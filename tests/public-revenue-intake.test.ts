import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import {sha256} from '../src/canonical.ts';
import {compileCommercialTerms} from '../src/commercial-terms.ts';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {createSaraServer} from '../src/server.ts';
import {compilePublicRevenueIntake} from '../src/public-revenue-intake.ts';

// SYNTHETIC: isolated kernel and fake public repository provider. No payment or send.
async function fixture(run:(f:{post:(body:Record<string,unknown>)=>Promise<Response>;body:Record<string,unknown>;state:()=>ReturnType<SaraKernel['getStatus']>;restart:()=>Promise<void>;seedPartial:(secret:string)=>Promise<string>;stop:()=>Promise<void>})=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'sara-intake-replay-'));
 const ownerTokenSha256=sha256('synthetic-intake-owner');
 const terms=compileCommercialTerms({businessName:'Synthetic intake business',contactEmail:'owner@example.com',governingLaw:'owner selected test terms'});
 const options={stateDirectory:directory,ownerTokenSha256,commerce:{recipientAddress:`0x${'2'.repeat(40)}`,rpcUrl:'https://provider.invalid',terms,publicOrigin:'https://saraseed.app',fetchImpl:(async()=>Response.json({private:false,archived:false,full_name:'example/project',pushed_at:new Date().toISOString()})) as typeof fetch}};
 let kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256,bootstrapRevenueCapabilities:true});
 let server=createSaraServer(kernel,options),base='';
 const start=async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;};
 const close=()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await start();
 let attempt=0;
 const body={customerReference:'synthetic-customer@example.com',repoUrl:'https://github.com/example/project',primaryGoal:'release_readiness',repositoryOwnerPermissionConfirmed:true,requiresPrivateAccess:false,containsRegulatedOrPrivateData:false,requestsProductionChanges:false,requestsExploitValidation:false,termsAccepted:true,termsDigest:terms.digest};
 try{await run({body,post:body=>fetch(`${base}/api/public/revenue-pilot/intents`,{method:'POST',headers:{origin:'https://saraseed.app','content-type':'application/json','x-forwarded-for':`synthetic-${directory}-${++attempt}`},body:JSON.stringify(body)}),state:()=>kernel.getStatus(),restart:async()=>{await close();kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256,bootstrapRevenueCapabilities:true});server=createSaraServer(kernel,options);await start();},seedPartial:async secret=>{const compiled=compilePublicRevenueIntake(await kernel.getStatus(),{repository:body.repoUrl,recentCommitDays:0,primaryGoal:'release_readiness',clientSecretDigest:sha256(secret),customerReferenceDigest:sha256(body.customerReference),recipientAddress:options.commerce.recipientAddress,terms});return (await kernel.createRevenuePilotJob(SARA_PRINCIPAL,compiled.job.input)).id;},stop:()=>kernel.setEmergencyStop(kernel.authenticateOwnerToken('synthetic-intake-owner'),true)});}finally{await close();await rm(directory,{recursive:true,force:true});}
}

test('legacy checkout retry cannot create an orphan job while the existing lane is occupied',()=>fixture(async f=>{
 assert.equal((await f.post(f.body)).status,201);
 const before=await f.state();
 assert.equal((await f.post(f.body)).status,400);
 const after=await f.state();
 assert.equal(after.revenuePilotJobs.length,before.revenuePilotJobs.length,'a rejected retry must not persist a replacement job');
 assert.deepEqual(after.revenuePaymentIntents,before.revenuePaymentIntents);
}));

test('a lost checkout response is recoverable with the same private recovery secret after restart',()=>fixture(async f=>{
 const recoverySecret=randomBytes(32).toString('base64url'),body={...f.body,recoverySecret};
 const first=await f.post(body);assert.equal(first.status,201);const original=await first.json() as Record<string,unknown>;
 await f.restart();
 const retry=await f.post(body);assert.equal(retry.status,201);const recovered=await retry.json() as Record<string,unknown>;
 assert.equal(recovered.id,original.id);assert.equal(recovered.jobId,original.jobId);assert.ok(recovered.clientSecret===original.clientSecret,'recovery returns the same access credential');
 const state=await f.state();assert.equal(state.revenuePilotJobs.length,1);assert.equal(state.revenuePaymentIntents.length,1);assert.equal(state.realizedProfit.collectedRevenueUsd,0);
 assert.ok(!JSON.stringify(state).includes(recoverySecret),'recovery secret must not be persisted in public owner state');
 const changed=await f.post({...body,customerReference:'different@example.com'});assert.equal(changed.status,400);
 assert.match(String((await changed.json() as {error:string}).error),/different|changed|scope/i);
 assert.equal((await f.state()).revenuePilotJobs.length,1);
}));

test('concurrent checkout attempts reserve only one durable job and intent',()=>fixture(async f=>{
 const responses=await Promise.all([f.post({...f.body,recoverySecret:randomBytes(32).toString('base64url')}),f.post({...f.body,recoverySecret:randomBytes(32).toString('base64url')})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,400]);
 const state=await f.state();assert.equal(state.revenuePilotJobs.length,1);assert.equal(state.revenuePaymentIntents.length,1);
}));

test('invalid recovery credentials fail before checkout creates durable state',()=>fixture(async f=>{
 const response=await f.post({...f.body,recoverySecret:'short'});assert.equal(response.status,400);
 const state=await f.state();assert.equal(state.revenuePilotJobs.length,0);assert.equal(state.revenuePaymentIntents.length,0);
}));

test('a synthetic interruption between job and payment persistence resumes the same job under current stop state',()=>fixture(async f=>{
 const recoverySecret=randomBytes(32).toString('base64url'),jobId=await f.seedPartial(recoverySecret);
 await f.restart();
 const response=await f.post({...f.body,recoverySecret});assert.equal(response.status,201);
 assert.equal((await response.json() as {jobId:string}).jobId,jobId);
 const completed=await f.state();assert.equal(completed.revenuePilotJobs.length,1);assert.equal(completed.revenuePaymentIntents.length,1);
 await f.stop();
 const blocked=await f.post({...f.body,recoverySecret:randomBytes(32).toString('base64url')});assert.equal(blocked.status,423);
 const stopped=await f.state();assert.deepEqual(stopped.revenuePilotJobs,completed.revenuePilotJobs);assert.deepEqual(stopped.revenuePaymentIntents,completed.revenuePaymentIntents);
}));
