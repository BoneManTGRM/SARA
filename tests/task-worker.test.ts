import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sha256} from '../src/canonical.ts';
import {validateTaskPackage,runTaskPackage} from '../src/task-worker.ts';
import {mkdtemp,rm,cp} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {createSaraServer} from '../src/server.ts';
import type {AddressInfo} from 'node:net';
import {isOrdinaryBehaviorExit} from '../src/task-worker.ts';
const fixture=()=>({version:'task-worker-v1',source:'https://github.com/example/project/issues/1',revision:'a'.repeat(40),objective:'Return forty two',baseline:{schemaVersion:1,candidateKind:'typescript_program',programName:'Synthetic task',summary:'Synthetic fixture',limitations:[],files:[{path:'src/index.ts',content:'export { value } from "./value.ts";\n'},{path:'src/value.ts',content:'export const value: number = 41;\n'},{path:'tests/value.test.ts',content:'import { value } from "../src/value.ts";\nif (value !== 42) throw new Error("required value");\n'}]},proposals:[{path:'src/value.ts',before:sha256('export const value: number = 41;\n'),content:'export const value: number = 42;\n'}]});
test('task package rejects test replacement, digest mismatch and excessive proposals',()=>{
 for(const mutate of [(x:any)=>x.proposals[0].path='tests/value.test.ts',(x:any)=>x.proposals[0].before='0'.repeat(64),(x:any)=>x.proposals=Array(4).fill(x.proposals[0]),(x:any)=>x.source='https://evil.test/task',(x:any)=>x.baseline.candidateKind='other',(x:any)=>x.baseline.files.push({path:'../secret.ts',content:''})]){const x=fixture();mutate(x);assert.throws(()=>validateTaskPackage(x));}
});
test('actual bounded worker reproduces baseline and independently verifies frozen tests',async()=>{
 const x=fixture(),stages:string[]=[];
 x.proposals.unshift({...x.proposals[0]!,content:'export const value: number = 40;\n'});
 const frozen=JSON.stringify(x);
 const r=await runTaskPackage(x,'c'.repeat(64),async s=>{stages.push(s);});
 assert.equal(r.status,'verified_isolated');assert.equal(r.baseline?.passed,false);assert.equal(r.verification?.passed,true);assert.equal(r.recheck?.passed,true);
 assert.equal(r.candidate?.files.find(f=>f.path.startsWith('tests/'))?.content,x.baseline.files[2]!.content);
 assert.equal(r.submitted,false);assert.equal(r.paymentReceived,'unknown');assert.equal(r.modelCalls,0);assert.equal(JSON.stringify(x),frozen);
 assert.equal(r.baseline?.failures[0]?.existedBeforeRepair,true);assert.equal(r.attempts[0]?.verification.failures[0]?.existedBeforeRepair,false);
 assert.deepEqual(stages,['baseline','proposal-1','proposal-2','recheck']);
});
test('cancelled admission executes no verification',async()=>{
 await assert.rejects(runTaskPackage(fixture(),'c'.repeat(64),async()=>{throw new Error('stopped');}),/stopped/);
});
test('owner HTTP admission, concurrent replay, export isolation and durable restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'task-worker-')),token='synthetic-task-owner';
 const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),owner=k.authenticateOwnerToken(token);
 const s=createSaraServer(k,{ownerTokenSha256:sha256(token),productMode:'second_brain'});await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+(s.address() as AddressInfo).port+'/api/second-brain/task-work',headers={Authorization:'Bearer '+token,'content-type':'application/json'};
 try{
  assert.equal((await fetch(url+'?project=sara')).status,401);
  await assert.rejects(k.runTaskWork(SARA_PRINCIPAL,'sara',fixture()),/owner/);
  await assert.rejects(k.runTaskWork(owner,'nico',fixture()),/scope/);
  const send=()=>fetch(url,{method:'POST',headers,body:JSON.stringify({project:'sara',package:fixture()})});
  const responses=await Promise.all([send(),send()]);assert.ok(responses.every(r=>r.status===200));
  const rows=await k.readTaskWork(owner,'sara');assert.equal(rows.length,1);assert.equal(rows[0]!.status,'completed');assert.equal(rows[0]!.result?.status,'verified_isolated');
  const events=(await k.inspectAudit()).filter(e=>e.type==='project_import_receipt'&&(e.data as any).kind==='isolated_task_worker');assert.equal(events.length,2);
  const reboot=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),o=reboot.authenticateOwnerToken(token);
  assert.deepEqual(await reboot.runTaskWork(o,'sara',fixture()),rows[0]);
  assert.deepEqual(await reboot.readTaskWork(o,'sara'),rows);
 }finally{await new Promise<void>(r=>s.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('single worker prevents parallel verifiers while admission is awaiting permission',async()=>{
 let release!:()=>void;const barrier=new Promise<void>(r=>release=r);
 const a=runTaskPackage(fixture(),'c'.repeat(64),async()=>{await barrier;throw new Error('cancelled');});
 await assert.rejects(runTaskPackage(fixture(),'c'.repeat(64),async()=>{}),/busy/);release();await assert.rejects(a,/cancelled/);
});
test('timeouts, output limits, signals and spawn failures cannot establish a behavioral baseline',()=>{
 for(const x of [{code:1,killed:true},{code:1,signal:'SIGABRT'},{code:'ENOENT'},{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'},null,{code:137}])assert.equal(isOrdinaryBehaviorExit(x),false);
 assert.equal(isOrdinaryBehaviorExit({code:1,killed:false,signal:null}),true);
});
test('cancellation and emergency stop retain interrupted work without restart execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'task-recovery-')),dir=join(root,'original'),copy=join(root,'interrupted'),token='synthetic';
 try{
  const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),o=k.authenticateOwnerToken(token);
  const pending=k.runTaskWork(o,'sara',fixture());let rows=await k.readTaskWork(o,'sara');
  for(let i=0;i<200&&!rows.length;i++){await setImmediate();rows=await k.readTaskWork(o,'sara');}
  assert.equal(rows[0]?.status,'running');await cp(dir,copy,{recursive:true});
  await k.cancelTaskWork(o,'sara',rows[0]!.id);assert.equal((await pending).status,'cancelled');
  const reboot=await SaraKernel.boot({stateDirectory:copy,ownerTokenSha256:sha256(token)}),owner=reboot.authenticateOwnerToken(token);
  assert.equal((await reboot.runTaskWork(owner,'sara',fixture())).status,'running');
  const different=fixture();different.objective='Another task';await assert.rejects(reboot.runTaskWork(owner,'sara',different),/interrupted/);
  await reboot.setEmergencyStop(owner,true);
  assert.equal((await reboot.cancelTaskWork(owner,'sara',rows[0]!.id)).status,'cancelled');
  await assert.rejects(reboot.runTaskWork(owner,'sara',different),/emergency|EMERGENCY/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
