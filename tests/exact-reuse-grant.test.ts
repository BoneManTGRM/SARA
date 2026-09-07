import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/canonical.ts";
import { EXACT_REUSE_BENCHMARK_GRANT as grant } from "../src/exact-reuse-benchmark-grant.ts";
import { KERNEL_CODING_BENCHMARK_GRANT as previous, OBSERVED_REUSE_BENCHMARK_GRANT as observed,
  CODING_BENCHMARK_CONTINUATION as historical, activeCodingBenchmarkContinuation,
  inspectCodingBenchmarkReadiness, assertCodingBenchmarkDispatch, assertCodingBenchmarkRuntimeAuthority } from "../src/coding-benchmark-readiness.ts";
import { codingBenchmarkLaunchSpec } from "../src/coding-benchmark-owner.ts";
import { parseCodingBenchmarkCommand } from "../src/coding-repair-benchmark-command.ts";
import { readCodingBenchmarkEvidence } from "../src/coding-benchmark-evidence.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { initializeCodingBenchmarkStore, withCodingBenchmarkExecution, type CodingBenchmarkManifest } from "../src/coding-repair-benchmark-store.ts";

const environment = () => ({ SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: grant.activationSha256,
  SARA_REPARODYNAMIC_CODING_MODE: "canary", SARA_OWNER_TOKEN: "offline-grant-test",
  SARA_OWNER_TOKEN_SHA256: sha256("offline-grant-test"), OPENAI_API_KEY: "OFFLINE_ONLY_NO_PROVIDER_REQUEST",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40), PORT: "3000" });
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-exact-grant-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("exact reuse has a fresh capped grant while previous activation and unresolved hold remain unchanged", () => {
  assert.notEqual(grant.benchmarkId, previous.benchmarkId);
  assert.notEqual(grant.activationSha256, previous.activationSha256);
  assert.equal(grant.maximumSpendUsd, .15); assert.equal(grant.maximumModelSpendUsdPerArm, .05);
  assert.equal(activeCodingBenchmarkContinuation(environment()).benchmarkId, grant.benchmarkId);
  for (const older of [previous, observed]) assert.equal(activeCodingBenchmarkContinuation({
    ...environment(), SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: older.activationSha256,
  }).benchmarkId, older.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({}).benchmarkId, historical.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({}).unresolvedExposureUsd, .15);
  const ready = inspectCodingBenchmarkReadiness({ environment: environment(), constitutionVerified: true, emergencyStopped: false });
  assert(ready.ready); assert.equal(ready.maximumSpendUsd, .15); assert.equal(ready.maximumModelSpendUsdPerArm, .05);
  assert.equal(ready.historicalHold?.unresolvedExposureUsd, .15);
  assert.equal(ready.kernelJobMeasured, true); assert.equal(ready.jobsPerArm, 4);
  assert.equal(ready.absoluteMaximumEstablished, false);
});

test("exact grant requires current canary, owner, constitution and stop authority", () => {
  for (const mode of ["off", "shadow", ""]) {
    const input = { environment: { ...environment(), SARA_REPARODYNAMIC_CODING_MODE: mode }, constitutionVerified: true, emergencyStopped: false };
    assert(inspectCodingBenchmarkReadiness(input).blockers.includes("CURRENT_PILOT_CANARY_REQUIRED"));
    assert.throws(() => assertCodingBenchmarkDispatch({ ...input, benchmarkId: grant.benchmarkId }));
  }
  for (const input of [
    { environment: environment(), constitutionVerified: false, emergencyStopped: false },
    { environment: environment(), constitutionVerified: true, emergencyStopped: true },
    { environment: { ...environment(), SARA_OWNER_TOKEN: "incorrect-owner" }, constitutionVerified: true, emergencyStopped: false },
  ]) assert.throws(() => assertCodingBenchmarkDispatch({ ...input, benchmarkId: grant.benchmarkId }));
  assert.throws(() => assertCodingBenchmarkDispatch({ environment: environment(), constitutionVerified: true,
    emergencyStopped: false, benchmarkId: previous.benchmarkId }), /SCOPE_MISMATCH/);
});

