import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportedWorkFamily,compileOwnerWork} from '../src/owner-work.ts';
import {capabilityContracts} from '../src/digital-capabilities/registry.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {resolveSoftwareTarget} from '../src/owner-software-work.ts';
import type {SoftwareRuntime} from '../src/digital-capabilities/software-work.ts';

const request='Test the movement-to-scanner journey on Nico’s World using https://nicos-world.com/ and BoneManTGRM/Nicos-Adventures. Inspect the current source and existing tests, gather the evidence yourself, and give me a defect report with what passed, what failed, what remains untested, and what still needs my decision.';
test('explicit application testing never becomes supplied-defect analysis or inherits an unrelated counter fixture',async()=>{
 assert.equal(supportedWorkFamily(request),'software-inspection');
 const record=await compileOwnerWork({requestId:'synthetic-software-route',text:request},[],await capabilityContracts(),'2026-09-13T00:00:00Z',[],'',{materials:[{workflow:'supplied-defect',body:'Expected: counter returns 2.\nObserved: synthetic counter.',sourceId:'synthetic-counter',receivedAt:'2026-09-12T00:00:00Z'}]});
 assert.equal(record.workflow,'software-inspection');
 assert.ok(record.plan?.steps.some(s=>s.capabilityId==='software-source-inspector'));
 assert.ok(record.plan?.steps.some(s=>s.capabilityId==='software-journey-tester'));
 assert.ok(!JSON.stringify(record.plan).includes('synthetic counter'));
});
test('target conflicts and unrelated project changes cannot inherit previous permissions or supplied material',()=>{
 const prior={target:{website:'https://nicos-world.com/',repository:'BoneManTGRM/Nicos-Adventures',journey:'movement-to-scanner',scope:'JOURNEY_TEST' as const},requestId:'synthetic-original',receivedAt:'2026-09-13T00:00:00Z'};
 assert.equal(resolveSoftwareTarget('Check the same project movement-to-scanner flow.',prior).contextSource,'synthetic-original');
 for(const text of ['Test movement and scanner on Nico’s World using https://example.com/', 'Test movement and scanner on Nico’s World using BoneManTGRM/Other', 'Test the same project movement and scanner using https://127.0.0.1/', 'Check movement and scanner using https://nicos-world.com/?token=secret', 'Test the movement and scanner journey for OtherOrg/OtherProject.'])assert.equal(resolveSoftwareTarget(text,prior).target,null,text);
 assert.equal(resolveSoftwareTarget('Check the same project movement-to-scanner flow.').target,null);
});

