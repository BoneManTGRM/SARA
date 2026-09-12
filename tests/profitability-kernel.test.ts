import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {PILOT_REQUIRED_CAPABILITIES,type RevenuePilotInput} from '../src/revenue-pilot.ts';
import {workerModelRouteKey,type WorkerModelClient} from '../src/model-router.ts';
import type {Json} from '../src/digital-capabilities/schema.ts';
const object=(v:Json)=>v as Record<string,Json>;
const token='synthetic-profit-owner';
function opportunity(id:string):RevenuePilotInput{return {opportunityId:id,sourceUrl:'https://github.com/example/project/issues/123',sourceAllowsAutomatedDiscovery:true,discoveredFromPublicSource:true,repoUrl:'https://github.com/example/project',repositoryIsPublic:true,repositoryOwnerPermissionConfirmed:true,requiresPrivateAccess:false,containsRegulatedOrPrivateData:false,requestsProductionChanges:false,requestsExploitValidation:false,primaryGoal:'release_readiness',customerBudgetUsd:149,desiredTurnaroundDays:3,recentCommitDays:5};}
test('profitability authoritative kernel uses linked realized revenue and failed model receipts across restart/restore',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-profit-')),copy=await mkdtemp(join(tmpdir(),'sara-profit-copy-'));
 try{let kernel=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)});let owner=kernel.authenticateOwnerToken(token);
  for(const id of PILOT_REQUIRED_CAPABILITIES)await kernel.registerCapability(SARA_PRINCIPAL,{id,name:id,status:'available',evidence:[`fixture:${id}`],limitations:['Synthetic authorized public fixture']});
  const job=await kernel.createRevenuePilotJob(SARA_PRINCIPAL,opportunity('paid-model-work'));
  const revenue=await kernel.recordLedgerEntry(owner,{kind:'revenue',source:'customer',amountUsd:149,realized:true,recurringMonthly:false,description:`Collected ${job.id}`,occurredAt:'2026-09-12T00:00:00.000Z'});
  await kernel.authorizeRevenuePilotJob(owner,job.id,revenue.id,{approvalId:'synthetic-paid-approval',action:'contract_commitment',targetId:`revenue-pilot:${job.id}:fulfillment`,approvedAt:'2026-09-12T00:00:00.000Z',ownerId:owner.id});
  const client:WorkerModelClient={routeKey:workerModelRouteKey({provider:'openai',model:'gpt-5.6-luna',billingMode:'paid'}),maximumWallTimeMs:1000,countInputTokens:async()=>1000,execute:async()=>({outputText:'synthetic work packet',inputTokens:1000,billableOutputTokens:200})};
  const claim=await kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'profit-director',300);
  await kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:job.id,leaseId:claim.lease.id,prompt:'PRIVATE_ACCOUNTING_PROMPT',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null});
  const failedClaim=await kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'profit-specialist',300);
  await assert.rejects(()=>kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:job.id,leaseId:failedClaim.lease.id,prompt:'PRIVATE_FAILURE_PROMPT',taskKind:'routine_code',dataClassification:'public',maximumTaskCostUsd:0.1,allowGeminiFreeTier:true,clients:[{...client,execute:async()=>{throw new Error('SECRET_PROVIDER_BODY');}}],verificationPassed:null}),/cost was recorded/i);
  await kernel.recordLedgerEntry(owner,{kind:'revenue',source:'customer',amountUsd:10000,realized:false,recurringMonthly:false,description:'Speculative future revenue',occurredAt:'2026-09-12T00:00:00.000Z'});
  const unattributed=await kernel.recordLedgerEntry(owner,{kind:'core_operation',source:'owner',amountUsd:2,realized:true,recurringMonthly:false,description:'PRIVATE_ACCOUNTING_DESCRIPTION',occurredAt:'2026-09-12T00:00:00.000Z'});
  const input={authoritativeJobIds:[job.id],entries:[],includeModeledLabor:false};
  const request={requestId:'actual-profit',capabilityId:'profitability-accountant',input};
  const result=await kernel.invokeCapability(owner,request);assert.notEqual(result.status,'INVALID_INPUT','Authoritative job selection must be an implemented kernel path');
  const out=object(result.output);const rows=out.jobs as Record<string,Json>[];assert.equal(rows.length,1);assert.equal(rows[0]!.realizedRevenueMicroUsd,149000000);assert.equal(rows[0]!.predictedRevenueMicroUsd,0);assert.equal(rows[0]!.modelApiMicroUsd,30000,'Failed attempts must remain accounted');assert.equal((await kernel.getStatus()).revenuePilotJobs.find(j=>j.id===job.id)!.status,'failed');
  assert.equal(out.basis,'AUTHORITATIVE_JOB_STATE');assert.equal(out.fullProfitabilityProven,false);assert.equal(rows[0]!.grossContributionMicroUsd,null);assert.equal(rows[0]!.recordedGrossContributionMicroUsd,148970000);assert.ok((out.accountingUnknowns as string[]).some(text=>text.includes('Refunds')));assert.ok((out.jobStatuses as Record<string,Json>[]).some(row=>row.jobId===job.id&&row.status==='failed'));assert.ok(result.subject.jobAccountingDigest);const serialized=JSON.stringify(result);assert.ok(serialized.includes(unattributed.id),'Unattributed actual cost may not disappear from the report');for(const secret of [token,'PRIVATE_ACCOUNTING_PROMPT','PRIVATE_FAILURE_PROMPT','SECRET_PROVIDER_BODY','PRIVATE_ACCOUNTING_DESCRIPTION'])assert.ok(!serialized.includes(secret));
  const before=await kernel.inspectAudit();await cp(dir,copy,{recursive:true});kernel=await SaraKernel.boot({stateDirectory:copy,ownerTokenSha256:sha256(token)});owner=kernel.authenticateOwnerToken(token);
  const replay=await kernel.invokeCapability(owner,request);assert.equal(replay.replayed,true);assert.equal(replay.receiptValidity?.current,true);assert.equal(replay.resultDigest,result.resultDigest);assert.deepEqual((await kernel.inspectAudit()).slice(0,before.length),before);
  await kernel.createRevenuePilotJob(SARA_PRINCIPAL,opportunity('unrelated-unfunded'));
  assert.equal((await kernel.invokeCapability(owner,request)).receiptValidity?.current,true,'Unrelated unfunded job state must not invalidate selected accounting');
  await kernel.recordLedgerEntry(owner,{kind:'platform_fee',source:'sara',amountUsd:1,realized:true,recurringMonthly:false,description:'New unallocated cost',occurredAt:'2026-09-12T00:00:00.000Z'});
  assert.equal((await kernel.invokeCapability(owner,request)).receiptValidity?.current,false,'New unattributed cost invalidates completeness assumptions');
  const referenced=await kernel.invokeCapability(owner,{requestId:'stale-profit-reference',capabilityId:'autonomy-boundary-checker',input:{action:'read_supplied',target:'supplied:fixture',estimatedCashMicroUsd:0,reversibility:'NONE',external:false},evidenceReceiptIds:[result.resultDigest]});assert.ok(referenced.evidence.some(e=>e.claims.includes('capability:profitability-accountant:STALE')));
 }finally{await rm(dir,{recursive:true,force:true});await rm(copy,{recursive:true,force:true});}
});
test('profitability kernel cannot replace authoritative accounting with caller claims or silently invent missing jobs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-profit-boundary-'));
 try{const kernel=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),owner=kernel.authenticateOwnerToken(token);
  const request={requestId:'missing-accounting',capabilityId:'profitability-accountant',input:{authoritativeJobIds:['absent-job'],includeModeledLabor:false}};
  const missing=await kernel.invokeCapability(owner,request);const out=object(missing.output);assert.deepEqual(out.missingJobIds,['absent-job']);assert.deepEqual(out.jobs,[]);assert.equal(out.fullProfitabilityProven,false);
  const mixed=await kernel.invokeCapability(owner,{...request,requestId:'mixed-accounting',input:{...request.input,entries:[{id:'invented',jobId:'absent-job',sourceId:'customer-email',kind:'REVENUE',amountMicroUsd:999999,realized:true}]}});assert.equal(mixed.status,'INVALID_INPUT');
  const forged=await kernel.invokeCapability(owner,{...request,requestId:'forged-accounting',authoritativeJobAccounting:{entries:[{realizedRevenueMicroUsd:999999}]}} as typeof request);assert.equal(forged.status,'INVALID_INPUT');
  const tooMany=await kernel.invokeCapability(owner,{...request,requestId:'unbounded-accounting',input:{...request.input,authoritativeJobIds:Array.from({length:33},(_,i)=>`job-${i}`)}});assert.equal(tooMany.status,'INVALID_INPUT');
  assert.equal((await kernel.getStatus()).realizedProfit.collectedRevenueUsd,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