test("exact launcher routes to its own CLI with bound caps, preserving prior CLI routes", () => {
  const env = { ...environment(), NODE_OPTIONS: "untrusted-option", SARA_KERNEL_VERIFICATION_WORKERS: "2" };
  const spec = codingBenchmarkLaunchSpec({ environment: env, stateDirectory: "/data/lab", sourceRevision: env.RAILWAY_GIT_COMMIT_SHA });
  assert.equal(spec.args[2], "scripts/benchmark-exact-reuse-kernel.ts");
  const parsed = parseCodingBenchmarkCommand({ args: spec.args.slice(3), env: spec.environment, maximumCases: 1 });
  assert.equal(parsed.benchmarkId, grant.benchmarkId); assert.equal(parsed.maximumSpendUsd, .15);
  assert.equal(parsed.maximumModelSpendUsdPerArm, .05); assert.equal(parsed.sourceRevision, env.RAILWAY_GIT_COMMIT_SHA);
  assert.equal(spec.environment.SARA_REPARODYNAMIC_CODING_MODE, "canary");
  assert.equal(spec.environment.NODE_OPTIONS, undefined); assert.equal(spec.environment.SARA_KERNEL_VERIFICATION_WORKERS, undefined);
  for (const flag of ["--max-spend-usd", "--max-arm-spend-usd"]) {
    const args = spec.args.slice(3); args[args.indexOf(flag) + 1] = "0.16";
    assert.throws(() => parseCodingBenchmarkCommand({ args, env: spec.environment, maximumCases: 1 }));
  }
  for (const [older, path] of [[previous, "scripts/benchmark-kernel-coding.ts"], [observed, "scripts/benchmark-observed-reuse.ts"]] as const) {
    const oldSpec = codingBenchmarkLaunchSpec({ environment: { ...env, SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: older.activationSha256 },
      stateDirectory: "/data/lab", sourceRevision: env.RAILWAY_GIT_COMMIT_SHA });
    assert.equal(oldSpec.args[2], path); assert(oldSpec.args.includes(older.benchmarkId));
  }
});

test("runtime dispatch rejects stale activation or resumed-unready health without a provider request", async () => {
  const healthy: typeof fetch = async () => new Response(JSON.stringify({ ok: true, constitutionVerified: true, emergencyStopped: false }));
  await assertCodingBenchmarkRuntimeAuthority({ benchmarkId: grant.benchmarkId, environment: environment(), fetchImpl: healthy });
  await assert.rejects(assertCodingBenchmarkRuntimeAuthority({ benchmarkId: grant.benchmarkId,
    environment: { ...environment(), SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: previous.activationSha256 }, fetchImpl: healthy }), /SCOPE_MISMATCH/);
  await assert.rejects(assertCodingBenchmarkRuntimeAuthority({ benchmarkId: grant.benchmarkId, environment: environment(),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, constitutionVerified: true, emergencyStopped: true })) }), /EMERGENCY_STOP/);
});

test("exact evidence exports only bounded kernel jobs and traces, retaining historical isolation", () => fixture(async root => {
  const allowed = ["kernel-state/jobs/regenerate-0.json", "kernel-state/jobs/ordinary_memory-1.json", "kernel-state/jobs/optimized-3.json",
    "kernel-state/trace/kernel-registration.json", "kernel-state/trace/kernel-summary.json", "kernel-state/trace/reuse-budget-0001-reservation.json"];
  const excluded = ["kernel-state/jobs/optimized-4.json", "kernel-state/jobs/secret.json", "kernel-state/trace/secret.json",
    "kernel-state/private-state/secret.json", "reuse-state/jobs/optimized-0.json"];
  for (const id of [grant.benchmarkId, observed.benchmarkId]) for (const path of [...allowed, ...excluded]) {
    const parts = path.split("/"); const name = parts.pop()!;
    await writeBenchmarkAudit(join(root, "coding-repair-benchmarks", id, ...parts), name, { fixture: true });
  }
  const evidence = await readCodingBenchmarkEvidence(root, grant.benchmarkId);
  assert.deepEqual(evidence.files.map(file => file.path), allowed.sort());
  assert.equal(evidence.status, "claimed"); assert.equal(evidence.replayAllowed, false);
  assert.deepEqual((await readCodingBenchmarkEvidence(root, observed.benchmarkId)).files.map(file => file.path), ["reuse-state/jobs/optimized-0.json"]);
}));

for (const throws of [false, true]) {
  test(`exact execution claim prevents replay after ${throws ? "failure" : "success"}`, () => fixture(async root => {
    const d = sha256("offline-bound-source-and-authority");
    const manifest: CodingBenchmarkManifest = { schemaVersion: 1, benchmarkId: grant.benchmarkId,
      bindings: { sourceCommit: d, corpusDigest: d, modelDigest: d, controllerDigest: d, policyDigest: d,
        verifierDigest: d, environmentDigest: d, authorityDigest: d }, currentCanaryPercent: 5,
      maximumSpendUsd: grant.maximumSpendUsd, caseIds: ["full-kernel-exact-repeat"], createdAt: "2026-09-07T00:00:00.000Z" };
    await initializeCodingBenchmarkStore({ stateDirectory: root, manifest });
    let executions = 0;
    const execute = async () => { executions++; if (throws) throw new Error("uncertain execution failure"); return "completed"; };
    const first = withCodingBenchmarkExecution({ stateDirectory: root, manifest, execute });
    if (throws) await assert.rejects(first, /uncertain execution failure/); else assert.equal(await first, "completed");
    await assert.rejects(withCodingBenchmarkExecution({ stateDirectory: root, manifest, execute }), /already claimed/);
    assert.equal(executions, 1);
    const evidence = await readCodingBenchmarkEvidence(root, grant.benchmarkId);
    assert.equal(evidence.status, "claimed"); assert.equal(evidence.replayAllowed, false);
    assert(evidence.files.some(file => file.path === "execution-claim.json"));
  }));
}
