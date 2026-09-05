import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import ts from 'typescript';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {loadConstitution} from '../src/constitution.ts';
import {runCodingRepairController,type CodingRepairModel} from '../src/coding-repair-controller.ts';
import {INITIAL_CODING_REPAIR_LIMITS as limits} from '../src/coding-repair-policy.ts';
import {buildCodingRepairPrompt} from '../src/coding-repair-prompt.ts';
import {expandCodingRepairEdits,CODING_REPAIR_EDITS_JSON_SCHEMA} from '../src/coding-repair-edits.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {describeBenchmarkFailure} from './v7-failure-diagnostics.ts';
import {GuardedRepairMemory,type Scope} from './guarded-repair-memory.ts';
import {PhysicalBudget} from './empirical-provider.ts';
import {baseline,reference,mutations,objective,acceptanceCriteria,assertionCount} from './v8-live-fixture.ts';
import type {ProgramCandidateProposal} from '../src/types.ts';
import type {CodingRepairReceipt,ProgramVerificationResult,CodingRepairProposal} from '../src/coding-repair-types.ts';

const mode=process.argv.includes('--live')?'live':'scripted';
const rounds=process.argv.includes('--smoke')?1:5;assert(!(mode==='live'&&rounds!==5),'LIVE_PROTOCOL_FIXED');
const out=resolve(process.env.SARA_EVIDENCE_DIRECTORY??'reuse-evidence');await mkdir(out,{recursive:true});
const MODEL='@cf/zai-org/glm-4.7-flash';
const startedAt=new Date().toISOString();
const contract={schemaVersion:1,experiment:'sara-exact-repair-reuse-01',model:MODEL,reasoning:'medium',temperature:0,maximumOutputTokens:8000,maximumInputBytes:30000,physicalCallsMaximum:6,physicalReservationMaximumUsd:0.15,limits,
 arms:['patch','ordinary_memory','guarded_recipe'],sharedSeed:true,sharedSeedAccounting:'Full seed latency and cost charged logically to each arm; physical request counted once.',rounds,armOrders:[['patch','ordinary_memory','guarded_recipe'],['ordinary_memory','guarded_recipe','patch'],['guarded_recipe','patch','ordinary_memory'],['patch','guarded_recipe','ordinary_memory'],['ordinary_memory','patch','guarded_recipe']],
 fixture:'V8_inventory_50_assertions',assertionCount,baselineDigest:sha256(canonicalJson(baseline)),referenceDigest:sha256(canonicalJson(reference)),
 measure:'Actual initial verification through independent final verification, including learning, lookup, application and failures.',qualityGate:'All compared jobs independently pass identical original verifier; no simulated latency or cached verifier.',targetRatio:11,
 pricing:{inputPerMillionUsd:0.06,outputPerMillionUsd:0.40,basis:'frozen_public_token_rates_not_invoice'},
 scope:'One exact-repeat inventory fixture, not unfamiliar tasks, family transfer, or population accuracy. Ordinary memory and recipes have matching eligibility.',
 authority:'Experimental SARA code only. No production activation, repository edits by candidates, provider/tool access from candidates, or authority changes.',generalClaimSupported:false};
const contractDigest=sha256(canonicalJson(contract));
const {digest:constitutionDigest}=await loadConstitution();
const sourcePaths=['src/genome-lab-verifier.ts','src/coding-repair-controller.ts','src/coding-repair-policy.ts','src/coding-repair-prompt.ts','src/coding-repair-edits.ts','src/genome-lab.ts','proof/v8-live-fixture.ts','proof/v8-inventory-protected-test-source.ts','proof/guarded-repair-memory.ts','proof/empirical-provider.ts','proof/repair-reuse-benchmark.ts','package-lock.json','constitution/constitution.v1.json'];
const sourceManifest:Record<string,string>={};for(const p of sourcePaths)sourceManifest[p]=sha256(await readFile(p));
const scope:Scope={contract:contractDigest,dependencies:sourceManifest['package-lock.json'],verifier:sha256(canonicalJson({verifier:sourceManifest['src/genome-lab-verifier.ts'],builder:sourceManifest['src/genome-lab.ts'],typescript:ts.version,tests:sourceManifest['proof/v8-inventory-protected-test-source.ts']})),policy:sha256(canonicalJson({constitutionDigest,limits}))};
await writeFile(join(out,'contract.json'),JSON.stringify({contract,contractDigest,sourceManifest},null,2));
if(process.argv.includes('--plan')){console.log(JSON.stringify({contractDigest,contract,sourceManifest}));process.exit(0);}

