import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createCloudflareFreeCandidateGenerator } from "../src/cloudflare-free-generator.ts";
import { sha256 } from "../src/canonical.ts";
import { AutonomousLearningWorker } from "../src/autonomous-learning-worker.ts";

const ownerToken="local-test-owner-token";
async function setupQueue(directory:string) {
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
  const owner=kernel.authenticateOwnerToken(ownerToken);
  const now=Date.now();
  await kernel.activateStandingMandate(owner,{
    id:"learning-test",ownerId:owner.id,allowedActions:["business_candidate_development"],allowedChannels:["internal"],allowedServiceIds:["skill-learning"],
    maximumCostPerActionUsd:0,maximumConcurrentActions:1,maximumDailyActions:20,
    startsAt:new Date(now-60_000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),
  },{approvalId:"test-approval",ownerId:owner.id,action:"required_owner_approval_change",targetId:"standing-mandate:learning-test",approvedAt:new Date(now).toISOString()});
  return {kernel,owner};
}
function enqueue(kernel:SaraKernel,value=1) {return kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{
  objective:"Validate catalog rows.",expectedOwnerValue:value,requiredCapabilities:["autonomous-learning","catalog-rows"],acceptanceCriteria:["Return input unchanged."],maximumBudgetUsd:0,
});}

const request = { objective: "Validate catalog rows.", acceptanceCriteria: [], missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: {contextDigest:"b".repeat(64),memories:[]} };
const credentials = {accountId:"a".repeat(32),apiToken:"test-placeholder-token-only",workersPlan:"free"};

test("parsing failures distinguish ambiguity and preserve safe completion evidence", async () => {
  for (const [content, expected] of [["PRIVATE malformed", /complete_objects=0/], ['{"a":1}\n{"b":2}', /complete_objects=2/]]) {
    const generator=createCloudflareFreeCandidateGenerator({...credentials,async fetcher(){return Response.json({choices:[{finish_reason:"length",message:{content,reasoning_content:"PRIVATE"}}],usage:{prompt_tokens:12,completion_tokens:8192}});}});
    await assert.rejects(()=>generator.generate(request),(error:Error)=>{
      assert.match(error.message,expected as RegExp);
      assert.match(error.message,/finish_reason=length; prompt_tokens=12; completion_tokens=8192/);
      assert.doesNotMatch(error.message,/PRIVATE/);return true;
    });
  }
});

