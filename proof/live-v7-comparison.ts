import {workerClient,finishWorker} from './benchmark-worker-client.ts';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {runCodingRepairController} from '../src/coding-repair-controller.ts';
import {INITIAL_CODING_REPAIR_LIMITS} from '../src/coding-repair-policy.ts';
import {createLunaCodingRepairModel} from '../src/luna-coding-repair-model.ts';
import {loadSupervisedContract} from './supervised-benchmark-contract.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {loadConstitution} from '../src/constitution.ts';
import type {CodingRepairReceipt} from '../src/coding-repair-types.ts';
import type {ProgramCandidateProposal} from '../src/types.ts';
import type {WorkerModelClient} from '../src/model-router.ts';
import {baseline,reference,good,broken,mutations,objective,acceptanceCriteria,protectedTests,assertionCount} from './v7-live-fixture.ts';
import {evaluatePair} from './v7-live-evaluation.ts';
import {assertOfflineRecovery,describeBenchmarkFailure,type BenchmarkStage} from './v7-failure-diagnostics.ts';

const SOURCE='b451a41dc7add73613c0580a9b101ddd390a93a6';
const LIMIT=0.15,ARM_PHYSICAL_LIMIT=LIMIT/2,MAX_CALLS=6;
assertOfflineRecovery(process.argv);
const bridge=process.argv.includes('--bridge');
const selfTest=process.argv.includes('--self-test');
const allWrong=process.argv.includes('--all-wrong');
assert(!allWrong||selfTest,'all-wrong is a self-test only option');
const {digest:constitutionDigest}=await loadConstitution();
const context={objective,acceptanceCriteria,constitutionDigest,missingCapabilities:[],memoryContext:{contextDigest:sha256('[]'),memories:[]}};
const authority={...INITIAL_CODING_REPAIR_LIMITS,physicalMaximumSpendUsd:LIMIT,physicalPerArmCeilingUsd:ARM_PHYSICAL_LIMIT,
  maximumPhysicalCalls:MAX_CALLS,repositoryMutation:false,merge:false,deploy:false,promotion:false};
const contract={schemaVersion:1,caseId:'stable-priority-queue-v7-live-01',sourceCommit:SOURCE,model:'gpt-5.6-luna',reasoning:'medium',
  baselineDigest:sha256(canonicalJson(baseline)),referenceDigest:sha256(canonicalJson(reference)),objective,acceptanceCriteria,
  oracle:'independent_repeated_maximum_scan',hiddenAssertionCount:assertionCount,sharedFirstProposal:false,
  armOrder:['compact_first','full_replacement'],treatment:'experimentalCompactFirstProposal_and_compactRepairContinuations',
  firstCallAccounting:'independent_physical_generations_because_output_contract_is_treatment',authority,
  measure:'baseline_verification_to_independent_final_verification_including_model_accounting_round_trips',
  target:{speedRatio:4,requiresBothComplete:true,requiresNoHigherCost:true},
  pricing:{inputPerMillion:0.20,cachedInputPerMillion:0.02,outputPerMillion:1.20,conservativeInputPerMillion:0.25},
  repeats:1,retainAllOutcomes:true,generalClaimSupported:false};
