import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { proposalPrompt } from "../src/cloudflare-free-generator.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { compileLearningCampaign, campaignAccounting, type LearningCampaignInput } from "../src/learning-campaign.ts";
import { AutonomousLearningWorker } from "../src/autonomous-learning-worker.ts";
import { createSaraServer } from "../src/server.ts";
import type { AddressInfo } from "node:net";
import type { CandidateGenerator } from "../src/types.ts";

const token = "local-only-campaign-test-owner";
const config: LearningCampaignInput = {id:"autonomous-skills-20260908-v1",maximumRequests:10,contracts:[{
  capabilityId:"catalog-value-check",objective:"Return input unchanged for an authorized catalog workflow.",
  publicCriteria:["Return input unchanged."],estimatedEffort:1,
  acceptanceTests:[{name:"independent-object",input:{value:"PRIVATE_ACCEPTANCE_ANSWER"},expected:{value:"PRIVATE_ACCEPTANCE_ANSWER"}},
    {name:"independent-array",input:[2,3],expected:[2,3]}],
}]};
const echo: CandidateGenerator = {id:"campaign-test-double",external:false,maximumCostUsd:0,async generate(input){
  assert.doesNotMatch(JSON.stringify(input),/PRIVATE_ACCEPTANCE_ANSWER/);
  return {schemaVersion:1,skillName:"Preserve catalog",summary:"Fixture only",source:"export function runSkill(input: unknown): unknown { return input; }",
    tests:[{name:"producer",input:1,expected:1}],limitations:["Scripted fixture; no real learning claim."]};
}};
async function setup(maximumRequests=10) {
  const directory=await mkdtemp(join(tmpdir(),"sara-campaign-"));
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  const owner=kernel.authenticateOwnerToken(token),now=new Date();
  await kernel.activateStandingMandate(owner,{id:"campaign-learning",ownerId:owner.id,allowedActions:["business_candidate_development"],
    allowedChannels:["internal"],allowedServiceIds:["skill-learning"],maximumCostPerActionUsd:0,maximumDailyActions:2,maximumConcurrentActions:1,
    startsAt:new Date(now.getTime()-60000).toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString()},
    {approvalId:"fixture-mandate",ownerId:owner.id,action:"required_owner_approval_change",targetId:"standing-mandate:campaign-learning",approvedAt:now.toISOString()});
  const campaign={...config,maximumRequests};
  await kernel.configureLearningCampaign(owner,campaign,compileLearningCampaign(campaign).digest);
  const source=await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{objective:"Audit authorized catalog value formatting",expectedOwnerValue:4,
    requiredCapabilities:["catalog-value-check"],acceptanceCriteria:["Preserve customer catalog values."],maximumBudgetUsd:0});
  return {directory,kernel,owner,source,campaign};
}

