import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {runSupervisedBenchmark,railwayCommand,type SupervisorInput} from '../proof/benchmark-supervisor.ts';
import {classifyCodingRepairRejection,CodingRepairRejectedAttemptError} from '../src/coding-repair-rejection.ts';
import {describeBenchmarkFailure} from '../proof/v7-failure-diagnostics.ts';
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function scenario(fn:(x:SupervisorInput,counts:{connect:number;provider:number;count:number;execute:number})=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'sara-supervisor-'));
 const counts={connect:0,provider:0,count:0,execute:0};
 const x:SupervisorInput={ledgerDirectory:directory,grant:{experimentId:'offline-integration',contractDigest:'a'.repeat(64),implementationCommit:'b'.repeat(40),deploymentId:uuid,expiresAt:2000,maximumPhysicalSpendUsd:0.15},now:1000,
 contract:{caseId:'offline-integration',digest:'a'.repeat(64),paidAllowed:false},mode:'offline',
 connect(){counts.connect++;return spawn(process.execPath,['-e','process.exit(1)'],{stdio:'pipe'});},
 provider(){counts.provider++;return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){counts.count++;return 100;},async execute(){counts.execute++;return {outputText:'{}',inputTokens:100,billableOutputTokens:100};}};}};
 try{await fn(x,counts);}finally{await rm(directory,{recursive:true,force:true});}
}
test('consumed live contract cannot reach Railway or a provider',()=>scenario(async(x,c)=>{
 x.grant.contractDigest=x.contract.digest='88674aed1970e107e1e92aec10f8cfc52f58f0b8f757d42883f45ef0128c18c1';
 await assert.rejects(()=>runSupervisedBenchmark(x),/RETIRED_CONTRACT/); assert.equal(c.connect,0);assert.equal(c.provider,0);
}));
test('an offline proof cannot be turned into a paid run by CLI mode',()=>scenario(async(x,c)=>{x.mode='live';await assert.rejects(()=>runSupervisedBenchmark(x),/PAID_CONTRACT_REQUIRED/);assert.equal(c.connect,0);assert.equal(c.provider,0);}));
test('renaming experiment does not reset the same frozen contract',()=>scenario(async(x,c)=>{x.grant.experimentId='renamed';await assert.rejects(()=>runSupervisedBenchmark(x),/CONTRACT_IDENTITY_MISMATCH/);assert.equal(c.connect,0);}));
test('a failed SSH connection consumes the claim and a second launch is denied',()=>scenario(async(x,c)=>{
 await assert.rejects(()=>runSupervisedBenchmark(x));assert.equal(c.connect,1);
 await assert.rejects(()=>runSupervisedBenchmark(x),/ALREADY_CLAIMED/);assert.equal(c.connect,1);assert.equal(c.provider,0);assert((await readdir(x.ledgerDirectory)).length>0);
}));
test('replacement deployment cannot replay the consumed experiment',()=>scenario(async(x,c)=>{
 await assert.rejects(()=>runSupervisedBenchmark(x)); x.grant.deploymentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await assert.rejects(()=>runSupervisedBenchmark(x),/ALREADY_CLAIMED/);assert.equal(c.connect,1);
}));
test('the real Railway command is pinned, noninteractive, and has no restart or credential arguments',()=>{
 const a=railwayCommand({projectId:uuid,environmentId:uuid,serviceId:uuid,instanceId:uuid});
 assert.deepEqual(a,['ssh','--project',uuid,'--environment',uuid,'--service',uuid,'--deployment-instance',uuid,'--','node','--import','tsx','proof/benchmark-worker.ts']);
 assert(!a.includes('--session'));assert(!a.includes('--live'));
 assert.throws(()=>railwayCommand({projectId:'x;exit',environmentId:uuid,serviceId:uuid,instanceId:uuid}),/INVALID_RAILWAY_TARGET/);
});
test('classifier and error constructor never invoke an exception message getter',()=>{
 let getters=0;const e=new Error();Object.defineProperty(e,'message',{get(){getters++;throw Error('secret');}});
 assert.equal(classifyCodingRepairRejection(e),'UNKNOWN_REJECTION');
 const wrapped=new CodingRepairRejectedAttemptError({error:e,cycle:1,retainedArtifactDigest:'a'.repeat(64),proposalDigest:null,inputTokens:NaN,outputTokens:10,accountedCostUsd:NaN,knownRunSpendUsd:0.003});
 assert.equal(getters,0);assert.equal(wrapped.evidence.usageUnknown,true);assert.equal(wrapped.evidence.knownRunSpendUsd,0.003);
});
for(const [message,code] of [
 ['Coding repair schema version is unsupported.','UNSUPPORTED_SCHEMA'],
 ['Coding repair proposal attempted a strategy escalation.','STRATEGY_MISMATCH'],
 ['Coding repair limitations are malformed.','INVALID_LIMITATIONS'],
 ['Coding repair model exceeded or malformed its accounted cost.','MODEL_COST_INVALID'],
]) test(`controller and harness share canonical ${code}`,()=>{assert.equal(describeBenchmarkFailure(new Error(message),'candidate_validation').code,code);});

