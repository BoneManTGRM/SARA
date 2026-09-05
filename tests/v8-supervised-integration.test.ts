import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {runSupervisedBenchmark,runProcessApprovedBenchmark,type SupervisorInput} from '../proof/benchmark-supervisor.ts';
import {loadV8SupervisedContract} from '../proof/v8-supervised-contract.ts';
import {good,mutations} from '../proof/v8-live-fixture.ts';
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('actual credential-free V8 worker and verifier complete both scripted arms without a live speed claim',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v8-offline-'));
 const contract=await loadV8SupervisedContract();let calls=0;
 try{
 const x:SupervisorInput={ledgerDirectory:dir,now:Date.now(),mode:'offline',contract,grant:{experimentId:contract.caseId,contractDigest:contract.digest,implementationCommit:'b'.repeat(40),deploymentId:uuid,expiresAt:Date.now()+60000,maximumPhysicalSpendUsd:0.15},
 connect:()=>spawn(process.execPath,['--import','tsx','proof/v8-worker.ts'],{stdio:'pipe',env:{PATH:process.env.PATH,RAILWAY_DEPLOYMENT_ID:uuid,RAILWAY_GIT_COMMIT_SHA:'b'.repeat(40)}}),
 provider:()=>({routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(p){assert(!p.includes('PRIVATE_V8_INVENTORY_ORACLE'));return 100;},async execute(input){calls++;const facts=JSON.parse(input.prompt.split('\n').slice(2).join('\n'));const current=facts.files.find((f:any)=>f.path==='src/inventory.ts');const compact=input.prompt.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');return {inputTokens:100,billableOutputTokens:100,outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,strategy:facts.requiredStrategy,changes:[{path:current.path,expectedContentDigest:current.contentDigest,...(compact?{edits:mutations.map(m=>({find:m.replace,replace:m.find}))}:{replacementText:good})}],limitations:[]})};}})};
 const out=await runSupervisedBenchmark(x);assert.equal(calls,2);assert.equal(out.result.speedRatio,null);assert.equal(out.result.evidenceLevel,'OFFLINE_SUPERVISED_V8_VERIFIER');assert(out.result.arms.every((a:any)=>a.verifiedComplete&&a.finalVerification.passed));assert.equal(out.result.contract.hiddenAssertionCount,50);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a consumed process approval cannot connect twice, even after connection failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v8-claim-'));let calls=0,providers=0;const now=Date.now();
 const id={contractDigest:'a'.repeat(64),implementationCommit:'b'.repeat(40),deploymentId:uuid,serviceId:uuid,nonce:'e'.repeat(64)};
 const approval={schemaVersion:1,caseId:'bounded-inventory-basket-v8-live-01',mode:'live',...id,maximumPhysicalSpendUsd:0.15,issuedAt:now,expiresAt:now+60000};
 const x:SupervisorInput={ledgerDirectory:dir,contract:{caseId:approval.caseId,digest:id.contractDigest,paidAllowed:true},grant:{experimentId:approval.caseId,contractDigest:id.contractDigest,implementationCommit:id.implementationCommit,deploymentId:uuid,expiresAt:approval.expiresAt,maximumPhysicalSpendUsd:0.15},mode:'live',now,connect:()=>{calls++;return spawn(process.execPath,['-e','process.exit(1)'],{stdio:'pipe'});},provider:()=>{providers++;throw Error('must not create provider');}};
 try{await assert.rejects(()=>runProcessApprovedBenchmark(x,approval,id));await assert.rejects(()=>runProcessApprovedBenchmark({...x,ledgerDirectory:dir+'/different'},approval,id),/PROCESS_APPROVAL_ALREADY_CONSUMED/);assert.equal(calls,1);assert.equal(providers,0);}finally{await rm(dir,{recursive:true,force:true});}
});

for(const mutation of ['nonce','deployment','budget','offline-contract'] as const)test(`process approval rejects ${mutation} mismatch before connect or provider`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v8-invalid-'));let calls=0;const now=Date.now();
 const id={contractDigest:'a'.repeat(64),implementationCommit:'b'.repeat(40),deploymentId:uuid,serviceId:uuid,nonce:'f'.repeat(64)};
 const approval={schemaVersion:1,caseId:'bounded-inventory-basket-v8-live-01',mode:'live',...id,maximumPhysicalSpendUsd:0.15,issuedAt:now,expiresAt:now+60000};
 const x:SupervisorInput={ledgerDirectory:dir,contract:{caseId:approval.caseId,digest:id.contractDigest,paidAllowed:true},grant:{experimentId:approval.caseId,contractDigest:id.contractDigest,implementationCommit:id.implementationCommit,deploymentId:uuid,expiresAt:approval.expiresAt,maximumPhysicalSpendUsd:0.15},mode:'live',now,connect:()=>{calls++;throw Error('must not connect');},provider:()=>{calls++;throw Error('must not call');}};
 if(mutation==='nonce')approval.nonce='c'.repeat(64);
 if(mutation==='deployment')approval.deploymentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 if(mutation==='budget')x.grant.maximumPhysicalSpendUsd=0.16;
 if(mutation==='offline-contract')x.contract.paidAllowed=false;
 try{await assert.rejects(()=>runProcessApprovedBenchmark(x,approval,id),/APPROVAL_/);assert.equal(calls,0);}finally{await rm(dir,{recursive:true,force:true});}
});