const syntheticAssets=[{url:'https://nicos-world.com/',sha256:sha256('SYNTHETIC HTML'),bytes:14,contentType:'text/html'},{url:'https://nicos-world.com/assets/synthetic.js',sha256:sha256('SYNTHETIC SCRIPT'),bytes:16,contentType:'text/javascript'}];
const ownerToken='synthetic-software-owner';
const stepPairs=[['Observe World Map','World Map'],['Continue adventure','Robot Home'],['Continue adventure','Robo Lab'],['Continue to the test chamber','Movement test'],['Forward','1'],['Right','2'],['Forward','3'],['Pass movement test','Scanner test']];
function adapters(calls:{source:number;browser:number},incomplete=false):SoftwareRuntime{return {
 inspectSource:async(repository)=>{calls.source++;return {schemaVersion:1,actor:'SARA_RUNTIME',evidenceLabel:'EXTERNAL_READ_ONLY',collectionMode:'anonymous_read_only',repository:`https://github.com/${repository}`,immutableCommitSha:'a'.repeat(40),treeSha:'b'.repeat(40),defaultBranch:'main',collectedAt:'2026-09-13T00:00:00Z',inventoryTruncated:false,files:['manifest','lockfile','runtime_configuration','journey_test','journey_source'].map((role,index)=>({path:`synthetic-${index}`,role:role as 'manifest',gitBlobSha:'d'.repeat(40),contentSha256:sha256('SYNTHETIC'),byteLength:9,permalink:`https://github.com/${repository}/blob/${'a'.repeat(40)}/synthetic-${index}`,sourceText:'SYNTHETIC',sourceTruncated:false,trust:'UNTRUSTED_SOURCE' as const})),requestsUsed:8,limitations:['SYNTHETIC isolated integration adapter, not real repository evidence.']};},
 testJourney:async()=>{calls.browser++;return {schemaVersion:1,actor:'SARA_RUNTIME',target:'https://nicos-world.com/',profile:'nicos-movement-to-scanner-v1',provenance:'ISOLATED',assetProvenance:'EXTERNAL_READ_ONLY',environment:{sandboxArgumentsVerified:true,commandLineDigest:sha256('SYNTHETIC ARGS'),sandboxDisabled:false,liveStateOrCredentialsImported:false,executableSha256:sha256('SYNTHETIC BROWSER'),browserProduct:'Chrome/153.0.8010.36',browserRevision:'@'+'a'.repeat(40)},assets:syntheticAssets,assetSetDigest:sha256(canonicalJson(syntheticAssets)),status:'PASSED',steps:stepPairs.slice(0,incomplete?1:8).map(([action,expected])=>({action,expected,observed:expected,passed:true})),screenshotDigest:'c'.repeat(64),servingRevision:null,runtimeExceptionCount:0,resourceFailureCount:0,failureCode:null,limitations:['SYNTHETIC controlled adapter, not real browser acceptance.']};}
};}
async function withKernel(run:(x:{kernel:SaraKernel;directory:string;calls:{source:number;browser:number};runtime:SoftwareRuntime})=>Promise<void>,incomplete=false){
 const directory=await mkdtemp(join(tmpdir(),'sara-software-work-')),calls={source:0,browser:0},runtime=adapters(calls,incomplete);
 try{const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken),softwareRuntime:runtime});await run({kernel,directory,calls,runtime});}finally{await rm(directory,{recursive:true,force:true});}
}
test('ordinary authenticated runtime plan gathers its own inputs, independently verifies, and replays after reboot',()=>withKernel(async({kernel,directory,calls,runtime})=>{
 const owner=kernel.authenticateOwnerToken(ownerToken),body={requestId:'synthetic-runtime-request',conversationId:'synthetic-project-context',text:request};
 const result=await kernel.executeOwnerMessage(owner,body);
 assert.equal(result.status,'COMPLETE');assert.equal(result.verification,'VERIFIED_ANALYSIS');assert.equal(result.receipts.length,5);assert.equal(calls.source,1);assert.equal(calls.browser,1);assert.match(result.outputText,/isolated/);
 assert.ok(result.receipts.filter(r=>r.capability.id.startsWith('software-')).every(r=>r.inputDigest===result.receipts.find(r=>r.capability.id==='software-source-inspector')!.inputDigest));
 const before=await kernel.inspectAudit();
 const replay=await kernel.executeOwnerMessage(owner,body);assert.deepEqual(replay.receipts,result.receipts);assert.deepEqual(calls,{source:1,browser:1});
 const resumed=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken),softwareRuntime:runtime});
 const again=await resumed.executeOwnerMessage(resumed.authenticateOwnerToken(ownerToken),body);assert.deepEqual(again.receipts,result.receipts);assert.deepEqual(calls,{source:1,browser:1});
 assert.deepEqual((await resumed.inspectAudit()).slice(0,before.length),before);
 const follow=await resumed.executeOwnerMessage(resumed.authenticateOwnerToken(ownerToken),{requestId:'synthetic-followup',conversationId:'synthetic-project-context',text:'Check the same project movement-to-scanner flow.'});assert.equal(follow.softwareTarget?.repository,'BoneManTGRM/Nicos-Adventures');
 const other=await resumed.executeOwnerMessage(resumed.authenticateOwnerToken(ownerToken),{requestId:'synthetic-other-context',conversationId:'different-context',text:'Check the same project movement-to-scanner flow.'});assert.equal(other.status,'BLOCKED');assert.equal(other.receipts.length,0);
}));
test('internal caller, bridge and stop never dispatch the new runtime adapters',()=>withKernel(async({kernel,calls})=>{
 const input={website:'https://nicos-world.com/',repository:'BoneManTGRM/Nicos-Adventures',journey:'movement-to-scanner',scope:'JOURNEY_TEST'};
 const denied=await kernel.invokeCapability(SARA_PRINCIPAL,{requestId:'synthetic-unadmitted',capabilityId:'software-source-inspector',input});assert.equal(denied.status,'BLOCKED');
 await assert.rejects(kernel.executeTelegramWork(SARA_PRINCIPAL,{requestId:'synthetic-bridge',text:request}),/AUTHENTICATED_OWNER/);
 const owner=kernel.authenticateOwnerToken(ownerToken);await kernel.setEmergencyStop(owner,true);
 await assert.rejects(kernel.executeOwnerMessage(owner,{requestId:'synthetic-stop',text:request}),/EMERGENCY_STOP/);assert.deepEqual(calls,{source:0,browser:0});
}));
test('a partial observation cannot be promoted by a runner claiming PASSED',()=>withKernel(async({kernel})=>{
 const result=await kernel.executeOwnerMessage(kernel.authenticateOwnerToken(ownerToken),{requestId:'synthetic-incomplete',text:request});assert.equal(result.status,'BLOCKED');assert.match(result.outputText,/incomplete/i);
},true));
test('ordinary software paraphrases select inspection while supplied review remains distinct',()=>{
 for(const goal of ['Check the movement and scanner path on https://nicos-world.com/ using BoneManTGRM/Nicos-Adventures.', 'Inspect https://nicos-world.com/ and BoneManTGRM/Nicos-Adventures and test movement through scanner.', 'Verify the movement-to-scanner flow for Nico’s World.']) assert.equal(supportedWorkFamily(goal),'software-inspection',goal);
 assert.equal(supportedWorkFamily('Review this supplied software defect report.'),'supplied-defect');
 assert.equal(supportedWorkFamily('Deploy https://nicos-world.com/ and test movement.'),null);
});