const budget=new PhysicalBudget();
const physical:Array<Record<string,any>>=[];
let activeJob='preflight';let auditPrevious='0'.repeat(64);
async function audit(event:string,payload:unknown){const item={event,payload,at:new Date().toISOString(),previous:auditPrevious};auditPrevious=sha256(canonicalJson(item));const f=await open(join(out,'audit.ndjson'),'a',0o600);try{await f.writeFile(JSON.stringify({...item,digest:auditPrevious})+'\n');await f.sync();}finally{await f.close();}}
const token=process.env.CLOUDFLARE_API_TOKEN??'';const account=process.env.CLOUDFLARE_ACCOUNT_ID??'';
if(mode==='live'){
 assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='BoneManTGRM/SARA'&&process.env.GITHUB_REF==='refs/heads/experiment/v8-live-inventory-comparison','LIVE_ENVIRONMENT_DENIED');
 assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','REPLAY_DENIED');
 assert(token&&/^[a-f0-9]{32}$/i.test(account),'PROVIDER_CAPABILITY_MISSING');
 const claim=JSON.parse(await readFile(process.env.SARA_CLAIM_FILE??'','utf8'));
 assert.equal(claim.contractDigest,contractDigest);assert.equal(claim.commit,process.env.GITHUB_SHA);assert.equal(claim.runId,process.env.GITHUB_RUN_ID);assert.equal(claim.maximumPhysicalCalls,6);assert.equal(claim.maximumCostUsd,0.15);
 await audit('admitted',claim);
}
// These credentials are held only in the parent broker, never the candidate runtime.
delete process.env.CLOUDFLARE_API_TOKEN;delete process.env.CLOUDFLARE_ACCOUNT_ID;delete process.env.GH_TOKEN;
function number(v:unknown):number|null{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;}
const generator:CodingRepairModel={async propose(request){
 const prompt=buildCodingRepairPrompt({objective,acceptanceCriteria,candidate:request.candidate,artifactDigest:request.verification.artifactDigest,failures:request.verification.failures,previouslyPassingChecks:request.verification.completedChecks.filter(x=>x!=='behavior_tests'),remainingCycles:limits.maximumCycles-request.cycle+1,remainingCostUsd:request.remainingCostUsd,verifiedLessons:[],constitutionDigest,limits,strategy:request.strategy,attemptLessons:request.attemptLessons??[],compactEdits:true});
 assert(Buffer.byteLength(prompt)<=30000&&!prompt.includes('PRIVATE_V8_INVENTORY_ORACLE'),'PROMPT_BOUNDARY');
 let value:unknown;let inputTokens=100,outputTokens=100,cost=0;
 if(mode==='scripted'){
  const file=request.candidate.files.find(f=>f.path==='src/inventory.ts')!;
  value={schemaVersion:1,baseArtifactDigest:request.verification.artifactDigest,failureFingerprint:request.verification.failures[0].fingerprint,strategy:request.strategy,changes:[{path:file.path,expectedContentDigest:sha256(file.content),edits:mutations.map(m=>({find:m.replace,replace:m.find}))}],limitations:[]};
 }else{
  const id=budget.reserve();const row:Record<string,any>={id,job:activeJob,cycle:request.cycle,model:MODEL,reasoning:'medium',startedAt:new Date().toISOString(),status:'attempted',promptDigest:sha256(prompt),reservedUsd:0.025,inputTokens:null,outputTokens:null,costEstimateUsd:null,responseId:null,responseModel:null,responseDigest:null,httpStatus:null,cfRay:null,elapsedMs:null};physical.push(row);await audit('model_attempt',row);
  const t=performance.now();let settled=false;
  try{
   const body={model:MODEL,messages:[{role:'system',content:'Return only the requested JSON repair object. Do not execute tools or reveal hidden tests.'},{role:'user',content:prompt}],temperature:0,reasoning_effort:'medium',max_completion_tokens:8000,stream:false,store:false,response_format:{type:'json_schema',json_schema:{name:'sara_repair_edits',strict:true,schema:CODING_REPAIR_EDITS_JSON_SCHEMA}}};
   const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
   row.httpStatus=response.status;row.cfRay=response.headers.get('cf-ray');const raw=await response.text();row.elapsedMs=performance.now()-t;row.responseDigest=sha256(raw);assert(Buffer.byteLength(raw)<=2000000,'RESPONSE_SIZE');
   if(!response.ok)throw Error('PROVIDER_HTTP_'+response.status);
   const envelope=JSON.parse(raw);const data=envelope.result??envelope;
   row.responseId=typeof data.id==='string'?data.id:null;row.responseModel=typeof data.model==='string'?data.model:null;
   if(row.responseModel!==MODEL&&row.responseModel!=='glm-4.7-flash')throw Error('MODEL_IDENTITY_UNKNOWN');
   inputTokens=number(data.usage?.prompt_tokens)??-1;outputTokens=number(data.usage?.completion_tokens)??-1;
   row.inputTokens=inputTokens<0?null:inputTokens;row.outputTokens=outputTokens<0?null:outputTokens;row.reasoningTokens=number(data.usage?.completion_tokens_details?.reasoning_tokens);
   if(inputTokens<0||outputTokens<0||inputTokens>32000||outputTokens>8000)throw Error('USAGE_UNKNOWN_OR_EXCEEDED');
   cost=(inputTokens*0.06+outputTokens*0.4)/1e6;row.costEstimateUsd=cost;budget.settle(id,cost);settled=true;
   const choice=data.choices?.[0];if(choice?.finish_reason!=='stop')throw Error('PROVIDER_INCOMPLETE');
   const text=choice?.message?.content;if(typeof text!=='string')throw Error('MODEL_OUTPUT_MISSING');
   await writeFile(join(out,`model-${id}-output.json`),text,{mode:0o600});value=JSON.parse(text);row.status='completed';await audit('model_receipt',row);
  }catch(error){if(!settled)budget.settle(id,null);row.status='failed';row.elapsedMs=performance.now()-t;row.failureCode=error instanceof Error&&/^(PROVIDER_HTTP_\d+|MODEL_IDENTITY_UNKNOWN|USAGE_UNKNOWN_OR_EXCEEDED|PROVIDER_INCOMPLETE|MODEL_OUTPUT_MISSING)$/.test(error.message)?error.message:'UNCLASSIFIED_PROVIDER_FAILURE';await audit('model_failure',row);throw Error(row.failureCode);}
 }
 let proposal:CodingRepairProposal;
 try{proposal=expandCodingRepairEdits({value,candidate:request.candidate,artifactDigest:request.verification.artifactDigest,failureFingerprints:new Set(request.verification.failures.map(f=>f.fingerprint)),strategy:request.strategy,limits});}catch{throw Error('MODEL_OUTPUT_CONTRACT');}
 return {proposal,inputTokens,outputTokens,accountedCostUsd:cost};
}};