test("autonomous queue requires a mandate, prioritizes value, and consumes failed reservations across restart", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-queue-"));
  try {
    let kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
    const low=await enqueue(kernel,1), high=await enqueue(kernel,3);
    let calls=0;
    const generator={id:"queue-failure-fixture",external:false,maximumCostUsd:0,async generate():Promise<never>{calls++;throw new Error("PRIVATE provider failure");}};
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"blocked");
    assert.equal(calls,0);
    ({kernel}=await setupQueue(directory));
    assert.deepEqual(await kernel.runNextAutonomousLearningCycle(generator),{status:"failed",jobId:high.id});
    kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
    assert.deepEqual(await kernel.runNextAutonomousLearningCycle(generator),{status:"failed",jobId:low.id});
    await enqueue(kernel,5);
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"failed");
    assert.equal(calls,3);
    for(let index=0;index<17;index++){
      await enqueue(kernel,6+index);
      assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"failed");
    }
    await enqueue(kernel,30);
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"blocked");
    assert.equal(calls,20);
    await assert.rejects(()=>kernel.runNextAutonomousLearningCycle({...generator,maximumCostUsd:.01}),/zero-cost/);
    const memory=await kernel.recallMemory({query:"Validate catalog rows",scope:"global",categories:["failure"]});
    assert.doesNotMatch(JSON.stringify(memory),/PRIVATE/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("two consumers cannot duplicate a learning dispatch, including after restart", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-exclusive-"));
  try {
    const {kernel}=await setupQueue(directory);
    await enqueue(kernel);
    let release!:()=>void,entered!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    const started=new Promise<void>(resolve=>{entered=resolve;});
    let calls=0;
    const generator={id:"queue-interruption-fixture",external:false,maximumCostUsd:0,async generate():Promise<never>{calls++;entered();await pending;throw new Error("Interrupted fixture");}};
    const worker=new AutonomousLearningWorker(kernel,generator);
    const first=worker.tick();await started;
    try {
      assert.equal((await worker.tick()).status,"blocked");
      const rebooted=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
      assert.equal((await rebooted.runNextAutonomousLearningCycle(generator)).status,"blocked");
      assert.equal(calls,1);
    } finally {release();await first;}
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("revocation during generation rejects the candidate before verification", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-revoke-"));
  try {
    const {kernel,owner}=await setupQueue(directory);
    await enqueue(kernel);
    const result=await kernel.runNextAutonomousLearningCycle({id:"queue-revoke-fixture",external:false,maximumCostUsd:0,async generate(){
      await kernel.revokeStandingMandate(owner,"learning-test","Stop learning test");
      return {schemaVersion:1,skillName:"Echo",summary:"Test only",source:"export function runSkill(input: unknown): unknown { return input; }",tests:[{name:"one",input:1,expected:1},{name:"two",input:2,expected:2}],limitations:["Fixture, not acquired skill"]};
    }});
    assert.equal(result.status,"failed");assert.equal((await kernel.getStatus()).mutations.length,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("a fixture-generated verified artifact remains SHADOW after restart without operational authority", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-shadow-"));
  try {
    const {kernel}=await setupQueue(directory);await enqueue(kernel);
    let calls=0;
    const result=await kernel.runNextAutonomousLearningCycle({id:"queue-echo-fixture",external:false,maximumCostUsd:0,async generate(){calls++;return {
      schemaVersion:1,skillName:"Catalog echo",summary:"Preserve catalog input",source:"export function runSkill(input: unknown): unknown { return input; }",
      tests:[{name:"one",input:[{sku:"A"}],expected:[{sku:"A"}]},{name:"empty",input:[],expected:[]}],limitations:["Codex fixture; no actual learning claim"],
    };}});
    assert.equal(result.status,"verified_shadow");
    const before=(await kernel.getStatus()).mutations[0]!;
    const rebooted=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
    const after=(await rebooted.getStatus()).mutations[0]!;
    assert.equal(after.candidateDigest,before.candidateDigest);assert.equal(after.stage,"SHADOW");
    assert.equal(after.artifactRelativePath,before.artifactRelativePath);
    assert.equal((await rebooted.routeOperationalSkillContext("Catalog echo")).length,0);
    const memories=await rebooted.recallMemory({query:"Validate catalog rows",scope:"global",categories:["skill"]});
    const retained=memories.relevant.find(memory=>memory.id===`learning-skill-${after.id}`);
    assert.ok(retained);
    assert.ok(retained.dependencies.includes(`candidate:${after.candidateDigest}`));
    assert.match(retained.statement,/SHADOW.*profit are not established/);
    assert.equal(calls,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("emergency stop prevents autonomous generation", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-stop-"));
  try {
    const {kernel,owner}=await setupQueue(directory);await enqueue(kernel);
    await kernel.setEmergencyStop(owner,true);
    let calls=0;
    const result=await kernel.runNextAutonomousLearningCycle({id:"queue-stop-fixture",external:false,maximumCostUsd:0,async generate():Promise<never>{calls++;throw new Error("Must not dispatch");}});
    assert.equal(result.status,"blocked");assert.equal(calls,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("recalled failure context excludes other objectives and bounds exposed evidence",async()=>{
  let prompt="";
  const generator=createCloudflareFreeCandidateGenerator({...credentials,async fetcher(_url,init){prompt=JSON.parse(String(init?.body)).messages[1].content;return Response.json({choices:[{message:{content:"invalid"}}]});}});
  const base={category:"failure" as const,scope:"global",confidence:1,verification:"measured" as const,observedAt:new Date().toISOString(),lastValidatedAt:new Date().toISOString(),dependencies:[]};
  await assert.rejects(()=>generator.generate({...request,memoryContext:{contextDigest:"b".repeat(64),memories:[
    {...base,id:"other",source:`sara://learning-failure/${sha256("another objective")}/x`,statement:"OTHER_PRIVATE_TASK"},
    ...Array.from({length:10},(_,i)=>({...base,id:`same-${i}`,source:`sara://learning-failure/${sha256(request.objective)}/x`,statement:"z".repeat(3000)})),
  ]}}));
  assert.doesNotMatch(prompt,/OTHER_PRIVATE_TASK/);assert.ok(prompt.length<10000);
  assert.equal((prompt.match(/"evidence":/g)??[]).length,2);
});

test("real rejection survives restart and reaches a later free-generator prompt", async () => {
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-memory-"));
  try {
    let kernel=await SaraKernel.boot({stateDirectory:directory});
    const job=await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{objective:request.objective,expectedOwnerValue:1,requiredCapabilities:["catalog-rows"],acceptanceCriteria:["Read catalog rows."],maximumBudgetUsd:0});
    await assert.rejects(()=>kernel.runSelfBuildCycle(SARA_PRINCIPAL,job.id,{id:"rejection-fixture",external:false,maximumCostUsd:0,async generate(){return {schemaVersion:1,skillName:"Catalog rows",summary:"Read a row.",source:"export function runSkill(input: unknown): unknown { return (input as string[])[0]; }",tests:[{name:"first",input:["A"],expected:"A"}],limitations:["Fixture only"]};}}),/computed property access/);
    kernel=await SaraKernel.boot({stateDirectory:directory});
    const recalled=await kernel.recallMemory({query:request.objective,scope:"global",categories:["failure"],limit:12});
    const evidence=recalled.relevant.find(m=>m.source.startsWith("sara://learning-failure/"));
    assert.ok(evidence,"Kernel failure must become durable learning evidence");
    let prompt="";
    const generator=createCloudflareFreeCandidateGenerator({...credentials,async fetcher(_url,init){prompt=JSON.parse(String(init?.body)).messages[1].content;return Response.json({choices:[{message:{content:"invalid"}}]});}});
    await assert.rejects(()=>generator.generate({...request,memoryContext:{contextDigest:recalled.contextDigest,memories:[evidence]}}));
    assert.match(prompt,/computed property access is prohibited/);
    assert.match(prompt,/untrusted evidence/i);
    assert.equal((await kernel.getStatus()).mutations.length,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});


test("actionable rejection iterates through a bounded four-attempt learning root across restart", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-recursive-"));
  try {
    let {kernel}=await setupQueue(directory);
    const root=await enqueue(kernel,3);
    let calls=0;
    const generator={id:"recursive-rejection-fixture",external:false,maximumCostUsd:0,async generate(input: Parameters<import("../src/types.ts").CandidateGenerator["generate"]>[0]){
      calls++;
      if(calls>=2) assert.ok(input.memoryContext.memories.some((memory: {source:string})=>memory.source.startsWith(`sara://learning-failure/${sha256(request.objective)}/`)));
      return {schemaVersion:1 as const,skillName:"Rows",summary:"Read rows",source:"export function runSkill(input: unknown): unknown { return (input as string[])[0]; }",tests:[{name:"first",input:["A"],expected:"A"}],limitations:["Fixture, not learned code"]};
    }};
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"failed");
    for(let attempt=2;attempt<=4;attempt++){
      kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
      const jobs=(await kernel.getStatus()).jobs;
      const next=jobs.find(job=>job.status==="authorized" && job.learningRootJobId===root.id);
      assert.ok(next);assert.deepEqual(await kernel.runNextAutonomousLearningCycle(generator),{status:"failed",jobId:next.id});
    }
    const jobs=(await kernel.getStatus()).jobs;
    const chain=jobs.filter(job=>job.id===root.id || job.learningRootJobId===root.id);
    assert.equal(chain.length,4);assert.equal(chain.filter(job=>Boolean(job.learningParentJobId)).length,3);
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"idle");
    assert.equal(calls,4);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("unknown failures and zero-value objectives cannot create a recursive backlog",async()=>{
  for(const actionable of [true,false]) {
    const directory=await mkdtemp(join(tmpdir(),"sara-learning-no-recursion-"));
    try {
      const {kernel}=await setupQueue(directory);await enqueue(kernel,actionable?0:2);
      await kernel.runNextAutonomousLearningCycle({id:"no-recursion-fixture",external:false,maximumCostUsd:0,async generate(){
        if(!actionable) throw new Error("Unknown provider failure");
        return {schemaVersion:1,skillName:"Rows",summary:"Read rows",source:"export function runSkill(input: unknown): unknown { return (input as string[])[0]; }",tests:[{name:"first",input:["A"],expected:"A"}],limitations:["Fixture"]};
      }});
      assert.equal((await kernel.getStatus()).jobs.length,1);
    } finally {await rm(directory,{recursive:true,force:true});}
  }
});

test("an evidence-responsive fixture repairs a rejected hypothesis and retains verified memory",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-recovery-"));
  try {
    let {kernel}=await setupQueue(directory);await enqueue(kernel,2);let calls=0;
    const generator: import("../src/types.ts").CandidateGenerator={id:"responsive-recovery-fixture",external:false,maximumCostUsd:0,async generate(input){
      calls++;
      const failure=input.memoryContext?.memories.find(memory=>memory.source.startsWith(`sara://learning-failure/${sha256(input.objective)}/`));
      if(failure) {
        assert.match(failure.statement,/computed property access/);
        return {schemaVersion:1,skillName:"Preserve rows",summary:"Return the input directly without indexed access",source:"export function runSkill(input: unknown): unknown { return input; }",tests:[{name:"rows",input:["A"],expected:["A"]},{name:"empty",input:[],expected:[]}],limitations:["Scripted responsiveness; not real model learning"]};
      }
      return {schemaVersion:1,skillName:"Read rows",summary:"Extract a row",source:"export function runSkill(input: unknown): unknown { return (input as string[])[0]; }",tests:[{name:"first",input:["A"],expected:"A"}],limitations:["Fixture"]};
    }};
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"failed");
    kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"verified_shadow");
    const status=await kernel.getStatus();assert.equal(status.jobs.filter(job=>job.status==="verified").length,1);
    assert.equal(status.jobs.filter(job=>job.status==="failed").length,1);assert.equal(calls,2);
    const rebooted=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken)});
    const memory=await rebooted.recallMemory({query:"Validate catalog rows",scope:"global",categories:["skill","failure"]});
    assert.ok(memory.relevant.some(item=>item.category==="failure"));assert.ok(memory.relevant.some(item=>item.category==="skill"));
    assert.equal((await rebooted.routeOperationalSkillContext("Preserve rows")).length,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("metadata rejection iterates through a bounded four-attempt learning root", async()=>{
  const directory=await mkdtemp(join(tmpdir(),"sara-learning-metadata-"));
  try {
    let {kernel}=await setupQueue(directory);
    const root=await enqueue(kernel,3);
    let calls=0;
    const generator={id:"recursive-metadata-fixture",external:false,maximumCostUsd:0,async generate(input: Parameters<import("../src/types.ts").CandidateGenerator["generate"]>[0]){
      calls++;
      if(calls>=2) assert.ok(input.memoryContext.memories.some(memory=>memory.statement.includes("300 characters or fewer")));
      return {schemaVersion:1 as const,skillName:"Rows",summary:"Read rows",source:"export function runSkill(input: unknown): unknown { return (input as string[])[0]; }",tests:[{name:"first",input:["A"],expected:"A"}],limitations:["x".repeat(438)]};
    }};
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"failed");
    for(let attempt=2;attempt<=4;attempt++){
      const next=(await kernel.getStatus()).jobs.find(job=>job.status==="authorized" && job.learningRootJobId===root.id);
      assert.ok(next);assert.deepEqual(await kernel.runNextAutonomousLearningCycle(generator),{status:"failed",jobId:next.id});
    }
    const jobs=(await kernel.getStatus()).jobs;
    assert.equal(jobs.filter(job=>job.id===root.id || job.learningRootJobId===root.id).length,4);
    assert.equal((await kernel.runNextAutonomousLearningCycle(generator)).status,"idle");
    assert.equal(calls,4);
  } finally {await rm(directory,{recursive:true,force:true});}
});