test("campaign exact approval, immutable contracts and real gap selection survive restart",async()=>{
  const {directory,kernel,owner,source}=await setup();
  try {
    await assert.rejects(()=>kernel.configureLearningCampaign(SARA_PRINCIPAL,config,compileLearningCampaign(config).digest),/EXACT/);
    await assert.rejects(()=>kernel.configureLearningCampaign(owner,config,"0".repeat(64)),/EXACT/);
    const changed={...config,id:"renamed-campaign"};
    await assert.rejects(()=>kernel.configureLearningCampaign(owner,changed,compileLearningCampaign(changed).digest),/immutable/);
    const selected=await kernel.selectNextLearningObjective();assert.equal(selected?.learningSourceJobId,source.id);
    assert.equal(selected?.learningCapabilityId,"catalog-value-check");
    assert.doesNotMatch(JSON.stringify(selected),/PRIVATE_ACCEPTANCE_ANSWER/);
    await assert.rejects(()=>kernel.runSelfBuildCycle(SARA_PRINCIPAL,selected!.id,echo),/RESERVATION_REQUIRED/);
    const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
    assert.equal(await reboot.selectNextLearningObjective(),null);
    assert.equal((await reboot.learningCampaignStatus()).selections.length,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("worker selects, qualifies, and ordinary task routing survives a real child-process restart",async()=>{
  const {directory,kernel,owner,source}=await setup();let calls=0;
  let server: ReturnType<typeof createSaraServer>|undefined;
  try {
    const worker=new AutonomousLearningWorker(kernel,{...echo,async generate(input){calls++;return echo.generate(input);}});
    assert.equal((await worker.tick()).status,"qualified");
    const status=await kernel.getStatus();const mutation=status.mutations[0]!;
    await assert.rejects(()=>kernel.invokeLearnedSkill(owner,"catalog-value-check",4),/QUALIFIED_APPROVED/);
    await assert.rejects(()=>kernel.promoteMutation(SARA_PRINCIPAL,mutation.id,"CANARY"));
    await kernel.promoteMutation(owner,mutation.id,"CANARY",{approvalId:"exact-test-promotion",ownerId:owner.id,
      action:"production_promotion",targetId:`${mutation.id}:CANARY`,approvedAt:new Date().toISOString()});
    const child=await promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","--eval",`
      import {SaraKernel} from ${JSON.stringify(new URL("../src/kernel.ts",import.meta.url).href)};
      import {sha256} from ${JSON.stringify(new URL("../src/canonical.ts",import.meta.url).href)};
      const kernel=await SaraKernel.boot({stateDirectory:process.argv[1],ownerTokenSha256:sha256(process.argv[2])});
      const result=await kernel.executeTaskWithLearnedSkill(kernel.authenticateOwnerToken(process.argv[2]),process.argv[3],{restart:[17,29]});
      process.stdout.write(JSON.stringify({pid:process.pid,...result}));
    `,"--",directory,token,source.id],{timeout:15000});
    const saved=JSON.parse(child.stdout);assert.notEqual(saved.pid,process.pid);
    assert.deepEqual(saved.output,{restart:[17,29]});assert.equal(saved.candidateDigest,mutation.candidateDigest);
    const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
    server=createSaraServer(reboot,{ownerTokenSha256:sha256(token),stateDirectory:directory});
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
    const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs/${source.id}/execute`;
    assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({capabilityId:"catalog-value-check",input:4})})).status,401);
    const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({capabilityId:"catalog-value-check",input:{fresh:[9,8]}})});
    assert.equal(response.status,200);assert.deepEqual(((await response.json()) as {output:unknown}).output,{fresh:[9,8]});
    assert.equal((await reboot.learningCampaignStatus()).reuses.length,2);assert.equal(calls,1);
    const task=await reboot.createSelfDevelopmentJob(reboot.authenticateOwnerToken(token),{objective:"New ordinary task",expectedOwnerValue:1,
      requiredCapabilities:["catalog-value-check"],acceptanceCriteria:["Preserve input"],maximumBudgetUsd:0});
    assert.deepEqual(task.workCard.missingCapabilities,[]);
    await reboot.setEmergencyStop(reboot.authenticateOwnerToken(token),true);
    await assert.rejects(()=>reboot.invokeLearnedSkill(reboot.authenticateOwnerToken(token),"catalog-value-check",4));
    await reboot.setEmergencyStop(reboot.authenticateOwnerToken(token),false);
    await reboot.revokeStandingMandate(reboot.authenticateOwnerToken(token),"campaign-learning","End bounded test");
    await assert.rejects(()=>reboot.invokeLearnedSkill(reboot.authenticateOwnerToken(token),"catalog-value-check",4),/MANDATE/);
  }finally{if(server)await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));await rm(directory,{recursive:true,force:true});}
});

