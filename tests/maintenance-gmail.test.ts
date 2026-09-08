import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {newMaintenanceId,maintenanceRequestDigest,type MaintenanceRequest} from '../src/website-maintenance.ts';
import {MaintenanceGmailNotifier} from '../src/maintenance-gmail.ts';

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'sara-maint-mail-'));
 const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256('fixture-owner')});
 const owner=kernel.authenticateOwnerToken('fixture-owner');
 const request:MaintenanceRequest={id:newMaintenanceId(),projectId:'gift-fixture',baseDigest:sha256('source'),slot:'tagline',before:'Before',after:'After',funding:'GIFT',maximumCostUsd:0};
 await kernel.submitWebsiteMaintenance(owner,request,maintenanceRequestDigest(request));
 // Fixtures for a previously verified publisher; not live website evidence.
 await kernel.advanceWebsiteMaintenance(SARA_PRINCIPAL,request.id,0,{state:'PREPARED',candidateDigest:sha256('candidate')});
 await kernel.advanceWebsiteMaintenance(SARA_PRINCIPAL,request.id,1,{state:'PUBLISH_INTENT'});
 await kernel.advanceWebsiteMaintenance(SARA_PRINCIPAL,request.id,2,{state:'PUBLISHED',deploymentReceipt:'fixture-published'});
 await kernel.advanceWebsiteMaintenance(SARA_PRINCIPAL,request.id,3,{state:'NOTIFY_INTENT'});
 const input={idempotencyKey:request.id,deploymentReceipt:'fixture-published',digest:sha256('candidate')};
 const create=(fetchImpl:typeof fetch,k=kernel)=>new MaintenanceGmailNotifier({kernel:k,stateDirectory:directory,clientId:'fixture-client-id',clientSecret:'fixture-client-secret',refreshToken:'fixture-refresh-token',fetchImpl});
 return {directory,kernel,owner,request,input,create,cleanup:()=>rm(directory,{recursive:true,force:true})};
}
function transport(send:(init?:RequestInit)=>Promise<Response>,email='sara.reparodynamics@gmail.com'):typeof fetch {
 return async(url,init)=>{
  if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access',token_type:'Bearer'});
  if(String(url)==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({email,email_verified:true});
  assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');return send(init);
 };
}
test('maintenance Gmail verifies exact identity, sends the bound receipt and reconciles across restart',async()=>{
 const f=await fixture();try{
  let sends=0;const fetchImpl=transport(async init=>{sends++;const mime=Buffer.from(JSON.parse(String(init?.body)).raw,'base64url').toString();assert.match(mime,/To: reparodynamics@gmail.com/);assert.match(mime,/From: SARA <sara.reparodynamics@gmail.com>/);const text=Buffer.from(mime.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString();assert.match(text,/fixture-published/);assert.match(text,/no customer revenue/);return Response.json({id:'fixture-message-1'});});
  const notifier=f.create(fetchImpl);assert.equal(await notifier.findNotification(f.request.id),null);
  assert.deepEqual(await notifier.notify(f.input),{receipt:'gmail:fixture-message-1'});
  const restarted=await SaraKernel.boot({stateDirectory:f.directory,ownerTokenSha256:sha256('fixture-owner')});
  assert.deepEqual(await f.create(fetchImpl,restarted).notify(f.input),{receipt:'gmail:fixture-message-1'});assert.equal(sends,1);
 }finally{await f.cleanup();}
});
test('wrong Gmail account or unbound notification cannot send',async()=>{
 const f=await fixture();try{let sends=0;const notifier=f.create(transport(async()=>{sends++;return Response.json({id:'unexpected'});},'someone-else@gmail.com'));
 await assert.rejects(notifier.notify({...f.input,digest:sha256('different')}),/NOT_AUTHORIZED/);
 await assert.rejects(notifier.notify(f.input),/IDENTITY_MISMATCH/);assert.equal(sends,0);assert.equal(await notifier.findNotification(f.request.id),null);
 }finally{await f.cleanup();}
});
test('uncertain Gmail response is durable and never automatically resent',async()=>{
 const f=await fixture();try{let sends=0;const fetchImpl=transport(async()=>{sends++;throw Error('lost reply');});
 await assert.rejects(f.create(fetchImpl).notify(f.input),/lost reply/);
 const restarted=await SaraKernel.boot({stateDirectory:f.directory,ownerTokenSha256:sha256('fixture-owner')});
 await assert.rejects(f.create(fetchImpl,restarted).notify(f.input),/UNCERTAIN/);assert.equal(sends,1);
 const attempt=await readFile(join(f.directory,'website-maintenance',f.request.id,'gmail','attempt.json'),'utf8');assert.doesNotMatch(attempt,/fixture-access|fixture-refresh/);
 }finally{await f.cleanup();}
});
test('concurrent notification attempts have one sender and emergency stop prevents dispatch',async()=>{
 const f=await fixture();try{let sends=0;const fetchImpl=transport(async()=>{sends++;return Response.json({id:'one-send-only'});});
 const results=await Promise.allSettled([f.create(fetchImpl).notify(f.input),f.create(fetchImpl).notify(f.input)]);assert(results.some(x=>x.status==='fulfilled'));assert.equal(sends,1);
 }finally{await f.cleanup();}
 const g=await fixture();try{let sends=0;const real=transport(async()=>{sends++;return Response.json({id:'unexpected'});});
 const fetchImpl:typeof fetch=async(url,init)=>{const r=await real(url,init);if(String(url).includes('userinfo'))await g.kernel.setEmergencyStop(g.owner,true);return r;};
 await assert.rejects(g.create(fetchImpl).notify(g.input),/STOPPED/);assert.equal(sends,0);
 }finally{await g.cleanup();}
});
test('tampered durable receipt cannot establish notification success',async()=>{
 const f=await fixture();try{const notifier=f.create(transport(async()=>Response.json({id:'fixture-message-1'})));await notifier.notify(f.input);
 const path=join(f.directory,'website-maintenance',f.request.id,'gmail','receipt.json');const receipt=JSON.parse(await readFile(path,'utf8'));receipt.identity='forged';await writeFile(path,JSON.stringify(receipt));await assert.rejects(notifier.findNotification(f.request.id),/INVALID_GMAIL_RECEIPT/);
 }finally{await f.cleanup();}
});