const contractDigest=sha256(canonicalJson(contract));
function emit(type:string,payload:unknown){if(!bridge)console.log(JSON.stringify({type,payload}));}
const sourceManifest=JSON.parse(await readFile('proof/live-v7-source-manifest.json','utf8')) as Record<string,string>;
for(const [path,digest] of Object.entries(sourceManifest)) assert.equal(sha256(await readFile(path)),digest,`source mismatch: ${path}`);
const verify=async(candidate:ProgramCandidateProposal)=>{
  assert.deepEqual(candidate.files.filter(f=>f.path.startsWith('tests/')),baseline.files.filter(f=>f.path.startsWith('tests/')),'protected verifier changed');
  return verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});
};
const preflight={reference:await verify(reference),baseline:await verify(baseline)};
assert(preflight.reference.passed,'independent reference failed');
assert(!preflight.baseline.passed,'baseline unexpectedly solved');
emit('PREFLIGHT',{contractDigest,sourceCommit:SOURCE,referencePassed:true,baselinePassed:false,baselineScore:preflight.baseline.score,assertionCount});
if(!bridge&&!selfTest&&!process.argv.includes('--live')){await writeFile('/tmp/sara-v7-contract.json',JSON.stringify(contract,null,2));process.exit(0);}
// No direct provider path remains in this worker. Historical live source stays frozen on PR89.
let activeArm='',currentCycle=0;
function modelClient():WorkerModelClient{
 if(bridge)return workerClient(()=>({arm:activeArm,cycle:currentCycle}));
 if(!selfTest)throw Error('SUPERVISED_OWNER_CHANNEL_REQUIRED');
 return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,
  async countInputTokens(prompt){assert(!prompt.includes('PRIVATE_V7_QUEUE_ORACLE'));return 100;},
  async execute(input){
   assert.equal(input.reasoningLevel,'medium');assert.equal(input.maximumOutputTokens,8000);
   const facts=JSON.parse(input.prompt.split('\n').slice(2).join('\n'));
   const current=facts.files.find((f:{path:string})=>f.path==='src/queue.ts');
   const compact=input.prompt.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');
   const fixes=allWrong?[{find:'limit+1',replace:`limit+${currentCycle+2}`}]:mutations.map(m=>({find:m.replace,replace:m.find}));
   const replacementText=allWrong?broken.replace('limit+1',`limit+${currentCycle+2}`):good;
   return {outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,
    strategy:facts.requiredStrategy,changes:[{path:current.path,expectedContentDigest:current.contentDigest,...(compact?{edits:fixes}:{replacementText})}],limitations:[]}),inputTokens:100,billableOutputTokens:100};
  }};
}
const arms:Array<Record<string,any>>=[];
for(const arm of contract.armOrder){
 activeArm=arm;const compact=arm==='compact_first';
 const start=performance.now();let verificationMs=0,modelMs=0,attemptedModelCalls=0,verificationCalls=0;
 const stage:{value:BenchmarkStage}={value:'baseline_verification'};
 const receipts:CodingRepairReceipt[]=[];const requests:Array<Record<string,unknown>>=[];
 const adapter=createLunaCodingRepairModel({client:modelClient(),context,compactRepairContinuations:compact,experimentalCompactFirstProposal:compact});
 const timedVerify=async(c:ProgramCandidateProposal,finalAudit=false)=>{
  stage.value=finalAudit?'final_verification':verificationCalls===0?'baseline_verification':'candidate_verification';
  verificationCalls++;const t=performance.now();try{return await verify(c);}finally{verificationMs+=performance.now()-t;}
 };
 let result:Record<string,any>;
 try{
  const run=await runCodingRepairController({baseline:structuredClone(baseline),limits:INITIAL_CODING_REPAIR_LIMITS,verify:timedVerify,
   onReceipt:r=>{receipts.push(structuredClone(r));emit('ARM_RECEIPT',{arm,receipt:r});},model:{
    async propose(request){
     stage.value='model_request';currentCycle=request.cycle;attemptedModelCalls++;const t=performance.now();const inputDigest=sha256(canonicalJson(request));
     try{const output=await adapter.propose({...request,remainingCostUsd:Math.min(request.remainingCostUsd,0.03)});
      stage.value='candidate_validation';requests.push({cycle:request.cycle,inputDigest,proposalDigest:sha256(canonicalJson(output.proposal)),elapsedMilliseconds:performance.now()-t});return output;
     }finally{modelMs+=performance.now()-t;}
    }}});
  const post=await timedVerify(run.champion,true);
  assert.equal(canonicalJson(post),canonicalJson(run.verification),'independent verification disagrees');
  result={arm,verifiedComplete:post.passed,score:post.score,timeMs:performance.now()-start,modelMilliseconds:modelMs,verificationMilliseconds:verificationMs,
   attemptedModelCalls,logicalModelCalls:requests.length,inputTokens:receipts.reduce((s,r)=>s+r.inputTokens,0),outputTokens:receipts.reduce((s,r)=>s+r.outputTokens,0),
   accountedCostUsd:run.accountedCostUsd,artifactDigest:post.artifactDigest,receipts,attemptLessons:run.attemptLessons,requests,state:run.state,
   finalSource:run.champion.files.filter(f=>f.path.startsWith('src/')),error:null,failure:null};
 }catch(error){const failure=describeBenchmarkFailure(error,stage.value);result={arm,verifiedComplete:false,score:null,timeMs:performance.now()-start,modelMilliseconds:modelMs,verificationMilliseconds:verificationMs,
  attemptedModelCalls,receipts,requests,finalSource:null,error:failure.code,failure};}
 result.costUsd=result.accountedCostUsd??null;
 result.costUpperBoundUsd=null;
 result.changedLines=result.error&&requests.length>receipts.length?null:receipts.reduce((s,r)=>s+r.changedLines,0);
 result.rollbacks=receipts.filter(r=>r.outcome==='rolled_back').length;
 result.acceptedImprovements=receipts.filter(r=>r.outcome==='accepted_improvement').length;
 result.duplicateRejections=receipts.filter(r=>r.outcome==='duplicate_rejected').length;
 result.ryeTotal=receipts.reduce((s,r)=>s+r.rye,0);
 arms.push(result);emit('ARM_COMPLETE',{arm,verifiedComplete:result.verifiedComplete,score:result.score,error:result.error,failure:result.failure});
}
const control=arms.find(a=>a.arm==='full_replacement')!,canary=arms.find(a=>a.arm==='compact_first')!;
const evaluation=evaluatePair(control as any,canary as any);
const supervision=bridge?await loadSupervisedContract():null;
// Synthetic timing is never a live speed measurement. Preserve only mechanism success/failure.
if(bridge){evaluation.timeComparable=false;evaluation.speedRatio=null;evaluation.speedIncreasePercent=null;evaluation.target300PercentMet=false;evaluation.costNotHigher=null;evaluation.verdict=evaluation.valid?'OFFLINE_INTEGRATION_ONLY':'INCONCLUSIVE';}
const record={contract,contractDigest,sourceCommit:SOURCE,supervisionContractDigest:supervision?.digest??null,evidenceLevel:bridge?'OFFLINE_SUPERVISED_V7_VERIFIER':'SCRIPTED_V7_HARNESS_SELF_TEST',
 ...evaluation,arms,physical:[],physicalModelCalls:bridge?null:0,physicalCostUsd:bridge?null:0,
 physicalConservativeUpperBoundUsd:null,accountingBasis:bridge?'see_owner_supervisor_ledger':'scripted_token_counters_not_billing',
 authorityDigest:sha256(canonicalJson(authority)),receiptsDigest:sha256(canonicalJson(arms.map(a=>a.receipts))),sourceManifestDigest:sha256(canonicalJson(sourceManifest)),
 environment:{node:process.version,platform:process.platform,arch:process.arch},generalClaimSupported:false};
if(selfTest){assert(evaluation.valid);assert.equal(control.verifiedComplete,!allWrong);assert.equal(canary.verifiedComplete,!allWrong);
 assert.equal(control.artifactDigest,canary.artifactDigest);assert.equal(control.attemptedModelCalls,allWrong?3:1);assert.equal(canary.attemptedModelCalls,allWrong?3:1);}
const text=JSON.stringify({...record,pairDigest:sha256(canonicalJson(record))});
if(bridge)await finishWorker({...record,pairDigest:sha256(canonicalJson(record))});
else await writeFile('/tmp/sara-v7-comparison-result.json',text+'\n',{mode:0o600});
const compressed=gzipSync(text).toString('base64');
emit('RESULT_META',{sha256:sha256(text),encoding:'gzip+base64',chunks:Math.ceil(compressed.length/2000),valid:record.valid,verdict:record.verdict});
for(let offset=0;offset<compressed.length;offset+=2000)emit('RESULT_CHUNK',{index:offset/2000,data:compressed.slice(offset,offset+2000)});
if(!record.valid)process.exitCode=1;
