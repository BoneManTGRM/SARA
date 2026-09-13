import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {compileCommercialTerms} from '../src/commercial-terms.ts';
import {BASE_USDC_CONTRACT,type VerifiedUsdcPayment} from '../src/usdc-payment.ts';
import {persistRevenuePilotArtifact} from '../src/revenue-pilot-artifacts.ts';
import {RevenuePilotOperator} from '../src/revenue-pilot-operator.ts';
import type {WorkerModelClient} from '../src/model-router.ts';
const token='synthetic-service-step-owner',secret='synthetic-service-secret-at-least-thirty-two-bytes';
async function fixture(run:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>,mandated=true){const f=await setup(mandated);try{await run(f);}finally{await rm(f.directory,{recursive:true,force:true});}}
async function setup(mandated=true){
 const directory=await mkdtemp(join(tmpdir(),'sara-synthetic-service-recheck-')),boot=()=>SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token),bootstrapRevenueCapabilities:true});
 const kernel=await boot(),owner=kernel.authenticateOwnerToken(token);
 const job=await kernel.createRevenuePilotJob(owner,{opportunityId:'synthetic-service-recheck',sourceUrl:'https://github.com/example/project',sourceAllowsAutomatedDiscovery:true,discoveredFromPublicSource:true,repoUrl:'https://github.com/example/project',repositoryIsPublic:true,repositoryOwnerPermissionConfirmed:true,requiresPrivateAccess:false,containsRegulatedOrPrivateData:false,requestsProductionChanges:false,requestsExploitValidation:false,primaryGoal:'release_readiness',customerBudgetUsd:149,desiredTurnaroundDays:3,recentCommitDays:1});
 const intent=await kernel.createRevenuePaymentIntent(owner,{id:'pay_synthetic_step_recheck',jobId:job.id,recipientAddress:`0x${'2'.repeat(40)}`,clientSecretDigest:sha256(secret),customerReferenceDigest:sha256('synthetic@example.com'),terms:compileCommercialTerms({businessName:'Synthetic business',contactEmail:'synthetic@example.com',governingLaw:'Synthetic test terms'})});
 const payment:VerifiedUsdcPayment={schemaVersion:1,provider:'base-usdc-direct',chainId:8453,tokenContract:BASE_USDC_CONTRACT,transactionHash:`0x${'a'.repeat(64)}`,transactionReferenceDigest:sha256('synthetic-chain-transfer'),senderAddress:`0x${'1'.repeat(40)}`,recipientAddress:intent.recipientAddress,amountAtomic:'149000000',amountUsd:149,blockNumber:100,latestBlockNumber:111,confirmations:12,verifiedAt:new Date().toISOString()};
 await kernel.confirmRevenuePayment(owner,intent.id,secret,payment);
 const approval={approvalId:'synthetic-fulfillment-approval',action:'contract_commitment' as const,targetId:`revenue-pilot:${job.id}:fulfillment`,approvedAt:new Date().toISOString(),ownerId:owner.id};
 if(mandated)await kernel.activateStandingMandate(owner,{id:'synthetic-paid-service',ownerId:owner.id,allowedActions:['fixed_service_fulfillment'],allowedChannels:['approved_api'],allowedServiceIds:[job.plan.serviceId],maximumCostPerActionUsd:3,maximumDailyActions:10,maximumConcurrentActions:1,startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()},{approvalId:'synthetic-mandate-approval',action:'required_owner_approval_change',targetId:'standing-mandate:synthetic-paid-service',approvedAt:new Date().toISOString(),ownerId:owner.id});
 const authorize=(k:SaraKernel)=>mandated?k.authorizeRevenuePilotFromConfirmedPaymentUnderMandate(SARA_PRINCIPAL,job.id,intent.id):k.authorizeRevenuePilotFromConfirmedPayment(k.authenticateOwnerToken(token),job.id,intent.id,approval);
 await authorize(kernel);
 return {directory,boot,kernel,owner,job,intent,authorize};
}
// Isolated fixture-only append simulates a supported provider/state transition;
// no production kernel bypass or payment endpoint is added.
async function seedPaymentState(f:Awaited<ReturnType<typeof setup>>,status:'disputed'|'refunded'){
 const audit=await f.kernel.inspectAudit(),current=(await f.kernel.getStatus()).revenuePaymentIntents[0]!;
 const event={id:randomUUID(),sequence:audit.length+1,occurredAt:new Date().toISOString(),type:'revenue_payment_intent_snapshot',actor:SARA_PRINCIPAL,data:{...current,status},previousHash:audit.at(-1)!.hash};
 await appendFile(join(f.directory,'events.ndjson'),JSON.stringify({...event,hash:sha256(canonicalJson(event))})+'\n');
}
for(const boundary of ['revoked mandate','missing required capability','disputed payment','refunded payment'] as const)test(`paid role claim rechecks ${boundary} and preserves the obligation`,()=>fixture(async f=>{
 if(boundary==='revoked mandate')await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic revocation');
 else if(boundary==='missing required capability'){const c=(await f.kernel.getStatus()).capabilities.find(c=>c.id==='readiness-analysis')!;await f.kernel.registerCapability(f.owner,{...c,status:'missing'});}
 else await seedPaymentState(f,boundary==='disputed payment'?'disputed':'refunded');
 const before=(await f.kernel.getStatus()).revenuePilotJobs;
 await assert.rejects(f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'synthetic-worker',300,{jobId:f.job.id,role:'work_director'}),/mandate|capability|payment/i);
 assert.deepEqual((await f.kernel.getStatus()).revenuePilotJobs,before);
}));
test('revocation after claim blocks paid dispatch without a model call',()=>fixture(async f=>{
 const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'synthetic-worker',300,{jobId:f.job.id,role:'work_director'});await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic revocation');let calls=0;
 const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){calls++;return {outputText:'Synthetic output',inputTokens:10,billableOutputTokens:10};}};
 await assert.rejects(f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic fixture',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null}),/mandate/i);assert.equal(calls,0);
}));
for(const change of ['revocation','stop'] as const)test(`${change} during generation preserves incurred cost but does not advance work`,()=>fixture(async f=>{
 const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'synthetic-worker',300,{jobId:f.job.id,role:'work_director'});
 const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){if(change==='revocation')await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic in-flight revocation');else await f.kernel.setEmergencyStop(f.owner,true);return {outputText:'Synthetic output',inputTokens:10,billableOutputTokens:10};}};
 const result=await f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic fixture',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null});
 assert.equal(result.job.status,'failed');assert.equal(result.job.nextRole,null);assert.equal(result.job.receipts.at(-1)?.failureStage,'eligibility_changed');assert.ok(result.job.actualExecutionCostUsd>0);assert.equal(result.job.receipts.filter(r=>r.role==='work_director').length,1);
}));
for(const mandated of [false,true])for(const tail of ['ledger_recorded','revenue_pilot_snapshot'])test(`payment authorization recovers synthetic interruption after ${tail} (${mandated?'mandate':'owner'})`,()=>fixture(async f=>{
 const path=join(f.directory,'events.ndjson'),lines=(await readFile(path,'utf8')).trimEnd().split('\n'),events=lines.map(l=>JSON.parse(l));
 const revenueIndex=events.findIndex(e=>e.type==='ledger_recorded'&&e.data.kind==='revenue');assert.ok(revenueIndex>=0);
 const end=tail==='ledger_recorded'?revenueIndex:events.findIndex((e,i)=>i>revenueIndex&&e.type==='revenue_pilot_snapshot');
 await writeFile(path,lines.slice(0,end+1).join('\n')+'\n');const reboot=await f.boot(),result=await f.authorize(reboot);
 assert.equal(result.job.status,'queued');assert.equal(result.paymentIntent.status,'authorized');assert.equal(result.job.revenueEvidenceId,events[revenueIndex].data.id);
 assert.equal((await reboot.inspectAudit()).filter(e=>e.type==='ledger_recorded'&&(e.data as any).kind==='revenue').length,1);
 const replay=await f.authorize(reboot);assert.equal(replay.job.revenueEvidenceId,result.job.revenueEvidenceId);
},mandated));
test('revocation during token counting blocks provider execution and adds no provider charge',()=>fixture(async f=>{
 const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'synthetic-worker',300,{jobId:f.job.id,role:'work_director'});let calls=0;
 const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic pre-provider revocation');return 10;},async execute(){calls++;return {outputText:'Synthetic output',inputTokens:10,billableOutputTokens:10};}};
 await assert.rejects(f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic fixture',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null}),/bounded model routes/i);
 assert.equal(calls,0);const job=(await f.kernel.getStatus()).revenuePilotJobs[0]!;assert.equal(job.actualExecutionCostUsd,0);assert.equal(job.status,'failed');assert.equal(job.receipts.at(-1)?.modelFailure?.attempts.at(-1)?.outcome,'rejected');
}));
test('revocation after a failed provider preserves its conservative cost and prevents fallback',()=>fixture(async f=>{
 const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'synthetic-worker',300,{jobId:f.job.id,role:'work_director'}),calls:string[]=[];
 const first:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){calls.push('first');await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic failed-provider revocation');throw new Error('Synthetic uncertain provider failure');}};
 const fallback:WorkerModelClient={routeKey:'google:gemini-3.8-flash:free',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){calls.push('fallback');return {outputText:'Synthetic output',inputTokens:10,billableOutputTokens:10};}};
 await assert.rejects(f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic fixture',taskKind:'repository_investigation',dataClassification:'public',maximumTaskCostUsd:0.1,allowGeminiFreeTier:true,clients:[first,fallback],verificationPassed:null}),/bounded model routes/i);
 assert.deepEqual(calls,['first']);const job=(await f.kernel.getStatus()).revenuePilotJobs[0]!,failure=job.receipts.at(-1)!.modelFailure!;assert.ok(failure.accountedCostUsd>0);assert.equal(job.actualExecutionCostUsd,Math.ceil((failure.accountedCostUsd-Number.EPSILON)*100)/100);assert.deepEqual(failure.attempts.map(a=>a.outcome),['failed','rejected']);assert.equal(failure.attempts[1]!.accountedCostUsd,0);
}));

