import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {ProceduralKnowledgeStore} from '../src/procedural-intelligence.ts';
import {verifiedRepairCandidate} from '../src/digital-capabilities/procedural/repair-candidate.ts';
import type {ExecutionContext} from '../src/digital-capabilities/types.ts';
import {nicosSeededMovementFixture} from './fixtures/nicos-seeded-movement.ts';

const token='synthetic-procedure-owner';
const instruction='Prepare a repair for this synthetic isolated movement defect.';
const receiptInput=(sourceRequestId:string)=>({sourceKind:'ISOLATED_REPAIR_RECEIPT',sourceRequestId,expectedKnowledgeDigest:null});
function ownerMaterial(){const f=nicosSeededMovementFixture();return `Expected: Forward, Right, Forward completes the route.\nObserved: The seeded comparator rejects expected movement.\nEnvironment: SYNTHETIC isolated reviewed subset.\nSteps: Submit Forward, Right, Forward.\nRevision: ${f.source.revision}\n${f.candidate.files.map(x=>'```ts '+x.path+'\n'+x.content+'```').join('\n')}`;}
test('verified owner repair stores one unqualified synthetic procedure candidate and reuses it across reboot',{timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-repair-procedure-'));
 try{
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),owner=kernel.authenticateOwnerToken(token);
  const body={requestId:'synthetic-repair-procedure',text:instruction,suppliedText:ownerMaterial()};
  const first=await kernel.executeOwnerMessage(owner,body);
  assert.equal(first.status,'COMPLETE',JSON.stringify(first.blockers));
  const repair=first.receipts.find(r=>r.capability.id==='isolated-defect-repairer')!;
  assert.equal(first.receipts.length,4,'goal compiler, reuse ranker, repair and candidate compiler');
  const trusted:ExecutionContext={ownerAuthenticated:true,emergencyStopped:false,authorityContextDigest:repair.authority.contextDigest,constitutionDigest:(await kernel.getStatus()).constitution.digest,mandateDigest:null,mandateId:null,evidence:[],currentIdentity:{},controls:[],policyDecision:{allowed:true,code:'AUTHORIZED_RECORD_MEMORY',reason:'Synthetic owner-bound evidence test'},benchmark:async()=>null,priorCapabilityResults:[{...repair,receiptValidity:{current:true,reason:'Test projection of current kernel receipt'}}]};
  assert.ok(verifiedRepairCandidate(receiptInput(repair.requestId),trusted));
  for(const mutate of [(e:any)=>{e.causalControlEstablished=false;},(e:any)=>{e.heldOutRegressionSha256='0'.repeat(64);},(e:any)=>{e.patch+='tampered';},(e:any)=>{e.source.revision='0'.repeat(40);},(e:any)=>{e.independentVerification.artifactDigest='0'.repeat(64);}]){
   const altered=structuredClone(trusted.priorCapabilityResults![0]!);mutate((altered.output as any).evidence);
   // Recompute the local test hash to challenge evidence semantics independently
   // of the kernel's separate trusted receipt provenance check.
   const {resultDigest,receiptValidity,replayed,...unsigned}=altered;altered.resultDigest=sha256(canonicalJson(unsigned));
   assert.equal(verifiedRepairCandidate(receiptInput(repair.requestId),{...trusted,priorCapabilityResults:[altered]}),null);
  }
  assert.equal(verifiedRepairCandidate(receiptInput(repair.requestId),{...trusted,authorityContextDigest:'0'.repeat(64)}),null);
  assert.equal(verifiedRepairCandidate(receiptInput(repair.requestId),{...trusted,priorCapabilityResults:[{...repair,receiptValidity:{current:false,reason:'Synthetic stale identity'}}]}),null);
  const compiled=first.receipts.find(r=>r.capability.id==='experience-to-procedure-compiler');assert.ok(compiled,'A dependent candidate receipt is required');
  assert.equal((compiled.output as any).persisted,true);assert.equal((compiled.output as any).executionAuthorized,false);
  const knowledge=await ProceduralKnowledgeStore.inspectExisting(directory);assert.ok(knowledge);
  assert.equal(knowledge.playbooks.length,1);assert.equal(knowledge.outcomes.length,0);
  const candidate=knowledge.playbooks[0]!;
  assert.equal(candidate.status,'CANDIDATE');assert.equal(candidate.qualificationStatus,'pending_independent_qualification');assert.equal(candidate.verifiedAt,null);
  assert.equal(candidate.procedureApplicabilityIdentity.synthetic,true);assert.ok(candidate.sourceEvidence.includes(repair.resultDigest));
  assert.equal(candidate.taskFamily,'isolated-comparator-repair');assert.ok(candidate.prohibitedActions.includes('production_change'));
  const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  const replay=await reboot.executeOwnerMessage(reboot.authenticateOwnerToken(token),body);
  assert.equal(replay.status,'COMPLETE',JSON.stringify(replay.blockers));
  assert.deepEqual(replay.receipts.map(r=>r.resultDigest),first.receipts.map(r=>r.resultDigest));
  assert.deepEqual(await ProceduralKnowledgeStore.inspectExisting(directory),knowledge);
  const resumed=await reboot.invokeCapability(reboot.authenticateOwnerToken(token),{requestId:'synthetic-candidate-post-commit-retry',capabilityId:'experience-to-procedure-compiler',input:receiptInput(repair.requestId),evidenceReceiptIds:[repair.resultDigest]});
  assert.equal((resumed.output as any).persisted,true);assert.deepEqual(await ProceduralKnowledgeStore.inspectExisting(directory),knowledge,'A committed candidate survives receipt retry without duplication');
  const denied=await reboot.invokeCapability(SARA_PRINCIPAL,{requestId:'synthetic-unadmitted-compiler',capabilityId:'experience-to-procedure-compiler',input:receiptInput(repair.requestId),evidenceReceiptIds:[repair.resultDigest]});assert.equal(denied.status,'BLOCKED');
  const wrong=await reboot.invokeCapability(reboot.authenticateOwnerToken(token),{requestId:'synthetic-wrong-repair-reference',capabilityId:'experience-to-procedure-compiler',input:receiptInput('different-repair'),evidenceReceiptIds:[repair.resultDigest]});assert.equal((wrong.output as any).persisted,false);
  assert.deepEqual(await ProceduralKnowledgeStore.inspectExisting(directory),knowledge);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('missing or supplied repair claims cannot populate procedural knowledge',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-repair-candidate-denied-'));
 try{
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),owner=kernel.authenticateOwnerToken(token);
  const result=await kernel.invokeCapability(owner,{requestId:'synthetic-no-repair-receipt',capabilityId:'experience-to-procedure-compiler',input:receiptInput('invented-repair')});
  assert.equal((result.output as any).persisted,false);assert.equal((result.output as any).status,'EVIDENCE_REQUIRED');
  assert.equal(await ProceduralKnowledgeStore.inspectExisting(directory),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('cancellation after verified repair blocks the exact admitted candidate worker step',{timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-repair-candidate-cancel-'));
 try{
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),owner=kernel.authenticateOwnerToken(token),original=kernel.invokeCapability.bind(kernel);
  kernel.invokeCapability=async(...args)=>{const receipt=await original(...args);if(receipt.capability.id==='isolated-defect-repairer')await kernel.cancelOwnerWork(owner,'synthetic-cancel-candidate');return receipt;};
  const result=await kernel.executeOwnerMessage(owner,{requestId:'synthetic-cancel-candidate',text:instruction,suppliedText:ownerMaterial()});
  assert.equal(result.status,'CANCELLED');const repair=result.receipts.find(r=>r.capability.id==='isolated-defect-repairer')!;assert.equal((repair.output as any).qualified,true);
  assert.ok(!result.receipts.some(r=>r.capability.id==='experience-to-procedure-compiler'));assert.equal(await ProceduralKnowledgeStore.inspectExisting(directory),null);
  const record=(await kernel.inspectAudit()).find(e=>e.type==='owner_work_received'&&(e.data as any).request.requestId==='synthetic-cancel-candidate')!.data as any;
  const step=record.plan.steps.find((s:any)=>s.capabilityId==='experience-to-procedure-compiler');
  const blocked=await original(SARA_PRINCIPAL,{requestId:`plan-${sha256(canonicalJson({planId:record.plan.id,version:record.plan.version,stepId:step.id}))}`,capabilityId:step.capabilityId,input:step.input,evidenceReceiptIds:[repair.resultDigest]});
  assert.equal(blocked.status,'BLOCKED');assert.equal((blocked.output as any).code,'AUTHENTICATED_OWNER_REQUIRED');assert.equal(await ProceduralKnowledgeStore.inspectExisting(directory),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});