type Job={id:string;arm:string;round:number;completed:boolean;elapsedMs:number;verificationMs:number;verificationTimings:Array<{stage:string;ms:number;passed:boolean}>;modelMs:number;lookupMs:number;memoryHits:number;physicalCalls:number;physicalCostEstimateUsd:number|null;failure:unknown;artifactDigest:string|null;receipts:CodingRepairReceipt[];finalVerification:ProgramVerificationResult|null;finalSource:ProgramCandidateProposal['files']|null;candidate?:ProgramCandidateProposal};
const jobs:Job[]=[];const recipe=new GuardedRepairMemory();let ordinary:ProgramCandidateProposal|null=null;let ordinaryKey:string|null=null;
const memoryKey=(c:ProgramCandidateProposal,s:Scope)=>sha256(canonicalJson({files:c.files,scope:s}));
async function verify(c:ProgramCandidateProposal){assert.deepEqual(c.files.filter(f=>f.path.startsWith('tests/')),baseline.files.filter(f=>f.path.startsWith('tests/')));return verifyGenomeLabProgramCandidate({candidate:c,objective,acceptanceCriteria,constitutionDigest});}
async function runJob(arm:string,round:number):Promise<Job>{
 activeJob=`${arm}:${round}`;const firstPhysical=physical.length;const timings:Job['verificationTimings']=[];let verificationMs=0,modelMs=0,lookupMs=0,memoryHits=0,count=0;const receipts:CodingRepairReceipt[]=[];const start=performance.now();
 const timedVerify=async(c:ProgramCandidateProposal,final=false)=>{const t=performance.now();const v=await verify(c);const ms=performance.now()-t;timings.push({stage:final?'final':count++===0?'initial':'candidate',ms,passed:v.passed});verificationMs+=ms;return v;};
 let job:Job;
 try{
  const run=await runCodingRepairController({baseline:structuredClone(baseline),limits,verify:timedVerify,onReceipt:r=>{receipts.push(structuredClone(r));},model:{async propose(request){
   const t=performance.now();let proposal:CodingRepairProposal|null=null;
   if(arm==='guarded_recipe')proposal=recipe.lookup(request.candidate,request.verification,scope,request.strategy);
   if(arm==='ordinary_memory'&&ordinary&&ordinaryKey===memoryKey(request.candidate,scope))proposal={schemaVersion:1,baseArtifactDigest:request.verification.artifactDigest,failureFingerprint:request.verification.failures[0].fingerprint,strategy:request.strategy,changes:request.candidate.files.filter(f=>f.content!==ordinary!.files.find(x=>x.path===f.path)!.content).map(f=>({path:f.path,expectedContentDigest:sha256(f.content),replacementText:ordinary!.files.find(x=>x.path===f.path)!.content})),limitations:['Exact-source artifact cache; fresh original verification required.']};
   lookupMs+=performance.now()-t;if(proposal){memoryHits++;return {proposal,inputTokens:0,outputTokens:0,accountedCostUsd:0};}
   const m=performance.now();try{return await generator.propose(request);}finally{modelMs+=performance.now()-m;}
  }}});
  const final=await timedVerify(run.champion,true);assert.equal(canonicalJson(final),canonicalJson(run.verification),'FINAL_AUDIT_MISMATCH');
  job={id:activeJob,arm,round,completed:final.passed,elapsedMs:performance.now()-start,verificationMs,verificationTimings:timings,modelMs,lookupMs,memoryHits,physicalCalls:physical.length-firstPhysical,physicalCostEstimateUsd:null,failure:null,artifactDigest:final.artifactDigest,receipts,finalVerification:final,finalSource:run.champion.files.filter(f=>f.path.startsWith('src/')),candidate:run.champion};
 }catch(error){const safe=describeBenchmarkFailure(error,'unknown');job={id:activeJob,arm,round,completed:false,elapsedMs:performance.now()-start,verificationMs,verificationTimings:timings,modelMs,lookupMs,memoryHits,physicalCalls:physical.length-firstPhysical,physicalCostEstimateUsd:null,failure:safe,artifactDigest:null,receipts,finalVerification:null,finalSource:null};}
 const paid=physical.slice(firstPhysical);job.physicalCostEstimateUsd=paid.every(r=>r.costEstimateUsd!==null)?paid.reduce((s,r)=>s+r.costEstimateUsd,0):null;
 if(memoryHits&&!job.completed){if(arm==='ordinary_memory'){ordinary=null;ordinaryKey=null;}else for(const r of recipe.snapshot())recipe.quarantine(r.id,sha256(canonicalJson({failure:job.failure,receipts})));}
 const {candidate,...publicJob}=job;await audit('job_finished',publicJob);console.log(JSON.stringify({id:job.id,completed:job.completed,elapsedMs:job.elapsedMs,physicalCalls:job.physicalCalls,memoryHits}));return job;
}