test('revoked queued work gathers no new repository evidence in the paid operator',()=>fixture(async f=>{
 await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic queued revocation');let collections=0,calls=0;
 const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){calls++;throw new Error('Unexpected synthetic dispatch');}};
 const operator=new RevenuePilotOperator({kernel:f.kernel,stateDirectory:f.directory,modelClient:client,repositoryEvidenceCollector:{async collect(){collections++;throw new Error('Unexpected synthetic collection');}}});
 const result=await operator.tick();assert.deepEqual(result,{outcome:'idle',reason:'eligibility_changed'});assert.equal(collections,0);assert.equal(calls,0);
 assert.equal((await f.kernel.getStatus()).revenuePilotJobs[0]?.status,'queued');
}));
test('interrupted mandate payment authorization cannot renew through a revoked cached decision',()=>fixture(async f=>{
 const path=join(f.directory,'events.ndjson'),lines=(await readFile(path,'utf8')).trimEnd().split('\n'),events=lines.map(l=>JSON.parse(l));
 const end=events.findIndex(e=>e.type==='ledger_recorded'&&e.data.kind==='revenue');await writeFile(path,lines.slice(0,end+1).join('\n')+'\n');
 const reboot=await f.boot();await reboot.revokeStandingMandate(reboot.authenticateOwnerToken(token),'synthetic-paid-service','Synthetic interrupted authorization revocation');
 await assert.rejects(f.authorize(reboot),/mandate/i);const state=await reboot.getStatus();assert.equal(state.revenuePilotJobs[0]?.status,'offer_ready');assert.equal(state.revenuePaymentIntents[0]?.status,'confirmed');assert.equal((await reboot.inspectAudit()).filter(e=>e.type==='ledger_recorded'&&(e.data as any).kind==='revenue').length,1);
}));

