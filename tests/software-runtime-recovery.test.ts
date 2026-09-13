import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {sha256} from '../src/canonical.ts';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import type {SoftwareRuntime} from '../src/digital-capabilities/software-work.ts';

const token='synthetic-runtime-recovery-owner';
const body={requestId:'synthetic-config-recovery',text:'Inspect the source and tests in repository BoneManTGRM/Nicos-Adventures.'};
function runtime(calls:{source:number},source='connected-v1'):SoftwareRuntime&{configurationIdentity:{sourceDigest:string;journeyDigest:string}}{
 return {configurationIdentity:{sourceDigest:sha256(source),journeyDigest:sha256('synthetic-browser-unused')},inspectSource:async repository=>{calls.source++;return {schemaVersion:1,actor:'SARA_RUNTIME',evidenceLabel:'EXTERNAL_READ_ONLY',collectionMode:'anonymous_read_only',repository:`https://github.com/${repository}`,immutableCommitSha:'a'.repeat(40),treeSha:'b'.repeat(40),defaultBranch:'main',collectedAt:'2026-09-13T00:00:00Z',inventoryTruncated:false,files:[{path:'package.json',role:'manifest',gitBlobSha:'d'.repeat(40),contentSha256:sha256('{}'),byteLength:2,permalink:`https://github.com/${repository}/blob/${'a'.repeat(40)}/package.json`,sourceText:'{}',sourceTruncated:false,trust:'UNTRUSTED_SOURCE'}],requestsUsed:1,limitations:['SYNTHETIC adapter result; no real customer/application evidence.']};},testJourney:async()=>{throw new Error('Inspection must not run a browser.');}};
}
async function fixture(run:(directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'sara-config-recovery-'));try{await run(directory);}finally{await rm(directory,{recursive:true,force:true});}}
const boot=(stateDirectory:string,softwareRuntime?:SoftwareRuntime)=>SaraKernel.boot({stateDirectory,ownerTokenSha256:sha256(token),...(softwareRuntime?{softwareRuntime}:{})});

test('SYNTHETIC adapter connection resumes the same durable owner plan and preserves unavailable receipts',()=>fixture(async directory=>{
 const unavailable=await boot(directory),old=await unavailable.executeOwnerMessage(unavailable.authenticateOwnerToken(token),body);
 assert.equal(old.status,'BLOCKED');const historical=await unavailable.inspectAudit();
 const calls={source:0},connected=await boot(directory,runtime(calls));
 const tick=await connected.resumeOwnerWorkTick();assert.notEqual(tick.status,'IDLE','a changed runtime is a new prerequisite fact for the existing plan');
 const fresh=await connected.executeOwnerMessage(connected.authenticateOwnerToken(token),body);
 assert.equal(fresh.status,'COMPLETE');assert.equal(fresh.planId,old.planId);assert.equal(fresh.receipts.length,old.receipts.length);assert.equal(calls.source,1);
 const again=await connected.executeOwnerMessage(connected.authenticateOwnerToken(token),body);assert.deepEqual(again.receipts,fresh.receipts);assert.equal(calls.source,1);
 const audit=await connected.inspectAudit();assert.deepEqual(audit.slice(0,historical.length),historical);assert.equal(audit.filter(e=>e.type==='owner_work_received').length,1);
 const oldSource=old.receipts.find(r=>r.capability.id==='software-source-inspector')!;
 const rejected=await connected.invokeCapability(connected.authenticateOwnerToken(token),{requestId:'synthetic-old-proof-consumer',capabilityId:'software-evidence-reviewer',input:{website:'https://nicos-world.com/',repository:'BoneManTGRM/Nicos-Adventures',journey:'',scope:'INSPECTION'},evidenceReceiptIds:[oldSource.resultDigest]});
 assert.equal((rejected.output as {qualified:boolean}).qualified,false);
}));

test('SYNTHETIC configuration changes invalidate displayed completion and only affected adapter proof',()=>fixture(async directory=>{
 const calls={source:0},original=await boot(directory,runtime(calls));
 const first=await original.executeOwnerMessage(original.authenticateOwnerToken(token),body);assert.equal(first.status,'COMPLETE');
 const browserOnly=runtime(calls);browserOnly.configurationIdentity.journeyDigest=sha256('different-browser');
 const sameSource=await boot(directory,browserOnly);const reused=await sameSource.executeOwnerMessage(sameSource.authenticateOwnerToken(token),body);assert.deepEqual(reused.receipts,first.receipts);assert.equal(calls.source,1);
 const changed=await boot(directory,runtime(calls,'connected-v2'));
 const displayed=(await changed.inspectOwnerWork(changed.authenticateOwnerToken(token)))[0]!;assert.equal(displayed.status,'BLOCKED');assert.equal(displayed.verification,'HISTORICAL_ANALYSIS');
 const fresh=await changed.executeOwnerMessage(changed.authenticateOwnerToken(token),body);assert.equal(fresh.status,'COMPLETE');assert.equal(calls.source,2);
 const source=first.receipts.find(r=>r.capability.id==='software-source-inspector')!;
 await assert.rejects(changed.invokeCapability(SARA_PRINCIPAL,{requestId:source.requestId,capabilityId:source.capability.id,input:{website:'https://nicos-world.com/',repository:'other/repository',journey:'',scope:'INSPECTION'}}),/REPLAY_CONFLICT/);
}));

test('SYNTHETIC runtime recovery preserves cancellation and stop without dispatch',()=>fixture(async directory=>{
 const unavailable=await boot(directory);await unavailable.executeOwnerMessage(unavailable.authenticateOwnerToken(token),body);await unavailable.cancelOwnerWork(unavailable.authenticateOwnerToken(token),body.requestId);
 const calls={source:0},connected=await boot(directory,runtime(calls));assert.equal((await connected.resumeOwnerWorkTick()).status,'IDLE');assert.equal((await connected.executeOwnerMessage(connected.authenticateOwnerToken(token),body)).status,'CANCELLED');
 await connected.setEmergencyStop(connected.authenticateOwnerToken(token),true);assert.equal((await connected.resumeOwnerWorkTick()).status,'BLOCKED');assert.equal(calls.source,0);
}));

test('SYNTHETIC changed authority blocks configuration recovery without repeated worker attempts',()=>fixture(async directory=>{
 const unavailable=await boot(directory),owner=unavailable.authenticateOwnerToken(token);await unavailable.executeOwnerMessage(owner,body);
 await unavailable.setEmergencyStop(owner,true);await unavailable.setEmergencyStop(owner,false);
 const calls={source:0},connected=await boot(directory,runtime(calls));
 assert.equal((await connected.resumeOwnerWorkTick()).status,'BLOCKED');
 const audit=await connected.inspectAudit();assert.equal((await connected.resumeOwnerWorkTick()).status,'IDLE');assert.deepEqual(await connected.inspectAudit(),audit);assert.equal(calls.source,0);
}));
