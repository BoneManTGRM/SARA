import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ts from 'typescript';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {runCodingRepairController} from '../src/coding-repair-controller.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {INITIAL_CODING_REPAIR_LIMITS} from '../src/coding-repair-policy.ts';
import {loadConstitution} from '../src/constitution.ts';
import {GuardedRepairMemory} from './guarded-repair-memory.ts';
import {baseline,objective,acceptanceCriteria} from './v8-live-fixture.ts';

// Post-hoc feasibility audit, not a new matched live-model experiment. No provider client exists here.
assert(!process.env.OPENAI_API_KEY&&!process.env.CLOUDFLARE_API_TOKEN,'credentials forbidden');
globalThis.fetch=async()=>{throw Error('AUDIT_NETWORK_FORBIDDEN');};
const out=resolve(process.env.SARA_AUDIT_OUTPUT??'captured-reuse-evidence');await mkdir(out,{recursive:true});
const original=JSON.parse(await readFile('proof/captured-v8-full.json','utf8'));
assert.equal(original.artifactDigest,'d7a7b3844887f1711c19be7e0ee4ef1cd7ef58b3dc525488fc1c032f11ae87d7');
assert.equal(original.livePayloadSha256,'7c49bf14875a7befebf0443478f18b3ae22bf8463cbf85d4731ea39bc206faaa');
const after=structuredClone(baseline);
assert.deepEqual(original.files.map(f=>f.path).sort(),['src/index.ts','src/inventory.ts']);
for(const file of original.files)after.files.find(f=>f.path===file.path).content=file.content;
const {digest:constitutionDigest}=await loadConstitution();
const boundarySource=`import assert from 'node:assert/strict';
import * as m from './inventory.mjs';
const cases=[
 ()=>m.total(null),()=>m.total({}),()=>m.add([],null),()=>m.remove([],null),
 ()=>m.add([],{sku:new String('A'),quantity:1,unitCents:1}),
 ()=>m.add([],{sku:{toString(){return 'A'}},quantity:1,unitCents:1}),
 ()=>m.remove([],[new String('A')]),()=>m.add(null,{sku:'A',quantity:1,unitCents:1}),
 ()=>m.total([{sku:'A',quantity:NaN,unitCents:1}]),
 ()=>m.total([{sku:'A',quantity:1,unitCents:1.5}])];
for(const run of cases)assert.throws(run,RangeError);
console.log('RUNTIME_BOUNDARY_10_PASS');
`;
const verifications=[];
async function verify(candidate){
 const started=performance.now();
 const result=await verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});
 let boundaryPassed=null;
 if(result.passed){
  const dir=await mkdtemp(join(tmpdir(),'sara-v8-boundary-'));
  try{
   const source=candidate.files.find(f=>f.path==='src/inventory.ts').content;
   const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
   await writeFile(join(dir,'inventory.mjs'),js);await writeFile(join(dir,'boundary.mjs'),boundarySource);
   const {stdout}=await promisify(execFile)(process.execPath,['--permission','--allow-fs-read='+dir,'--max-old-space-size=64',join(dir,'boundary.mjs')],{env:{NODE_NO_WARNINGS:'1'},timeout:5000,maxBuffer:65536});
   assert.equal(stdout.trim(),'RUNTIME_BOUNDARY_10_PASS');boundaryPassed=true;
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 verifications.push({elapsedMs:performance.now()-started,artifactDigest:result.artifactDigest,originalPassed:result.passed,boundaryPassed,completedChecks:result.completedChecks,evidenceDigests:result.evidenceDigests});
 return result;
}
const seedStart=performance.now();
const beforeVerification=await verify(baseline);assert.equal(beforeVerification.passed,false);
const seedVerification=await verify(after);assert(seedVerification.passed);assert.equal(seedVerification.artifactDigest,original.artifactDigest);
const seedReverificationMs=performance.now()-seedStart;
const scope={contract:sha256(canonicalJson({objective,acceptanceCriteria,boundarySource})),dependencies:sha256(await readFile('package-lock.json')),verifier:sha256(canonicalJson({original:sha256(await readFile('src/genome-lab-verifier.ts')),boundary:sha256(boundarySource)})),policy:sha256(canonicalJson(INITIAL_CODING_REPAIR_LIMITS))};
const memory=new GuardedRepairMemory();const learnStart=performance.now();
const recipeId=memory.learn(baseline,after,seedVerification,scope);const learningMs=performance.now()-learnStart;
const boundaryGuards=[];
for(const field of Object.keys(scope)){
 assert.equal(memory.lookup(baseline,beforeVerification,{...scope,[field]:sha256('changed')},'surgical'),null);
 boundaryGuards.push('changed '+field+' rejected');
}
const changed=structuredClone(baseline);changed.files[1].content+='\n// different source';
assert.equal(memory.lookup(changed,beforeVerification,scope,'surgical'),null);boundaryGuards.push('changed source rejected');
const rows=[];
for(let repetition=0;repetition<5;repetition++){
 const start=performance.now();const startChecks=verifications.length;let proposalRequests=0;
 const result=await runCodingRepairController({baseline:structuredClone(baseline),verify,limits:INITIAL_CODING_REPAIR_LIMITS,
  model:{async propose(request){proposalRequests++;const proposal=memory.lookup(request.candidate,request.verification,scope,request.strategy);assert(proposal,'inapplicable repair must not proceed');return {proposal,inputTokens:0,outputTokens:0,accountedCostUsd:0};}}});
 const final=await verify(result.champion);assert(final.passed);assert.equal(final.artifactDigest,original.artifactDigest);assert.equal(proposalRequests,1);assert.equal(verifications.length-startChecks,3);assert.equal(result.receipts[0].changedLines,51);
 rows.push({repetition,elapsedMs:performance.now()-start,proposalRequests,modelCalls:0,verifierCalls:3,originalAssertions:50,extraRuntimeAssertions:10,verifiedComplete:true,artifactDigest:final.artifactDigest,receipts:result.receipts});
}
memory.quarantine(recipeId,sha256('posthoc audit quarantine exercise'));
assert.equal(memory.lookup(baseline,beforeVerification,scope,'surgical'),null);boundaryGuards.push('quarantine prevents replay');
memory.learn(baseline,after,seedVerification,scope);assert.equal(memory.lookup(baseline,beforeVerification,scope,'surgical'),null);boundaryGuards.push('same evidence cannot silently unquarantine');
const times=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b);
const report={schemaVersion:1,evidenceLevel:'EXECUTED_SARA_CAPTURED_REPAIR_REUSE_NO_NEW_MODEL',sourceCommit:process.env.GITHUB_SHA??null,node:process.version,typescript:ts.version,originalLivePayloadSha256:original.livePayloadSha256,originalLiveArtifact:original.artifactDigest,seedReverificationMs,learningMs,scope,recipeId,rows,verifications,boundaryGuards,latencyMs:{minimum:times[0],median:times[2],maximum:times[4]},additionalModelCalls:0,matchedLiveSpeedRatio:null,generalClaimSupported:false,historicalSeedGenerationCostEstimateUsd:0.0022574,limitations:['Post-hoc selection of the original full-file artifact because it passed the additional runtime boundary audit.','Exact repeats only; not new tasks, family transfer or a matched model comparison.','Original model time and cost are historical and are not erased by this reuse audit.','This is an experimental in-memory component, not installed SARA production memory.','Same host and fixed order for five repeats; not a statistical dependability guarantee.','Additional runtime checks are post-hoc; original 50-assertion live benchmark remains unchanged.']};
await writeFile(join(out,'result.json'),JSON.stringify({...report,digest:sha256(canonicalJson(report))},null,2)+'\n');
await writeFile(join(out,'boundary-test.mjs'),boundarySource);
console.log(JSON.stringify({evidenceLevel:report.evidenceLevel,completed:rows.length,latencyMs:report.latencyMs,additionalModelCalls:0,matchedLiveSpeedRatio:null,guards:boundaryGuards.length,digest:sha256(canonicalJson(report))}));
