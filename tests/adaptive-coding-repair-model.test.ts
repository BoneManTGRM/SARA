import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { selectRepairOutputFormat, createAdaptiveCodingRepairModel, persistRepairFormatDecision } from "../src/adaptive-coding-repair-model.ts";
import { CodingRepairOutputError, createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import { check, candidate as small } from "./helpers/repair-memory-fixture.ts";
import { largeCandidate, responseFor, fixtureContext } from "./helpers/adaptive-repair-fixture.ts";
type Request = Parameters<CodingRepairModel["propose"]>[0];
function request(large = true): Request {
  const candidate = large ? largeCandidate() : small();
  return { candidate, verification: check(candidate, false), cycle: 1, strategy: "surgical", remainingCostUsd: 0.075 };
}
function sized(bytes: number, located: boolean): Request {
  const r = request(false); r.candidate.files[1].content = "a".repeat(bytes);
  r.verification = check(r.candidate, false); r.verification.failures[0].file = located ? "src/value.ts" : "";
  return r;
}
function stub(r: Request, output: unknown) {
  const prompts: string[] = []; let executions = 0;
  const client: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
    async countInputTokens(prompt) { prompts.push(prompt); return 100; },
    async execute() { executions++; return { outputText: typeof output === "string" ? output : JSON.stringify(output), inputTokens: 100, billableOutputTokens: 50 }; } };
  return { client, prompts, executions: () => executions,
    adapter: (onFormat: Parameters<typeof createAdaptiveCodingRepairModel>[0]["onFormat"] = () => {}) =>
      createAdaptiveCodingRepairModel({ client, context: fixtureContext, onFormat }) };
}
for (const [bytes, located, format] of [[2047,true,"full_files"],[2048,true,"compact_edits"],[4095,false,"full_files"],[4096,false,"compact_edits"]] as const) {
  test(`format boundary ${bytes} bytes / located=${located}`, () => assert.equal(selectRepairOutputFormat(sized(bytes,located)).format, format));
}
test("small repairs and deep strategy preserve full-file output", () => {
  assert.equal(selectRepairOutputFormat(request(false)).format,"full_files");
  const r=request();r.strategy="deep";assert.equal(selectRepairOutputFormat(r).reason,"deep_repair");
});
test("hidden test content and size cannot drive representation selection", () => {
  const r=request(false);const before=selectRepairOutputFormat(r);
  r.candidate.files[2].content="private test body".repeat(700);r.verification=check(r.candidate,false);
  const after=selectRepairOutputFormat(r);
  assert.equal(after.format,before.format);assert.equal(after.reason,before.reason);assert.equal(after.largestRelevantSourceBytes,before.largestRelevantSourceBytes);
});
test("unrelated large modules do not override a located small repair", () => {
  const r=request();r.verification.failures[0].file="src/index.ts";
  assert.equal(selectRepairOutputFormat(r).format,"full_files");
});
test("threshold uses UTF-8 bytes, not JavaScript character count", () => {
  const r=sized(1,true);r.candidate.files[1].content="é".repeat(1024);r.verification=check(r.candidate,false);
  assert.equal(selectRepairOutputFormat(r).largestRelevantSourceBytes,2048);assert.equal(selectRepairOutputFormat(r).format,"compact_edits");
});
for (const [name, mutate] of [
  ["stale artifact",(r:Request)=>{r.verification.artifactDigest="f".repeat(64);}],
  ["passing baseline",(r:Request)=>{r.verification=check(r.candidate,true);}],
  ["cycle zero",(r:Request)=>{r.cycle=0;}], ["too many cycles",(r:Request)=>{r.cycle=4;}],
  ["nonfinite budget",(r:Request)=>{r.remainingCostUsd=NaN;}], ["expanded budget",(r:Request)=>{r.remainingCostUsd=1;}],
] as const) test(`rejects ${name} before counting tokens or executing`,async()=>{
  const r=request();mutate(r);const s=stub(r,{});await assert.rejects(()=>s.adapter().propose(r));
  assert.equal(s.prompts.length,0);assert.equal(s.executions(),0);
});
test("large first repair uses guarded edits and expands to the exact full-file proposal",async()=>{
  const r=request(),s=stub(r,responseFor(r,true));const result=await s.adapter().propose(r);
  assert.deepEqual(result.proposal,responseFor(r,false));assert.equal(s.executions(),1);
  assert.match(s.prompts[0],/SARA_CODING_REPAIR_EDITS_V1/);assert.doesNotMatch(s.prompts[0],/PRIVATE_ADAPTIVE_ORACLE/);
  assert(result.accountedCostUsd>0);assert.equal(r.candidate.files[1].content,largeCandidate().files[1].content);
});
test("small request prompt stays byte-identical to the existing adapter",async()=>{
  const r=request(false),output={schemaVersion:1,baseArtifactDigest:r.verification.artifactDigest,
    failureFingerprint:r.verification.failures[0].fingerprint,strategy:r.strategy,changes:[{path:"src/value.ts",
      expectedContentDigest:sha256(r.candidate.files[1].content),replacementText:small(true).files[1].content}],limitations:[]};
  const s=stub(r,output);const before=await createLunaCodingRepairModel({client:s.client,context:fixtureContext}).propose(r);
  const after=await s.adapter().propose(r);assert.equal(s.prompts[0],s.prompts[1]);assert.deepEqual(before,after);
});
test("required pre-dispatch receipt failure stops before token count or model calls",async()=>{
  const r=request(),s=stub(r,responseFor(r,true));await assert.rejects(()=>s.adapter(()=>{throw new Error("receipt unavailable");}).propose(r),/receipt unavailable/);
  assert.equal(s.executions(),0);assert.equal(s.prompts.length,0);
});
test("input/context and decision mutation across the receipt await cannot change the bound request",async()=>{
  const r=request(),original=structuredClone(r),s=stub(r,responseFor(r,true));const context=structuredClone(fixtureContext);
  const model=createAdaptiveCodingRepairModel({client:s.client,context,onFormat:async decision=>{
    r.candidate.files[1].content="MUTATED_SOURCE";r.remainingCostUsd=100;context.objective="MUTATED_OBJECTIVE";
    (decision as {format:string}).format="full_files";await Promise.resolve();}});
  const result=await model.propose(r);assert.deepEqual(result.proposal,responseFor(original,false));
  assert.doesNotMatch(s.prompts[0],/MUTATED_/);assert.match(s.prompts[0],/SARA_CODING_REPAIR_EDITS_V1/);
});
for(const [name,mutate] of [
  ["stale file",(v:any)=>{v.changes[0].expectedContentDigest="0".repeat(64);}],
  ["unknown anchor",(v:any)=>{v.changes[0].edits[0].find="does-not-exist";}],
  ["ambiguous anchor",(v:any)=>{v.changes[0].edits[0].find="value";}],
  ["protected file",(v:any)=>{v.changes[0].path="tests/value.test.ts";}],
  ["overlap",(v:any)=>{v.changes[0].edits.push({...v.changes[0].edits[0]});}],
  ["oversized replacement",(v:any)=>{v.changes[0].edits[0].replace="x".repeat(16385);}],
  ["different output contract",(v:any)=>{v.changes[0].replacementText="export const x=1;";delete v.changes[0].edits;}],
] as const) test(`invalid compact ${name} retains charged usage and never retries full output`,async()=>{
  const r=request(),v=responseFor(r,true);mutate(v);const s=stub(r,v);
  await assert.rejects(()=>s.adapter().propose(r),error=>error instanceof CodingRepairOutputError && error.inputTokens===100 && error.outputTokens===50 && error.accountedCostUsd>0);
  assert.equal(s.executions(),1);assert.equal(s.prompts.length,1);
});
test("unknown provider failure propagates without a second attempt",async()=>{
  const r=request(),s=stub(r,{});let n=0;s.client.execute=async()=>{n++;throw new Error("provider receipt uncertain");};
  await assert.rejects(()=>s.adapter().propose(r));assert.equal(n,1);
});
test("pre-dispatch format receipts are exclusive, private and hash-bound",async()=>{
  const root=await mkdtemp(join(tmpdir(),"sara-format-test-")),runId=randomUUID(),decision=selectRepairOutputFormat(request());
  try{await persistRepairFormatDecision({stateDirectory:root,runId,decision});
    const path=join(root,"coding-repair-receipts",runId,`format-${decision.cycle}.json`);
    const value=JSON.parse(await readFile(path,"utf8"));assert.equal(value.phase,"before_dispatch");assert.deepEqual(value.decision,decision);
    assert.equal(value.digest,sha256(canonicalJson(decision)));assert.doesNotMatch(JSON.stringify(value),/PRIVATE_ADAPTIVE_ORACLE|export function/);
    await assert.rejects(()=>persistRepairFormatDecision({stateDirectory:root,runId,decision}),{code:"EEXIST"});
    assert.equal((await readdir(join(root,"coding-repair-receipts",runId))).length,1);
    await assert.rejects(()=>persistRepairFormatDecision({stateDirectory:root,runId:"../escape",decision}));
  }finally{await rm(root,{recursive:true,force:true});}
});

for (const [name, code] of [["wrong behavior", "Math.min(11, Math.max(0, value))"],
    ["wrong type", '"wrong"'], ["prohibited capability", "process.exit(0)"]] as const) {
  test(`compact proposal cannot bypass fresh verifier: ${name}`, async () => {
    const r=request();const output=responseFor(r,true);
    (output.changes[0] as { edits: Array<{find:string;replace:string}> }).edits[0].replace=code;
    const s=stub(r,output),result=await s.adapter().propose(r);
    const proposed=structuredClone(r.candidate);proposed.files[1].content=result.proposal.changes[0].replacementText;
    const verification=await verifyGenomeLabProgramCandidate({candidate:proposed,...fixtureContext});
    assert.equal(verification.passed,false);assert.equal(s.executions(),1);
  });
}
