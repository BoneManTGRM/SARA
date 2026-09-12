import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {SaraKernel} from '../src/kernel.ts';
import {learningFreshRootRetryBlocker} from '../src/learning-campaign.ts';
import {createSaraServer} from '../src/server.ts';
import {sha256} from '../src/canonical.ts';
import {legacyLearningRetryFixture} from './fixtures/legacy-learning-retry.ts';

test('ordinary owner review reports the exact worker retry limit from durable history without replacing jobs',async()=>{
 const fixture=await legacyLearningRetryFixture();const {kernel,directory,token}=fixture;
 const server=createSaraServer(kernel,{stateDirectory:directory,ownerTokenSha256:sha256(token)});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const before=await kernel.getStatus(),body={requestId:'legacy-retry-review',text:'Review unfinished work, identify blockers, prioritize obligations, complete the authorized steps, and give me a brief.'};
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/owner/messages`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200);const result=await response.json() as any;
  assert.equal(result.status,'BLOCKED');assert.equal(result.verification,'VERIFIED_ANALYSIS');
  const blocked=result.blockers.find((b:any)=>b.subjectId==='legacy-authorized-root');
  assert.match(blocked.reason,/LEARNING_FRESH_ROOT_RETRY_BUDGET_EXHAUSTED/);
  assert.match(blocked.reason,/3.*3/);assert.ok(blocked.missing.some((m:string)=>m.includes('failed-root-1')));
  assert.ok(result.brief.sections.some((s:any)=>s.items.some((i:any)=>i.summary.includes('LEARNING_FRESH_ROOT_RETRY_BUDGET_EXHAUSTED'))));
  assert.deepEqual((await kernel.getStatus()).jobs,before.jobs);assert.equal(result.actualCashMicroUsd,0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.cleanup();}
});

test('the direct kernel entrypoint cannot bypass the scheduled worker fresh-root retry ceiling',async()=>{
 const fixture=await legacyLearningRetryFixture();
 try{
  const before=await fixture.kernel.inspectAudit();let calls=0;
  assert.equal((await fixture.kernel.learningCampaignStatus()).campaign?.reserved,3);
  const result=await fixture.kernel.runLearningWorkerTick({id:'should-not-dispatch',external:false,maximumCostUsd:0,async generate(){calls++;throw new Error('Controlled nonretryable fixture failure');}});
  assert.equal(result.status,'blocked');assert.equal(calls,0);
  const after=await fixture.kernel.inspectAudit();assert.deepEqual(after,before,'Blocking must preserve jobs, reservations and the audit');
  const rebooted=await SaraKernel.boot({stateDirectory:fixture.directory,ownerTokenSha256:sha256(fixture.token)});
  const rebootAudit=await rebooted.inspectAudit();assert.deepEqual(rebootAudit.slice(0,before.length),before);
  const restarted=await rebooted.runLearningWorkerTick({id:'no-restart-retry',external:false,maximumCostUsd:0,async generate(){calls++;throw new Error('not called');}});
  assert.equal(restarted.status,'blocked');assert.equal(calls,0);assert.equal((await rebooted.learningCampaignStatus()).campaign?.reserved,3);
  assert.deepEqual(await rebooted.inspectAudit(),rebootAudit);

 }finally{await fixture.cleanup();}
});


test('the shared retry rule binds exact root identity and exempts child repair',async()=>{
 const fixture=await legacyLearningRetryFixture();
 try{
  const root=fixture.jobs.at(-1)!;
  for(const key of ['learningCampaignId','learningCapabilityId','learningContractDigest','learningSourceJobId'] as const){
   assert.equal(learningFreshRootRetryBlocker(fixture.jobs,{...root,[key]:'different-subject'}),null,key);
  }
  assert.equal(learningFreshRootRetryBlocker(fixture.jobs,{...root,learningParentJobId:'failed-root-1'}),null);
  assert.equal(learningFreshRootRetryBlocker(fixture.jobs.slice(1),root),null,'Two terminal roots do not exhaust a limit of three');
  assert.equal(learningFreshRootRetryBlocker(fixture.jobs,{...root,status:'running'})?.failedRootJobIds.length,3,'Provider dispatch must recheck a root that is now running');
 }finally{await fixture.cleanup();}
});


test('a third root failure after reservation blocks the next provider dispatch without refunding the reservation',async()=>{
 const fixture=await legacyLearningRetryFixture({failedRoots:2,concurrentRoot:true});
 try{
  const {kernel,token}=fixture,original=kernel.runSelfBuildCycle.bind(kernel);let calls=0;
  kernel.runSelfBuildCycle=async(principal,jobId,generator)=>{
   assert.equal(jobId,'legacy-authorized-root');
   await assert.rejects(()=>original(kernel.authenticateOwnerToken(token),'zz-concurrent-root',{id:'concurrent-terminal-failure',external:false,maximumCostUsd:0,async generate(){throw new Error('Controlled concurrent terminal failure');}}),/Controlled concurrent terminal failure/);
   assert.equal((await kernel.getStatus()).jobs.find(j=>j.id==='zz-concurrent-root')?.status,'failed');
   return original(principal,jobId,generator);
  };
  await kernel.runLearningWorkerTick({id:'next-provider-must-not-start',external:false,maximumCostUsd:0,async generate(){calls++;throw new Error('Unexpected provider dispatch');}});
  assert.equal(calls,0);
  const events=await kernel.inspectAudit();
  assert.ok(!events.some(e=>e.type==='learning_provider_call_started'&&(e.data as any).jobId==='legacy-authorized-root'));
  assert.equal((await kernel.learningCampaignStatus()).campaign?.reserved,4,'The already-made reservation remains accounted after the live boundary changes');
 }finally{await fixture.cleanup();}
});
