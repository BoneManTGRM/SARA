import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/canonical.ts';
import { SaraKernel, SARA_PRINCIPAL } from '../src/kernel.ts';
import { newMaintenanceId, maintenanceRequestDigest, prepareMaintenance, verifyMaintenance, WebsiteMaintenanceOperator, type MaintenanceRequest, type MaintenanceProvider } from '../src/website-maintenance.ts';
const source='<!doctype html><html lang="es"><body><h1>Óptica Montecristo</h1><p><!-- sara:tagline -->Una mirada cercana.<!-- /sara:tagline --></p></body></html>';
const request=():MaintenanceRequest=>({id:newMaintenanceId(),projectId:'montecristo-gift',baseDigest:sha256(source),slot:'tagline',before:'Una mirada cercana.',after:'Una nueva mirada.',funding:'GIFT',maximumCostUsd:0});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'sara-maint-'));const kernel=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256('maintenance-owner')});return {dir,kernel,owner:kernel.authenticateOwnerToken('maintenance-owner')};}

test('literal maintenance is exact-source-bound and refuses script, attribute and ambiguous slots',()=>{
 const r=request(),candidate=prepareMaintenance(source,r);assert.equal(candidate,source.replace('Una mirada cercana.','Una nueva mirada.'));assert.equal(verifyMaintenance(source,candidate,r),sha256(candidate));
 assert.throws(()=>prepareMaintenance(source+' ',r),/SOURCE_CHANGED/);
 assert.throws(()=>verifyMaintenance(source,candidate.replace('Óptica','Otra'),r));
 assert.throws(()=>prepareMaintenance(source,{...r,after:'<script>alert(1)</script>'}));
 for(const unsafe of ['<script><!-- sara:tagline -->Una mirada cercana.<!-- /sara:tagline --></script>','<div onclick="<!-- sara:tagline -->Una mirada cercana.<!-- /sara:tagline -->">Hi</div>',source+source])assert.throws(()=>prepareMaintenance(unsafe,{...r,baseDigest:sha256(unsafe)}));
 assert.throws(()=>prepareMaintenance(source,{...r,funding:'PAID'} as unknown as MaintenanceRequest),/COMMERCIAL/);
});