import {loadSupervisedContract} from '../proof/supervised-benchmark-contract.ts';
import {good,mutations} from '../proof/v7-live-fixture.ts';
function realWorker(x:SupervisorInput){return spawn(process.execPath,['--import','tsx','proof/benchmark-worker.ts'],{stdio:'pipe',env:{PATH:process.env.PATH,RAILWAY_DEPLOYMENT_ID:x.grant.deploymentId,RAILWAY_GIT_COMMIT_SHA:x.grant.implementationCommit}});}
async function configured(x:SupervisorInput,c:{connect:number;provider:number;count:number;execute:number},rejectControl=false){
 x.contract=await loadSupervisedContract();x.grant.experimentId=x.contract.caseId;x.grant.contractDigest=x.contract.digest;x.grant.expiresAt=Date.now()+60_000;x.now=Date.now();
 x.connect=()=>{c.connect++;return realWorker(x);};
 x.provider=()=>{c.provider++;return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,
  async countInputTokens(){c.count++;return 100;},
  async execute(input){c.execute++;const facts=JSON.parse(input.prompt.split('\n').slice(2).join('\n'));const current=facts.files.find((f:{path:string})=>f.path==='src/queue.ts');
   const compact=input.prompt.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');
   return {inputTokens:100,billableOutputTokens:100,outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,strategy:facts.requiredStrategy,changes:[{path:current.path,expectedContentDigest:current.contentDigest,...(compact?{edits:mutations.map(m=>({find:m.replace,replace:m.find}))}:{replacementText:good+(rejectControl?'// extra line\n'.repeat(100):'')})}],limitations:[]})};
  }};};
}
test('complete owner to worker to actual V7 verifier path succeeds once, then rejects restart',()=>scenario(async(x,c)=>{
 await configured(x,c);const result=await runSupervisedBenchmark(x);
 assert.equal(result.generations,2);assert.equal(c.execute,2);assert.equal(result.evidenceLevel,'OFFLINE_SUPERVISED_INTEGRATION');
 assert(result.result.arms.every((arm:any)=>arm.verifiedComplete&&arm.score===1));
 await assert.rejects(()=>runSupervisedBenchmark(x),/ALREADY_CLAIMED/);assert.equal(c.connect,1);assert.equal(c.execute,2);
}));
test('full control line-limit rejection retains cost and a null comparison through the complete pipeline',()=>scenario(async(x,c)=>{
 await configured(x,c,true);const result=await runSupervisedBenchmark(x);const control=result.result.arms.find((a:any)=>a.arm==='full_replacement');
 assert.equal(control.failure.code,'CHANGED_LINE_LIMIT');assert.equal(control.verifiedComplete,false);assert.equal(control.changedLines,null);
 assert.equal(result.result.speedRatio,null);assert.equal(result.result.verdict,'INCONCLUSIVE');assert.equal(result.generations,2);assert(result.spentUpper>0);
}));