const preflightStarted=performance.now();const goodProof=await verify(reference),badProof=await verify(baseline);assert(goodProof.passed&&!badProof.passed,'INVALID_FIXTURE');const preflightMs=performance.now()-preflightStarted;
// Empty memories. The measured seed is generated, never filled from reference code.
const seed=await runJob('shared_seed',0);jobs.push(seed);
let ordinaryLearningMs=0,recipeLearningMs=0;
if(seed.completed&&seed.candidate&&seed.finalVerification){let t=performance.now();ordinary=structuredClone(seed.candidate);ordinaryKey=memoryKey(baseline,scope);await writeFile(join(out,'ordinary-memory.json'),JSON.stringify({scope,key:ordinaryKey,artifact:ordinary}),{mode:0o600});ordinaryLearningMs=performance.now()-t;
 t=performance.now();recipe.learn(baseline,seed.candidate,seed.finalVerification,scope);await writeFile(join(out,'guarded-recipes.json'),JSON.stringify({scope,recipes:recipe.snapshot()}),{mode:0o600});recipeLearningMs=performance.now()-t;
 for(let round=1;round<=rounds;round++)for(const arm of contract.armOrders[round-1])jobs.push(await runJob(arm,round));
}
const summaries=contract.arms.map(arm=>{const rows=jobs.filter(j=>j.arm===arm);const learningMs=arm==='ordinary_memory'?ordinaryLearningMs:arm==='guarded_recipe'?recipeLearningMs:0;const warmMs=rows.reduce((s,r)=>s+r.elapsedMs,0);const costs=[seed.physicalCostEstimateUsd,...rows.map(r=>r.physicalCostEstimateUsd)];return {arm,attempted:1+rows.length,completed:(seed.completed?1:0)+rows.filter(r=>r.completed).length,learningMs,seedMs:seed.elapsedMs,warmMs,pooledMs:seed.elapsedMs+learningMs+warmMs,logicalCostEstimateUsd:costs.every(c=>c!==null)?costs.reduce<number>((s,c)=>s+c!,0):null,warmMemoryHits:rows.reduce((s,r)=>s+r.memoryHits,0)};});
const control=summaries[0];const valid=mode==='live'&&physical.length>0&&physical.every(r=>r.status==='completed')&&summaries.every(s=>s.attempted===rounds+1&&s.completed===rounds+1);
const comparisons=summaries.slice(1).map(s=>({arm:s.arm,pooledSpeedRatio:valid?control.pooledMs/s.pooledMs:null,warmSpeedRatio:valid?control.warmMs/s.warmMs:null,pooledTarget1000PercentMet:valid?control.pooledMs/s.pooledMs>=11:false}));
const ordinarySummary=summaries[1],recipeSummary=summaries[2];
const publicJobs=jobs.map(({candidate,...j})=>j);
const record={schemaVersion:1,experiment:contract.experiment,evidenceLevel:mode==='live'?'LIVE_SARA_CLOUDFLARE_COMPONENT_BENCHMARK':'SCRIPTED_MODEL_REAL_SARA_VERIFIER',contractDigest,sourceCommit:process.env.GITHUB_SHA??null,sourceManifest,startedAt,finishedAt:new Date().toISOString(),environment:{node:process.version,typescript:ts.version,githubRunId:process.env.GITHUB_RUN_ID??null},preflightMs,preflight:{reference:goodProof,baseline:badProof},seedShared:true,physical,physicalCalls:physical.length,physicalCostEstimateUsd:physical.every(r=>r.costEstimateUsd!==null)?physical.reduce((s,r)=>s+r.costEstimateUsd,0):null,reservedCostUsd:budget.reserved,mode,jobs:publicJobs,summaries,comparisons,validMatchedCompletion:valid,guardedVersusOrdinaryRuntimeRatio:valid?ordinarySummary.pooledMs/recipeSummary.pooledMs:null,uniqueReparodynamicsEffectEstablished:false,unfamiliarTasksTested:0,realFamilyTransfersTested:0,syntheticInvalidationCoveredBySeparateTests:true,generalClaimSupported:false,telegram:{sent:false,reason:'Existing bot credential and authorized delivery route are not available to this runner.'},auditTail:auditPrevious};
const result={...record,digest:sha256(canonicalJson(record))};await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));
const md=['# SARA repair-reuse execution report','',`Evidence: **${record.evidenceLevel}**`,`Run: ${record.environment.githubRunId??'local'}; source: ${record.sourceCommit??'local source snapshot'}`,`Model: ${MODEL}; reasoning: medium. This is NOT the historical Luna comparison.`,`Started: ${startedAt}; finished: ${record.finishedAt}`,`Result digest: ${result.digest}`,'','## Scope','One measured shared learning task, followed by five exact repetitions per comparison arm. The actual SARA controller and original verifier are used throughout. Shared seed time/cost are fully charged to every logical arm, but physically billed only once. Fresh verification is never cached.','',`Physical model requests: ${physical.length}. Token-rate cost estimate: ${record.physicalCostEstimateUsd===null?'UNKNOWN':'$'+record.physicalCostEstimateUsd.toFixed(6)}. Conservative retained reservation: $${budget.reserved.toFixed(6)}. These are not reconciled invoices. Infrastructure costs are not measured.`,'','| Arm | Completed / attempted | Learning ms | Total ms including seed | Warm ms |','|---|---:|---:|---:|---:|',...summaries.map(s=>`| ${s.arm} | ${s.completed}/${s.attempted} | ${s.learningMs.toFixed(3)} | ${s.pooledMs.toFixed(3)} | ${s.warmMs.toFixed(3)} |`),'','## Comparison',...comparisons.map(c=>`${c.arm}: pooled ratio ${c.pooledSpeedRatio?.toFixed(4)??'INCONCLUSIVE'}; warm ratio ${c.warmSpeedRatio?.toFixed(4)??'INCONCLUSIVE'}.`),'',`Guarded recipes versus equally eligible ordinary memory: ${record.guardedVersusOrdinaryRuntimeRatio?.toFixed(4)??'INCONCLUSIVE'}. A single paired fixture cannot establish statistical superiority.`,'','## Limitations','No general 1000% result, population accuracy gain, genuinely unfamiliar coding-task gain, or cross-family transfer is established. The model differs from the historical Luna experiment. Any shared benefit of ordinary memory is not credited as a uniquely Reparodynamic contribution. Memory is retained within this execution, not installed in SARA production. Invalidations and quarantines are separately tested mechanisms, not observed changes in a client environment. All failed or quota-limited jobs remain in the record.','',`Telegram: NOT SENT. ${record.telegram.reason}`,''];
await writeFile(join(out,'SARA_execution_report.md'),md.join('\n'));console.log(JSON.stringify({experiment:contract.experiment,digest:result.digest,validMatchedCompletion:valid,physicalCalls:physical.length,comparisons}));
if(mode==='scripted')assert(summaries.every(s=>s.completed===rounds+1)&&physical.length===0,'SCRIPTED_PROOF_FAILED');