test('passing assertions without frozen fetched assets cannot qualify',()=>withKernel(async({kernel,runtime})=>{
 const original=runtime.testJourney;
 const directory=await mkdtemp(join(tmpdir(),'sara-missing-assets-'));
 try{const isolated=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken),softwareRuntime:{...runtime,testJourney:async()=>({...await original() as object,assets:[],assetSetDigest:null})}});
 const result=await isolated.executeOwnerMessage(isolated.authenticateOwnerToken(ownerToken),{requestId:'synthetic-no-assets',text:request});assert.equal(result.status,'BLOCKED');
 }finally{await rm(directory,{recursive:true,force:true});}
}));

test('cancellation after source gathering blocks the next browser step and preserves completed evidence',()=>withKernel(async({kernel,calls})=>{
 const owner=kernel.authenticateOwnerToken(ownerToken),original=kernel.invokeCapability.bind(kernel);
 kernel.invokeCapability=async(...args)=>{const result=await original(...args);if(args[1].capabilityId==='software-source-inspector')await kernel.cancelOwnerWork(owner,'synthetic-cancel-after-source');return result;};
 const result=await kernel.executeOwnerMessage(owner,{requestId:'synthetic-cancel-after-source',text:request});
 assert.equal(result.status,'CANCELLED');assert.equal(calls.source,1);assert.equal(calls.browser,0);assert.ok(result.receipts.some(r=>r.capability.id==='software-source-inspector'));
 assert.equal((await kernel.resumeOwnerWorkTick()).status,'IDLE');
}));
test('crash after source receipt resumes the existing plan without recollecting the source',()=>withKernel(async({kernel,directory,calls,runtime})=>{
 const owner=kernel.authenticateOwnerToken(ownerToken),original=kernel.invokeCapability.bind(kernel);
 kernel.invokeCapability=async(...args)=>{const result=await original(...args);if(args[1].capabilityId==='software-source-inspector')throw new Error('SYNTHETIC_CRASH_AFTER_SOURCE_RECEIPT');return result;};
 await assert.rejects(kernel.executeOwnerMessage(owner,{requestId:'synthetic-crash-after-source',text:request}),/SYNTHETIC_CRASH/);
 assert.deepEqual(calls,{source:1,browser:0});
 const restored=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(ownerToken),softwareRuntime:runtime});
 await restored.resumeOwnerWorkTick();
 const result=await restored.executeOwnerMessage(restored.authenticateOwnerToken(ownerToken),{requestId:'synthetic-crash-after-source',text:request});
 assert.equal(result.status,'COMPLETE');assert.deepEqual(calls,{source:1,browser:1});assert.equal(result.receipts.length,5);
 assert.equal((await restored.inspectAudit()).filter(e=>e.type==='owner_work_received').length,1);
}));
