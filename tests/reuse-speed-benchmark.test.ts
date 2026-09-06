import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { createReuseSpeedBudget, runReuseSpeedBenchmark, REUSE_SPEED_PROTOCOL } from "../src/reuse-speed-benchmark.ts";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
import { CURRENT_CODING_BENCHMARK_GRANT as previous, REUSE_SPEED_BENCHMARK_GRANT as grant,
  activeCodingBenchmarkContinuation, inspectCodingBenchmarkReadiness } from "../src/coding-benchmark-readiness.ts";
import { codingBenchmarkLaunchSpec } from "../src/coding-benchmark-owner.ts";
import { readCodingBenchmarkEvidence } from "../src/coding-benchmark-evidence.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
const init = () => ({ method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({
  model:"gpt-5.6-luna",input:"test",store:false,max_output_tokens:8000,reasoning:{effort:"medium"} }) });
const response = (i=30000,o=8000) => new Response(JSON.stringify({status:"completed",model:"gpt-5.6-luna",usage:{input_tokens:i,output_tokens:o},output:[]}));
const env={SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:grant.activationSha256,SARA_REPARODYNAMIC_CODING_MODE:"canary",
  SARA_OWNER_TOKEN:"offline-only",SARA_OWNER_TOKEN_SHA256:sha256("offline-only"),OPENAI_API_KEY:"OFFLINE",RAILWAY_GIT_COMMIT_SHA:"a".repeat(40)};
