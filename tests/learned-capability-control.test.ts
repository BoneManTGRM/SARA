import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { compileLearningCampaign } from "../src/learning-campaign.ts";
import { AutonomousLearningWorker } from "../src/autonomous-learning-worker.ts";
import { readProductionStateFingerprint } from "../src/production-state-fingerprint.ts";
import type { Principal, OwnerApproval, CandidateGenerator } from "../src/types.ts";

// Public contract declared before implementation so the baseline failure is an assertion,
// not a missing-module or TypeScript setup error.
type ControlRequest = {
  requestId: string; mutationId: string; candidateDigest: string;
  state: "ACTIVE" | "QUARANTINED" | "DISABLED"; priorState: string;
  reason: string; evidenceEventIds: string[]; expectedControlSequence: number;
  qualificationEventId: string | null; targetId: string;
};
type ControlledKernel = SaraKernel & {
  reviewLearnedCapabilityControl(owner: Principal, mutationId: string, input: {
    requestId: string; state: ControlRequest["state"]; reason: string; evidenceEventIds: string[];
  }): Promise<ControlRequest>;
  changeLearnedCapabilityControl(owner: Principal, request: ControlRequest, approval: OwnerApproval): Promise<unknown>;
  requalifyLearnedCapability(owner: Principal, mutationId: string): Promise<{status:string}>;
  inspectLearnedCapabilityControls(): Promise<Array<{mutationId:string;state:string;sequence:number}>>;
};
const token = "isolated-control-test-owner";
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sara-capability-control-"));
  const kernel = await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}) as ControlledKernel;
  assert.equal(typeof kernel.reviewLearnedCapabilityControl, "function", "Learned capabilities require an owner-reviewable disable/quarantine control");
  const owner = kernel.authenticateOwnerToken(token), now = new Date();
  await kernel.activateStandingMandate(owner, {id:"control-fixture",ownerId:owner.id,
    allowedActions:["business_candidate_development"],allowedChannels:["internal"],allowedServiceIds:["skill-learning"],
    maximumCostPerActionUsd:0,maximumDailyActions:20,maximumConcurrentActions:1,
    startsAt:new Date(now.getTime()-60000).toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString()},
    {approvalId:"control-fixture",ownerId:owner.id,action:"required_owner_approval_change",targetId:"standing-mandate:control-fixture",approvedAt:now.toISOString()});
  const campaign = {id:"control-qualification",maximumRequests:10,contracts:[{
    capabilityId:"controlled-identity",objective:"Preserve supplied JSON except the unsupported sentinel.",publicCriteria:["Return supplied supported JSON unchanged."],estimatedEffort:1,
    acceptanceTests:[{name:"object",input:{v:17},expected:{v:17}},{name:"array",input:[2,7],expected:[2,7]}]}]};
  await kernel.configureLearningCampaign(owner,campaign,compileLearningCampaign(campaign).digest);
  await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{objective:"Use the bounded identity capability",expectedOwnerValue:1,
    requiredCapabilities:["controlled-identity"],acceptanceCriteria:["Preserve supported input"],maximumBudgetUsd:0});
  const generator: CandidateGenerator = {id:"control-fixture-generator",external:false,maximumCostUsd:0,async generate(){
    return {schemaVersion:1,skillName:"Controlled identity",summary:"Isolated qualification only",
      source:'export function runSkill(input: unknown): unknown { return input === "unsupported-sentinel" ? undefined : input; }',
      tests:[{name:"producer",input:5,expected:5}],limitations:["The unsupported sentinel deliberately fails; fixture only."]};
  }};
  assert.equal((await new AutonomousLearningWorker(kernel,generator).tick()).status,"qualified");
  const mutation = (await kernel.getStatus()).mutations[0]!;
  await kernel.promoteMutation(owner,mutation.id,"CANARY",{approvalId:"control-promotion",ownerId:owner.id,
    action:"production_promotion",targetId:`${mutation.id}:CANARY`,approvedAt:now.toISOString()});
  const evidenceEventIds = (await kernel.inspectAudit()).filter(e=>e.type==="learning_qualification_passed").map(e=>e.id);
  return {directory,kernel,owner,mutation,evidenceEventIds};
}
const approval = (owner:Principal,request:ControlRequest): OwnerApproval => ({approvalId:request.requestId,ownerId:owner.id,
  action:request.state==="ACTIVE"?"production_promotion":"protected_security_control_change",targetId:request.targetId,approvedAt:new Date().toISOString()});
