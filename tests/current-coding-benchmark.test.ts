import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJson, sha256 } from '../src/canonical.ts';
import { currentBenchmarkCase, assertCurrentImplementation, runCurrentCodingBenchmarkArm } from '../src/current-coding-benchmark.ts';
import { NativeCodingVerifier } from '../src/native-coding-verifier.ts';
import { codingRepairCandidateDigest } from '../src/experimental-v5/coding-repair-verification.ts';
import { CURRENT_CODING_BENCHMARK_GRANT as grant, POST_FIX_CODING_BENCHMARK_GRANT as old, activeCodingBenchmarkContinuation, inspectCodingBenchmarkReadiness } from '../src/coding-benchmark-readiness.ts';
import { codingBenchmarkLaunchSpec } from '../src/coding-benchmark-owner.ts';
import { readCodingBenchmarkEvidence } from '../src/coding-benchmark-evidence.ts';
import { INITIAL_CODING_REPAIR_LIMITS } from '../src/coding-repair-policy.ts';
import type { WorkerModelClient } from '../src/model-router.ts';
const ownerToken = 'offline-current-pilot';
const env = { SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: grant.activationSha256,
  SARA_REPARODYNAMIC_CODING_MODE: 'canary', SARA_OWNER_TOKEN: ownerToken, SARA_OWNER_TOKEN_SHA256: sha256(ownerToken),
  OPENAI_API_KEY: 'OFFLINE_NEVER_USED', RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40) };