test('paid crash after provider dispatch preserves an unresolved lease and allowance across restart and month',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 await fixture(async f=>{
  const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'});let crashPrefix='';
  const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){crashPrefix=await readFile(join(f.directory,'events.ndjson'),'utf8');return {outputText:'Synthetic provider already ran',inputTokens:10,billableOutputTokens:10};}};
  await f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic crash',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null});
  await writeFile(join(f.directory,'events.ndjson'),crashPrefix);t.mock.timers.setTime(Date.now()+600000);const reboot=await f.boot();
  await assert.rejects(reboot.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'}),/unresolved|reconciliation/i);
  let calls=0,collections=0;const operator=new RevenuePilotOperator({kernel:reboot,stateDirectory:f.directory,modelClient:{...client,async execute(){calls++;throw new Error('Unexpected synthetic repeat');}},repositoryEvidenceCollector:{async collect(){collections++;throw new Error('Unexpected synthetic collection');}}});
  assert.deepEqual(await operator.tick(),{outcome:'idle',reason:'unresolved_provider_effect'});assert.equal(calls,0);assert.equal(collections,0);
  assert.equal((await operator.status()).unresolvedReservedUsd,0.05);
  t.mock.timers.setTime(Date.now()+40*86400000);assert.equal((await operator.status()).unresolvedReservedUsd,0.05);assert.deepEqual(await operator.tick(),{outcome:'idle',reason:'unresolved_provider_effect'});
  const accounting=await reboot.inspectRevenueJobAccounting(reboot.authenticateOwnerToken(token),f.job.id);assert.ok(accounting.accounting.unknowns.some(s=>/pending provider|unresolved provider/i.test(s)));
  const job=(await reboot.getStatus()).revenuePilotJobs[0]!;assert.equal(job.activeLease?.id,claim.lease.id);assert.equal(job.receipts.filter(r=>r.role==='work_director').length,0);
 },false);
});
test('saved exact provider output reconciles an expired pending lease without another model call',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 await fixture(async f=>{
  const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'});let crashPrefix='';
  const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 10;},async execute(){return {outputText:'Synthetic persisted result',inputTokens:10,billableOutputTokens:10};}};
  await f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic saved output',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null,persistOutput:async result=>{await persistRevenuePilotArtifact({stateDirectory:f.directory,jobId:f.job.id,role:result.role,outputText:result.outputText,outputDigest:result.evidence.outputDigest,modelExecution:result.evidence});crashPrefix=await readFile(join(f.directory,'events.ndjson'),'utf8');}});
  await writeFile(join(f.directory,'events.ndjson'),crashPrefix);t.mock.timers.setTime(Date.now()+600000);const reboot=await f.boot();let calls=0;
  const operator=new RevenuePilotOperator({kernel:reboot,stateDirectory:f.directory,modelClient:{...client,async execute(){calls++;throw new Error('Unexpected repeat');}},repositoryEvidenceCollector:{async collect(){throw new Error('Unexpected collection');}}});
  assert.equal((await operator.tick()).outcome,'completed_role');assert.equal(calls,0);assert.equal((await operator.status()).unresolvedReservedUsd,0);
  const job=(await reboot.getStatus()).revenuePilotJobs[0]!;assert.equal(job.completedRoles.filter(r=>r==='work_director').length,1);assert.ok(job.actualExecutionCostUsd>0);assert.equal(job.nextRole,'specialist_worker');
 },false);
});