test('owner approval, idempotency, immutable request and stop are enforced by the existing kernel',async()=>{
 const f=await fixture();try{const r=request(),digest=maintenanceRequestDigest(r);
 await assert.rejects(f.kernel.submitWebsiteMaintenance(SARA_PRINCIPAL,r,digest));
 await assert.rejects(f.kernel.submitWebsiteMaintenance(f.owner,r,'0'.repeat(64)));
 const a=await f.kernel.submitWebsiteMaintenance(f.owner,r,digest);const b=await f.kernel.submitWebsiteMaintenance(f.owner,r,digest);assert.deepEqual(a,b);
 const changed={...r,after:'Changed'};await assert.rejects(f.kernel.submitWebsiteMaintenance(f.owner,changed,maintenanceRequestDigest(changed)),/CONFLICT/);
 await assert.rejects(f.kernel.advanceWebsiteMaintenance(SARA_PRINCIPAL,r.id,0,{state:'DELIVERED',notificationReceipt:'fake'}));
 await f.kernel.setEmergencyStop(f.owner,true);const operator=new WebsiteMaintenanceOperator(f.kernel,f.dir,null);assert.equal(await operator.tick(),'STOPPED');assert.equal((await f.kernel.listWebsiteMaintenance())[0].state,'QUEUED');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('real local artifact and durable restart complete a fixture-provider workflow without replaying publication or notification',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=await fixture();try{const r=request();await f.kernel.submitWebsiteMaintenance(f.owner,r,maintenanceRequestDigest(r));
 let published:string|null=null,notified=false,publishes=0,notifications=0,losePublishReply=true,loseNotifyReply=true;
 // Remote calls below are TEST FIXTURES, not proof of live publishing, email, or revenue.
 const provider:MaintenanceProvider={projectId:r.projectId,readSource:async()=>source,
  publish:async input=>{assert.equal(input.baseDigest,sha256(source));published=input.content;publishes++;if(losePublishReply){losePublishReply=false;throw new Error('lost response');}return {receipt:'fixture-publish'};},
  findPublication:async()=>published?{receipt:'fixture-publish'}:null,readPublished:async()=>published!,
  notify:async()=>{notified=true;notifications++;if(loseNotifyReply){loseNotifyReply=false;throw new Error('lost response');}return {receipt:'fixture-notification'};},findNotification:async()=>notified?{receipt:'fixture-notification'}:null,rollback:async()=>{throw new Error('unexpected rollback');},findRollback:async()=>null};
 let op=new WebsiteMaintenanceOperator(f.kernel,f.dir,provider);
 assert.equal(await op.tick(),'PREPARED');const artifact=await readFile(join(f.dir,'website-maintenance',r.id,'candidate.html'),'utf8');assert.match(artifact,/Una nueva mirada/);
 assert.equal(await op.tick(),'PUBLISH_INTENT');await assert.rejects(op.tick(),/lost response/);
 t.mock.timers.tick(6000);const restarted=await SaraKernel.boot({stateDirectory:f.dir,ownerTokenSha256:sha256('maintenance-owner')});op=new WebsiteMaintenanceOperator(restarted,f.dir,provider);
 assert.equal(await op.tick(),'PUBLISHED');assert.equal(publishes,1);assert.equal(await op.tick(),'NOTIFY_INTENT');await assert.rejects(op.tick(),/lost response/);
 t.mock.timers.tick(6000);op=new WebsiteMaintenanceOperator(restarted,f.dir,provider);assert.equal(await op.tick(),'DELIVERED');assert.equal(notifications,1);assert.equal(await op.tick(),'IDLE');
 const [job]=await restarted.listWebsiteMaintenance();assert.equal(job.notificationReceipt,'fixture-notification');assert.equal(job.request.funding,'GIFT');assert.equal((await restarted.inspectAudit()).some(x=>x.type==='ledger_recorded'&&(x.data as {kind?:string}).kind==='revenue'),false);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('missing publishing credentials stop honestly and artifact tampering prevents dispatch',async()=>{
 const f=await fixture();try{const r=request();await f.kernel.submitWebsiteMaintenance(f.owner,r,maintenanceRequestDigest(r));assert.equal(await new WebsiteMaintenanceOperator(f.kernel,f.dir,null).tick(),'BLOCKED');assert.equal((await f.kernel.listWebsiteMaintenance())[0].reason,'PROJECT_PROVIDER_NOT_CONNECTED');
 const second=request();await f.kernel.submitWebsiteMaintenance(f.owner,second,maintenanceRequestDigest(second));
 const provider={projectId:second.projectId,readSource:async()=>source} as MaintenanceProvider;const op=new WebsiteMaintenanceOperator(f.kernel,f.dir,provider);assert.equal(await op.tick(),'PREPARED');await writeFile(join(f.dir,'website-maintenance',second.id,'candidate.html'),'tampered');await assert.rejects(op.tick(),/VERIFICATION/);assert.equal((await f.kernel.listWebsiteMaintenance())[1].state,'PREPARED');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('a mismatched deployment is restored and verified after a lost rollback response',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=await fixture();try{
  const r=request();await f.kernel.submitWebsiteMaintenance(f.owner,r,maintenanceRequestDigest(r));
  let published=false,restored=false,rollbacks=0;
  const provider:MaintenanceProvider={
   projectId:r.projectId,readSource:async()=>source,
   publish:async()=>{published=true;return {receipt:'bad-deployment'};},
   findPublication:async()=>published?{receipt:'bad-deployment'}:null,
   readPublished:async receipt=>receipt==='restored'?source:'unexpected content',
   notify:async()=>{throw new Error('must not announce success');},findNotification:async()=>null,
   rollback:async input=>{assert.equal(input.failedReceipt,'bad-deployment');assert.equal(input.content,source);assert.equal(input.digest,sha256(source));restored=true;rollbacks++;throw new Error('lost rollback response');},
   findRollback:async()=>restored?{receipt:'restored'}:null
  };
  let op=new WebsiteMaintenanceOperator(f.kernel,f.dir,provider);
  assert.equal(await op.tick(),'PREPARED');assert.equal(await op.tick(),'PUBLISH_INTENT');assert.equal(await op.tick(),'ROLLBACK_INTENT');
  await assert.rejects(op.tick(),/lost rollback response/);
  t.mock.timers.tick(6000);
  const restarted=await SaraKernel.boot({stateDirectory:f.dir,ownerTokenSha256:sha256('maintenance-owner')});
  op=new WebsiteMaintenanceOperator(restarted,f.dir,provider);
  assert.equal(await op.tick(),'ROLLED_BACK');assert.equal(rollbacks,1);
  const [job]=await restarted.listWebsiteMaintenance();assert.equal(job.rollbackReceipt,'restored');assert.equal(job.notificationReceipt,null);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('durable backoff lets other jobs proceed and bounded failures retain a review obligation',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=await fixture();try{
  const r=request();await f.kernel.submitWebsiteMaintenance(f.owner,r,maintenanceRequestDigest(r));
  const unexpected=async():Promise<never>=>{throw new Error('unexpected external action');};
  const provider:MaintenanceProvider={projectId:r.projectId,readSource:async()=>{throw new Error('provider unavailable');},
   publish:unexpected,findPublication:unexpected,readPublished:unexpected,notify:unexpected,findNotification:unexpected,rollback:unexpected,findRollback:unexpected};
  const op=new WebsiteMaintenanceOperator(f.kernel,f.dir,provider);
  await assert.rejects(op.tick(),/unavailable/);assert.equal(await op.tick(),'IDLE');
  const other={...request(),projectId:'different-project'};
  await f.kernel.submitWebsiteMaintenance(f.owner,other,maintenanceRequestDigest(other));
  assert.equal(await op.tick(),'BLOCKED');
  for(let i=0;i<4;i++){t.mock.timers.tick(300001);await assert.rejects(op.tick(),/unavailable/);}
  const job=(await f.kernel.listWebsiteMaintenance()).find(x=>x.request.id===r.id)!;
  assert.equal(job.state,'BLOCKED');assert.equal(job.attempts,5);assert.equal(job.reason,'RETRY_LIMIT_RECONCILE_REQUIRED');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('maintenance HTTP intake requires owner authentication and exact request approval',async()=>{
 const {createSaraServer}=await import('../src/server.ts');
 const f=await fixture();const server=createSaraServer(f.kernel,{ownerTokenSha256:sha256('maintenance-owner'),stateDirectory:f.dir});
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert(address&&typeof address!=='string');
  const base='http://127.0.0.1:'+address.port;
  const r=request(),body={request:r,approvedRequestDigest:maintenanceRequestDigest(r)};
  assert.equal((await fetch(base+'/api/website-maintenance/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status,401);
  const headers={'authorization':'Bearer maintenance-owner','content-type':'application/json'};
  const ready=await fetch(base+'/api/website-maintenance/readiness',{headers});assert.equal(ready.status,200);
  assert.equal((await ready.json() as {liveDemonstrationVerified:boolean}).liveDemonstrationVerified,false);
  assert.equal((await fetch(base+'/api/website-maintenance/jobs',{method:'POST',headers,body:JSON.stringify({request:r})})).status,400);
  assert.equal((await f.kernel.listWebsiteMaintenance()).length,0);
  assert.equal((await fetch(base+'/api/website-maintenance/jobs',{method:'POST',headers,body:JSON.stringify(body)})).status,201);
  assert.equal((await f.kernel.listWebsiteMaintenance()).length,1);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await rm(f.dir,{recursive:true,force:true});
 }
});