test("independent acceptance rejects producer-only success and cannot be bypassed by promotion",async()=>{
  const {directory,kernel,owner}=await setup();
  try {
    assert.equal((await new AutonomousLearningWorker(kernel,{...echo,async generate(){return {...await echo.generate({} as never),source:"export function runSkill(input: unknown): unknown { return 1; }"};}}).tick()).status,"rejected");
    const mutation=(await kernel.getStatus()).mutations[0]!;
    await assert.rejects(()=>kernel.promoteMutation(owner,mutation.id,"CANARY",{approvalId:"fixture",action:"production_promotion",targetId:`${mutation.id}:CANARY`,ownerId:owner.id,approvedAt:new Date().toISOString()}),/INDEPENDENT/);
    assert.doesNotMatch(JSON.stringify((await kernel.learningCampaignStatus()).qualifications),/PRIVATE_ACCEPTANCE_ANSWER/);
    assert.equal(await kernel.selectNextLearningObjective(),null);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("two workers reserve at most one dispatch and campaign quota never resets",async()=>{
  const {directory,kernel,owner,campaign}=await setup(1);let calls=0;
  try {
    const generator={...echo,async generate(){calls++;throw new Error("Uncertain provider response");}};
    const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
    await Promise.all([new AutonomousLearningWorker(kernel,generator).tick(),new AutonomousLearningWorker(reboot,generator).tick()]);
    assert.equal(calls,1);
    await kernel.configureLearningCampaign(owner,campaign,compileLearningCampaign(campaign).digest);
    assert.equal((await reboot.learningCampaignStatus()).campaign?.remaining,0);
    assert.equal((await reboot.runNextAutonomousLearningCycle(generator)).status,"blocked");assert.equal(calls,1);
    assert.throws(()=>compileLearningCampaign({...config,maximumRequests:11}));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("failed metadata lesson reaches one child after restart, with no third generation",async()=>{
  const {directory,kernel}=await setup();let calls=0;
  const generator:CandidateGenerator={...echo,async generate(input){calls++;if(calls===2)assert.match(JSON.stringify(input.memoryContext),/300 characters or fewer/);
    return {...await echo.generate(input),limitations:["x".repeat(438)]};}};
  try {
    assert.equal((await new AutonomousLearningWorker(kernel,generator).tick()).status,"failed");
    const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
    assert.equal((await new AutonomousLearningWorker(reboot,generator).tick()).status,"failed");
    assert.equal((await new AutonomousLearningWorker(reboot,generator).tick()).status,"blocked");
    assert.equal(calls,2);assert.equal((await reboot.learningCampaignStatus()).selections.length,1);
    assert.equal((await reboot.getStatus()).jobs.filter(j=>j.learningCampaignId).length,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("pure initial generation rejects constructor destructuring before execution",async()=>{
  const {directory,kernel}=await setup();
  try {
    const source=await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{objective:"Isolation regression",expectedOwnerValue:0,requiredCapabilities:[],acceptanceCriteria:["Reject dynamic code construction."],maximumBudgetUsd:0});
    await assert.rejects(()=>kernel.runSelfBuildCycle(SARA_PRINCIPAL,source.id,{...echo,async generate(){return {...await echo.generate({} as never),
      source:'export function runSkill(input: unknown): unknown { const { constructor: factory } = (() => 2); const calculate = factory("return 2"); return calculate(); }',tests:[{name:"harmless",input:1,expected:2}]};}}),/property constructor is prohibited/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("content-equivalent reordering moves precise feedback after the same rejected candidate",async()=>{
  const proposal=await echo.generate({} as never);
  if(proposal.candidateKind === "typescript_program")throw new Error("Fixture requires pure skill");
  const input={objective:"Preserve input",acceptanceCriteria:["Return input"],missingCapabilities:[],constitutionDigest:"a".repeat(64),memoryContext:{contextDigest:"b".repeat(64),memories:[]}};
  const feedback="TS18048 at skill.ts:41:27: A value may be undefined; narrow it before accessing its fields.";
  const original=proposalPrompt(input,proposal,feedback,"feedback-first");
  const reordered=proposalPrompt(input,proposal,feedback,"candidate-first");
  assert.deepEqual(original.split("\n").sort(),reordered.split("\n").sort());
  assert.ok(original.indexOf(feedback)<original.indexOf("Previous rejected candidate (bounded repair context):"));
  assert.ok(reordered.indexOf(feedback)>reordered.indexOf("Previous rejected candidate (bounded repair context):"));
});

test("a stop on/off during generation invalidates its authority without refunding its request",async()=>{
  const {directory,kernel,owner}=await setup();
  try {
    let started!:()=>void,finish!:()=>void;
    const waiting=new Promise<void>(resolve=>{started=resolve});const released=new Promise<void>(resolve=>{finish=resolve});
    const pending=new AutonomousLearningWorker(kernel,{...echo,async generate(input){started();await released;return echo.generate(input);}}).tick();
    await waiting;await kernel.setEmergencyStop(owner,true);await kernel.setEmergencyStop(owner,false);finish();
    assert.equal((await pending).status,"failed");
    assert.equal((await kernel.learningCampaignStatus()).campaign?.reserved,1);
    assert.equal((await kernel.getStatus()).mutations.length,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
