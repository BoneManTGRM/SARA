import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { canonicalJson, sha256 } from '../src/canonical.ts';
import { runCodingRepairController, type CodingRepairModel } from '../src/coding-repair-controller.ts';
import { INITIAL_CODING_REPAIR_LIMITS } from '../src/coding-repair-policy.ts';
import { createLunaCodingRepairModel } from '../src/luna-coding-repair-model.ts';
import { OpenAIResponsesClient } from '../src/openai-worker.ts';
import { verifyGenomeLabProgramCandidate } from '../src/genome-lab-verifier.ts';
import { loadConstitution } from '../src/constitution.ts';
import type { ProgramCandidateProposal } from '../src/types.ts';
import type { WorkerModelClient } from '../src/model-router.ts';

const SOURCE = 'd9a5ef84aa44b809fc8af87a027c5ad3eb059000';
const LIMIT = 0.15;
const CASE = 'integer-interval-operations-v6-live-01';
const objective = 'Repair the inclusive integer interval module while preserving all exported APIs and correct behavior.';
const acceptanceCriteria = [
  'Intervals have integer start and end in [-1000000,1000000], start <= end. Invalid endpoints must throw RangeError.',
  'normalize returns a new ascending list of the union, merging overlaps and adjacent integer intervals. Never mutate any caller input.',
  'intersect returns the normalized intersection of two interval lists, including one-point intersections.',
  'subtract returns the normalized integer set difference of its first list minus the second. Preserve endpoints and one-point remnants.',
  'measure returns the number of distinct covered integers, not continuous length. Empty lists have measure zero.',
  'Every exported operation validates all supplied intervals, including the second operand when the first operand is empty.',
  'Retain the existing two source modules. No external imports, dynamic code, clocks, networking, filesystem, or computed property access. Use for-of, objects, or array methods rather than indexed array access.',
];
const good = `export type Interval = { start: number; end: number };
function validate(span: Interval): void {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) ||
      span.start < -1000000 || span.end > 1000000 || span.start > span.end) {
    throw new RangeError("invalid interval");
  }
}
export function normalize(input: readonly Interval[]): Interval[] {
  input.forEach(validate);
  const sorted = input.map(span => ({ start: span.start, end: span.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  let active: Interval | undefined;
  for (const span of sorted) {
    if (active && span.start <= active.end + 1) {
      active.end = Math.max(active.end, span.end);
    } else {
      active = { start: span.start, end: span.end };
      out.push(active);
    }
  }
  return out;
}
export function intersect(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const a = normalize(left);
  const b = normalize(right);
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (start <= end) out.push({ start, end });
    }
  }
  return normalize(out);
}
export function subtract(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  let remaining = normalize(left);
  const removals = normalize(right);
  for (const cut of removals) {
    const next: Interval[] = [];
    for (const span of remaining) {
      if (cut.end < span.start || cut.start > span.end) {
        next.push(span);
      } else {
        if (span.start < cut.start) next.push({ start: span.start, end: cut.start - 1 });
        if (cut.end < span.end) next.push({ start: cut.end + 1, end: span.end });
      }
    }
    remaining = next;
  }
  return normalize(remaining);
}
export function measure(input: readonly Interval[]): number {
  return normalize(input).reduce((sum, span) => sum + span.end - span.start + 1, 0);
}
`;
const edits = [
  {find:'a.start - b.start || a.end - b.end',replace:'a.end - b.end || a.start - b.start'},
  {find:'span.start <= active.end + 1',replace:'span.start < active.end'},
  {find:'if (start <= end)',replace:'if (start < end)'},
  {find:'end: cut.start - 1',replace:'end: cut.start'},
  {find:'start: cut.end + 1',replace:'start: cut.end'},
  {find:'span.end - span.start + 1',replace:'span.end - span.start'},
];
const broken = edits.reduce((source, edit) => source.replace(edit.find, edit.replace), good);
// Oracle enumerates integer membership; it does not copy the module's interval sweep algorithm.
function points(spans: Array<{start:number;end:number}>): Set<number> {
  const out = new Set<number>();
  for (const span of spans) for (let x=span.start; x<=span.end; x++) out.add(x);
  return out;
}
function spans(values: Set<number>): Array<{start:number;end:number}> {
  const starts = [...values].filter(x => !values.has(x-1)).sort((a,b)=>a-b);
  return starts.map(start => { let end=start; while(values.has(end+1)) end++; return {start,end}; });
}
const vectors = [
  {a:[],b:[]}, {a:[{start:1,end:1}],b:[]},
  {a:[{start:5,end:6},{start:1,end:10}],b:[{start:2,end:3}]},
  {a:[{start:-3,end:2},{start:3,end:4}],b:[{start:0,end:0}]},
  {a:[{start:1,end:3}],b:[{start:3,end:5}]},
  {a:[{start:1,end:10}],b:[{start:2,end:3},{start:5,end:6},{start:8,end:9}]},
  {a:[{start:-9,end:-3},{start:4,end:7}],b:[{start:-7,end:5}]},
  {a:[{start:4,end:4},{start:2,end:2},{start:3,end:3}],b:[{start:2,end:4}]},
];
let checks = 'import { normalize, intersect, subtract, measure } from "../src/index.ts";\nimport { deepStrictEqual as eq, strictEqual as same, throws } from "node:assert/strict";\n';
for(const {a,b} of vectors) {
  const pa=points(a),pb=points(b);
  checks+=`eq(normalize(${JSON.stringify(a)}),${JSON.stringify(spans(pa))});\n`;
  checks+=`eq(intersect(${JSON.stringify(a)},${JSON.stringify(b)}),${JSON.stringify(spans(new Set([...pa].filter(x=>pb.has(x)))))});\n`;
  checks+=`eq(subtract(${JSON.stringify(a)},${JSON.stringify(b)}),${JSON.stringify(spans(new Set([...pa].filter(x=>!pb.has(x)))))});\n`;
  checks+=`same(measure(${JSON.stringify(a)}),${pa.size});\n`;
}
checks+='const caller = [{start:5,end:6},{start:1,end:10}];\nnormalize(caller); intersect(caller,[]); subtract(caller,[]); measure(caller);\neq(caller,[{start:5,end:6},{start:1,end:10}]);\n';
for(const invalid of ['{start:2,end:1}','{start:0.5,end:2}','{start:0,end:Infinity}','{start:NaN,end:1}','{start:-1000001,end:0}','{start:0,end:1000001}']) {
  for(const expr of [`normalize([${invalid}])`,`measure([${invalid}])`,`intersect([], [${invalid}])`,`subtract([], [${invalid}])`]) checks+=`throws(()=>${expr},RangeError);\n`;
}
const baseline: ProgramCandidateProposal = {schemaVersion:1,candidateKind:'typescript_program',programName:'Integer interval operations',summary:'Frozen coding comparison fixture',limitations:[],files:[
  {path:'src/index.ts',content:'export { normalize, intersect, subtract, measure } from "./intervals.ts";\n'},
  {path:'src/intervals.ts',content:broken},
  {path:'tests/intervals.test.ts',content:checks},
]};
const reference=structuredClone(baseline); reference.files[1].content=good;
const {digest:constitutionDigest}=await loadConstitution();
const context={objective,acceptanceCriteria,constitutionDigest,missingCapabilities:[],memoryContext:{contextDigest:sha256('[]'),memories:[]}};
const authority={...INITIAL_CODING_REPAIR_LIMITS,physicalMaximumSpendUsd:LIMIT,maximumPhysicalCalls:5,repositoryMutation:false,merge:false,deploy:false,promotion:false};
const contract={schemaVersion:1,caseId:CASE,sourceCommit:SOURCE,model:'gpt-5.6-luna',reasoning:'medium',baselineDigest:sha256(canonicalJson(baseline)),referenceDigest:sha256(canonicalJson(reference)),objective,acceptanceCriteria,oracle:'independent_integer_membership_enumeration',hiddenAssertionCount:57,sharedFirstProposal:true,armOrder:['full_replacement','compact_continuations'],treatment:'compactRepairContinuations_only',authority,firstCallTiesRetained:true,measure:'baseline_verification_to_independent_final_verification_including_model_accounting_round_trips',pricing:{inputPerMillion:0.20,cachedInputPerMillion:0.02,outputPerMillion:1.20,conservativeInputPerMillion:0.25},generalClaimSupported:false};
const contractDigest=sha256(canonicalJson(contract));
function emit(type:string, payload:unknown) { console.log(JSON.stringify({type,payload})); }
const verify=async(candidate:ProgramCandidateProposal)=>{
  assert.equal(candidate.files.find(f=>f.path.startsWith('tests/'))?.content,checks,'protected verifier changed');
  return verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});
};
const preflight={reference:await verify(reference),baseline:await verify(baseline)};
assert(preflight.reference.passed,'independent reference failed');
assert(!preflight.baseline.passed,'baseline unexpectedly solved');
const sourceManifest=JSON.parse(await readFile('proof/live-v6-source-manifest.json','utf8')) as Record<string,string>;
for(const [path,digest] of Object.entries(sourceManifest)) assert.equal(sha256(await readFile(path)),digest,`frozen source mismatch ${path}`);
emit('PREFLIGHT',{contractDigest,sourceCommit:SOURCE,referencePassed:true,baselinePassed:false,baselineScore:preflight.baseline.score});
const selfTest=process.argv.includes('--self-test');
if(!selfTest && !process.argv.includes('--live')) process.exit(0);
if(!selfTest) {
  assert(process.argv.includes('--acknowledge-max-spend-usd=0.15'),'missing spend acknowledgement');
  assert.equal(process.env.SARA_BENCHMARK_COMMIT_SHA,SOURCE,'runtime source pin missing');
  assert(process.env.OPENAI_API_KEY?.trim(),'provider credential missing');
}
const physical:Array<Record<string,any>>=[];
let spentUpper=0,activeArm='full_replacement',currentCycle=0;
const rawFetch=globalThis.fetch;
const observedFetch:typeof fetch=async(url,init)=>{
  const target=String(url); assert(['https://api.openai.com/v1/responses','https://api.openai.com/v1/responses/input_tokens'].includes(target));
  const body=JSON.parse(String(init?.body)); assert.equal(body.model,'gpt-5.6-luna');
  const generation=target.endsWith('/responses');
  let receipt:Record<string,any>|undefined;
  if(generation) {
    assert(physical.length<5,'physical call ceiling'); assert.equal(body.store,false); assert.equal(body.reasoning.effort,'medium'); assert(body.max_output_tokens<=8000);
    const reserve=(30000*0.25+body.max_output_tokens*1.2)/1e6;
    assert(spentUpper+reserve<=LIMIT,'physical reservation ceiling'); spentUpper+=reserve;
    receipt={id:physical.length+1,arm:activeArm,cycle:currentCycle,reservedUsd:reserve,inputTokens:null,outputTokens:null,costUsd:null,upperBoundUsd:reserve,promptDigest:sha256(body.input),status:'attempted'};
    physical.push(receipt); emit('MODEL_ATTEMPT',{id:receipt.id,arm:activeArm,cycle:currentCycle,reservedUsd:reserve});
  }
  const start=performance.now();
  try {
    const response=await rawFetch(url,init);
    if(receipt) {
      receipt.httpStatus=response.status; receipt.httpMilliseconds=performance.now()-start;
      const result=await response.clone().json() as any;
      receipt.responseModel=result.model??null;
      if(result.model && !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(result.model)) throw new Error('provider model mismatch');
      const usage=result.usage;
      if(usage&&Number.isSafeInteger(usage.input_tokens)&&Number.isSafeInteger(usage.output_tokens)&&usage.input_tokens>=0&&usage.output_tokens>=0) {
        receipt.inputTokens=usage.input_tokens; receipt.outputTokens=usage.output_tokens; receipt.cachedInputTokens=usage.input_tokens_details?.cached_tokens??null;
        receipt.reasoningTokens=usage.output_tokens_details?.reasoning_tokens??null;
        receipt.costUsd=(usage.input_tokens*0.20+usage.output_tokens*1.20)/1e6;
        receipt.upperBoundUsd=(usage.input_tokens*0.25+usage.output_tokens*1.20)/1e6;
        spentUpper+=receipt.upperBoundUsd-receipt.reservedUsd;
      }
      receipt.status=result.status??'http_error';
      receipt.responseDigest=sha256(canonicalJson(result));
      emit('MODEL_RECEIPT',receipt);
    }
    return response;
  } catch(error) { if(receipt){receipt.status='unresolved_failure'; receipt.httpMilliseconds=performance.now()-start;emit('MODEL_FAILURE',receipt);} throw error; }
};
function modelClient():WorkerModelClient {
  if(!selfTest) return new OpenAIResponsesClient({apiKey:process.env.OPENAI_API_KEY!,fetchImpl:observedFetch,timeoutMs:120000});
  return {routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,
    async countInputTokens(){return 100;},
    async execute(input){
      const facts=JSON.parse(input.prompt.split('\n').slice(2).join('\n'));
      const compact=input.prompt.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');
      const current=facts.files.find((f:any)=>f.path==='src/intervals.ts');
      const change=compact?{edits:edits.map(e=>({find:e.replace,replace:e.find}))}:{replacementText:currentCycle===1?broken:good};
      return {outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,strategy:facts.requiredStrategy,changes:[{path:current.path,expectedContentDigest:current.contentDigest,...change}],limitations:[]}),inputTokens:100,billableOutputTokens:100};
    },
  };
}
let shared:Awaited<ReturnType<CodingRepairModel['propose']>>|undefined,sharedMs=0,firstInputDigest='';
const arms:Array<any>=[];
for(const compact of [false,true]) {
  activeArm=compact?'compact_continuations':'full_replacement';
  const start=performance.now(); let verificationMs=0,replayMs=0,modelMs=0;
  const adapter=createLunaCodingRepairModel({client:modelClient(),context,compactRepairContinuations:compact});
  const requests:any[]=[];
  const timedVerify=async(c:ProgramCandidateProposal)=>{const t=performance.now();try{return await verify(c);}finally{verificationMs+=performance.now()-t;}};
  try {
    const run=await runCodingRepairController({baseline,limits:INITIAL_CODING_REPAIR_LIMITS,verify:timedVerify,model:{
      async propose(request) {
        currentCycle=request.cycle; const t=performance.now();
        const inputDigest=sha256(canonicalJson(request));
        if(request.cycle===1 && compact) {
          assert(shared,'no shared proposal'); assert.equal(inputDigest,firstInputDigest,'first request differs');
          const output=structuredClone(shared);replayMs+=performance.now()-t;requests.push({cycle:1,sharedReplay:true,inputDigest,proposalDigest:sha256(canonicalJson(output.proposal))});return output;
        }
        if(request.cycle===1) firstInputDigest=inputDigest;
        const output=await adapter.propose({...request,remainingCostUsd:Math.min(request.remainingCostUsd,0.03)});
        const elapsed=performance.now()-t;modelMs+=elapsed;
        if(request.cycle===1){shared=structuredClone(output);sharedMs=elapsed;}
        requests.push({cycle:request.cycle,sharedReplay:false,inputDigest,proposalDigest:sha256(canonicalJson(output.proposal)),elapsedMilliseconds:elapsed});return output;
      },
    }});
    const post=await timedVerify(run.champion);
    assert.equal(canonicalJson(post),canonicalJson(run.verification),'independent verification disagrees');
    const elapsed=performance.now()-start+(compact?sharedMs-replayMs:0);
    arms.push({arm:activeArm,verifiedComplete:post.passed,score:post.score,activeExecutionMilliseconds:elapsed,modelMilliseconds:modelMs+(compact?sharedMs:0),verificationMilliseconds:verificationMs,logicalModelCalls:requests.length,inputTokens:run.receipts.reduce((s,r)=>s+r.inputTokens,0),outputTokens:run.receipts.reduce((s,r)=>s+r.outputTokens,0),accountedCostUsd:run.accountedCostUsd,artifactDigest:post.artifactDigest,receipts:run.receipts,requests,state:run.state,finalSource:run.champion.files.filter(f=>f.path.startsWith('src/')),error:null});
  } catch(error) { arms.push({arm:activeArm,verifiedComplete:false,score:null,activeExecutionMilliseconds:performance.now()-start+(compact?sharedMs-replayMs:0),error:error instanceof Error?error.name:'Error',requests}); }
  emit('ARM_COMPLETE',{arm:activeArm,verifiedComplete:arms.at(-1).verifiedComplete,score:arms.at(-1).score});
  if(!shared) break;
}
const [control,canary]=arms;
const valid=arms.length===2 && arms.every(a=>!a.error) && new Set(physical.map(r=>r.responseModel).filter(Boolean)).size<=1;
const both=valid&&control.verifiedComplete&&canary.verifiedComplete;
const treatmentExercised=!!canary&&canary.requests.some((r:any)=>r.cycle>1);
const ratio=both?control.activeExecutionMilliseconds/canary.activeExecutionMilliseconds:null;
const classification=!valid?'INVALID_OR_INCOMPLETE':!treatmentExercised?'SHARED_FIRST_COMPLETION_TIE':both?'VALID_COMPLETED_PAIR':'VALID_UNCOMPLETED_PAIR';
const record={contract,contractDigest,sourceCommit:SOURCE,evidenceLevel:selfTest?'SCRIPTED_HARNESS_SELF_TEST':'LIVE_SINGLE_MATCHED_V6_TRANSPORT',classification,valid,treatmentExercised,arms,physical,physicalModelCalls:physical.length,physicalCostUsd:physical.every(r=>r.costUsd!==null)?physical.reduce((s,r)=>s+r.costUsd,0):null,physicalConservativeUpperBoundUsd:spentUpper,accountingBasis:'standard_uncached_token_estimate_with_1.25x_input_upper_bound_not_invoice',timeComparable:both,speedRatio:ratio,speedIncreasePercent:ratio===null?null:(ratio-1)*100,accuracyPreservedOnFixture:both,costNotHigher:both?canary.accountedCostUsd<=control.accountedCostUsd:null,target200PercentMet:both&&treatmentExercised&&ratio!>=3&&canary.accountedCostUsd<=control.accountedCostUsd,generalClaimSupported:false,environment:{node:process.version,platform:process.platform,arch:process.arch}};
if(selfTest){assert(valid);assert(both);assert(treatmentExercised);assert.equal(control.artifactDigest,canary.artifactDigest);assert.equal(physical.length,0);}
const text=JSON.stringify(record);await writeFile('/tmp/sara-v6-comparison-result.json',text+'\n');
const compressed=gzipSync(text).toString('base64');
emit('RESULT_META',{sha256:sha256(text),encoding:'gzip+base64',chunks:Math.ceil(compressed.length/2000),classification});
for(let offset=0;offset<compressed.length;offset+=2000) emit('RESULT_CHUNK',{index:offset/2000,data:compressed.slice(offset,offset+2000)});
if(!valid) process.exitCode=1;
