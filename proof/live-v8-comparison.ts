import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {runCodingRepairController} from '../src/coding-repair-controller.ts';
import {INITIAL_CODING_REPAIR_LIMITS} from '../src/coding-repair-policy.ts';
import {createLunaCodingRepairModel} from '../src/luna-coding-repair-model.ts';
import {OpenAIResponsesClient} from '../src/openai-worker.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {loadConstitution} from '../src/constitution.ts';
import type {CodingRepairReceipt} from '../src/coding-repair-types.ts';
import type {ProgramCandidateProposal} from '../src/types.ts';
import type {WorkerModelClient} from '../src/model-router.ts';
import {baseline,reference,good,mutations,objective,acceptanceCriteria,assertionCount} from './v8-live-fixture.ts';
import {evaluatePair} from './v7-live-evaluation.ts';
import {describeBenchmarkFailure,type BenchmarkStage} from './v7-failure-diagnostics.ts';

const LIMIT=0.15,ARM_LIMIT=LIMIT/2,MAX_GENERATIONS=6;
const selfTest=process.argv.includes('--self-test');
const live=process.argv.includes('--live');
assert(!(selfTest&&live),'self-test and live are mutually exclusive');
const runtimeCommit=(process.env.SARA_BENCHMARK_COMMIT_SHA??'').trim();
if(live) assert(/^[a-f0-9]{40}$/u.test(runtimeCommit),'SARA_BENCHMARK_COMMIT_SHA must pin the deployed commit');
const {digest:constitutionDigest}=await loadConstitution();
const context={objective,acceptanceCriteria,constitutionDigest,missingCapabilities:[],memoryContext:{contextDigest:sha256('[]'),memories:[]}};
const authority={...INITIAL_CODING_REPAIR_LIMITS,physicalMaximumSpendUsd:LIMIT,physicalPerArmCeilingUsd:ARM_LIMIT,maximumPhysicalCalls:MAX_GENERATIONS,repositoryMutation:false,merge:false,deploy:false,promotion:false};
const contract={schemaVersion:1,caseId:'bounded-inventory-basket-v8-live-01',runtimeCommit:live?runtimeCommit:null,model:'gpt-5.6-luna',reasoning:'medium',baselineDigest:sha256(canonicalJson(baseline)),referenceDigest:sha256(canonicalJson(reference)),objective,acceptanceCriteria,oracle:'independent_static_hidden_inventory_assertions',hiddenAssertionCount:assertionCount,sharedFirstProposal:false,armOrder:['compact_first','full_replacement'],treatment:'experimentalCompactFirstProposal_and_compactRepairContinuations',firstCallAccounting:'independent_physical_generations_because_output_contract_is_treatment',measure:'baseline_verification_to_independent_final_verification_including_model_accounting_round_trips',target:{speedRatio:4,requiresBothComplete:true,requiresNoHigherCost:true},pricing:{inputPerMillion:0.20,outputPerMillion:1.20},repeats:1,retainAllOutcomes:true,generalClaimSupported:false};
const contractDigest=sha256(canonicalJson(contract));
function emit(type:string,payload:unknown){console.log(JSON.stringify({type,payload}));}
const verify=async(candidate:ProgramCandidateProposal)=>{
  assert.deepEqual(candidate.files.filter(f=>f.path.startsWith('tests/')),baseline.files.filter(f=>f.path.startsWith('tests/')),'protected verifier changed');
  return verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});
};
const preflight={reference:await verify(reference),baseline:await verify(baseline)};
assert(preflight.reference.passed,'reference must pass');
assert(!preflight.baseline.passed,'baseline must fail');
emit('V8_PREFLIGHT',{contractDigest,runtimeCommit:live?runtimeCommit:null,referencePassed:true,baselinePassed:false,baselineScore:preflight.baseline.score,assertionCount});
if(!live&&!selfTest){await writeFile('/tmp/sara-v8-contract.json',JSON.stringify(contract,null,2));process.exit(0);}

