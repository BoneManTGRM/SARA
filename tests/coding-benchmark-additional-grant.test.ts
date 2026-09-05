import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { ADDITIONAL_BENCHMARK_AUTHORIZATION as added, BENCHMARK_AUTHORIZATION_KEY as key,
  CODING_BENCHMARK_CONTINUATION as old, assertCodingBenchmarkDispatch, inspectCodingBenchmarkReadiness,
  selectedBenchmarkAuthorization } from "../src/coding-benchmark-readiness.ts";
import { assertBenchmarkUnclaimed, codingBenchmarkLaunchSpec } from "../src/coding-benchmark-owner.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
const environment: Record<string,string|undefined> = {SARA_OWNER_TOKEN:"offline-owner",SARA_OWNER_TOKEN_SHA256:sha256("offline-owner"),OPENAI_API_KEY:"offline-not-a-key",RAILWAY_GIT_COMMIT_SHA:"a".repeat(40),PORT:"8080"};
const input={environment,constitutionVerified:true,emergencyStopped:false};
it("preserves original unresolved allocation and default refusal",()=>{
 const v=inspectCodingBenchmarkReadiness(input);assert.equal(v.ready,false);assert.equal(v.benchmarkId,old.benchmarkId);assert.equal(v.unresolvedExposureUsd,.15);assert.equal(v.availableAuthorizationUsd,0);assert.equal(old.historicalResolutionEvidence,null);assert.ok(Object.isFrozen(old));
});
it("only explicit additional selection supplies the new equal-arm allocation",()=>{
 const v=inspectCodingBenchmarkReadiness({...input,environment:{...environment,[key]:added.benchmarkId}});
 assert.equal(v.ready,true);assert.deepEqual(v.blockers,[]);assert.equal(v.benchmarkId,added.benchmarkId);assert.equal(v.maximumSpendUsd,.15);assert.equal(v.maximumModelSpendUsdPerArm,.075);assert.equal(v.availableAuthorizationUsd,.15);assert.equal(v.unresolvedExposureUsd,0);assert.equal(v.historicalUnresolvedExposureUsd,.15);assert.equal(v.historicalBenchmarkId,old.benchmarkId);assert.equal(v.confirmedChargeUsd,null);
});
for(const id of ["new"," "+added.benchmarkId,added.benchmarkId.toUpperCase(),"00000000-0000-4000-8000-000000000000"])it("rejects unregistered selector "+id,()=>assert.throws(()=>selectedBenchmarkAuthorization({...environment,[key]:id}),/BENCHMARK_AUTHORIZATION_UNKNOWN/));
it("does not make historical id runnable under new selector",()=>assert.throws(()=>assertCodingBenchmarkDispatch({...input,environment:{...environment,[key]:added.benchmarkId},benchmarkId:old.benchmarkId}),/BENCHMARK_SCOPE_MISMATCH/));
for(const field of ["SARA_OWNER_TOKEN","SARA_OWNER_TOKEN_SHA256","OPENAI_API_KEY","RAILWAY_GIT_COMMIT_SHA"])it("retains required runtime preflight "+field,()=>assert.equal(inspectCodingBenchmarkReadiness({...input,environment:{...environment,[key]:added.benchmarkId,[field]:undefined}}).ready,false));
it("retains Constitution and emergency-stop checks",()=>{
 const env={...environment,[key]:added.benchmarkId};assert.equal(inspectCodingBenchmarkReadiness({...input,environment:env,constitutionVerified:false}).ready,false);assert.equal(inspectCodingBenchmarkReadiness({...input,environment:env,emergencyStopped:true}).ready,false);
});
it("launch spec uses only existing runner, new id, equal limits and allowed secrets",()=>{
 const spec=codingBenchmarkLaunchSpec({environment:{...environment,[key]:added.benchmarkId,UNRELATED_SECRET:"never-copy"},stateDirectory:"/data/sara/coding-benchmark-lab",sourceRevision:"a".repeat(40)});
 assert.ok(spec.args.includes("scripts/benchmark-matched-coding-evidence.ts"));assert.equal(spec.args[spec.args.indexOf("--benchmark-id")+1],added.benchmarkId);assert.equal(spec.args[spec.args.indexOf("--max-spend-usd")+1],"0.15");assert.equal(spec.args[spec.args.indexOf("--max-arm-spend-usd")+1],"0.075");assert.equal(spec.environment[key],added.benchmarkId);assert.equal(spec.environment.UNRELATED_SECRET,undefined);
});
it("one-use launch evidence survives concurrent claims and fresh admission reads",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"sara-added-claim-"));try{
  await assertBenchmarkUnclaimed(dir,added.benchmarkId);const trace=join(dir,"coding-repair-benchmarks",added.benchmarkId,"trace");
  const results=await Promise.allSettled([1,2,3].map(()=>writeBenchmarkAudit(trace,"owner-launch-claim.json",{reservedUsd:.15,historicalReservedUsd:.15})));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);await assert.rejects(assertBenchmarkUnclaimed(dir,added.benchmarkId),/BENCHMARK_ALREADY_CLAIMED_NO_REPLAY/);await assert.rejects(writeBenchmarkAudit(trace,"owner-launch-claim.json",{reservedUsd:0}));await assert.rejects(assertBenchmarkUnclaimed(dir,added.benchmarkId),/BENCHMARK_ALREADY_CLAIMED_NO_REPLAY/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

it("conservative dispatch reserves cache writes and token counts before fetch within each arm",async()=>{
 const {createBenchmarkAudit}=await import("../src/coding-benchmark-audit.ts");const{readFile}=await import("node:fs/promises");
 const dir=await mkdtemp(join(tmpdir(),"sara-added-cost-"));let calls=0;
 try{
  const audit=createBenchmarkAudit({directory:dir,method:"luna",conservativeRequestReservations:true,beforeDispatch:async()=>{},fetchImpl:async url=>{
   calls++;const count=String(url).endsWith("input_tokens");
   const name=count?"luna-count-0001-reservation.json":"luna-0001-reservation.json";
   const receipt=JSON.parse(await readFile(join(dir,name),"utf8"));assert.equal(receipt.payload.maximumReservedUsd,count?.0075:.0171);
   return Response.json(count?{input_tokens:100}:{model:"gpt-5.6-luna",status:"completed",usage:{input_tokens:100,output_tokens:100},output:[]});
  }});
  await audit.fetch("https://api.openai.com/v1/responses/input_tokens",{method:"POST",body:JSON.stringify({model:"gpt-5.6-luna",input:"offline"})});
  await audit.fetch("https://api.openai.com/v1/responses",{method:"POST",body:JSON.stringify({model:"gpt-5.6-luna",input:"offline",store:false,max_output_tokens:8000,reasoning:{effort:"medium"}})});
  assert.equal(calls,2);assert.ok(3*(.0075+.0171)<.075);
  await assert.rejects(audit.fetch("https://api.openai.com/v1/responses/input_tokens",{method:"POST",body:JSON.stringify({model:"gpt-5.6-luna",input:"x".repeat(30000)})}),/byte bound/);assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
