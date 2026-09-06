import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/canonical.ts';
import { HARDENED_REUSE_BENCHMARK_GRANT as current, REUSE_SPEED_BENCHMARK_GRANT as prior,
  CURRENT_CODING_BENCHMARK_GRANT as cold, activeCodingBenchmarkContinuation, inspectCodingBenchmarkReadiness } from '../src/coding-benchmark-readiness.ts';
import { codingBenchmarkLaunchSpec } from '../src/coding-benchmark-owner.ts';
import { readCodingBenchmarkEvidence } from '../src/coding-benchmark-evidence.ts';
import { writeBenchmarkAudit } from '../src/coding-benchmark-audit.ts';
const env={SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:current.activationSha256,
  SARA_REPARODYNAMIC_CODING_MODE:'canary',SARA_OWNER_TOKEN:'offline',SARA_OWNER_TOKEN_SHA256:sha256('offline'),
  OPENAI_API_KEY:'OFFLINE_ONLY',RAILWAY_GIT_COMMIT_SHA:'a'.repeat(40)};
test('new hardening grant is separate, capped, and does not release the original hold',()=>{
  assert.equal(current.maximumSpendUsd,.15);assert.equal(current.maximumModelSpendUsdPerArm,.05);
  assert.notEqual(current.benchmarkId,prior.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation(env).benchmarkId,current.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({}).unresolvedExposureUsd,.15);
  const ready=inspectCodingBenchmarkReadiness({environment:env,constitutionVerified:true,emergencyStopped:false});
  assert(ready.ready);assert.equal(ready.historicalHold!.unresolvedExposureUsd,.15);
  assert.equal(ready.jobsPerArm,4);assert.equal(ready.persistentReuseMeasured,true);
  assert(!inspectCodingBenchmarkReadiness({environment:{...env,SARA_REPARODYNAMIC_CODING_MODE:'off'},constitutionVerified:true,emergencyStopped:false}).ready);
  assert(!inspectCodingBenchmarkReadiness({environment:env,constitutionVerified:true,emergencyStopped:true}).ready);
});
test('only the new grant selects the new pinned launcher',()=>{
  const args={stateDirectory:'/data/sara/coding-benchmark-lab',sourceRevision:'a'.repeat(40)};
  assert(codingBenchmarkLaunchSpec({...args,environment:env}).args.includes('scripts/benchmark-hardened-reuse.ts'));
  for(const [grant,path] of [[prior,'scripts/benchmark-reuse-speed.ts'],[cold,'scripts/benchmark-current-coding-evidence.ts']] as const){
    assert(codingBenchmarkLaunchSpec({...args,environment:{...env,SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:grant.activationSha256}}).args.includes(path));
  }
});
test('new export remains bounded to fixed job names and isolated from cold grant',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sara-new-export-'));
  try{
    for(const grant of [current,cold]){
      const dir=join(root,'coding-repair-benchmarks',grant.benchmarkId,'reuse-state/jobs');await mkdir(dir,{recursive:true});
      for(const name of ['optimized-0.json','optimized-4.json','secret.json'])await writeBenchmarkAudit(dir,name,{test:true});
    }
    assert.deepEqual((await readCodingBenchmarkEvidence(root,current.benchmarkId)).files.map(f=>f.path),['reuse-state/jobs/optimized-0.json']);
    assert.equal((await readCodingBenchmarkEvidence(root,cold.benchmarkId)).files.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('new launcher hardening pins exactly bind the runtime modules',async()=>{
  const text=await readFile(new URL('../scripts/benchmark-hardened-reuse.ts',import.meta.url),'utf8');
  const pins=JSON.parse(text.match(/const hardeningPins = (\{[\s\S]*?\});/)![1]) as Record<string,string>;
  assert.equal(Object.keys(pins).length,4);
  for(const [path,digest] of Object.entries(pins))assert.equal(sha256(await readFile(new URL('../'+path,import.meta.url))),digest);
  assert(text.includes('HARDENED_REUSE_BENCHMARK_GRANT as grant'));
});