async function change(f:Awaited<ReturnType<typeof fixture>>,state:ControlRequest["state"],requestId:string) {
  const request=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,{requestId,state,reason:"Controlled regression exercise",evidenceEventIds:f.evidenceEventIds});
  await f.kernel.changeLearnedCapabilityControl(f.owner,request,approval(f.owner,request));
  return request;
}

test("quarantine and disable stop normal execution without erasing promotion or evidence; fresh exact owner restoration is mandatory",async()=>{
  const f=await fixture();
  try {
    assert.deepEqual((await f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",{ok:1})).output,{ok:1});
    const originalAudit=await f.kernel.inspectAudit();
    const quarantine=await change(f,"QUARANTINED","quarantine-1");
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]!.state,"QUARANTINED");
    const restricted=await f.kernel.getStatus();
    assert.equal(restricted.mutations[0]!.stage,"CANARY");
    assert.deepEqual(restricted.mutations[0]!.evidence,f.mutation.evidence);
    assert.equal(restricted.capabilities.find(c=>c.id==="controlled-identity")?.status,"limited");
    await assert.rejects(()=>f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",1),/QUARANTINED|MAINTENANCE/);
    await assert.rejects(()=>f.kernel.promoteMutation(f.owner,f.mutation.id,"LIMITED_PRODUCTION",{...approval(f.owner,quarantine),action:"production_promotion",targetId:`${f.mutation.id}:LIMITED_PRODUCTION`}),/QUARANTINED|MAINTENANCE/);
    await assert.rejects(()=>change(f,"ACTIVE","restore-too-early"),/FRESH.*QUALIFICATION/);
    const disable=await change(f,"DISABLED","disable-1");
    await assert.rejects(()=>f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",1),/DISABLED|MAINTENANCE/);
    await assert.rejects(()=>f.kernel.requalifyLearnedCapability(SARA_PRINCIPAL,f.mutation.id),/OWNER/);
    assert.equal((await f.kernel.requalifyLearnedCapability(f.owner,f.mutation.id)).status,"qualified");
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]!.state,"DISABLED","Qualification must not re-enable code");
    const restore=await change(f,"ACTIVE","restore-1");
    assert.deepEqual((await f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",[3,4])).output,[3,4]);
    const beforeReplay=(await f.kernel.inspectAudit()).length;
    await f.kernel.changeLearnedCapabilityControl(f.owner,restore,approval(f.owner,restore));
    assert.equal((await f.kernel.inspectAudit()).length,beforeReplay,"Identical replay must not append duplicate events");
    const finalAudit=await f.kernel.inspectAudit();
    assert.deepEqual(finalAudit.slice(0,originalAudit.length),originalAudit);
    assert.equal(finalAudit.filter(e=>e.type==="learned_capability_control_changed").length,3);
    assert.ok(disable.targetId!==restore.targetId);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("forged owners, untrusted opinions, stale exact approvals and cross-target requests cannot change controls",async()=>{
  const f=await fixture();
  try {
    const input={requestId:"authority-1",state:"QUARANTINED" as const,reason:"Explicit owner decision",evidenceEventIds:f.evidenceEventIds};
    await assert.rejects(()=>f.kernel.reviewLearnedCapabilityControl({id:"OWNER",kind:"owner",authenticated:true},f.mutation.id,input),/OWNER/);
    const request=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,input);
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(SARA_PRINCIPAL,request,approval(f.owner,request)),/OWNER/);
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(f.owner,{...request,candidateDigest:"f".repeat(64)},approval(f.owner,request)),/IDENTITY|APPROVAL|STALE/);
    await change(f,"DISABLED","authority-disable");
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(f.owner,request,approval(f.owner,request)),/STALE/);
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]!.state,"DISABLED");
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("quarantine survives an actual process restart and isolated copied-state restore with its audit prefix intact",async()=>{
  const f=await fixture();const restored=`${f.directory}-restored`;
  try {
    await change(f,"QUARANTINED","restart-quarantine");
    const before=await readProductionStateFingerprint(f.directory);
    await cp(f.directory,restored,{recursive:true,force:false});
    assert.deepEqual(await readProductionStateFingerprint(restored),before);
    const child=await promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","--eval",`
      import {SaraKernel} from ${JSON.stringify(new URL("../src/kernel.ts",import.meta.url).href)};
      import {sha256} from ${JSON.stringify(new URL("../src/canonical.ts",import.meta.url).href)};
      const k=await SaraKernel.boot({stateDirectory:process.argv[1],ownerTokenSha256:sha256(process.argv[2])});
      let denied=false;try{await k.invokeLearnedSkill(k.authenticateOwnerToken(process.argv[2]),"controlled-identity",7);}catch{denied=true;}
      process.stdout.write(JSON.stringify({pid:process.pid,controls:await k.inspectLearnedCapabilityControls(),denied}));
    `,"--",restored,token],{timeout:20000});
    const result=JSON.parse(child.stdout);
    assert.notEqual(result.pid,process.pid);assert.equal(result.denied,true);assert.equal(result.controls[0].state,"QUARANTINED");
    const after=await readProductionStateFingerprint(restored);assert.ok(after.audit.eventCount>before.audit.eventCount);
  }finally{await rm(f.directory,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});

test("task-specific invalid output does not automatically disable a skill whose frozen independent qualification still passes",async()=>{
  const f=await fixture();
  try {
    await assert.rejects(()=>f.kernel.invokeLearnedSkill(f.owner,"controlled-identity","unsupported-sentinel"));
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]!.state,"ACTIVE");
    assert.deepEqual((await f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",{still:"valid"})).output,{still:"valid"});
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("objective retained-artifact integrity failure quarantines and restoration still requires fresh qualification",async()=>{
  const f=await fixture();
  try {
    const path=join(f.directory,f.mutation.artifactRelativePath!,"runtime","skill.mjs");
    const original=await readFile(path,"utf8");await writeFile(path,original+"\n// tampered\n");
    await assert.rejects(()=>f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",7));
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]!.state,"QUARANTINED");
    await writeFile(path,original);
    await assert.rejects(()=>change(f,"ACTIVE","integrity-early-restore"),/FRESH.*QUALIFICATION/);
    assert.equal((await f.kernel.requalifyLearnedCapability(f.owner,f.mutation.id)).status,"qualified");
    await change(f,"ACTIVE","integrity-restored");
    assert.equal((await f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",7)).output,7);
    const audit=await f.kernel.inspectAudit();
    assert.ok(audit.some(e=>e.type==="learning_skill_reuse_failed"));
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("an in-flight pure execution cannot return success after the owner withdraws its operational eligibility",async()=>{
  const f=await fixture();
  try {
    const request=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,{requestId:"concurrent-disable",state:"DISABLED",reason:"Withdraw eligibility while running",evidenceEventIds:f.evidenceEventIds});
    const execution=f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",11);
    const settled=execution.then(()=>"returned",()=>"withheld");
    await f.kernel.changeLearnedCapabilityControl(f.owner,request,approval(f.owner,request));
    assert.equal(await settled,"withheld");
    assert.equal((await f.kernel.inspectAudit()).filter(e=>e.type==="learning_skill_reused").length,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("owner HTTP control requires authentication, exact preview confirmation and does not re-enable after requalification",async()=>{
  const f=await fixture();
  const {createSaraServer}=await import("../src/server.ts");
  const server=createSaraServer(f.kernel,{ownerTokenSha256:sha256(token),stateDirectory:f.directory,
    readOnlyBridgeTokenSha256:sha256("unprivileged-bridge")});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address() as {port:number}; const base=`http://127.0.0.1:${address.port}`;
  const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
  const call=(path:string,body:unknown,authorization=headers)=>fetch(`${base}${path}`,{method:"POST",headers:authorization,body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(`${base}/api/learning/controls`)).status,401);
    assert.equal((await fetch(`${base}/api/learning/controls`,{headers:{Authorization:"Bearer unprivileged-bridge"}})).status,401);
    const read=await fetch(`${base}/api/learning/controls`,{headers});
    assert.equal(read.status,200,"The authenticated control projection must be exposed");
    assert.equal(((await read.json()) as {state:string}[])[0]?.state,"ACTIVE");
    const input={mutationId:f.mutation.id,requestId:"http-quarantine",state:"QUARANTINED",reason:"Owner investigation",evidenceEventIds:f.evidenceEventIds};
    assert.equal((await call("/api/learning/controls/review",input, {Authorization:"Bearer attacker","Content-Type":"application/json"})).status,401);
    const reviewed=await call("/api/learning/controls/review",input);
    assert.equal(reviewed.status,200);const request=await reviewed.json() as ControlRequest;
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]?.state,"ACTIVE","Review is not approval");
    assert.equal((await call("/api/learning/controls/apply",{request,approvedTargetId:"not-the-target"})).status,409);
    assert.equal((await call("/api/learning/controls/apply",{request,approvedTargetId:request.targetId})).status,200);
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]?.state,"QUARANTINED");
    assert.equal((await call("/api/learning/requalify",{mutationId:f.mutation.id})).status,200);
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]?.state,"QUARANTINED");
    assert.equal((await call("/api/learning/controls/apply",{request,approvedTargetId:request.targetId})).status,200,"Exact replay remains idempotent");
  }finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));await rm(f.directory,{recursive:true,force:true});}
});

