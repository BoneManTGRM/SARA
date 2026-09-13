import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {SoftwareSourceReadError} from '../src/software-source-reader.ts';
import type {SoftwareRuntime} from '../src/digital-capabilities/software-work.ts';
import {sourceQuotaRetryDeadline} from '../src/owner-software-recovery.ts';

const token='SYNTHETIC quota owner';
const request={requestId:'synthetic-quota-recovery',text:'Test the movement-to-scanner journey on Nico’s World using https://nicos-world.com/ and BoneManTGRM/Nicos-Adventures.'};
const quota=()=>new SoftwareSourceReadError('RATE_LIMIT','SYNTHETIC quota',new Response('',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1'}}));
async function fixture(run:(x:{kernel:SaraKernel;directory:string;runtime:SoftwareRuntime;calls:{source:number;browser:number};setFailure:(f:()=>Error|null)=>void})=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'sara-quota-')),calls={source:0,browser:0};let failure:()=>Error|null=quota;
 const runtime:SoftwareRuntime={inspectSource:async repository=>{calls.source++;const error=failure();if(error)throw error;return {schemaVersion:1,actor:'SARA_RUNTIME',evidenceLabel:'EXTERNAL_READ_ONLY',collectionMode:'anonymous_read_only',repository:`https://github.com/${repository}`,immutableCommitSha:'a'.repeat(40),treeSha:'b'.repeat(40),defaultBranch:'main',collectedAt:'2026-09-13T00:00:00Z',inventoryTruncated:false,files:['manifest','lockfile','runtime_configuration','journey_test','journey_source'].map((role,index)=>({path:`synthetic-${index}`,role:role as 'manifest',gitBlobSha:'d'.repeat(40),contentSha256:sha256('SYNTHETIC'),byteLength:9,permalink:`https://github.com/${repository}/blob/${'a'.repeat(40)}/synthetic-${index}`,sourceText:'SYNTHETIC',sourceTruncated:false,trust:'UNTRUSTED_SOURCE' as const})),requestsUsed:8,limitations:['SYNTHETIC adapter, not real repository evidence.']};},testJourney:async()=>{calls.browser++;return {actor:'SARA_RUNTIME',status:'INCOMPLETE_EVIDENCE',target:'https://nicos-world.com/',profile:'nicos-movement-to-scanner-v1',provenance:'ISOLATED',steps:[],assets:[],failureCode:'JOURNEY_BROWSER_SANDBOX_CREDENTIALS_FAILURE',startupDiagnostics:{classificationBasis:'FIRST_FATAL_LINE',classification:'SANDBOX_CREDENTIALS_FAILURE'},limitations:['SYNTHETIC pre-navigation browser failure.']};}};
 try{const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token),softwareRuntime:runtime});await run({kernel,directory,runtime,calls,setFailure:f=>{failure=f;}});}finally{await rm(directory,{recursive:true,force:true});}
}
test('SYNTHETIC elapsed source quota permits one explicit owner retry while preserving browser failure and exact durable work',()=>fixture(async({kernel,calls,setFailure,directory,runtime})=>{
 const owner=kernel.authenticateOwnerToken(token),first=await kernel.executeOwnerMessage(owner,request);
 setFailure(()=>null);
 assert.equal((await kernel.resumeOwnerWorkTick()).status,'IDLE');
 await kernel.executeOwnerMessage(owner,request);assert.deepEqual(calls,{source:1,browser:1});
 await assert.rejects(kernel.resumeOwnerMessage(SARA_PRINCIPAL,request.requestId),/AUTHENTICATED_OWNER/);
 const [resumed]=await Promise.all([kernel.resumeOwnerMessage(owner,request.requestId),kernel.resumeOwnerMessage(owner,request.requestId)]);
 assert.deepEqual(calls,{source:2,browser:1});assert.equal(resumed.planId,first.planId);
 const receipt=(r:typeof first,id:string)=>r.receipts.find(x=>x.capability.id===id)!;
 assert.equal(receipt(resumed,'software-journey-tester').resultDigest,receipt(first,'software-journey-tester').resultDigest);
 assert.notEqual(receipt(resumed,'software-source-inspector').resultDigest,receipt(first,'software-source-inspector').resultDigest);
 assert.notEqual(receipt(resumed,'software-evidence-reviewer').resultDigest,receipt(first,'software-evidence-reviewer').resultDigest);
 assert.equal((receipt(resumed,'software-evidence-reviewer').output as any).evidence.sourceReceipt,receipt(resumed,'software-source-inspector').resultDigest);
 const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token),softwareRuntime:runtime});
 const replay=await reboot.resumeOwnerMessage(reboot.authenticateOwnerToken(token),request.requestId);assert.deepEqual(replay.receipts,resumed.receipts);assert.deepEqual(calls,{source:2,browser:1});
 const events=await reboot.inspectAudit();assert.equal(events.filter(e=>e.type==='owner_work_received').length,1);assert.equal(events.filter(e=>e.type==='owner_source_retry_authorized').length,1);assert.equal(events.filter(e=>e.type==='owner_source_retry_dispatched').length,1);
}));

