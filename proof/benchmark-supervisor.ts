import {validateV8Approval,type Identity} from './v8-process-approval.ts';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import type {Readable,Writable} from 'node:stream';
import {canonicalJson,sha256} from '../src/canonical.ts';
import type {WorkerModelClient} from '../src/model-router.ts';
import {claimBenchmarkRun,type BenchmarkRunGrant} from './benchmark-run-admission.ts';

export type SupervisorInput = {
 ledgerDirectory:string; grant:BenchmarkRunGrant; now:number;
 contract:{caseId:string;digest:string;paidAllowed:boolean};
 connect:()=>ChildProcessWithoutNullStreams; provider:(signal:AbortSignal)=>WorkerModelClient;
 mode:'offline'|'live'; timeoutMs?:number;
};
export const MAX_FRAME_BYTES=1_048_576;
/** Length bounded before JSON parsing. A truncated frame never becomes an empty success. */
export async function* frames(stream:Readable):AsyncGenerator<Record<string,any>> {
 let buffer=Buffer.alloc(0);
 for await(const chunk of stream){
  buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
  let index:number;
  while((index=buffer.indexOf(10))>=0){
   if(index>MAX_FRAME_BYTES)throw Error('PROTOCOL_FRAME_LIMIT');
   const line=buffer.subarray(0,index);buffer=buffer.subarray(index+1);
   let value:unknown;try{value=JSON.parse(line.toString('utf8'));}catch{throw Error('PROTOCOL_INVALID_JSON');}
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('PROTOCOL_INVALID_FRAME');
   yield value as Record<string,any>;
  }
  if(buffer.length>MAX_FRAME_BYTES)throw Error('PROTOCOL_FRAME_LIMIT');
 }
 if(buffer.length)throw Error('PROTOCOL_TRUNCATED');
}
export async function sendFrame(stream:Writable,value:unknown):Promise<void>{
 const text=JSON.stringify(value);if(Buffer.byteLength(text)>MAX_FRAME_BYTES)throw Error('PROTOCOL_FRAME_LIMIT');
 await new Promise<void>((resolve,reject)=>stream.write(text+'\n',e=>e?reject(Error('PROTOCOL_WRITE_FAILED')):resolve()));
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
export type RailwayTarget={projectId:string;environmentId:string;serviceId:string;instanceId:string};
export function railwayCommand(target:RailwayTarget):string[]{
 if(![target.projectId,target.environmentId,target.serviceId,target.instanceId].every(v=>typeof v==='string'&&UUID.test(v)))throw Error('INVALID_RAILWAY_TARGET');
 return ['ssh','--project',target.projectId,'--environment',target.environmentId,'--service',target.serviceId,'--deployment-instance',target.instanceId,'--','node','--import','tsx','proof/benchmark-worker.ts'];
}
/** One command, no tmux session, shell evaluation, deployment mutation, or reconnect loop. */
export function connectRailway(target:RailwayTarget):ChildProcessWithoutNullStreams{
 const env:NodeJS.ProcessEnv={};
 for(const key of ['PATH','HOME','SSH_AUTH_SOCK','RAILWAY_TOKEN','RAILWAY_API_TOKEN'])if(process.env[key])env[key]=process.env[key];
 return spawn('railway',railwayCommand(target),{stdio:'pipe',shell:false,env});
}

/** Trusted owner process only. Provider credentials never enter the worker or Railway variables. */
export async function runSupervisedBenchmark(input:SupervisorInput):Promise<Record<string,any>>{
 if(input.mode!=='offline'&&input.mode!=='live')throw Error('INVALID_MODE');
 if(input.mode==='live'&&!input.contract.paidAllowed)throw Error('PAID_CONTRACT_REQUIRED');
 if(input.grant.experimentId!==input.contract.caseId||input.grant.contractDigest!==input.contract.digest)throw Error('CONTRACT_IDENTITY_MISMATCH');
 const timeoutMs=input.timeoutMs??600_000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600_000)throw Error('INVALID_TIMEOUT');
 // This claim is flushed BEFORE even invoking SSH. A disconnect, uncertainty, or crash consumes it.
 await claimBenchmarkRun({ledgerDirectory:input.ledgerDirectory,grant:input.grant,observed:{contractDigest:input.contract.digest,implementationCommit:input.grant.implementationCommit,deploymentId:input.grant.deploymentId},now:input.now});
 return runBenchmarkSession(input,timeoutMs);
}
const consumedProcessClaims=new Set<string>();
/** Owner-written GitHub grant: one exact random process challenge, never a restartable deployment flag. */
export async function runProcessApprovedBenchmark(input:SupervisorInput,approval:unknown,identity:Identity):Promise<Record<string,any>>{
 validateV8Approval(approval,identity,input.now);
 if(input.mode!=='live'||!input.contract.paidAllowed||input.contract.caseId!==approval.caseId||input.contract.digest!==approval.contractDigest||
    input.grant.experimentId!==approval.caseId||input.grant.contractDigest!==approval.contractDigest||
    input.grant.implementationCommit!==approval.implementationCommit||input.grant.deploymentId!==approval.deploymentId||
    input.grant.maximumPhysicalSpendUsd!==approval.maximumPhysicalSpendUsd||input.grant.expiresAt!==approval.expiresAt)throw Error('APPROVAL_CONTRACT_MISMATCH');
 const timeoutMs=input.timeoutMs??600_000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600_000)throw Error('INVALID_TIMEOUT');
 const key=sha256(canonicalJson(identity));
 if(consumedProcessClaims.has(key))throw Error('PROCESS_APPROVAL_ALREADY_CONSUMED');
 consumedProcessClaims.add(key);
 return runBenchmarkSession(input,timeoutMs);
}
async function runBenchmarkSession(input:SupervisorInput,timeoutMs:number):Promise<Record<string,any>>{
 const auditKey=sha256(canonicalJson({schemaVersion:1,experimentId:input.grant.experimentId}));
 const audit=await open(join(input.ledgerDirectory,`${auditKey}.events.ndjson`),'wx',0o600);
 let sequence=0,previousDigest='0'.repeat(64);
 const record=async(type:string,data:Record<string,unknown>)=>{
  const event={sequence:++sequence,type,previousDigest,...data};const digest=sha256(canonicalJson(event));
  await audit.writeFile(JSON.stringify({...event,digest})+'\n');await audit.sync();previousDigest=digest;
 };
 let child:ChildProcessWithoutNullStreams|undefined;let timer:NodeJS.Timeout|undefined;
 let spentUpper=0,generations=0,counts=0,nextId=1,finished=false,terminalFailure=false;
 const armCalls={compact_first:0,full_replacement:0},armUpper={compact_first:0,full_replacement:0};
 const physical:Array<Record<string,unknown>>=[];
 const started=performance.now();
 const cancellation=new AbortController();
 const cancellable=<T>(operation:()=>Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
  const stop=()=>reject(Error('SESSION_CANCELLED'));
  if(cancellation.signal.aborted){stop();return;}
  cancellation.signal.addEventListener('abort',stop,{once:true});
  Promise.resolve().then(operation).then(resolve,reject).finally(()=>cancellation.signal.removeEventListener('abort',stop));
 });
 try{
  await record('claimed',{contractDigest:input.contract.digest,mode:input.mode});
  child=input.connect();
  const exited=new Promise<number>(resolve=>{child!.once('error',()=>resolve(-1));child!.once('close',code=>{if(!finished){terminalFailure=true;cancellation.abort();}resolve(code??-1);});});
  // Never copy raw stderr, errors, prompts or secrets to the durable audit.
  let stderrBytes=0;child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>MAX_FRAME_BYTES)child?.kill('SIGKILL');});
  timer=setTimeout(()=>{terminalFailure=true;cancellation.abort();child?.kill('SIGKILL');},timeoutMs);
  child.stdin.on('error',()=>{terminalFailure=true;cancellation.abort();child?.kill('SIGKILL');});
  const reader=frames(child.stdout)[Symbol.asyncIterator]();
  const first=await reader.next();const ready=first.value;
  if(first.done||ready.type!=='ready'||ready.contractDigest!==input.contract.digest||ready.implementationCommit!==input.grant.implementationCommit||ready.deploymentId!==input.grant.deploymentId)throw Error('WORKER_IDENTITY_MISMATCH');
  await sendFrame(child.stdin,{type:'start',contractDigest:input.contract.digest,mode:input.mode});
  let client:WorkerModelClient|undefined;
  const counted=new Map<string,number>();
  let result:Record<string,unknown>|undefined;
  for(let next=await reader.next();!next.done;next=await reader.next()){
   const frame=next.value;
   if(terminalFailure||input.now+performance.now()-started>=input.grant.expiresAt)throw Error('SESSION_EXPIRED');
   if(frame.type==='result'){
    if(finished||!frame.record||typeof frame.record!=='object'||Array.isArray(frame.record))throw Error('PROTOCOL_INVALID_RESULT');
    const {pairDigest,...body}=frame.record;
    if(body.supervisionContractDigest!==input.contract.digest||typeof pairDigest!=='string'||pairDigest!==sha256(canonicalJson(body)))throw Error('RESULT_IDENTITY_MISMATCH');
    finished=true;result=frame.record;child.stdin.end();continue;
   }
   if(finished||frame.id!==nextId++||!['count','execute'].includes(frame.type))throw Error('PROTOCOL_REPLAY_OR_ORDER');
   const arm=frame.arm as keyof typeof armCalls;
   if(!Object.hasOwn(armCalls,arm)||!Number.isInteger(frame.cycle)||frame.cycle<1||frame.cycle>3)throw Error('INVALID_ARM_OR_CYCLE');
   const prompt=frame.prompt;
   if(typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>120_000||/PRIVATE_(?:V7_QUEUE|V8_INVENTORY)_ORACLE/u.test(prompt))throw Error('PROMPT_BOUNDARY');
   const promptDigest=sha256(prompt),key=`${arm}:${frame.cycle}:${promptDigest}`;
   let value:unknown;
   if(frame.type==='count'){
    if(++counts>12)throw Error('COUNT_CALL_LIMIT');
    await record('token_count_attempt',{id:frame.id,arm,cycle:frame.cycle,promptDigest});
    client??=input.provider(cancellation.signal);
    if(client.routeKey!=='openai:gpt-5.6-luna:paid')throw Error('MODEL_ROUTE_MISMATCH');
    value=await cancellable(()=>client!.countInputTokens(prompt));
    if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>30_000)throw Error('INPUT_TOKEN_LIMIT');
    counted.set(key,value as number);
   }else{
    if(frame.reasoningLevel!=='medium'||frame.maximumOutputTokens!==8000||!counted.has(key))throw Error('GENERATION_CONTRACT');
    if(generations>=6||armCalls[arm]>=3)throw Error('GENERATION_CALL_LIMIT');
    // Retain conservative reservation after unknown usage, failure, disconnect or crash.
    const reserve=(30_000*0.25+8000*1.2)/1e6;
    if(spentUpper+reserve>input.grant.maximumPhysicalSpendUsd+1e-12||armUpper[arm]+reserve>input.grant.maximumPhysicalSpendUsd/2+1e-12)throw Error('PHYSICAL_SPEND_LIMIT');
    counted.delete(key);generations++;armCalls[arm]++;spentUpper+=reserve;armUpper[arm]+=reserve;
    const receipt:Record<string,unknown>={id:frame.id,arm,cycle:frame.cycle,status:'attempted',inputTokens:null,outputTokens:null,costUsd:null,upperBoundUsd:reserve,promptDigest};physical.push(receipt);
    await record('generation_reserved',receipt);
    client??=input.provider(cancellation.signal);
    if(client.routeKey!=='openai:gpt-5.6-luna:paid')throw Error('MODEL_ROUTE_MISMATCH');
    const raw=await cancellable(()=>client!.execute({prompt,reasoningLevel:'medium',maximumOutputTokens:8000}));
    if(!raw||typeof raw.outputText!=='string'||Buffer.byteLength(raw.outputText)>256_000||!Number.isSafeInteger(raw.inputTokens)||raw.inputTokens<0||raw.inputTokens>30_000||!Number.isSafeInteger(raw.billableOutputTokens)||raw.billableOutputTokens<0||raw.billableOutputTokens>8000)throw Error('UNKNOWN_OR_EXCESS_USAGE');
    const upper=(raw.inputTokens*0.25+raw.billableOutputTokens*1.2)/1e6;
    spentUpper+=upper-reserve;armUpper[arm]+=upper-reserve;
    Object.assign(receipt,{status:'completed',inputTokens:raw.inputTokens,outputTokens:raw.billableOutputTokens,costUsd:(raw.inputTokens*0.2+raw.billableOutputTokens*1.2)/1e6,upperBoundUsd:upper,outputDigest:sha256(raw.outputText)});
    await record('generation_completed',receipt);value={outputText:raw.outputText,inputTokens:raw.inputTokens,billableOutputTokens:raw.billableOutputTokens};
   }
   await sendFrame(child.stdin,{type:'reply',id:frame.id,value});
  }
  const exitCode=await exited;
  if(!finished||terminalFailure||!result||![0,1].includes(exitCode))throw Error('WORKER_INCOMPLETE');
  await record('worker_finished',{exitCode,resultDigest:sha256(canonicalJson(result)),generations,spentUpper});
  return {result,physical,generations,spentUpper,exitCode,auditDigest:previousDigest,evidenceLevel:input.mode==='offline'?'OFFLINE_SUPERVISED_INTEGRATION':'LIVE_SUPERVISED_EXECUTION',accountingBasis:input.mode==='offline'?'scripted_token_counters_not_billing':'frozen_token_rate_estimate_not_invoice',generalClaimSupported:false};
 }catch{
  await record('session_failed',{generations,spentUpper,usageUnknown:physical.some(r=>r.costUsd===null)});
  throw Error('SUPERVISED_SESSION_FAILED');
 }finally{cancellation.abort();if(timer)clearTimeout(timer);child?.kill('SIGKILL');await audit.close();}
}