test("control requests reject malformed data, nonexistent evidence, replay conflicts, and wrong exact authority",async()=>{
  const f=await fixture();
  try {
    const good={requestId:"bounded-control",state:"QUARANTINED" as const,reason:"Owner diagnosis",evidenceEventIds:f.evidenceEventIds};
    for(const input of [null,{}, {...good,evidenceEventIds:[]},{...good,state:"RESTORE"},{...good,reason:"password=secret"},
      {...good,requestId:"../escape"},{...good,evidenceEventIds:["nonexistent-proof"]},{...good,authority:"system"}]) {
      await assert.rejects(()=>f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,input as never));
    }
    const request=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,good);
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(f.owner,request,{...approval(f.owner,request),targetId:"different-target"}),/APPROVAL/);
    await f.kernel.changeLearnedCapabilityControl(f.owner,request,approval(f.owner,request));
    const conflict=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,{...good,state:"DISABLED"});
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(f.owner,conflict,approval(f.owner,conflict)),/REPLAY_CONFLICT/);
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]?.state,"QUARANTINED");
    assert.equal((await f.kernel.requalifyLearnedCapability(f.owner,f.mutation.id)).status,"qualified");
    const oldRestore=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,{...good,requestId:"older-restore",state:"ACTIVE"});
    await change(f,"DISABLED","newer-restriction");
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(f.owner,oldRestore,approval(f.owner,oldRestore)),/STALE/);
    await assert.rejects(()=>change(f,"ACTIVE","newest-restore-needs-proof"),/FRESH.*QUALIFICATION/);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("emergency stop preserves inspection but blocks control mutation, restoration verification, and execution",async()=>{
  const f=await fixture();
  try {
    const request=await f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,{requestId:"stop-control",state:"QUARANTINED",reason:"Owner investigation",evidenceEventIds:f.evidenceEventIds});
    await f.kernel.setEmergencyStop(f.owner,true);
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]?.state,"ACTIVE");
    await assert.rejects(()=>f.kernel.changeLearnedCapabilityControl(f.owner,request,approval(f.owner,request)),/stop|STOP/i);
    await assert.rejects(()=>f.kernel.invokeLearnedSkill(f.owner,"controlled-identity",1),/stop|STOP/i);
    await assert.rejects(()=>f.kernel.requalifyLearnedCapability(f.owner,f.mutation.id),/stop|STOP/i);
    await f.kernel.setEmergencyStop(f.owner,false);
    await f.kernel.changeLearnedCapabilityControl(f.owner,request,approval(f.owner,request));
    assert.equal((await f.kernel.inspectLearnedCapabilityControls())[0]?.state,"QUARANTINED");
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("separate processes cannot both apply competing controls from the same version",async()=>{
  const f=await fixture();
  try {
    const requests=await Promise.all((["QUARANTINED","DISABLED"] as const).map((state,i)=>f.kernel.reviewLearnedCapabilityControl(f.owner,f.mutation.id,
      {requestId:`competing-${i}`,state,reason:"Owner concurrent control",evidenceEventIds:f.evidenceEventIds})));
    const program=`
      import {SaraKernel} from ${JSON.stringify(new URL("../src/kernel.ts",import.meta.url).href)};
      import {sha256} from ${JSON.stringify(new URL("../src/canonical.ts",import.meta.url).href)};
      const [directory,token,request,approval]=JSON.parse(process.argv[1]);
      const k=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
      try { await k.changeLearnedCapabilityControl(k.authenticateOwnerToken(token),request,approval);process.stdout.write("applied"); }
      catch(error){if(!/STALE/.test(error.message))throw error;process.stdout.write("stale");}
    `;
    const outcomes=await Promise.all(requests.map(request=>promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","--eval",program,"--",
      JSON.stringify([f.directory,token,request,approval(f.owner,request)])],{timeout:30000,maxBuffer:65536})));
    assert.deepEqual(outcomes.map(value=>value.stdout).sort(),["applied","stale"]);
    assert.equal((await f.kernel.inspectAudit()).filter(e=>e.type==="learned_capability_control_changed").length,1);
    await readProductionStateFingerprint(f.directory);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
