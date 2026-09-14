import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it} from 'node:test';
import {SaraKernel} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {abandonedExclusiveVolumeSelfPid} from '../src/state-lock-owner.ts';

it('never treats age alone, another live PID, unknown volume ownership, or a live local lock as abandoned',()=>{
 const base={owner:{pid:33,acquiredAt:'2026-09-14T05:08:30.693Z'},selfPid:33,processStartedAt:Date.parse('2026-09-14T05:12:00Z'),stateDirectory:'/data/sara',volumeMount:'/data',deploymentId:'isolated-recovery-deployment',heldInThisProcess:false};
 assert.equal(abandonedExclusiveVolumeSelfPid(base),true);
 for(const change of [{selfPid:1},{volumeMount:undefined},{deploymentId:undefined},{stateDirectory:'/data-other'},{volumeMount:'data'},{heldInThisProcess:true},{owner:{pid:33,acquiredAt:'invalid'}},{owner:{pid:33,acquiredAt:'2026-09-14T05:12:01Z'}},{owner:{pid:33,acquiredAt:'2026-09-14T05:11:59.500Z'}}])assert.equal(abandonedExclusiveVolumeSelfPid({...base,...change}),false);
});

it('recovers a reused self PID only on the exclusive Railway volume and preserves the copied audit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sara-reused-lock-'));
 const previous={mount:process.env.RAILWAY_VOLUME_MOUNT_PATH,deployment:process.env.RAILWAY_DEPLOYMENT_ID};
 try{
  const original=join(root,'original'),copy=join(root,'copy');
  const options={ownerTokenSha256:sha256('isolated-lock-owner')};
  await SaraKernel.boot({...options,stateDirectory:original});
  const before=await readFile(join(original,'events.ndjson'),'utf8');
  await cp(original,copy,{recursive:true});
  await mkdir(join(copy,'events.ndjson.lock'));
  const owner={pid:process.pid,acquiredAt:new Date(Date.now()-process.uptime()*1000-60_000).toISOString()};
  await writeFile(join(copy,'events.ndjson.lock/owner.json'),JSON.stringify(owner));
  process.env.RAILWAY_VOLUME_MOUNT_PATH=root;
  process.env.RAILWAY_DEPLOYMENT_ID='isolated-recovery-deployment';
  const recovered=await SaraKernel.boot({...options,stateDirectory:copy});
  assert.equal(await readFile(join(original,'events.ndjson'),'utf8'),before);
  assert.ok((await readFile(join(copy,'events.ndjson'),'utf8')).startsWith(before));
  const audit=await recovered.inspectAudit();
  await SaraKernel.boot({...options,stateDirectory:copy});
  assert.deepEqual((await recovered.inspectAudit()).slice(0,audit.length),audit);
 }finally{
  if(previous.mount===undefined)delete process.env.RAILWAY_VOLUME_MOUNT_PATH;else process.env.RAILWAY_VOLUME_MOUNT_PATH=previous.mount;
  if(previous.deployment===undefined)delete process.env.RAILWAY_DEPLOYMENT_ID;else process.env.RAILWAY_DEPLOYMENT_ID=previous.deployment;
  await rm(root,{recursive:true,force:true});
 }
});
