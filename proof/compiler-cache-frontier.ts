import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as ts from 'typescript';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {ExperimentalCompilerCache} from '../src/experimental-compiler-cache.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {runCodingRepairController} from '../src/coding-repair-controller.ts';
import {INITIAL_CODING_REPAIR_LIMITS} from '../src/coding-repair-policy.ts';
import {GuardedRepairMemory,type Scope} from './guarded-repair-memory.ts';
import {baseline as inventory,objective,acceptanceCriteria} from './v8-live-fixture.ts';
import {compilerFixtures} from './compiler-cache-fixtures.ts';
import type {ProgramCandidateProposal} from '../src/types.ts';

// Actual compiler/controller/runtime work. No new model calls or verdict caching.
assert(!process.env.OPENAI_API_KEY&&!process.env.CLOUDFLARE_API_TOKEN,'provider credentials forbidden');
globalThis.fetch=async()=>{throw Error('RESEARCH_NETWORK_FORBIDDEN');};
const output=resolve(process.env.SARA_FRONTIER_OUTPUT??'compiler-frontier-evidence');await mkdir(output,{recursive:true});
const context={objective,acceptanceCriteria,constitutionDigest:'a'.repeat(64)};
const start=new Date().toISOString();
const paired: Array<Record<string,any>>=[];const cache=new ExperimentalCompilerCache();let sequence=0;
const emit=async(row:Record<string,unknown>)=>{await writeFile(join(output,'events.ndjson'),JSON.stringify({sequence:++sequence,...row})+'\n',{flag:'a'});};
for(const fixture of compilerFixtures){
 const tests='import {run} from "../src/index.ts";\nimport {deepStrictEqual as eq} from "node:assert/strict";\n'+fixture.assertions.join('\n')+'\n';
 for(const variant of ['broken','correct'] as const){
  const candidate:ProgramCandidateProposal={schemaVersion:1,candidateKind:'typescript_program',programName:fixture.id.replaceAll('-',' '),summary:'Verifier parity only',limitations:[],files:[{path:'src/index.ts',content:'export {run} from "./value.ts";\n'},{path:'src/value.ts',content:variant==='broken'?fixture.source:fixture.source.replace(fixture.find,fixture.correct)},{path:'tests/value.test.ts',content:tests}]};
  const results:Record<string,any>={};const order=paired.length%2?['cached','ordinary']:['ordinary','cached'];
  for(const mode of order){const t=performance.now();const result=await verifyGenomeLabProgramCandidate({candidate,objective:fixture.objective,acceptanceCriteria:[fixture.objective],constitutionDigest:context.constitutionDigest,...(mode==='cached'?{experimentalCompilerCache:cache}:{})});results[mode]={elapsedMs:performance.now()-t,result};assert.equal(result.passed,variant==='correct');await emit({kind:'verifier',fixture:fixture.id,variant,mode,...results[mode]});}
  assert.deepEqual(results.cached.result,results.ordinary.result);paired.push({fixture:fixture.id,variant,order,...results});
 }
}
const captured=JSON.parse(await readFile('proof/captured/v8-full.json','utf8'));
const reference=structuredClone(inventory);for(const f of captured.files)reference.files.find(x=>x.path===f.path)!.content=f.content;
const boundary=await readFile('proof/captured/v8-boundary.mjs','utf8');
async function boundaryCheck(candidate:ProgramCandidateProposal){
 const dir=await mkdtemp(join(tmpdir(),'sara-boundary-check-'));try{
  const code=ts.transpileModule(candidate.files.find(f=>f.path==='src/inventory.ts')!.content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  await writeFile(join(dir,'inventory.mjs'),code);await writeFile(join(dir,'boundary.mjs'),boundary);
  await promisify(execFile)(process.execPath,['--permission','--allow-fs-read='+dir,'--max-old-space-size=64',join(dir,'boundary.mjs')],{env:{NODE_NO_WARNINGS:'1'},timeout:5000,maxBuffer:65536});
 }finally{await rm(dir,{recursive:true,force:true});}
}
const scopes:Scope={contract:sha256(canonicalJson({objective,acceptanceCriteria,boundary})),dependencies:sha256(await readFile('package-lock.json')),verifier:sha256(await readFile('src/genome-lab-verifier.ts')),policy:sha256(canonicalJson(INITIAL_CODING_REPAIR_LIMITS))};
// Separate unprimed cache for repair batches, retaining learning/warm-up cost.
const repairCache=new ExperimentalCompilerCache();const memories={ordinary:new GuardedRepairMemory(),cached:new GuardedRepairMemory()};
const learning:Record<string,any>={};
for(const mode of ['ordinary','cached'] as const){const t=performance.now();const v=await verifyGenomeLabProgramCandidate({...context,candidate:reference,...(mode==='cached'?{experimentalCompilerCache:repairCache}:{})});assert(v.passed);assert.equal(v.artifactDigest,captured.artifactDigest);await boundaryCheck(reference);memories[mode].learn(inventory,reference,v,scopes);learning[mode]={elapsedMs:performance.now()-t,verification:v};}
const repairs:Array<Record<string,any>>=[];
for(let repetition=0;repetition<6;repetition++){
 const pair:Record<string,any>={repetition,order:repetition%2?['cached','ordinary']:['ordinary','cached']};
 for(const mode of pair.order as Array<'ordinary'|'cached'>){let verifications=0,proposals=0;const t=performance.now();const verify=async(candidate:ProgramCandidateProposal)=>{verifications++;const v=await verifyGenomeLabProgramCandidate({...context,candidate,...(mode==='cached'?{experimentalCompilerCache:repairCache}:{})});if(v.passed)await boundaryCheck(candidate);return v;};
 const run=await runCodingRepairController({baseline:structuredClone(inventory),verify,limits:INITIAL_CODING_REPAIR_LIMITS,model:{async propose(request){proposals++;const proposal=memories[mode].lookup(request.candidate,request.verification,scopes,request.strategy);assert(proposal);return {proposal,inputTokens:0,outputTokens:0,accountedCostUsd:0};}}});
 const final=await verify(run.champion);assert(final.passed);assert.equal(final.artifactDigest,captured.artifactDigest);assert.equal(verifications,3);assert.equal(proposals,1);
 pair[mode]={elapsedMs:performance.now()-t,verifications,proposals,modelCalls:0,result:final,receipts:run.receipts};await emit({kind:'guarded_repair',repetition,mode,...pair[mode]});
 }
 assert.deepEqual(pair.cached.result,pair.ordinary.result);repairs.push(pair);
}
function summarize(pairs:Array<Record<string,any>>){const a=pairs.map(p=>p.ordinary.elapsedMs),b=pairs.map(p=>p.cached.elapsedMs);const sorted=(x:number[])=>[...x].sort((a,b)=>a-b);const median=(x:number[])=>{const s=sorted(x),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};return {pairs:pairs.length,ordinaryMedianMs:median(a),cachedMedianMs:median(b),ordinaryTotalMs:a.reduce((x,y)=>x+y,0),cachedTotalMs:b.reduce((x,y)=>x+y,0),pooledSpeedup:a.reduce((x,y)=>x+y,0)/b.reduce((x,y)=>x+y,0),minimumPairedSpeedup:Math.min(...pairs.map(p=>p.ordinary.elapsedMs/p.cached.elapsedMs)),cachedMaxMs:Math.max(...b)};}
const record={schemaVersion:1,evidenceLevel:'MATCHED_EXECUTED_SARA_COMPILER_AND_REPAIR_NOT_LIVE_MODEL',sourceCommit:process.env.GITHUB_SHA??null,start,finish:new Date().toISOString(),node:process.version,typescript:ts.version,localLoader:process.env.SARA_LOCAL_LOADER??null,sourceHashes:Object.fromEntries(await Promise.all(['src/experimental-compiler-cache.ts','src/genome-lab.ts','src/genome-lab-verifier.ts','src/coding-repair-controller.ts','proof/guarded-repair-memory.ts','proof/compiler-cache-frontier.ts','package-lock.json'].map(async p=>[p,sha256(await readFile(p))]))),paired,repairs,learning,verifierSummary:summarize(paired),repairSummary:summarize(repairs),cache:cache.snapshot(),repairCache:repairCache.snapshot(),providerCalls:0,newModelCostUsd:0,generalClaimSupported:false,limitations:['Synthetic verifier fixtures and exact-repeat captured repair only.','Six repeated repair pairs are not six distinct software tasks.','Cold learning/warm-up charged separately as well as pooled batches.','Ordinary-memory control has the identical guarded recipe and eligibility.','Neither arm makes a new model request; no new general coding or model speedup.','Cache retains parsed external declarations only, not test results.','Local non-locked toolchain disclosed; locked CI is separate release evidence.']};
await writeFile(join(output,'results.json'),JSON.stringify({...record,evidenceDigest:sha256(canonicalJson(record))},null,2));
console.log(JSON.stringify({verifier:record.verifierSummary,repair:record.repairSummary,learning,cache:record.cache,providerCalls:0}));
