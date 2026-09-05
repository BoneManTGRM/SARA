import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {OpenAIResponsesClient} from '../src/openai-worker.ts';
import {runProcessApprovedBenchmark} from './benchmark-supervisor.ts';
import {loadV8SupervisedContract} from './v8-supervised-contract.ts';
import {validateV8Approval,type Identity} from './v8-process-approval.ts';
import {evaluatePair} from './v7-live-evaluation.ts';

const approvalUrl='https://raw.githubusercontent.com/BoneManTGRM/SARA/experiment/v8-owner-run-grant/.github/sara/v8-live-owner-grant.json';
const http:Array<Record<string,any>>=[];
let directory:string|undefined;
function emit(type:string,payload:unknown){console.log(JSON.stringify({type,timestamp:new Date().toISOString(),payload}));}
function publish(record:Record<string,unknown>){
 const text=JSON.stringify({...record,evidenceDigest:sha256(canonicalJson(record))});
 const data=gzipSync(text).toString('base64');
 emit('V8_EVIDENCE_META',{sha256:sha256(text),encoding:'gzip+base64',chunks:Math.ceil(data.length/2000)});
 for(let offset=0;offset<data.length;offset+=2000)emit('V8_EVIDENCE_CHUNK',{index:offset/2000,data:data.slice(offset,offset+2000)});
 return text;
}
async function auditRows(){
 if(!directory)return [];
 const name=(await readdir(directory)).find(p=>p.endsWith('.events.ndjson'));
 if(!name)return [];
 return (await readFile(join(directory,name),'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
}
try{
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--retired'){emit('V8_RETIRED_NO_PROVIDER_CALLS',{});process.exit(0);}
 const contract=await loadV8SupervisedContract();
 if(args.length===0||(args.length===1&&args[0]==='--preflight')){emit('V8_SOURCE_PREFLIGHT',{contract,providerCalls:0});process.exit(0);}
 if(args.length!==1||args[0]!=='--await-grant')throw Error('ARGUMENTS');
 const identity:Identity={contractDigest:contract.digest,implementationCommit:process.env.RAILWAY_GIT_COMMIT_SHA??'',deploymentId:process.env.RAILWAY_DEPLOYMENT_ID??'',serviceId:process.env.RAILWAY_SERVICE_ID??'',nonce:randomBytes(32).toString('hex')};
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
 if(!/^[a-f0-9]{40}$/u.test(identity.implementationCommit)||!uuid.test(identity.deploymentId)||!uuid.test(identity.serviceId))throw Error('RAILWAY_IDENTITY_REQUIRED');
 emit('V8_AWAITING_OWNER_GRANT',{...identity,approvalUrl,providerCredentialPresent:Boolean(process.env.OPENAI_API_KEY?.trim()),providerCalls:0});
 let approval:unknown;
 const deadline=Date.now()+1_200_000;
 while(Date.now()<deadline){
  let response:Response|undefined;
  try{response=await fetch(approvalUrl+'?process='+identity.nonce+'&poll='+Date.now(),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{/* bounded read-only polling */}
  if(response?.ok){
   const text=await response.text();if(Buffer.byteLength(text)>16384)throw Error('APPROVAL_TOO_LARGE');
   approval=JSON.parse(text);validateV8Approval(approval,identity,Date.now());break;
  }
  if(response&&response.status!==404)throw Error('APPROVAL_READ_FAILED');
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(!approval){emit('V8_NO_APPROVAL_NO_PROVIDER_CALLS',identity);process.exit(0);}
 validateV8Approval(approval,identity,Date.now());
 if(!process.env.OPENAI_API_KEY?.trim())throw Error('PROVIDER_CREDENTIAL_REQUIRED');
 directory=await mkdtemp(join(tmpdir(),'sara-v8-owner-audit-'));
 const rawFetch=globalThis.fetch;
 const grant={experimentId:contract.caseId,contractDigest:contract.digest,implementationCommit:identity.implementationCommit,deploymentId:identity.deploymentId,expiresAt:approval.expiresAt,maximumPhysicalSpendUsd:approval.maximumPhysicalSpendUsd};
 emit('V8_OWNER_GRANT_ACCEPTED',{...identity,approvalDigest:sha256(canonicalJson(approval)),maximumPhysicalSpendUsd:0.15});
 const output=await runProcessApprovedBenchmark({ledgerDirectory:directory,grant,contract,now:Date.now(),mode:'live',
  connect:()=>spawn(process.execPath,['--import','tsx','proof/v8-worker.ts'],{shell:false,stdio:'pipe',env:{PATH:process.env.PATH,NODE_ENV:'production',RAILWAY_DEPLOYMENT_ID:identity.deploymentId,RAILWAY_GIT_COMMIT_SHA:identity.implementationCommit}}),
  provider:signal=>new OpenAIResponsesClient({apiKey:process.env.OPENAI_API_KEY!,timeoutMs:120000,fetchImpl:async(url,init)=>{
   const target=String(url);
   if(!['https://api.openai.com/v1/responses','https://api.openai.com/v1/responses/input_tokens'].includes(target))throw Error('PROVIDER_URL');
   const body=JSON.parse(String(init?.body));
   if(body.model!=='gpt-5.6-luna'||String(body.input).includes('PRIVATE_V8_INVENTORY_ORACLE'))throw Error('PROVIDER_CONTRACT');
   const generation=target.endsWith('/responses');
   if(generation&&(body.reasoning?.effort!=='medium'||body.max_output_tokens!==8000||body.store!==false))throw Error('PROVIDER_CONTRACT');
   const receipt:Record<string,any>={sequence:http.length+1,kind:generation?'generation':'token_count',startedAt:new Date().toISOString(),promptDigest:sha256(String(body.input)),httpStatus:null,responseId:null,responseModel:null,inputTokens:null,outputTokens:null,reasoningTokens:null,cachedInputTokens:null,status:'attempted',httpMilliseconds:null};
   http.push(receipt);emit('V8_PROVIDER_ATTEMPT',receipt);
   const start=performance.now();
   try{
    const response=await rawFetch(url,{...init,signal:AbortSignal.any(init?.signal?[signal,init.signal]:[signal])});
    receipt.httpStatus=response.status;
    const payload=await response.clone().json() as Record<string,any>;
    receipt.httpMilliseconds=performance.now()-start;receipt.responseDigest=sha256(canonicalJson(payload));
    if(generation){
     receipt.responseId=typeof payload.id==='string'?payload.id:null;
     receipt.responseModel=typeof payload.model==='string'?payload.model:null;
     const u=payload.usage;
     for(const [field,v] of [['inputTokens',u?.input_tokens],['outputTokens',u?.output_tokens],['reasoningTokens',u?.output_tokens_details?.reasoning_tokens],['cachedInputTokens',u?.input_tokens_details?.cached_tokens]] as const)receipt[field]=Number.isSafeInteger(v)&&v>=0?v:null;
     receipt.status=response.ok&&payload.status==='completed'?'completed':'provider_not_completed';
     emit('V8_PROVIDER_RECEIPT',receipt);
     if(!receipt.responseModel||!/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/u.test(receipt.responseModel))throw Error('PROVIDER_MODEL_MISMATCH');
    }else{receipt.inputTokens=Number.isSafeInteger(payload.input_tokens)?payload.input_tokens:null;receipt.status=response.ok?'completed':'provider_not_completed';emit('V8_PROVIDER_RECEIPT',receipt);}
    return response;
   }catch{receipt.status='unresolved_failure';receipt.httpMilliseconds=performance.now()-start;emit('V8_PROVIDER_FAILURE',receipt);throw Error('PROVIDER_REQUEST_FAILED');}
  }})},approval,identity);
 const generationReceipts=http.filter(r=>r.kind==='generation');
 const arms=structuredClone(output.result.arms) as Array<Record<string,any>>;
 for(const arm of arms){const rows=output.physical.filter((r:any)=>r.arm===arm.arm);arm.costUsd=rows.length===arm.attemptedModelCalls&&rows.every((r:any)=>r.costUsd!==null)?rows.reduce((sum:number,r:any)=>sum+r.costUsd,0):null;}
 const control=arms.find(a=>a.arm==='full_replacement')!,compact=arms.find(a=>a.arm==='compact_first')!;
 const evaluation=evaluatePair(control as any,compact as any);
 const metadataValid=generationReceipts.length===output.generations&&generationReceipts.every(r=>r.status==='completed'&&r.httpStatus===200&&r.responseId)&&new Set(generationReceipts.map(r=>r.responseId)).size===generationReceipts.length&&new Set(generationReceipts.map(r=>r.responseModel)).size===1;
 if(!metadataValid){evaluation.valid=false;evaluation.timeComparable=false;evaluation.speedRatio=null;evaluation.speedIncreasePercent=null;evaluation.costNotHigher=null;evaluation.target300PercentMet=false;evaluation.verdict='INCONCLUSIVE';}
 const {pairDigest,...originalResult}=output.result;
 if(pairDigest!==sha256(canonicalJson(originalResult)))throw Error('RESULT_IDENTITY_MISMATCH');
 const record={schemaVersion:1,evidenceLevel:'LIVE_SARA_V8_RAILWAY_EXECUTION',identity,approval,approvalDigest:sha256(canonicalJson(approval)),contract,supervisor:output,comparison:{...evaluation,arms},http,audit:await auditRows(),providerCostEstimateUsd:output.physical.every((r:any)=>r.costUsd!==null)?output.physical.reduce((s:number,r:any)=>s+r.costUsd,0):null,conservativeProviderReserveUsd:output.spentUpper,accountingBasis:'frozen_uncached_token_rates_not_reconciled_invoice',infrastructureCostUsd:null,telegramDelivery:null,generalClaimSupported:false};
 const text=publish(record);await writeFile(join(directory,'evidence.json'),text+'\n',{mode:0o600});
 emit('V8_COMPARISON_COMPLETE',{...evaluation,assertions:contract.hiddenAssertionCount,physicalModelCalls:output.generations,providerCostEstimateUsd:record.providerCostEstimateUsd,compactSeconds:compact.timeMs/1000,controlSeconds:control.timeMs/1000,evidenceSha256:sha256(text)});
 if(!evaluation.valid)process.exitCode=1;
}catch{
 const audit=await auditRows();publish({schemaVersion:1,evidenceLevel:'LIVE_ATTEMPT_STOPPED_OR_NOT_STARTED',http,audit,comparison:null,generalClaimSupported:false});
 emit('V8_STOPPED_WITHOUT_COMPLETION',{generationRequestsObserved:http.filter(r=>r.kind==='generation').length,unknownUsagePreserved:true});process.exitCode=1;
}
