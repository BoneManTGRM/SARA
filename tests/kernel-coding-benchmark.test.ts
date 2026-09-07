import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runKernelCodingBenchmark, KERNEL_BENCHMARK_PROTOCOL, assertKernelBenchmarkImplementation } from "../src/kernel-coding-benchmark.ts";
import { KERNEL_CODING_BENCHMARK_GRANT as grant, HARDENED_REUSE_BENCHMARK_GRANT as previous,
  activeCodingBenchmarkContinuation, inspectCodingBenchmarkReadiness } from "../src/coding-benchmark-readiness.ts";
import { codingBenchmarkLaunchSpec } from "../src/coding-benchmark-owner.ts";
import { readCodingBenchmarkEvidence } from "../src/coding-benchmark-evidence.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";

const correct = `export type Booking = Readonly<{start:number;end:number}>;
export type TimeWindow = Readonly<{start:number;end:number}>;
export function freeWindows(dayStart:number,dayEnd:number,bookings:readonly Booking[]):TimeWindow[]{
 if(!Number.isFinite(dayStart)||!Number.isFinite(dayEnd)||dayStart>=dayEnd)return [];
 const busy=bookings.filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start)
 .map(b=>({start:Math.max(dayStart,b.start),end:Math.min(dayEnd,b.end)})).filter(b=>b.end>b.start)
 .sort((a,b)=>a.start-b.start||a.end-b.end);
 let cursor=dayStart;const result:TimeWindow[]=[];
 for(const b of busy){if(b.start>cursor)result.push({start:cursor,end:b.start});cursor=Math.max(cursor,b.end);}
 if(cursor<dayEnd)result.push({start:cursor,end:dayEnd});return result;
}`;
const environment = () => ({ SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: grant.activationSha256,
  SARA_OWNER_TOKEN: "test-owner", SARA_OWNER_TOKEN_SHA256: sha256("test-owner"), OPENAI_API_KEY: "SCRIPTED_NEVER_LIVE",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40), SARA_REPARODYNAMIC_CODING_MODE: "canary" });
