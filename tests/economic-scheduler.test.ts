import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {valueFixture} from '../src/digital-capabilities/economic/definitions.ts';
import {validatePlan} from '../src/digital-capabilities/plan.ts';
test('actual scheduler blocks consequential high profit, honors obligations, then schedules expected net value',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'economic-scheduler-'));
 try{const kernel=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256('scheduler-owner')}),owner=kernel.authenticateOwnerToken('scheduler-owner');
 const contracts=await kernel.inspectCapabilityContracts(),read=contracts.find(c=>c.id==='autonomy-boundary-checker')!,consequential=contracts.find(c=>c.id==='experience-to-procedure-compiler')!;
 const specs=[{id:'cosmetic',benefit:10,p:1000000,cost:0},{id:'paying',benefit:1000,p:900000,cost:100},{id:'speculative',benefit:100000,p:1000,cost:200},{id:'reliability',benefit:2000,p:1000000,cost:100},{id:'unauthorized',benefit:1000000,p:1000000,cost:0},{id:'commitment',benefit:1,p:1000000,cost:20}];
 const steps=[];
 for(const s of specs){const evidence=await kernel.invokeCapability(owner,{requestId:'value-'+s.id,capabilityId:'economic-value-of-work',input:{...valueFixture,benefitMicroUsd:s.benefit,successProbabilityPpm:s.p,cost:{...(valueFixture.cost as object),directCashMicroUsd:s.cost,modelApiMicroUsd:0,infrastructureMicroUsd:0,toolingMicroUsd:0},riskReserveMicroUsd:0,opportunityCostMicroUsd:0}});assert.equal(evidence.status,'SUCCEEDED');const c=s.id==='unauthorized'?consequential:read;
 steps.push({id:s.id,capabilityId:c.id,contractDigest:c.contractDigest,input:{action:'read_supplied',target:'supplied:'+s.id,estimatedCashMicroUsd:0,reversibility:'NONE',external:false},dependsOn:[],evidenceReceiptIds:[],bindings:[],completion:[{path:['allowed'],equals:true}],obligation:s.id==='commitment',economicEvidenceId:evidence.resultDigest});}
 const before=await kernel.getStatus();const plan={id:'six-competing-work-items',version:1,steps};
 const result=await kernel.executeCapabilityPlan(owner,plan,64);assert.equal(result.status,'BLOCKED');assert.deepEqual(result.completed.map(s=>s.stepId),['commitment','reliability','paying','cosmetic','speculative']);assert.deepEqual(result.blocked.map(s=>s.stepId),['unauthorized']);assert.equal(result.actualCashMicroUsd,0);
 const after=await kernel.getStatus();assert.deepEqual(after.realizedProfit,before.realizedProfit);const receipts=(await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed');assert.equal(receipts.length,17);assert.ok(receipts.every(e=>(e.data as any).result.capability.id!=='experience-to-procedure-compiler'));
 const [a,b]=await Promise.all([kernel.executeCapabilityPlan(owner,plan,64),kernel.executeCapabilityPlan(owner,plan,64)]);assert.deepEqual(a.completed,b.completed);assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length,17);
 await assert.rejects(()=>kernel.executeCapabilityPlan(SARA_PRINCIPAL,plan),/AUTHENTICATED_OWNER_REQUIRED/);
 const changed={...plan,id:'missing-economics',steps:[{...steps[0]!,economicEvidenceId:'f'.repeat(64)}]};const denied=await kernel.executeCapabilityPlan(owner,changed);assert.equal(denied.completed.length,0);assert.equal(denied.reason,'CURRENT_ECONOMIC_RECEIPT_REQUIRED');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('plan rejects cycles, forged authority fields, unsafe bindings and malformed contracts',()=>{
 const step={id:'a',capabilityId:'read',contractDigest:'a'.repeat(64),input:{},dependsOn:[],evidenceReceiptIds:[],bindings:[],completion:[{path:['ok'],equals:true}]};
 assert.throws(()=>validatePlan({id:'p',version:1,steps:[{...step,ownerAuthorized:true}]}));assert.throws(()=>validatePlan({id:'p',version:1,steps:[{...step,dependsOn:['a']}]}),/DEPENDENCY_ORDER_OR_CYCLE/);assert.throws(()=>validatePlan({id:'p',version:1,steps:[{...step,bindings:[{inputKey:'x',stepId:'unknown',path:['output']}]}]}),/UNDECLARED_BINDING_DEPENDENCY/);
});
test('goal-derived work identifies actual capability readiness and replays without unrelated invalidation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'goal-readiness-'));try{const k=await SaraKernel.boot({stateDirectory:dir});const request={requestId:'high-level-goal',capabilityId:'goal-to-work-queue-compiler',input:{goalId:'bug',goal:'Fix a software login defect',tasks:[]}};
 const first=await k.invokeCapability(SARA_PRINCIPAL,request);assert.equal(first.status,'SUCCEEDED');const out=first.output as any;assert.equal(out.tasks.length,9);assert.ok(out.tasks.every((t:any)=>t.state==='INCOMPLETE_CONTRACT'));assert.deepEqual(out.missingCapabilities,[]);const second=await k.invokeCapability(SARA_PRINCIPAL,request);assert.equal(second.receiptValidity?.current,true);assert.equal(second.resultDigest,first.resultDigest);
 }finally{await rm(dir,{recursive:true,force:true});}
});
