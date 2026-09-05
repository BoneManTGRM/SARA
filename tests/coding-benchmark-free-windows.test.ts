import assert from "node:assert/strict";
import { it } from "node:test";
import { FREE_WINDOWS_CORPUS, FREE_WINDOWS_PROTECTED_FILES, freeWindowsCorpusDigest, verifyFreeWindowsCandidate } from "../src/coding-benchmark-free-windows.ts";
import { runCodingBenchmarkArm } from "../src/coding-repair-benchmark-runner.ts";
import { sha256 } from "../src/canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
// OFFLINE POSITIVE CONTROL ONLY. Never sent to a worker or used as a live solution.
// This sorting/union fixture is independently checked by the hidden occupancy oracle.
const correctFixture=`export type Window = Readonly<{start:number;end:number}>;
export function findFreeWindows(bookings:readonly unknown[],horizonStart:number,horizonEnd:number,minimumDuration=1):Window[]{
 if(!Array.isArray(bookings)||!Number.isSafeInteger(horizonStart)||!Number.isSafeInteger(horizonEnd)||horizonStart<0||horizonStart>=horizonEnd||horizonEnd>1000000||!Number.isSafeInteger(minimumDuration)||minimumDuration<1||minimumDuration>1000000)return [];
 const occupied:Window[]=[];
 for(const item of bookings){
  if(item===null||typeof item!=="object"||Array.isArray(item))continue;
  const v=item as Record<string,unknown>;
  if(typeof v.start!=="number"||typeof v.end!=="number"||!Number.isSafeInteger(v.start)||!Number.isSafeInteger(v.end)||v.start>=v.end)continue;
  const start=Math.max(horizonStart,v.start),end=Math.min(horizonEnd,v.end);
  if(start<end)occupied.push({start,end});
 }
 occupied.sort((a,b)=>a.start-b.start||a.end-b.end);
 const result:Window[]=[];let cursor=horizonStart;
 for(const v of occupied){if(v.start-cursor>=minimumDuration)result.push({start:cursor,end:v.start});cursor=Math.max(cursor,v.end);}
 if(horizonEnd-cursor>=minimumDuration)result.push({start:cursor,end:horizonEnd});return result;
}
`;
const task=FREE_WINDOWS_CORPUS.cases[0]!;
const context={objective:task.objective,acceptanceCriteria:task.acceptanceCriteria,missingCapabilities:[],constitutionDigest:"a".repeat(64),memoryContext:{contextDigest:"b".repeat(64),memories:[]}};
const verify=(candidate:typeof task.baseline)=>verifyFreeWindowsCandidate({candidate,objective:task.objective,acceptanceCriteria:task.acceptanceCriteria,constitutionDigest:context.constitutionDigest,maximumBudgetUsd:.075});
const good=()=>({...structuredClone(task.baseline),files:task.baseline.files.map(f=>f.path==="src/free-windows.ts"?{...f,content:correctFixture}:{...f})});
const model:CodingRepairModel={propose:async req=>({proposal:{schemaVersion:1,baseArtifactDigest:req.verification.artifactDigest,failureFingerprint:req.verification.failures[0]!.fingerprint,strategy:req.strategy,changes:[{path:"src/free-windows.ts",expectedContentDigest:sha256(req.candidate.files.find(f=>f.path==="src/free-windows.ts")!.content),replacementText:correctFixture}],limitations:["Offline fixture only."]},inputTokens:1,outputTokens:1,accountedCostUsd:.001})};
it("freezes new task and protected tests outside model-visible files",()=>{
 assert.equal(freeWindowsCorpusDigest(),"71081d5ef6d04c76c88a88c5df87168924a272a17b6339ab3bef104fda6237bf");assert.equal(task.caseId,"live-free-windows-001");assert.equal(FREE_WINDOWS_PROTECTED_FILES.length,1);assert.ok(task.baseline.files.every(f=>f.path.startsWith("src/")));assert.ok(!JSON.stringify(task).includes("4781"));assert.ok(!JSON.stringify(task).includes("correctFixture"));
});
it("broken baseline fails and independent correct fixture passes actual verification",async()=>{
 const failed=await verify(task.baseline);assert.equal(failed.passed,false);assert.ok(failed.failures.length);assert.ok(!JSON.stringify(failed).includes("unsorted and nested"));const passed=await verify(good());assert.equal(passed.passed,true);assert.equal(passed.failures.length,0);assert.equal(passed.completedChecks.length,5);
});
it("rejects proposed protected acceptance files",async()=>{const c=good();c.files.push({path:"tests/free-windows.test.ts",content:""});await assert.rejects(verify(c),/writable file set/);});
for(const method of ["luna","luna_reparodynamic"] as const){
 it("scripted fixture completes through "+method+" with fresh final verification",async()=>{
  let checks=0;const result=await runCodingBenchmarkArm({method,benchmarkCase:task,context,model,limits:{...INITIAL_CODING_REPAIR_LIMITS,maximumModelSpendUsd:.075},verify:async c=>{checks++;return verify(c);}});assert.equal(result.verifiedComplete,true);assert.equal(result.cycles,1);assert.ok(checks>=3);
 });
 it("fresh final failure remains incomplete through "+method,async()=>{
  let checks=0;const failed=await verify(task.baseline);const result=await runCodingBenchmarkArm({method,benchmarkCase:task,context,model,limits:{...INITIAL_CODING_REPAIR_LIMITS,maximumModelSpendUsd:.075},verify:async c=>++checks>=3?failed:verify(c)});assert.equal(result.verifiedComplete,false);assert.equal(result.failureCode,"post_verification_failed");
 });
}
