import {lstat,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {OpenAIResponsesClient} from '../src/openai-worker.ts';
import {good,mutations} from '../proof/v7-live-fixture.ts';
import {loadSupervisedContract} from '../proof/supervised-benchmark-contract.ts';
import {connectRailway,railwayCommand,runSupervisedBenchmark,type RailwayTarget} from '../proof/benchmark-supervisor.ts';
import type {BenchmarkRunGrant} from '../proof/benchmark-run-admission.ts';
import type {WorkerModelClient} from '../src/model-router.ts';

function scriptedClient():WorkerModelClient{return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,
 async countInputTokens(){return 100;},async execute(input){
  const facts=JSON.parse(input.prompt.split('\n').slice(2).join('\n'));
  const current=facts.files.find((f:{path:string})=>f.path==='src/queue.ts');
  const compact=input.prompt.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');
  return {inputTokens:100,billableOutputTokens:100,outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,strategy:facts.requiredStrategy,
   changes:[{path:current.path,expectedContentDigest:current.contentDigest,...(compact?{edits:mutations.map(m=>({find:m.replace,replace:m.find}))}:{replacementText:good})}],limitations:[]})};
 }};}
try{
 const args=process.argv.slice(2);const options:Record<string,string>={};
 if(args.length%2)throw Error('ARGUMENTS');
 for(let i=0;i<args.length;i+=2){if(!['--mode','--grant','--ledger','--output'].includes(args[i])||Object.hasOwn(options,args[i]))throw Error('ARGUMENTS');options[args[i]]=args[i+1];}
 const contract=await loadSupervisedContract(),mode=options['--mode']??'plan';
 if(mode==='plan')console.log(JSON.stringify(contract,null,2));
 else{
  if(!['offline','live'].includes(mode)||(mode==='live'&&!contract.paidAllowed))throw Error('PAID_CONTRACT_REQUIRED');
  if(!options['--grant']||!options['--ledger']||!options['--output']||![options['--grant'],options['--ledger'],options['--output']].every(isAbsolute))throw Error('PRIVATE_PATHS_REQUIRED');
  const stat=await lstat(options['--grant']);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>16_384)throw Error('PRIVATE_GRANT_REQUIRED');
  const approved=JSON.parse(await readFile(options['--grant'],'utf8')) as {grant:BenchmarkRunGrant;railway:RailwayTarget};
  railwayCommand(approved.railway);
  const output=await runSupervisedBenchmark({ledgerDirectory:options['--ledger'],grant:approved.grant,contract,now:Date.now(),mode:mode as 'offline'|'live',connect:()=>connectRailway(approved.railway),
   provider:(signal)=>mode==='offline'?scriptedClient():new OpenAIResponsesClient({apiKey:process.env.OPENAI_API_KEY??'',timeoutMs:120_000,fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.any(init?.signal?[signal,init.signal]:[signal])})})});
  await writeFile(options['--output'],JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('SUPERVISED_RESULT_SAVED');
 }
}catch{process.stderr.write('SUPERVISED_LAUNCH_DENIED_OR_FAILED\n');process.exitCode=1;}
