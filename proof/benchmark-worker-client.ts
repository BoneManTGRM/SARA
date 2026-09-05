import {frames,sendFrame} from './benchmark-supervisor.ts';
import {loadSupervisedContract} from './supervised-benchmark-contract.ts';
import type {WorkerModelClient} from '../src/model-router.ts';
let reader:AsyncIterator<Record<string,any>>|undefined,nextId=1;
export async function initializeWorker(){
 if(process.env.OPENAI_API_KEY?.trim())throw Error('WORKER_PROVIDER_KEY_FORBIDDEN');
 const contract=await loadSupervisedContract();
 reader=frames(process.stdin)[Symbol.asyncIterator]();
 await sendFrame(process.stdout,{type:'ready',contractDigest:contract.digest,implementationCommit:process.env.RAILWAY_GIT_COMMIT_SHA??null,deploymentId:process.env.RAILWAY_DEPLOYMENT_ID??null});
 let timer:NodeJS.Timeout|undefined;
 try{
  const start=await Promise.race([reader.next(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('OWNER_CHANNEL_REQUIRED')),5000);})]);
  if(start.done||start.value.type!=='start'||start.value.contractDigest!==contract.digest)throw Error('OWNER_CHANNEL_REQUIRED');
 }finally{if(timer)clearTimeout(timer);}
 // The reviewed worker has no direct provider client. This is defense in depth, not an OS sandbox.
 globalThis.fetch=async()=>{throw Error('WORKER_DIRECT_NETWORK_FORBIDDEN');};
}
export function workerClient(position:()=>{arm:string;cycle:number}):WorkerModelClient{
 if(!reader)throw Error('OWNER_CHANNEL_REQUIRED');
 const request=async(type:string,input:Record<string,unknown>)=>{
  if(!reader)throw Error('OWNER_CHANNEL_REQUIRED');
  const id=nextId++;await sendFrame(process.stdout,{type,id,...position(),...input});
  const reply=await reader.next();
  if(reply.done||reply.value.type!=='reply'||reply.value.id!==id)throw Error('OWNER_CHANNEL_CLOSED');
  return reply.value.value;
 };
 return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:120000,
  countInputTokens:prompt=>request('count',{prompt}),execute:input=>request('execute',input)};
}
export async function finishWorker(record:unknown){await sendFrame(process.stdout,{type:'result',record});process.stdin.destroy();}
