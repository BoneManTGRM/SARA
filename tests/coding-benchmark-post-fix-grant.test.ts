import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodingBenchmarkEvidence } from "../src/coding-benchmark-evidence.ts";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { codingBenchmarkLaunchSpec } from "../src/coding-benchmark-owner.ts";
import { activeCodingBenchmarkContinuation, assertCodingBenchmarkDispatch,
  inspectCodingBenchmarkReadiness, POST_FIX_CODING_BENCHMARK_GRANT,
  ADDITIONAL_CODING_BENCHMARK_GRANT, CODING_BENCHMARK_CONTINUATION,
} from "../src/coding-benchmark-readiness.ts";

const environment = { OPENAI_API_KEY: "offline-only", SARA_OWNER_TOKEN: "offline-owner",
  SARA_OWNER_TOKEN_SHA256: sha256("offline-owner"), RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: POST_FIX_CODING_BENCHMARK_GRANT.activationSha256 };
const input = { environment, constitutionVerified: true, emergencyStopped: false };

it("selects the separately approved post-fix allocation without releasing the old hold", () => {
  const result = inspectCodingBenchmarkReadiness(input);
  assert.equal(result.ready, true);
  assert.equal(result.benchmarkId, POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId);
  assert.equal(result.availableAuthorizationUsd, 0.15);
  assert.equal(result.maximumModelSpendUsdPerArm, 0.075);
  assert.deepEqual(result.historicalHold, { benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
    unresolvedExposureUsd: 0.15, confirmedChargeUsd: null });
  assert.equal(CODING_BENCHMARK_CONTINUATION.historicalResolutionEvidence, null);
  assert.equal(ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId, "33d94c9a-0de6-41d9-a843-fe9880994242");
});

it("does not spend this allocation using either historical identity", () => {
  for (const old of [CODING_BENCHMARK_CONTINUATION, ADDITIONAL_CODING_BENCHMARK_GRANT]) {
    assert.throws(() => assertCodingBenchmarkDispatch({ ...input, benchmarkId: old.benchmarkId }), /BENCHMARK_SCOPE_MISMATCH/);
  }
  assert.doesNotThrow(() => assertCodingBenchmarkDispatch({ ...input, benchmarkId: POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId }));
});

it("preserves previous activation behavior and fails closed on unknown activation", () => {
  assert.equal(activeCodingBenchmarkContinuation({}).benchmarkId, CODING_BENCHMARK_CONTINUATION.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({ SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: "f".repeat(64) }).benchmarkId,
    CODING_BENCHMARK_CONTINUATION.benchmarkId);
  assert.equal(activeCodingBenchmarkContinuation({ SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: ADDITIONAL_CODING_BENCHMARK_GRANT.activationSha256 }).benchmarkId,
    ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId);
  assert.throws(() => assertCodingBenchmarkDispatch({ ...input, emergencyStopped: true,
    benchmarkId: POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId }), /EMERGENCY_STOP/);
  assert.throws(() => assertCodingBenchmarkDispatch({ ...input, constitutionVerified: false,
    benchmarkId: POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId }), /CONSTITUTION_UNVERIFIED/);
});

it("passes the new identity through the unchanged CLI and preserves equal ceilings", () => {
  const spec = codingBenchmarkLaunchSpec({ environment, sourceRevision: "a".repeat(40), stateDirectory: "/data/sara/coding-benchmark-lab" });
  for (const [flag, expected] of [["--benchmark-id", POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId],
    ["--max-spend-usd", "0.15"], ["--max-arm-spend-usd", "0.075"], ["--case-count", "1"]]) {
    assert.equal(spec.args[spec.args.indexOf(flag!) + 1], expected);
  }
  assert.equal(spec.environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256, POST_FIX_CODING_BENCHMARK_GRANT.activationSha256);
});

it("retains the authorized PR111 task, hidden tests, model, controllers, verifier and CLI bytes", async () => {
  const pinned = {
  "src/genome-lab.ts": "ab1427a29742c1f657df3544e36197fa6dfa7a0103c472faa4618e18fe0692da",
  "src/genome-lab-verifier.ts": "6c3618bd6ffac193265dd7f687388543a41d059b625ad1cdc800dc5f115721c9",
  "src/coding-repair-controller.ts": "39e65a56c55887cddaedca740c6b5f9edcaccb90e702c3ed744ae5d3a302df95",
  "src/luna-coding-repair-model.ts": "89604cbd580ab462327d8842355367a15bbaeaec553b01eab984d2bafcbfe2bb",
  "src/coding-repair-prompt.ts": "3a0d72545d0c26823e09a0fd8f837c9c48854e4726aad3af1ff14b8a82d97e57",
  "src/coding-repair-live-benchmark-case.ts": "5f7447e5891014dea5a9e846ef4734303b53146a0c30c16f43447ff65015d752",
  "src/coding-repair-benchmark-runner.ts": "3f8e379315de19805ebcf3f08bfce1e46b3597f2a85ff38ed75cbe6f9fbb0b88",
  "scripts/benchmark-matched-coding-evidence.ts": "db82bb37d4804716b78d0f19a8ec372664850c2cedc1eff8cbcf1ed22f5acd49",
  "package.json": "f4dad9294070b398d28663ac878bf68ee12cdeedbcadcf83f28b49819d21504b",
  "package-lock.json": "2af53c1b9447041cb7bc2ed9526f9c3fde51f395fb5a19c8482c90c35552bf0e"
};
  for (const [path, expected] of Object.entries(pinned)) {
    assert.equal(sha256(await readFile(new URL(`../${path}`, import.meta.url), "utf8")), expected, path);
  }
});

it("exports only the new registered directory and treats a surviving claim as consumed", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-post-fix-grant-"));
  try {
    assert.equal((await readCodingBenchmarkEvidence(root, POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId)).status, "not_started");
    const trace = join(root, "coding-repair-benchmarks", POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId, "trace");
    await mkdir(trace, { recursive: true });
    await writeFile(join(trace, "owner-launch-claim.json"), "{unfinished");
    const evidence = await readCodingBenchmarkEvidence(root, POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId);
    assert.equal(evidence.status, "claimed");
    assert.equal(evidence.replayAllowed, false);
    assert.equal(evidence.files.length, 1);
    await assert.rejects(readCodingBenchmarkEvidence(root, "11111111-1111-4111-8111-111111111111"), /SCOPE_REJECTED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