function model(failGeneration = 0) {
  let calls = 0, counts = 0; const prompts: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/input_tokens")) { counts++; return new Response('{"input_tokens":100}'); }
    calls++; prompts.push(body.input);
    assert.equal(body.model, "gpt-5.6-luna"); assert.equal(body.reasoning.effort, "medium"); assert.equal(body.max_output_tokens, 8000);
    assert.doesNotMatch(body.input, /clips, sorts and merges|ignores invalid bookings/);
    if (calls === failGeneration) throw new Error("INJECTED_UNCERTAIN_PROVIDER_REQUEST");
    const p = JSON.parse(body.input.split("\n").slice(2).join("\n"));
    const file = p.files.find((f: {path:string}) => f.path === "src/free-windows.ts"); assert(file);
    const answer = { schemaVersion: 1, baseArtifactDigest: p.currentArtifactDigest,
      failureFingerprint: p.failures[0].fingerprint, strategy: p.requiredStrategy,
      changes: [{ path: file.path, expectedContentDigest: file.contentDigest, replacementText: correct }], limitations: [] };
    return new Response(JSON.stringify({ id: `scripted-${calls}`, model: "gpt-5.6-luna", status: "completed",
      usage: { input_tokens: 100, output_tokens: 80 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] }));
  };
  return { fetchImpl, calls: () => calls, counts: () => counts, prompts };
}
async function inDirectory(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-full-kernel-test-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test("full-kernel grant is separate; old authorization still selects old grant", () => {
  const env = environment(); assert.equal(activeCodingBenchmarkContinuation(env).benchmarkId, grant.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({ ...env, SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: previous.activationSha256 }).benchmarkId, previous.benchmarkId);
  const ready = inspectCodingBenchmarkReadiness({ environment: env, constitutionVerified: true, emergencyStopped: false });
  assert.equal(ready.kernelJobMeasured, true); assert.equal(ready.maximumSpendUsd, .15); assert.equal(ready.maximumModelSpendUsdPerArm, .05);
  assert.equal(ready.experiment, "full_kernel_exact_repeat_pilot");
  assert.equal(ready.historicalHold?.unresolvedExposureUsd, .15);
  assert.equal(ready.providerDeadlineMilliseconds, 45000);
  assert(inspectCodingBenchmarkReadiness({ environment: { ...env, SARA_REPARODYNAMIC_CODING_MODE: "off" }, constitutionVerified: true, emergencyStopped: false }).blockers.includes("CURRENT_PILOT_CANARY_REQUIRED"));
});
test("launcher targets only the new CLI, with no injected configuration or expanded caps", () => {
  const env = environment(); const spec = codingBenchmarkLaunchSpec({ environment: env, stateDirectory: "/data/lab", sourceRevision: env.RAILWAY_GIT_COMMIT_SHA });
  assert(spec.args.includes("scripts/benchmark-kernel-coding.ts")); assert(spec.args.includes(grant.benchmarkId));
  assert.equal(spec.environment.SARA_KERNEL_VERIFICATION_WORKERS, undefined);
  assert(spec.args.includes("0.15")); assert(spec.args.includes("0.05"));
});
test("evidence export includes only fixed bounded new job/trace paths", async () => inDirectory(async root => {
  for (const id of [grant.benchmarkId, previous.benchmarkId]) {
    const dir = join(root, "coding-repair-benchmarks", id, "kernel-state/jobs");
    await mkdir(dir, { recursive: true }); await writeBenchmarkAudit(dir, "optimized-0.json", { allowed: true });
    await writeBenchmarkAudit(dir, "optimized-4.json", { allowed: false }); await writeBenchmarkAudit(dir, "secret.json", { never: true });
  }
  const read = await readCodingBenchmarkEvidence(root, grant.benchmarkId); assert.equal(read.files.length, 1);
  assert.equal(read.files[0].path, "kernel-state/jobs/optimized-0.json");
  assert.equal((await readCodingBenchmarkEvidence(root, previous.benchmarkId)).files.length, 0);
}));
test("mocked and live execution classifications cannot be interchanged", async () => inDirectory(async root => {
  const options = { directory: join(root,"trial"), benchmarkId: randomUUID(), apiKey: "SCRIPTED_NEVER_LIVE", beforeDispatch: async () => {} };
  await assert.rejects(runKernelCodingBenchmark({ ...options, executionKind: "scripted_offline" }), /EXECUTION_KIND/);
  await assert.rejects(runKernelCodingBenchmark({ ...options, executionKind: "live", fetchImpl: model().fetchImpl }), /EXECUTION_KIND/);
}));
test("current full-kernel implementation pins match before any execution", async () => { await assertKernelBenchmarkImplementation(); });
test("all twelve actual HTTP/kernel jobs complete with six scripted generations and fresh acceptance", async () => inDirectory(async root => {
  const stub = model(); const directory = join(root, "trial");
  const rows = await runKernelCodingBenchmark({ directory, benchmarkId: randomUUID(), apiKey: "SCRIPTED_NEVER_LIVE",
    executionKind: "scripted_offline", beforeDispatch: async () => {}, fetchImpl: stub.fetchImpl });
  assert.equal(rows.length, 12); assert(rows.every(row => row.result === "passed")); assert.equal(stub.calls(), 6); assert.equal(stub.counts(), 6);
  assert.equal(new Set(stub.prompts).size, 1, "all generated repairs use identical recorded prompts");
  const summary = JSON.parse(await readFile(join(directory, "trace/kernel-summary.json"), "utf8")).payload;
  assert.equal(summary.allComplete, true); assert.equal(summary.aggregates.optimized.generationAttempts, 1);
  assert.equal(summary.aggregates.regenerate.generationAttempts, 4); assert.equal(summary.aggregates.ordinary_memory.hits, 3);
  assert.equal(summary.aggregates.optimized.hits, 3); assert(summary.warmRatios.optimizedVersusRegenerate > 0);
  const mutations = new Set<string>();
  for (const row of rows) {
    const text = await readFile(join(directory, "jobs", `${row.arm}-${row.round}.json`), "utf8");
    assert.doesNotMatch(text, /SCRIPTED_NEVER_LIVE|Bearer /);
    const envelope = JSON.parse(text), payload = envelope.payload;
    assert.equal(envelope.payloadDigest, sha256(canonicalJson(payload))); assert.equal(envelope.payloadDigest, row.evidenceSha256);
    assert.equal(payload.response.evidence.attestation, "kernel_executed"); assert.equal(payload.kernelVerification.typescriptVersion, "5.9.3");
    assert.equal(payload.kernelVerification.result, "PASS"); assert.equal(payload.response.mutation.stage, "SHADOW");
    assert(payload.jobEvents.some((e: {type:string}) => e.type === "self_build_cycle_completed"));
    assert(payload.response.timing.totalMilliseconds <= row.elapsedMilliseconds!); assert(row.withEvidenceMilliseconds! >= row.elapsedMilliseconds!);
    assert.equal(payload.reuse.finalFreshVerification, true); mutations.add(payload.response.mutation.id);
    assert.equal(payload.run.cycles, 1); assert.equal(payload.run.verifiedComplete, true);
  }
  assert.equal(mutations.size, 12); assert.equal(new Set(rows.map(r => r.finalArtifactDigest)).size, 1);
  await assert.rejects(runKernelCodingBenchmark({ directory, benchmarkId: randomUUID(), apiKey: "SCRIPTED_NEVER_LIVE",
    executionKind: "scripted_offline", beforeDispatch: async () => {}, fetchImpl: stub.fetchImpl }), { code: "EEXIST" });
  assert.equal(stub.calls(), 6);
}));
test("third-generation uncertainty stays counted even without reuse callback, and all warm jobs stay unrun", async () => inDirectory(async root => {
  const stub = model(3), directory = join(root,"trial");
  await assert.rejects(runKernelCodingBenchmark({ directory, benchmarkId: randomUUID(), apiKey: "SCRIPTED_NEVER_LIVE",
    executionKind: "scripted_offline", beforeDispatch: async () => {}, fetchImpl: stub.fetchImpl }), /INCOMPLETE_NO_REPLAY/);
  const summary = JSON.parse(await readFile(join(directory,"trace/kernel-summary.json"),"utf8")).payload;
  assert.equal(stub.calls(), 3); assert.equal(summary.rows.filter((r: {result:string}) => r.result === "unrun").length, 9);
  assert.equal(summary.aggregates.optimized.generationAttempts, 1); assert.equal(summary.aggregates.optimized.uncertainAttempts, 1);
  assert.equal(summary.comparisonAllowed, false); assert.equal(summary.warmRatios, null); assert.equal(summary.learningInclusiveRatios, null);
  assert.equal(summary.accounting.unresolvedReservedUsd, .0156); assert.equal(summary.accounting.closed, true);
  const failed = JSON.parse(await readFile(join(directory,"jobs/optimized-0.json"),"utf8")).payload;
  assert.equal(failed.reuse, null); assert.equal(failed.dispatch.generationAttempts, 1);
  assert(failed.dispatchFiles.some((f: {path:string}) => f.path.endsWith("failure.json")));
}));
test("authority rejection before trial admission makes no provider request", async () => inDirectory(async root => {
  const stub = model();
  await assert.rejects(runKernelCodingBenchmark({ directory: join(root,"trial"), benchmarkId: randomUUID(), apiKey: "SCRIPTED_NEVER_LIVE",
    executionKind: "scripted_offline", beforeDispatch: async () => { throw new Error("STOP"); }, fetchImpl: stub.fetchImpl }), /STOP/);
  assert.equal(stub.calls(), 0); assert.equal(stub.counts(), 0);
}));