type Physical={id:number;arm:string;cycle:number;kind:'generation';status:string;inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;responseId:string|null;responseModel:string|null;httpStatus:number|null;httpMilliseconds:number|null;costUsd:number|null;promptDigest:string};
const physical:Physical[]=[];let activeArm='',currentCycle=0;
const rawFetch=globalThis.fetch;
const observedFetch:typeof fetch=async(url,init)=>{
  const target=String(url);const generation=target==='https://api.openai.com/v1/responses';let receipt:Physical|undefined;
  let body:Record<string,any>|null=null;
  if(init?.body){try{body=JSON.parse(String(init.body));}catch{/* client handles malformed body */}}
  if(generation){
    assert(physical.length<MAX_GENERATIONS,'physical generation ceiling exceeded');
    assert(physical.filter(r=>r.arm===activeArm).length<3,'per-arm generation ceiling exceeded');
    assert.equal(body?.model,'gpt-5.6-luna');assert.equal(body?.reasoning?.effort,'medium');assert.equal(body?.store,false);
    receipt={id:physical.length+1,arm:activeArm,cycle:currentCycle,kind:'generation',status:'attempted',inputTokens:null,outputTokens:null,reasoningTokens:null,responseId:null,responseModel:null,httpStatus:null,httpMilliseconds:null,costUsd:null,promptDigest:sha256(String(body?.input??''))};
    physical.push(receipt);emit('V8_MODEL_ATTEMPT',receipt);
  }
  const start=performance.now();
  try{
    const response=await rawFetch(url,init);
    if(receipt){
      receipt.httpStatus=response.status;receipt.httpMilliseconds=performance.now()-start;
      const payload=await response.clone().json() as Record<string,any>;
      receipt.responseId=typeof payload.id==='string'?payload.id:null;receipt.responseModel=typeof payload.model==='string'?payload.model:null;
      const u=payload.usage;
      if(u&&Number.isSafeInteger(u.input_tokens)&&Number.isSafeInteger(u.output_tokens)){
        receipt.inputTokens=u.input_tokens;receipt.outputTokens=u.output_tokens;receipt.reasoningTokens=Number.isSafeInteger(u.output_tokens_details?.reasoning_tokens)?u.output_tokens_details.reasoning_tokens:null;
        receipt.costUsd=(u.input_tokens*0.20+u.output_tokens*1.20)/1e6;
      }
      receipt.status=response.ok&&payload.status==='completed'?'completed':'provider_not_completed';emit('V8_MODEL_RECEIPT',receipt);
    }
    return response;
  }catch(error){if(receipt){receipt.status='unresolved_failure';receipt.httpMilliseconds=performance.now()-start;emit('V8_MODEL_FAILURE',receipt);}throw error;}
};
function modelClient():WorkerModelClient{
  if(live){const key=process.env.OPENAI_API_KEY?.trim();assert(key,'OPENAI_API_KEY is required');return new OpenAIResponsesClient({apiKey:key,fetchImpl:observedFetch,timeoutMs:120000});}
  return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,async countInputTokens(){return 100;},async execute(input){
    assert.equal(input.reasoningLevel,'medium');const facts=JSON.parse(input.prompt.split('\n').slice(2).join('\n'));const current=facts.files.find((f:{path:string})=>f.path==='src/inventory.ts');const compact=input.prompt.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');
    const edits=mutations.map(m=>({find:m.replace,replace:m.find}));
    return {outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,strategy:facts.requiredStrategy,changes:[{path:current.path,expectedContentDigest:current.contentDigest,...(compact?{edits}:{replacementText:good})}],limitations:[]}),inputTokens:100,billableOutputTokens:100};
  }};
}
const arms:Array<Record<string,any>>=[];
for(const arm of contract.armOrder){
  activeArm=arm;const compact=arm==='compact_first';const start=performance.now();let verificationMs=0,modelMs=0,attemptedModelCalls=0,verificationCalls=0;const stage:{value:BenchmarkStage}={value:'baseline_verification'};const receipts:CodingRepairReceipt[]=[];const requests:Array<Record<string,unknown>>=[];
  const adapter=createLunaCodingRepairModel({client:modelClient(),context,compactRepairContinuations:compact,experimentalCompactFirstProposal:compact});
  const timedVerify=async(c:ProgramCandidateProposal,finalAudit=false)=>{stage.value=finalAudit?'final_verification':verificationCalls===0?'baseline_verification':'candidate_verification';verificationCalls++;const t=performance.now();try{return await verify(c);}finally{verificationMs+=performance.now()-t;}};
  let result:Record<string,any>;
  try{
    const run=await runCodingRepairController({baseline:structuredClone(baseline),limits:INITIAL_CODING_REPAIR_LIMITS,verify:timedVerify,onReceipt:r=>{receipts.push(structuredClone(r));emit('V8_ARM_RECEIPT',{arm,receipt:r});},model:{async propose(request){stage.value='model_request';currentCycle=request.cycle;attemptedModelCalls++;const t=performance.now();const inputDigest=sha256(canonicalJson(request));try{const output=await adapter.propose({...request,remainingCostUsd:Math.min(request.remainingCostUsd,0.03)});stage.value='candidate_validation';requests.push({cycle:request.cycle,inputDigest,proposalDigest:sha256(canonicalJson(output.proposal)),elapsedMilliseconds:performance.now()-t});return output;}finally{modelMs+=performance.now()-t;}}}});
    const post=await timedVerify(run.champion,true);assert.equal(canonicalJson(post),canonicalJson(run.verification),'independent verification disagrees');
    result={arm,verifiedComplete:post.passed,score:post.score,timeMs:performance.now()-start,modelMilliseconds:modelMs,verificationMilliseconds:verificationMs,attemptedModelCalls,logicalModelCalls:requests.length,inputTokens:receipts.reduce((s,r)=>s+r.inputTokens,0),outputTokens:receipts.reduce((s,r)=>s+r.outputTokens,0),accountedCostUsd:run.accountedCostUsd,artifactDigest:post.artifactDigest,receipts,requests,state:run.state,finalSource:run.champion.files.filter(f=>f.path.startsWith('src/')),error:null,failure:null};
  }catch(error){const failure=describeBenchmarkFailure(error,stage.value);result={arm,verifiedComplete:false,score:null,timeMs:performance.now()-start,modelMilliseconds:modelMs,verificationMilliseconds:verificationMs,attemptedModelCalls,logicalModelCalls:requests.length,inputTokens:receipts.reduce((s,r)=>s+r.inputTokens,0),outputTokens:receipts.reduce((s,r)=>s+r.outputTokens,0),accountedCostUsd:receipts.reduce((s,r)=>s+r.accountedCostUsd,0),artifactDigest:null,receipts,requests,state:null,finalSource:null,error:failure.code,failure};}
  result.changedLines=result.error&&requests.length>receipts.length?null:receipts.reduce((s,r)=>s+r.changedLines,0);result.rollbacks=receipts.filter(r=>r.outcome==='rolled_back').length;result.acceptedImprovements=receipts.filter(r=>r.outcome==='accepted_improvement').length;result.duplicateRejections=receipts.filter(r=>r.outcome==='duplicate_rejected').length;result.ryeTotal=receipts.reduce((s,r)=>s+r.rye,0);
  arms.push(result);emit('V8_ARM_COMPLETE',{arm,verifiedComplete:result.verifiedComplete,score:result.score,timeMs:result.timeMs,attemptedModelCalls,error:result.error});
}
const control=arms.find(a=>a.arm==='full_replacement')!,canary=arms.find(a=>a.arm==='compact_first')!;const evaluation=evaluatePair(control as any,canary as any);
const physicalCostUsd=physical.every(r=>r.costUsd!==null)?physical.reduce((s,r)=>s+(r.costUsd??0),0):null;
const record={contract,contractDigest,evidenceLevel:live?'LIVE_V8_FRESH_MATCHED_COMPARISON':'SCRIPTED_V8_SELF_TEST',...evaluation,arms,physical,physicalModelCalls:physical.length,physicalCostUsd,authorityDigest:sha256(canonicalJson(authority)),receiptsDigest:sha256(canonicalJson(arms.map(a=>a.receipts))),environment:{node:process.version,platform:process.platform,arch:process.arch,railwayDeploymentId:process.env.RAILWAY_DEPLOYMENT_ID??null},generalClaimSupported:false};
if(selfTest){assert(evaluation.valid);assert(control.verifiedComplete&&canary.verifiedComplete);assert.equal(control.artifactDigest,canary.artifactDigest);assert.equal(control.attemptedModelCalls,1);assert.equal(canary.attemptedModelCalls,1);}
const pairDigest=sha256(canonicalJson(record));const text=JSON.stringify({...record,pairDigest});await writeFile('/tmp/sara-v8-comparison-result.json',text+'\n',{mode:0o600});const compressed=gzipSync(text).toString('base64');emit('V8_RESULT_META',{sha256:sha256(text),pairDigest,contractDigest,encoding:'gzip+base64',chunks:Math.ceil(compressed.length/2000),valid:record.valid,verdict:record.verdict,speedRatio:record.speedRatio,speedIncreasePercent:record.speedIncreasePercent,target300PercentMet:record.target300PercentMet,physicalModelCalls:physical.length,physicalCostUsd});for(let offset=0;offset<compressed.length;offset+=2000)emit('V8_RESULT_CHUNK',{index:offset/2000,data:compressed.slice(offset,offset+2000)});
if(!record.valid)process.exitCode=1;