test('a new explicitly undispatched lease remains reclaimable after harmless interruption',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});await fixture(async f=>{
  const first=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'});assert.equal(first.lease.dispatchState,'NOT_DISPATCHED');
  t.mock.timers.setTime(Date.now()+600000);const reboot=await f.boot(),next=await reboot.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'});
  assert.notEqual(next.lease.id,first.lease.id);assert.equal(next.job.id,f.job.id);assert.equal(next.lease.dispatchState,'NOT_DISPATCHED');
 },false);
});
test('legacy ambiguous expired leases cannot silently redispatch after upgrade',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});await fixture(async f=>{
  const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'}),audit=await f.kernel.inspectAudit();
  const legacy=structuredClone(claim.job);delete legacy.activeLease!.dispatchState;
  const e={id:randomUUID(),sequence:audit.length+1,occurredAt:new Date().toISOString(),type:'revenue_pilot_snapshot',actor:SARA_PRINCIPAL,data:legacy,previousHash:audit.at(-1)!.hash};await appendFile(join(f.directory,'events.ndjson'),JSON.stringify({...e,hash:sha256(canonicalJson(e))})+'\n');
  t.mock.timers.setTime(Date.now()+600000);const reboot=await f.boot();await assert.rejects(reboot.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'}),/unresolved/i);
  const accounting=await reboot.inspectRevenueJobAccounting(reboot.authenticateOwnerToken(token),f.job.id);assert.ok(accounting.accounting.unknowns.some(s=>/reserved allowance USD3.000000/.test(s)));
 },false);
});
test('concurrent invocations cannot dispatch or settle another invocation pending provider effect',()=>fixture(async f=>{
 const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'});let counts=0,calls=0,releaseCount!:()=>void,releaseProvider!:()=>void;
 const counted=new Promise<void>(r=>releaseCount=r),provider=new Promise<void>(r=>releaseProvider=r);
 const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){if(++counts===2)releaseCount();await counted;return 10;},async execute(){calls++;await provider;return {outputText:'Synthetic concurrent result',inputTokens:10,billableOutputTokens:10};}};
 const run=()=>f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic same work',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null});
 const runs=[run(),run()].map(p=>p.then(value=>({value,error:null}),error=>({value:null,error})));
 const first=await Promise.race(runs);assert.ok(first.error);const pending=(await f.kernel.getStatus()).revenuePilotJobs[0]!;assert.equal(pending.activeLease?.dispatchState,'PENDING');assert.equal(pending.receipts.filter(r=>r.role==='work_director').length,0);
 releaseProvider();const results=await Promise.all(runs);assert.equal(calls,1);assert.equal(results.filter(r=>r.value).length,1);assert.equal((await f.kernel.getStatus()).revenuePilotJobs[0]?.receipts.filter(r=>r.role==='work_director').length,1);
},false));
test('the production shared-budget wrapper rechecks authority after its own token count before the raw provider',()=>fixture(async f=>{
 const config={monthlyLimitUsd:1,openingChargeUsd:0,inputUsdPerMillionTokens:0.1,outputUsdPerMillionTokens:0.4};await f.kernel.configureModelBudget(f.owner,config,{approvalId:'synthetic-shared-budget',action:'owner_funded_ceiling_change',targetId:`model-budget:${sha256(canonicalJson(config))}`,approvedAt:new Date().toISOString(),ownerId:f.owner.id});
 const claim=await f.kernel.claimRevenuePilotRole(SARA_PRINCIPAL,'luna-work-director',300,{jobId:f.job.id,role:'work_director'});let counts=0,calls=0;
 const client=f.kernel.guardPaidModelClient({routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){if(++counts===2)await f.kernel.revokeStandingMandate(f.owner,'synthetic-paid-service','Synthetic wrapped pre-provider revocation');return 10;},async execute(){calls++;return {outputText:'Synthetic raw provider',inputTokens:10,billableOutputTokens:10};}});
 await assert.rejects(f.kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL,{jobId:f.job.id,leaseId:claim.lease.id,prompt:'Synthetic wrapped dispatch',taskKind:'requirements_analysis',dataClassification:'public',maximumTaskCostUsd:0.05,allowGeminiFreeTier:false,clients:[client],verificationPassed:null}),/bounded model routes/i);assert.equal(calls,0);
 const job=(await f.kernel.getStatus()).revenuePilotJobs[0]!;assert.equal(job.actualExecutionCostUsd,0);assert.equal(job.receipts.at(-1)?.modelFailure?.attempts.at(-1)?.outcome,'rejected');assert.ok((await f.kernel.modelBudgetStatus()).reservedUsd>0,'A shared allowance reservation is preserved separately from actual provider expense');
}));