test('current pilot preserves all bound deployed components', async () => { await assertCurrentImplementation(); });
test('new grant is distinct, has equal limits, and leaves both historical defaults intact', () => {
  assert.equal(activeCodingBenchmarkContinuation(env).benchmarkId, grant.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({}).unresolvedExposureUsd,.15);
  assert.equal(activeCodingBenchmarkContinuation({SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:old.activationSha256}).benchmarkId,old.benchmarkId);
  assert.notEqual(old.benchmarkId,grant.benchmarkId);assert.equal(grant.maximumSpendUsd,.15);assert.equal(grant.maximumModelSpendUsdPerArm,.075);
});
test('new pilot requires canary, current owner authority and no emergency stop', () => {
  assert(inspectCodingBenchmarkReadiness({environment:env,constitutionVerified:true,emergencyStopped:false}).ready);
  for (const environment of [{...env,SARA_REPARODYNAMIC_CODING_MODE:'off'},{...env,SARA_OWNER_TOKEN:'wrong'},{...env,OPENAI_API_KEY:''}])
    assert(!inspectCodingBenchmarkReadiness({environment,constitutionVerified:true,emergencyStopped:false}).ready);
  assert(!inspectCodingBenchmarkReadiness({environment:env,constitutionVerified:true,emergencyStopped:true}).ready);
});
test('only the newly activated grant selects the new launcher without unrelated secrets', () => {
  const spec=codingBenchmarkLaunchSpec({environment:{...env,DATABASE_URL:'no',NODE_OPTIONS:'no'},sourceRevision:'a'.repeat(40),stateDirectory:'/data/sara/coding-benchmark-lab'});
  assert(spec.args.includes('scripts/benchmark-current-coding-evidence.ts'));assert.equal(spec.environment.DATABASE_URL,undefined);assert.equal(spec.environment.NODE_OPTIONS,undefined);
  assert.equal(spec.environment.SARA_REPARODYNAMIC_CODING_MODE,'canary');
  const historical=codingBenchmarkLaunchSpec({environment:{...env,SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:old.activationSha256},sourceRevision:'a'.repeat(40),stateDirectory:'/data/sara/coding-benchmark-lab'});
  assert(historical.args.includes('scripts/benchmark-matched-coding-evidence.ts'));
});
test('evidence reader accepts only known experiment directories, including the fresh grant', async () => {
  const dir=await mkdtemp(join(tmpdir(),'current-pilot-evidence-'));
  try {assert.equal((await readCodingBenchmarkEvidence(dir,grant.benchmarkId)).status,'not_started');await assert.rejects(readCodingBenchmarkEvidence(dir,'11111111-1111-4111-8111-111111111111'));}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('experiment runner differs only by an optional explicitly recorded final verifier', async () => {
  let expected=await readFile(new URL('../src/coding-repair-benchmark-runner.ts',import.meta.url),'utf8');
  expected=expected.replace('  onEvidence?: (kind: "verification"','  verifyFinal?: (candidate: ProgramCandidateProposal) => Promise<ProgramVerificationResult>;\n  onEvidence?: (kind: "verification"');
  expected=expected.replace('    const final = await verify(outcome.candidate);',`    const final = input.verifyFinal
      ? structuredClone(await input.verifyFinal(structuredClone(outcome.candidate)))
      : await verify(outcome.candidate);
    if (input.verifyFinal) await input.onEvidence?.("verification", structuredClone({
      sequence: ++verificationSequence, phase: "legacy_final", candidate: outcome.candidate, verification: final }));`);
  assert.equal(await readFile(new URL('../src/current-coding-benchmark-runner.ts',import.meta.url),'utf8'),'// Experiment-local copy: frozen production benchmark runner is unchanged.\n'+expected);
});
const correct=`export type Booking = Readonly<{start:number;end:number}>;
export type TimeWindow = Readonly<{start:number;end:number}>;
export function freeWindows(dayStart:number, dayEnd:number, bookings:readonly Booking[]):TimeWindow[] {
  if (!Number.isFinite(dayStart)||!Number.isFinite(dayEnd)||dayStart>=dayEnd) return [];
  const busy=bookings.filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start)
    .map(b=>({start:Math.max(dayStart,b.start),end:Math.min(dayEnd,b.end)})).filter(b=>b.end>b.start)
    .sort((a,b)=>a.start-b.start||a.end-b.end);
  let cursor=dayStart; const result:TimeWindow[]=[];
  for (const b of busy) {if(b.start>cursor)result.push({start:cursor,end:b.start});cursor=Math.max(cursor,b.end);}
  if(cursor<dayEnd)result.push({start:cursor,end:dayEnd});return result;
}`;
function setup(replacement=correct){
  const benchmarkCase=currentBenchmarkCase(),prompts:string[]=[],events:any[]=[];let calls=0;
  const context={objective:benchmarkCase.objective,acceptanceCriteria:benchmarkCase.acceptanceCriteria,
    missingCapabilities:[],constitutionDigest:'a'.repeat(64),memoryContext:{contextDigest:'b'.repeat(64),memories:[]}};
  const client:WorkerModelClient={routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,
    async countInputTokens(prompt){prompts.push(prompt);assert.doesNotMatch(prompt,/clips, sorts and merges|assert\.deepEqual/);return 100;},
    async execute({prompt}){calls++;const body=JSON.parse(prompt.split('\n').slice(2).join('\n'));
      const source=body.files.find((f:any)=>f.path==='src/free-windows.ts');
      return {outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:body.currentArtifactDigest,
        failureFingerprint:body.failures[0].fingerprint,strategy:body.requiredStrategy,changes:[{path:source.path,
        expectedContentDigest:source.contentDigest,replacementText:replacement}],limitations:[]}),inputTokens:100,billableOutputTokens:80};}};
  return {benchmarkCase,context,client,prompts,events,calls:()=>calls,limits:{...INITIAL_CODING_REPAIR_LIMITS,maximumModelSpendUsd:.075},
    beforeDispatch:async()=>{},onEvidence:async(kind:string,payload:any)=>{events.push({kind,payload});}};
}
for(const method of ['luna','luna_reparodynamic'] as const) test(`offline actual-verifier pilot ${method} keeps hidden tests and two fresh legacy finals`,async()=>{
  const fixture=setup(),native=await NativeCodingVerifier.create();assert(native);
  const saved=structuredClone(fixture.benchmarkCase);
  const result=await runCurrentCodingBenchmarkArm({...fixture,method,native});
  assert(result.verifiedComplete);assert.equal(fixture.calls(),1);assert.equal(result.cycles,1);
  assert.equal(fixture.events.filter(e=>e.kind==='verification').length,4);
  assert(fixture.events.some(e=>e.payload.phase==='legacy_final'));
  assert(fixture.events.some(e=>e.payload.phase==='independent_default_TS5'));
  assert.deepEqual(fixture.benchmarkCase,saved);assert(result.accountedCostUsd!<.075);
  assert.equal(result.finalArtifactDigest,codingRepairCandidateDigest(fixture.events.at(-1).payload.candidate));
});
test('a changed protected test is rejected before any provider request',async()=>{
  const f=setup();f.benchmarkCase.baseline.files.at(-1)!.content+='\n';let checked=0;
  await assert.rejects(runCurrentCodingBenchmarkArm({...f,method:'luna',native:{verify:async()=>{checked++;throw Error('no');}}}),/TASK_DRIFT/);
  assert.equal(f.calls(),0);assert.equal(checked,0);
});
test('revoked authority rejects before compilation or model dispatch',async()=>{
  const f=setup();await assert.rejects(runCurrentCodingBenchmarkArm({...f,method:'luna',native:{verify:async()=>{throw Error('no');}},beforeDispatch:async()=>{throw Error('EMERGENCY_STOP');}}),/EMERGENCY_STOP/);assert.equal(f.calls(),0);
});
test('a provisional native PASS cannot return a type-invalid program',async()=>{
  const f=setup('export function freeWindows(): number { return "invalid"; }');
  const native=await NativeCodingVerifier.create();assert(native);let n=0;
  const testNative={verify:async (...args:Parameters<NativeCodingVerifier['verify']>)=>{
    n++;if(n===1)return native.verify(...args);return {passed:true,score:1,artifactDigest:codingRepairCandidateDigest(args[0].candidate),failures:[],
      completedChecks:['source_policy','syntax','typecheck','behavior_tests','artifact_integrity'] as any,evidenceDigests:['a'.repeat(64)]};}};
  const result=await runCurrentCodingBenchmarkArm({...f,method:'luna_reparodynamic',native:testNative});
  assert.equal(result.verifiedComplete,false);assert.equal(f.calls(),1);
});