test("maximum reuse pilot has a fresh grant and preserves historical grants",()=>{
  assert.equal(activeCodingBenchmarkContinuation(env).benchmarkId,grant.benchmarkId);
  assert.notEqual(grant.benchmarkId,previous.benchmarkId);assert.equal(grant.maximumSpendUsd,.15);assert.equal(grant.maximumModelSpendUsdPerArm,.05);
  assert.equal(activeCodingBenchmarkContinuation({}).unresolvedExposureUsd,.15);
  assert.equal(activeCodingBenchmarkContinuation({...env,SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:previous.activationSha256}).benchmarkId,previous.benchmarkId);
  assert.equal(REUSE_SPEED_PROTOCOL.rounds,4);
});
test("new readiness and launcher use exact three-arm scope without changing old launcher",()=>{
  const ready=inspectCodingBenchmarkReadiness({environment:env,constitutionVerified:true,emergencyStopped:false});
  assert(ready.ready);assert.equal(ready.maximumModelSpendUsdPerArm,.05);assert.equal(ready.persistentReuseMeasured,true);
  assert(!inspectCodingBenchmarkReadiness({environment:{...env,SARA_REPARODYNAMIC_CODING_MODE:"off"},constitutionVerified:true,emergencyStopped:false}).ready);
  const args={sourceRevision:"a".repeat(40),stateDirectory:"/data/sara/coding-benchmark-lab"};
  const spec=codingBenchmarkLaunchSpec({...args,environment:env});assert(spec.args.includes("scripts/benchmark-reuse-speed.ts"));assert(spec.args.includes("0.05"));
  assert.equal(spec.environment.SARA_REPARODYNAMIC_CODING_MODE,"canary");
  assert(codingBenchmarkLaunchSpec({...args,environment:{...env,SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256:previous.activationSha256}}).args.includes("scripts/benchmark-current-coding-evidence.ts"));
});
test("fresh arm caps stop before a fourth worst-case request; all three remain within total",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"reuse-cap-"));let calls=0;
  try{const b=createReuseSpeedBudget({directory:dir,beforeDispatch:async()=>{},fetchImpl:async()=>{calls++;return response();}});
    for(const arm of ["regenerate","ordinary_memory","optimized"] as const){const f=b.fetchFor(arm);
      for(let i=0;i<3;i++)await f("https://api.openai.com/v1/responses",init());
      await assert.rejects(f("https://api.openai.com/v1/responses",init()),/BUDGET_EXHAUSTED/);
    }assert.equal(calls,9);assert.equal(b.snapshot().estimatedTotalUsd,.1404);assert.equal(b.snapshot().unresolvedReservedUsd,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
for(const failure of ["network","bad_usage","incomplete"]){test(`uncertain ${failure} retains charge reservation and prevents every later request`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),"reuse-uncertain-"));let calls=0;
  try{const b=createReuseSpeedBudget({directory:dir,beforeDispatch:async()=>{},fetchImpl:async()=>{
    calls++;if(failure==="network")throw Error("network failed");if(failure==="bad_usage")return response(30001,1);
    return new Response(JSON.stringify({status:"incomplete",usage:{input_tokens:1,output_tokens:1}}));
  }});await assert.rejects(b.fetchFor("regenerate")("https://api.openai.com/v1/responses",init()));
  await assert.rejects(b.fetchFor("optimized")("https://api.openai.com/v1/responses",init()),/CLOSED/);
  assert.equal(calls,1);assert.equal(b.snapshot().unresolvedReservedUsd,.0156);assert(b.snapshot().closed);
  }finally{await rm(dir,{recursive:true,force:true});}
});}
test("authority revoked after reservation produces zero dispatches and no retry",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"reuse-revoked-"));let checks=0,calls=0;
  try{const b=createReuseSpeedBudget({directory:dir,beforeDispatch:async()=>{if(++checks===2)throw Error("stop");},fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(b.fetchFor("optimized")("https://api.openai.com/v1/responses",init()),/stop/);assert.equal(calls,0);assert(b.snapshot().closed);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("concurrent budget attempts cannot race the reservation",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"reuse-race-"));let release!:()=>void;const pending=new Promise<void>(r=>{release=r;});let calls=0;
  try{const b=createReuseSpeedBudget({directory:dir,beforeDispatch:async()=>{await pending;},fetchImpl:async()=>{calls++;return response();}});
  const first=b.fetchFor("regenerate")("https://api.openai.com/v1/responses",init());
  await assert.rejects(b.fetchFor("optimized")("https://api.openai.com/v1/responses",init()),/BUSY/);release();await first;assert.equal(calls,1);
  }finally{release?.();await rm(dir,{recursive:true,force:true});}
});
test("new evidence reader exports only the exact reuse grant's bounded job files",async()=>{
  const root=await mkdtemp(join(tmpdir(),"reuse-export-"));
  try{for(const id of [grant.benchmarkId,previous.benchmarkId]){
    const dir=join(root,"coding-repair-benchmarks",id,"reuse-state/jobs");await mkdir(dir,{recursive:true});
    await writeBenchmarkAudit(dir,"optimized-0.json",{approved:true});await writeBenchmarkAudit(dir,"secret.json",{neverExport:true});
  }
  const read=await readCodingBenchmarkEvidence(root,grant.benchmarkId);assert.equal(read.files.length,1);assert(read.files[0].path.endsWith("optimized-0.json"));
  assert.equal((await readCodingBenchmarkEvidence(root,previous.benchmarkId)).files.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
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
test("offline full three-arm protocol learns within the run, persists proposals, and freshly verifies every repeated job",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"reuse-protocol-"));let calls=0,counts=0;
  const native=await NativeCodingVerifier.create();assert(native);
  try{const rows=await runReuseSpeedBenchmark({directory:join(dir,"trial"),benchmarkId:grant.benchmarkId,apiKey:"OFFLINE_ONLY",
    native,executionKind:"scripted_offline",beforeDispatch:async()=>{},fetchImpl:async(url,init)=>{
      const body=JSON.parse(String(init!.body));assert.doesNotMatch(body.input,/clips, sorts and merges|assert\.deepEqual/);
      if(String(url).endsWith("/input_tokens")){counts++;return new Response(JSON.stringify({input_tokens:100}));}
      calls++;const p=JSON.parse(body.input.split("\n").slice(2).join("\n")),file=p.files.find((f:{path:string})=>f.path==="src/free-windows.ts");
      const proposal={schemaVersion:1,baseArtifactDigest:p.currentArtifactDigest,failureFingerprint:p.failures[0].fingerprint,
        strategy:p.requiredStrategy,changes:[{path:file.path,expectedContentDigest:file.contentDigest,replacementText:correct}],limitations:[]};
      return new Response(JSON.stringify({id:`offline-response-${calls}`,model:"gpt-5.6-luna",status:"completed",usage:{input_tokens:100,output_tokens:80},
        output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(proposal)}]}]}));
    }});
    assert.equal(rows.length,12);assert(rows.every(r=>r.completed));assert(rows.every(r=>r.verificationCalls===4));
    assert.equal(calls,6);assert.equal(counts,6);assert.equal(new Set(rows.map(r=>r.finalArtifactDigest)).size,1);
    assert.equal(rows.filter(r=>r.arm==="optimized").reduce((n,r)=>n+r.hits,0),3);
    assert.equal(rows.filter(r=>r.arm==="ordinary_memory").reduce((n,r)=>n+r.hits,0),3);
    assert.equal(rows.filter(r=>r.arm==="regenerate").reduce((n,r)=>n+r.hits,0),0);
    const summary=JSON.parse(await readFile(join(dir,"trial/trace/reuse-summary.json"),"utf8"));
    assert.equal(summary.payload.executionKind,"scripted_offline");assert.equal(summary.payload.absoluteMaximumEstablished,false);
    assert.equal(summary.payloadDigest,sha256(canonicalJson(summary.payload)));
    await assert.rejects(runReuseSpeedBenchmark({directory:join(dir,"trial"),benchmarkId:grant.benchmarkId,apiKey:"OFFLINE_ONLY",native,
      executionKind:"scripted_offline",beforeDispatch:async()=>{},fetchImpl:async()=>{throw Error("should never execute");}}),{code:"EEXIST"});
  }finally{await rm(dir,{recursive:true,force:true});}
});