test('SYNTHETIC quota retry requires explained provider evidence and respects every supplied deadline',()=>fixture(async({kernel,setFailure,calls})=>{
 const future=new Date(Date.now()+3600000).toUTCString();
 setFailure(()=>new SoftwareSourceReadError('RATE_LIMIT','SYNTHETIC future',new Response('',{status:429,headers:{'retry-after':future,'x-ratelimit-reset':'1'}})));
 const owner=kernel.authenticateOwnerToken(token),first=await kernel.executeOwnerMessage(owner,request),source=first.receipts.find(r=>r.capability.id==='software-source-inspector')!;
 assert.ok(sourceQuotaRetryDeadline(source,'2026-09-13T00:00:00.000Z')!>Date.now());
 await kernel.resumeOwnerMessage(owner,request.requestId);assert.deepEqual(calls,{source:1,browser:1});
 const b=(source.output as any).evidence.providerBoundary;
 for(const malformed of [{classification:'PROVIDER_REJECTED'},{httpStatus:403,rateLimitRemaining:null},{retryAfterAt:'bad'},{retryAfterSeconds:-1},{retryAfterSeconds:'1'},{rateLimitResetUnixSeconds:null,retryAfterAt:null,retryAfterSeconds:null}]){
  const changed=structuredClone(source);Object.assign((changed.output as any).evidence.providerBoundary,b,malformed);assert.equal(sourceQuotaRetryDeadline(changed,'2026-09-13T00:00:00.000Z'),null);
 }
 const relative=structuredClone(source);Object.assign((relative.output as any).evidence.providerBoundary,{retryAfterAt:null,retryAfterSeconds:30,rateLimitResetUnixSeconds:1});assert.equal(sourceQuotaRetryDeadline(relative,'2026-09-13T00:00:00.000Z'),Date.parse('2026-09-13T00:00:30.000Z'));
}));

test('SYNTHETIC repeated distinct quota failures exhaust durable owner retry ceiling and do not reset on reboot',()=>fixture(async({kernel,setFailure,calls,directory,runtime})=>{
 let reset=1;setFailure(()=>new SoftwareSourceReadError('RATE_LIMIT','SYNTHETIC quota',new Response('',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(reset++)}})));
 const owner=kernel.authenticateOwnerToken(token);await kernel.executeOwnerMessage(owner,request);
 await kernel.resumeOwnerMessage(owner,request.requestId);await kernel.resumeOwnerMessage(owner,request.requestId);await kernel.resumeOwnerMessage(owner,request.requestId);
 assert.deepEqual(calls,{source:3,browser:1});
 const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token),softwareRuntime:runtime});await reboot.resumeOwnerMessage(reboot.authenticateOwnerToken(token),request.requestId);assert.deepEqual(calls,{source:3,browser:1});
 assert.equal((await reboot.inspectAudit()).filter(e=>e.type==='owner_source_retry_authorized').length,2);
}));

test('SYNTHETIC unchanged quota evidence cannot mint repeated attempts and stop epoch or cancellation cannot renew authority',()=>fixture(async({kernel,calls})=>{
 const owner=kernel.authenticateOwnerToken(token);await kernel.executeOwnerMessage(owner,request);await kernel.resumeOwnerMessage(owner,request.requestId);await kernel.resumeOwnerMessage(owner,request.requestId);assert.deepEqual(calls,{source:2,browser:1});
 await kernel.setEmergencyStop(owner,true);await kernel.resumeOwnerMessage(owner,request.requestId);await kernel.setEmergencyStop(owner,false);
 await kernel.cancelOwnerWork(owner,request.requestId);assert.equal((await kernel.resumeOwnerMessage(owner,request.requestId)).status,'CANCELLED');assert.deepEqual(calls,{source:2,browser:1});
}));

test('SYNTHETIC changed authority rejects a new quota admission',()=>fixture(async({kernel,calls})=>{
 const owner=kernel.authenticateOwnerToken(token);await kernel.executeOwnerMessage(owner,request);await kernel.setEmergencyStop(owner,true);await kernel.setEmergencyStop(owner,false);
 await assert.rejects(kernel.resumeOwnerMessage(owner,request.requestId),/AUTHORITY_CHANGED/);assert.deepEqual(calls,{source:1,browser:1});
}));

test('SYNTHETIC crash after owner retry admission resumes only the pending bounded attempt',()=>fixture(async({kernel,calls,setFailure,directory,runtime})=>{
 const owner=kernel.authenticateOwnerToken(token);await kernel.executeOwnerMessage(owner,request);setFailure(()=>null);
 const original=kernel.invokeCapability.bind(kernel);kernel.invokeCapability=async(...args)=>{if(args[1].capabilityId==='software-source-inspector')throw new Error('SYNTHETIC_CRASH_BEFORE_RETRY_DISPATCH');return original(...args);};
 await assert.rejects(kernel.resumeOwnerMessage(owner,request.requestId),/SYNTHETIC_CRASH/);assert.deepEqual(calls,{source:1,browser:1});
 const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token),softwareRuntime:runtime});await reboot.resumeOwnerWorkTick();await reboot.resumeOwnerMessage(reboot.authenticateOwnerToken(token),request.requestId);assert.deepEqual(calls,{source:2,browser:1});
}));

test('SYNTHETIC cancellation after retry admission blocks its next affected dispatch',()=>fixture(async({kernel,calls})=>{
 const owner=kernel.authenticateOwnerToken(token);await kernel.executeOwnerMessage(owner,request);
 const original=kernel.invokeCapability.bind(kernel);kernel.invokeCapability=async(...args)=>{if(args[1].capabilityId==='software-source-inspector')await kernel.cancelOwnerWork(owner,request.requestId);return original(...args);};
 assert.equal((await kernel.resumeOwnerMessage(owner,request.requestId)).status,'CANCELLED');assert.deepEqual(calls,{source:1,browser:1});
 const events=await kernel.inspectAudit();assert.equal(events.filter(e=>e.type==='owner_source_retry_authorized').length,1);assert.equal(events.filter(e=>e.type==='owner_source_retry_dispatched').length,0);
}));
