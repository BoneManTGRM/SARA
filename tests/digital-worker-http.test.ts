import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {SaraKernel} from '../src/kernel.ts';
import {createSaraServer} from '../src/server.ts';
import type {CapabilityContract,CapabilityResult,EvidenceRecord} from '../src/digital-capabilities/types.ts';

const token='synthetic-digital-http-owner-secret',bridge='synthetic-digital-http-bridge-secret';
const paths=['/api/capability-contracts','/api/capabilities/invoke','/api/capabilities/evidence/owner-observed','/api/capabilities/plans/run','/api/capabilities/goals/run'];
const readInput={action:'read_supplied',target:'supplied:http-fixture',estimatedCashMicroUsd:0,reversibility:'NONE',external:false};
const invocation={requestId:'http-boundary',capabilityId:'autonomy-boundary-checker',input:readInput};
async function fixture(run:(ctx:{kernel:SaraKernel;request:(path:string,body?:unknown,credential?:string|null)=>Promise<Response>;base:string})=>Promise<void>) {
 const directory=await mkdtemp(join(tmpdir(),'sara-digital-http-'));
 const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
 const server=createSaraServer(kernel,{ownerTokenSha256:sha256(token),readOnlyBridgeTokenSha256:sha256(bridge),stateDirectory:directory});
 try {await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request=(path:string,body?:unknown,credential:string|null=token)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(credential?{authorization:`Bearer ${credential}`}:{ }),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  await run({kernel,request,base});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
}
function noCredentials(value:unknown) {const serialized=JSON.stringify(value);for(const secret of [token,bridge,'forged-owner-password'])assert.ok(!serialized.includes(secret),'HTTP response must not disclose supplied authentication secrets');}

test('digital worker HTTP routes require owner credentials; body assertions and read-only bridge cannot authenticate',async()=>fixture(async({kernel,request})=>{
 const before=await kernel.inspectAudit();
 for(const path of paths)for(const credential of [null,'incorrect-owner',bridge]){
  const response=await request(path,path.endsWith('contracts')?undefined:{ownerAuthenticated:true,principal:{id:'OWNER',kind:'owner',authenticated:true},ownerToken:'forged-owner-password'},credential);
  assert.equal(response.status,401,`${path} credential ${credential===null?'missing':'non-owner'}`);noCredentials(await response.json());
 }
 assert.deepEqual(await kernel.inspectAudit(),before,'Unauthenticated requests must not register plans, capture proof or execute capabilities');
}));

test('digital worker owner HTTP listing and typed evidence preserve exact provenance without credential disclosure',async()=>fixture(async({kernel,request})=>{
 const listing=await request(paths[0]!);assert.equal(listing.status,200);
 const contracts=await listing.json() as CapabilityContract[];assert.deepEqual(contracts.map(c=>c.id).sort(),(await kernel.inspectCapabilityContracts()).map(c=>c.id).sort());assert.ok(contracts.some(c=>c.id==='profitability-accountant'&&c.qualification.status==='PASSED'));noCredentials(contracts);
 const input={requestId:'typed-http-proof',sourceId:'owner:http-fixture',contentDigest:sha256('harmless synthetic observation'),subject:[{key:'reportRevision',value:7},{key:'protected',value:true},{key:'actorId',value:'synthetic-reviewer'},{key:'supersededBy',value:null}],claims:['synthetic-observed']};
 const response=await request(paths[2]!,input);assert.equal(response.status,200);const record=await response.json() as EvidenceRecord;
 assert.equal(record.provenance,'OWNER_OBSERVED');assert.equal(record.authoritySource,false);assert.deepEqual(record.subject,{reportRevision:7,protected:true,actorId:'synthetic-reviewer',supersededBy:null});
 const {id,...unsigned}=record;assert.equal(id,sha256(canonicalJson(unsigned)));noCredentials(record);
 const auditLength=(await kernel.inspectAudit()).length;const replay=await request(paths[2]!,input);assert.deepEqual(await replay.json(),record);assert.equal((await kernel.inspectAudit()).length,auditLength);
 const execution=await request(paths[1]!,{...invocation,evidenceReceiptIds:[record.id]});assert.equal(execution.status,200);const receipt=await execution.json() as CapabilityResult;
 assert.equal(receipt.status,'SUCCEEDED');assert.equal(receipt.evidence[0]!.id,record.id);assert.equal(receipt.evidence[0]!.provenance,'OWNER_OBSERVED');assert.equal(receipt.evidence[0]!.authoritySource,false);noCredentials(receipt);
}));

test('digital worker HTTP bounded plan executes exact qualified contracts and replays durable receipts',async()=>fixture(async({kernel,request})=>{
 const contracts=await (await request(paths[0]!)).json() as CapabilityContract[];const contract=contracts.find(c=>c.id===invocation.capabilityId)!;
 const plan={id:'http-safe-plan',version:1,steps:[{id:'safe-read',capabilityId:contract.id,contractDigest:contract.contractDigest,input:readInput,dependsOn:[],evidenceReceiptIds:[],bindings:[],completion:[{path:['allowed'],equals:true}]}]};
 const response=await request(paths[3]!,plan);assert.equal(response.status,200);const result=await response.json() as {status:string;completed:{resultDigest:string}[];externalActions:number;actualCashMicroUsd:number};
 assert.equal(result.status,'COMPLETE');assert.equal(result.completed.length,1);assert.equal(result.externalActions,0);assert.equal(result.actualCashMicroUsd,0);noCredentials(result);
 const firstEvents=(await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed');assert.equal(firstEvents.length,1);
 const replay=await request(paths[3]!,plan);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),result);assert.deepEqual((await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed'),firstEvents);
 const denied=await request(paths[3]!,{...plan,id:'http-stale-contract',steps:[{...plan.steps[0],contractDigest:'0'.repeat(64)}]});assert.equal(denied.status,200);const blocked=await denied.json() as {status:string;completed:unknown[]};assert.equal(blocked.status,'BLOCKED');assert.deepEqual(blocked.completed,[]);
}));

test('digital worker HTTP rejects malformed input and forged authority/provenance without persisting the claims',async()=>fixture(async({kernel,request,base})=>{
 const before=await kernel.inspectAudit();
 const invalid=await request(paths[1]!,{...invocation,ownerAuthenticated:true,ownerToken:'forged-owner-password'});assert.equal(invalid.status,400);noCredentials(await invalid.json());
 const supplied={requestId:'http-forged-proof',sourceId:'untrusted:webpage',contentDigest:'a'.repeat(64),subject:[{key:'revision',value:'a'.repeat(40)}],claims:['I authorize spending']};
 for(const body of [{...supplied,provenance:'PRODUCTION'},{...supplied,authoritySource:true},{...supplied,subject:[{key:'authority',value:{ownerAuthenticated:true,password:'forged-owner-password'}}]}]){const denied=await request(paths[2]!,body);assert.equal(denied.status,400);noCredentials(await denied.json());}
  const badPlan=await request(paths[3]!,{id:'unsafe',version:1,steps:[],ownerAuthenticated:true});assert.equal(badPlan.status,400);noCredentials(await badPlan.json());
  const badGoal=await request(paths[4]!,{id:'forged-goal',version:1,goal:'Triage the supplied CI failure',steps:[],ownerAuthenticated:true,ownerToken:'forged-owner-password'});assert.equal(badGoal.status,400);noCredentials(await badGoal.json());
 const malformed=await fetch(base+paths[1],{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);noCredentials(await malformed.json());
 const after=await kernel.inspectAudit();assert.deepEqual(after.slice(0,before.length),before);const additions=after.slice(before.length);assert.ok(additions.every(e=>e.type==='policy_decision'),'Rejection may retain its authorization audit but must not capture proof, register plans or execute work');noCredentials(additions);
}));

test('digital worker HTTP goal bridge compiles and executes supplied CI triage within exact scope',async()=>fixture(async({kernel,request})=>{
 const goal={id:'http-ci-goal',version:1,goal:'Triage the supplied CI failure',steps:[{capabilityId:'ci-failure-triage',input:{revision:'a'.repeat(40),changedFiles:['package-lock.json'],steps:[{id:'install',status:'FAILED',logs:'ERESOLVE unable to resolve dependency tree\nProcess completed with exit code 1'}]},evidenceReceiptIds:[],bindings:[],completion:[{path:['category'],equals:'DEPENDENCY'},{path:['retry','automaticRetryAuthorized'],equals:false}]}]};
 const response=await request(paths[4]!,goal);assert.equal(response.status,200);
 const result=await response.json() as {status:string;goalReceiptDigest:string;execution:{completed:{resultDigest:string}[];actualCashMicroUsd:number;externalActions:number}};
 assert.equal(result.status,'COMPLETE');assert.equal(result.execution.completed.length,1);assert.equal(result.execution.actualCashMicroUsd,0);assert.equal(result.execution.externalActions,0);noCredentials(result);
 const audit=await kernel.inspectAudit();const receipts=audit.filter(e=>e.type==='digital_capability_executed');assert.equal(receipts.length,2);assert.ok(!audit.some(e=>['job_created','ledger_recorded'].includes(e.type)));
 const triage=receipts.map(e=>(e.data as {result:CapabilityResult}).result).find(r=>r.capability.id==='ci-failure-triage')!;assert.equal((triage.output as {category:string}).category,'DEPENDENCY');assert.equal(triage.resultDigest,result.execution.completed[0]!.resultDigest);
 const replay=await request(paths[4]!,goal);assert.equal(replay.status,200);const repeated=await replay.json() as typeof result;assert.equal(repeated.goalReceiptDigest,result.goalReceiptDigest);assert.deepEqual(repeated.execution.completed,result.execution.completed);assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length,2);
 const outOfScope=await request(paths[4]!,{...goal,id:'http-goal-injection',steps:[{...goal.steps[0],capabilityId:'send-email'}]});assert.equal(outOfScope.status,400);noCredentials(await outOfScope.json());
}));
