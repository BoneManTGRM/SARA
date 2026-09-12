import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {ProceduralKnowledgeStore,PROCEDURAL_SEED_PLAYBOOKS,executeVerifiedProcedure,type ProceduralPlaybook} from '../src/procedural-intelligence.ts';
import {digest} from '../src/digital-capabilities/engineering/common.ts';
import type {Json} from '../src/digital-capabilities/schema.ts';
const token='synthetic-procedure-post-state-owner';
const object=(x:Json)=>x as Record<string,Json>;
async function success(store:ProceduralKnowledgeStore,p:ProceduralPlaybook,taskId:string){return executeVerifiedProcedure({store,task:{taskId,description:'ci failure: verify isolated supplied arithmetic',taskFamily:p.taskFamily,identity:p.procedureApplicabilityIdentity,requestedActions:[]},grantedAuthorities:[],authorizedCostCeilingUsd:0,estimatedCostUsd:0,variableWork:async()=>2+2,freshVerify:async result=>({passed:result===4,evidence:[`ISOLATED:${taskId}:2-plus-2-equals-4`]})});}
for(const operation of ['compile','supersede'] as const)test(`real kernel ${operation} receipt binds committed post-state while preserving pre-state evidence`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-procedure-post-')),backup=await mkdtemp(join(tmpdir(),'sara-procedure-post-copy-'));
 try{
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),owner=kernel.authenticateOwnerToken(token);
  const identity={policyDigest:(await kernel.getStatus()).constitution.digest};
  const source:ProceduralPlaybook={...structuredClone(PROCEDURAL_SEED_PLAYBOOKS[0]!),procedureApplicabilityIdentity:identity,evidenceReuseIdentity:identity,authorityRequired:[]};
  const store=await ProceduralKnowledgeStore.open(directory,[source]);await success(store,source,'verified-source');
  if(operation==='supersede'){
   const replacement:ProceduralPlaybook={...structuredClone(source),id:'fresh-kernel-replacement',status:'CANDIDATE',qualificationStatus:'pending',qualificationDigest:'',evaluatorIdentity:'unassigned',verifiedAt:null,qualificationStrength:101};
   await store.addCandidatePlaybook(replacement);const qualification={evaluatorIdentity:'independent-isolated-reviewer',sourceEvidence:['replacement-positive','replacement-negative'],qualificationDigest:'b'.repeat(64)};
   await store.qualifyPlaybook(replacement.id,1,qualification);await store.publishPlaybook(replacement.id,1,qualification);await success(store,replacement,'verified-replacement');
  }
  const before=store.snapshot(),newer=before.playbooks.find(p=>p.id==='fresh-kernel-replacement');
  const input=operation==='compile'?{playbookId:source.id,playbookVersion:1,outcomeDigests:[digest(before.outcomes[0]!)],expectedKnowledgeDigest:digest(before)}:{taskFamily:source.taskFamily,operation:'SUPERSEDE',oldId:source.id,oldVersion:1,replacementId:newer!.id,replacementVersion:1,oldDigest:digest(before.playbooks.find(p=>p.id===source.id)!),replacementDigest:digest(newer!),expectedKnowledgeDigest:digest(before)};
  const request={requestId:`post-state-${operation}`,capabilityId:operation==='compile'?'experience-to-procedure-compiler':'memory-conflict-resolver',input};
  const result=await kernel.invokeCapability(owner,request);assert.equal(result.status,'SUCCEEDED',JSON.stringify(result.output));assert.equal(object(result.output).persisted,true);
  const after=(await ProceduralKnowledgeStore.inspectExisting(directory))!;assert.notEqual(digest(after),digest(before));
  assert.equal(object(result.output).sourceKnowledgeDigest,digest(before),'Original qualification/approval state remains visible in the signed historical output');
  assert.ok(result.observed.some(o=>object(o).snapshotDigest===digest(before)));
  assert.equal(result.subject.proceduralKnowledgeDigest,digest(after),'Fresh receipt must bind the exact resulting committed state');
  const replay=await kernel.invokeCapability(owner,request);assert.equal(replay.resultDigest,result.resultDigest);assert.equal(replay.receiptValidity?.current,true);assert.equal((await ProceduralKnowledgeStore.inspectExisting(directory))!.generation,after.generation);
  const referenced=await kernel.invokeCapability(owner,{requestId:`reference-${operation}`,capabilityId:'autonomy-boundary-checker',input:{action:'read_supplied',target:'supplied:procedure-history',estimatedCashMicroUsd:0,reversibility:'NONE',external:false},evidenceReceiptIds:[result.resultDigest]});assert.ok(referenced.evidence.some(e=>e.claims.includes(`capability:${request.capabilityId}:SUCCEEDED`)));
  const audit=await kernel.inspectAudit();await cp(directory,backup,{recursive:true});const restored=await SaraKernel.boot({stateDirectory:backup,ownerTokenSha256:sha256(token)});const durable=await restored.invokeCapability(restored.authenticateOwnerToken(token),request);assert.equal(durable.receiptValidity?.current,true);assert.equal(durable.resultDigest,result.resultDigest);assert.deepEqual((await restored.inspectAudit()).slice(0,audit.length),audit);assert.equal((await ProceduralKnowledgeStore.inspectExisting(backup))!.generation,after.generation);
  const denied=await kernel.invokeCapability(SARA_PRINCIPAL,{...request,requestId:`untrusted-${operation}`});assert.equal(denied.status,'BLOCKED');assert.equal((await ProceduralKnowledgeStore.inspectExisting(directory))!.generation,after.generation);
  await success(await ProceduralKnowledgeStore.open(directory,[]),newer??source,`later-${operation}`);const stale=await kernel.invokeCapability(owner,request);assert.equal(stale.receiptValidity?.current,false,'A subsequent relevant procedure outcome still invalidates the prior proof');assert.equal(stale.resultDigest,result.resultDigest);
 }finally{await rm(directory,{recursive:true,force:true});await rm(backup,{recursive:true,force:true});}
});