import {readFile} from 'node:fs/promises';
function protocolWorker(x:SupervisorInput,mode:string){return spawn(process.execPath,['tests/fixtures/supervisor-protocol-worker.mjs'],{stdio:'pipe',env:{PATH:process.env.PATH,TEST_MODE:mode,TEST_READY:JSON.stringify({type:'ready',contractDigest:x.contract.digest,implementationCommit:x.grant.implementationCommit,deploymentId:x.grant.deploymentId})}});}
for(const mode of ['duplicate_ready','oversize','partial','reused_id','low_reasoning'])test(`protocol ${mode} stops without a generation`,()=>scenario(async(x,c)=>{
 x.connect=()=>{c.connect++;return protocolWorker(x,mode);};await assert.rejects(()=>runSupervisedBenchmark(x),/SUPERVISED_SESSION_FAILED/);assert.equal(c.execute,0);
}));
test('unknown provider usage retains its pre-request reservation and never logs exception prose',()=>scenario(async(x,c)=>{
 x.connect=()=>{c.connect++;return protocolWorker(x,'unknown_usage');};
 x.provider=()=>({routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 100;},async execute(){c.execute++;throw Error('PRIVATE_PROVIDER_ERROR_AND_SECRET');}});
 await assert.rejects(()=>runSupervisedBenchmark(x));assert.equal(c.execute,1);
 const name=(await readdir(x.ledgerDirectory)).find(p=>p.endsWith('.events.ndjson'))!;const text=await readFile(join(x.ledgerDirectory,name),'utf8');
 assert(!text.includes('PRIVATE_PROVIDER'));const rows=text.trim().split('\n').map(l=>JSON.parse(l));
 const failure=rows.at(-1);assert.equal(failure.type,'session_failed');assert.equal(failure.usageUnknown,true);assert(failure.spentUpper>0);
 await assert.rejects(()=>runSupervisedBenchmark(x),/ALREADY_CLAIMED/);assert.equal(c.execute,1);
}));
test('physical reserve ceiling stops generation before provider execution',()=>scenario(async(x,c)=>{
 x.grant.maximumPhysicalSpendUsd=0.01;x.connect=()=>protocolWorker(x,'budget');await assert.rejects(()=>runSupervisedBenchmark(x));assert.equal(c.execute,0);
}));
test('concurrent complete-launch admissions connect at most once',()=>scenario(async(x,c)=>{
 const results=await Promise.allSettled(Array.from({length:12},()=>runSupervisedBenchmark(x)));assert.equal(c.connect,1);assert.equal(c.provider,0);assert(results.every(r=>r.status==='rejected'));
}));
test('worker deployment identity mismatch prevents even token counting',()=>scenario(async(x,c)=>{
 await configured(x,c);x.connect=()=>{const y=structuredClone(x.grant);y.deploymentId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';return realWorker({...x,grant:y});};
 await assert.rejects(()=>runSupervisedBenchmark(x));assert.equal(c.provider,0);assert.equal(c.count,0);
}));
test('worker refuses a provider key and never includes it in output',()=>scenario(async(x,c)=>{
 await configured(x,c);x.connect=()=>spawn(process.execPath,['--import','tsx','proof/benchmark-worker.ts'],{stdio:'pipe',env:{PATH:process.env.PATH,OPENAI_API_KEY:'PRIVATE_SENTINEL_KEY'}});
 await assert.rejects(()=>runSupervisedBenchmark(x));assert.equal(c.provider,0);
}));
test('deployment idle command has no owner handshake and cannot call a model',async()=>{
 const child=spawn(process.execPath,['--import','tsx','proof/benchmark-worker.ts','--idle'],{stdio:'pipe',env:{PATH:process.env.PATH}});
 let stdout='';const closed=new Promise(r=>child.once('close',r));let timeout:NodeJS.Timeout|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{
   timeout=setTimeout(()=>reject(Error('idle worker did not report ready')),15_000);
   child.once('error',reject);child.once('close',()=>reject(Error('idle worker exited before ready')));
   child.stdout.on('data',v=>{stdout+=v;if(stdout.includes('\n'))resolve();});
  });
  assert.equal(stdout.trim(),'BENCHMARK_IDLE_NO_PROVIDER_ACCESS');
 }finally{if(timeout)clearTimeout(timeout);child.kill('SIGKILL');await closed;}
});
test('provider factory receives a cancellable session signal and it is aborted on exit',()=>scenario(async(x,c)=>{
 let captured:AbortSignal|undefined;
 x.connect=()=>protocolWorker(x,'signal');
 x.provider=(signal:AbortSignal)=>{captured=signal;return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 100;},async execute(){throw Error('bounded failure');}};};
 await assert.rejects(()=>runSupervisedBenchmark(x));assert(captured instanceof AbortSignal);assert.equal(captured.aborted,true);
}));

test('worker disconnection promptly cancels an in-flight provider instead of waiting for the session deadline',()=>scenario(async(x,c)=>{
 x.timeoutMs=2500; x.grant.expiresAt=Date.now()+10_000;x.now=Date.now();
 x.connect=()=>protocolWorker(x,'disconnect_inflight');
 let cancelled=false;
 x.provider=signal=>({routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,
  async countInputTokens(){return 100;},async execute(){c.execute++;signal.addEventListener('abort',()=>{cancelled=true;},{once:true});return new Promise(()=>{});}});
 const started=performance.now();await assert.rejects(()=>runSupervisedBenchmark(x));
 assert.equal(c.execute,1);assert(cancelled);assert(performance.now()-started<1800,'disconnect must cancel before the 2500ms deadline');
}));
test('supervised rejection preserves missing worker cost bounds as null, not zero',()=>scenario(async(x,c)=>{
 await configured(x,c,true);const output=await runSupervisedBenchmark(x);
 assert(output.physical.every((r:any)=>r.costUsd>0));
 for(const arm of output.result.arms)assert.equal(arm.costUpperBoundUsd,null);
 assert.equal(output.result.supervisionContractDigest,x.contract.digest);
}));

test('a worker result without its frozen contract and pair digest is rejected',()=>scenario(async(x,c)=>{
 x.connect=()=>protocolWorker(x,'empty_result');
 await assert.rejects(()=>runSupervisedBenchmark(x),/SUPERVISED_SESSION_FAILED/);assert.equal(c.provider,0);
}));
