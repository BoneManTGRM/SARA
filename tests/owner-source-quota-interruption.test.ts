import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendFile,cp,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root=dirname(dirname(fileURLToPath(import.meta.url)));
const program=`
import {SaraKernel} from './src/kernel.ts';
import {sha256} from './src/canonical.ts';
import {SoftwareSourceReadError} from './src/software-source-reader.ts';
import {writeFile} from 'node:fs/promises';
const mode=process.argv[3],token='SYNTHETIC quota crash',body={requestId:'synthetic-quota-crash',text:'Inspect the source and tests in repository BoneManTGRM/Nicos-Adventures.'};
let calls=0;
const runtime={inspectSource:async()=>{calls++;if(mode==='crash')process.exit(73);throw new SoftwareSourceReadError('RATE_LIMIT','SYNTHETIC',{status:403,headers:new Headers({'x-ratelimit-remaining':'0','x-ratelimit-reset':mode==='initial'?'1':mode==='retry'?'2':'3'})});},testJourney:async()=>null};
const kernel=await SaraKernel.boot({stateDirectory:process.argv[2],ownerTokenSha256:sha256(token),softwareRuntime:runtime}),owner=kernel.authenticateOwnerToken(token);
const before=await kernel.inspectOwnerWork(owner);
const result=mode==='initial'?await kernel.executeOwnerMessage(owner,body):await kernel.resumeOwnerMessage(owner,body.requestId);
const after=await kernel.inspectOwnerWork(owner),events=await kernel.inspectAudit();
await writeFile(process.argv[4],JSON.stringify({calls,before,result,after,events}));
`;
async function copied(runTest:(source:string,state:string,directory:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'sara-quota-process-'));try{const source=join(directory,'source');await cp(root,source,{recursive:true,filter:path=>{const rel=path.slice(root.length).split('/').filter(Boolean);return !rel.length||['src','tgrm','constitution','scripts','package.json','package-lock.json','railpack.json','tsconfig.json'].includes(rel[0]!);}});await symlink(join(root,'node_modules'),join(source,'node_modules'),'dir');await writeFile(join(source,'synthetic-quota.ts'),program);await runTest(source,join(directory,'state'),directory);}finally{await rm(directory,{recursive:true,force:true});}
}
async function execute(source:string,state:string,directory:string,mode:string){const path=join(directory,mode+'.json');await run(process.execPath,['--import','tsx','synthetic-quota.ts',state,mode,path],{cwd:source,timeout:40000,maxBuffer:1024*1024});return JSON.parse(await readFile(path,'utf8'));}
test('SYNTHETIC process crash after durable retry dispatch shows uncertain outcome and never redispatches after restart',{timeout:90000},()=>copied(async(source,state,directory)=>{
 const initial=await execute(source,state,directory,'initial');
 await assert.rejects(execute(source,state,directory,'crash'),(e:any)=>e.code===73);
 const recovered=await execute(source,state,directory,'recover');assert.equal(recovered.calls,0);assert.equal(recovered.result.planId,initial.result.planId);
 for(const result of [recovered.before[0],recovered.result,recovered.after[0]])assert.ok(result.blockers.some((b:any)=>b.reason==='SOURCE_RETRY_OUTCOME_UNKNOWN'));
 assert.equal(recovered.events.filter((e:any)=>e.type==='owner_source_retry_authorized').length,1);assert.equal(recovered.events.filter((e:any)=>e.type==='owner_source_retry_dispatched').length,1);
}));
test('SYNTHETIC copied prior RATE_LIMIT work retains retry history through changed-contract owner renewal',{timeout:90000},()=>copied(async(source,state,directory)=>{
 const initial=await execute(source,state,directory,'initial'),retried=await execute(source,state,directory,'retry');assert.equal(retried.calls,1);
 await appendFile(join(source,'src/software-journey-browser.ts'),'\n// SYNTHETIC changed deployment identity.\n');
 const renewed=await execute(source,state,directory,'renew');assert.equal(renewed.calls,1);assert.equal(renewed.result.planId,initial.result.planId);
 assert.equal(renewed.events.filter((e:any)=>e.type==='owner_work_reauthorized').length,1);assert.equal(renewed.events.filter((e:any)=>e.type==='owner_source_retry_authorized').length,1);
 const final=await execute(source,state,directory,'final');assert.equal(final.calls,1);assert.equal(final.events.filter((e:any)=>e.type==='owner_source_retry_authorized').length,2);
 const replay=await execute(source,state,directory,'replay');assert.equal(replay.calls,0);assert.ok(replay.result.blockers.some((b:any)=>b.reason==='SOURCE_RETRY_LIMIT'));
 assert.deepEqual(renewed.events.slice(0,retried.events.length),retried.events);
}));
