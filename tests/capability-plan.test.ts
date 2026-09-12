import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
const valueFixture={action:'read_supplied',target:'supplied:fixture',estimatedCashMicroUsd:0,reversibility:'NONE',external:false};
test('bounded plan persists partial progress and resumes existing receipts after restart and restore',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-plan-')),copy=await mkdtemp(join(tmpdir(),'sara-plan-copy-'));
 try{let k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256('plan-owner')});let owner=k.authenticateOwnerToken('plan-owner');
 const contract=(await k.inspectCapabilityContracts()).find(c=>c.id==='autonomy-boundary-checker')!;
 const plan={id:'economic-work',version:1,steps:[{id:'first',capabilityId:contract.id,contractDigest:contract.contractDigest,input:valueFixture,dependsOn:[],evidenceReceiptIds:[],bindings:[],completion:[{path:['allowed'],equals:true}]},{id:'second',capabilityId:contract.id,contractDigest:contract.contractDigest,input:valueFixture,dependsOn:['first'],evidenceReceiptIds:[],bindings:[],completion:[{path:['allowed'],equals:true}]}]};
 assert.equal(typeof (k as any).executeCapabilityPlan,'function');
 const first=await (k as any).executeCapabilityPlan(owner,plan,1);assert.equal(first.status,'PAUSED');assert.equal(first.completed.length,1);
 const before=await k.inspectAudit();await cp(dir,copy,{recursive:true});
 k=await SaraKernel.boot({stateDirectory:copy,ownerTokenSha256:sha256('plan-owner')});owner=k.authenticateOwnerToken('plan-owner');
 const resumed=await (k as any).executeCapabilityPlan(owner,plan,10);assert.equal(resumed.status,'COMPLETE');assert.equal(resumed.completed[0].resultDigest,first.completed[0].resultDigest);
 const events=await k.inspectAudit();assert.deepEqual(events.slice(0,before.length),before);assert.equal(events.filter(e=>e.type==='digital_capability_executed').length,2);
 const final=await (k as any).executeCapabilityPlan(owner,plan,10);assert.deepEqual(final.completed,resumed.completed);assert.equal((await k.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length,2);
 await assert.rejects(()=>(k as any).executeCapabilityPlan(owner,{...plan,steps:[{...plan.steps[0],input:{...valueFixture,target:'supplied:other'}}]},1),/PLAN_IDENTITY_CONFLICT/);
 }finally{await rm(dir,{recursive:true,force:true});await rm(copy,{recursive:true,force:true});}
});
