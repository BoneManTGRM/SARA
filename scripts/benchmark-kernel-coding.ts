import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { parseCodingBenchmarkCommand } from "../src/coding-repair-benchmark-command.ts";
import { persistentBenchmarkStateDirectory } from "../src/coding-benchmark-owner.ts";
import { KERNEL_CODING_BENCHMARK_GRANT as grant, assertCodingBenchmarkRuntimeAuthority } from "../src/coding-benchmark-readiness.ts";
import { initializeCodingBenchmarkStore, withCodingBenchmarkExecution, type CodingBenchmarkManifest } from "../src/coding-repair-benchmark-store.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { currentBenchmarkCase } from "../src/current-coding-benchmark.ts";
import { KERNEL_BENCHMARK_PROTOCOL, assertKernelBenchmarkImplementation, runKernelCodingBenchmark } from "../src/kernel-coding-benchmark.ts";
import { KERNEL_BENCHMARK_PINS } from "../src/kernel-coding-benchmark-pins.ts";
const start = performance.now();
const config = parseCodingBenchmarkCommand({ args: process.argv.slice(2), env: process.env, maximumCases: 1 });
if (config.benchmarkId !== grant.benchmarkId || config.maximumSpendUsd !== .15 || config.maximumModelSpendUsdPerArm !== .05 ||
    config.sourceRevision !== process.env.RAILWAY_GIT_COMMIT_SHA ||
    config.stateDirectory !== await persistentBenchmarkStateDirectory(process.env.SARA_STATE_DIRECTORY)) throw new Error("KERNEL_BENCHMARK_EXACT_AUTHORITY_REQUIRED");
const beforeDispatch = () => assertCodingBenchmarkRuntimeAuthority({ benchmarkId: config.benchmarkId, environment: process.env });
await beforeDispatch(); await assertKernelBenchmarkImplementation();
const sourceBindings = Object.fromEntries(await Promise.all(["src/kernel-coding-benchmark.ts", "src/kernel-coding-benchmark-pins.ts", "scripts/benchmark-kernel-coding.ts",
  "src/coding-benchmark-readiness.ts", "src/coding-benchmark-owner.ts", "src/coding-benchmark-evidence.ts", "src/coding-benchmark-github-relay.ts"]
  .map(async path => [path, sha256(await readFile(new URL(`../${path}`, import.meta.url)))])));
const manifest: CodingBenchmarkManifest = { schemaVersion: 1, benchmarkId: grant.benchmarkId,
  bindings: { sourceCommit: sha256(config.sourceRevision), authorityDigest: config.authorityDigest,
    corpusDigest: sha256(canonicalJson(currentBenchmarkCase())), modelDigest: sha256(canonicalJson({ model: "gpt-5.6-luna", reasoning: "medium", deadlineMs: 45000, maxOutput: 8000 })),
    controllerDigest: sha256(canonicalJson(sourceBindings)), policyDigest: sha256(canonicalJson(KERNEL_BENCHMARK_PROTOCOL)),
    verifierDigest: sha256(canonicalJson(KERNEL_BENCHMARK_PINS)), environmentDigest: sha256(canonicalJson({ node: process.version, platform: process.platform, arch: process.arch })) },
  maximumSpendUsd: .15, currentCanaryPercent: 5, caseIds: ["full-kernel-exact-repeat"], createdAt: new Date().toISOString() };
await initializeCodingBenchmarkStore({ stateDirectory: config.stateDirectory, manifest });
await withCodingBenchmarkExecution({ stateDirectory: config.stateDirectory, manifest, execute: async () => {
  const root = join(config.stateDirectory, "coding-repair-benchmarks", grant.benchmarkId);
  await writeBenchmarkAudit(join(root, "trace"), "trial-registration.json", { manifest, sourceBindings,
    protocol: KERNEL_BENCHMARK_PROTOCOL, sourcePins: KERNEL_BENCHMARK_PINS, sourceRevision: config.sourceRevision,
    setupMilliseconds: performance.now() - start });
  try {
    await runKernelCodingBenchmark({ directory: join(root, "kernel-state"), benchmarkId: grant.benchmarkId,
      apiKey: config.apiKey, executionKind: "live", beforeDispatch });
  } finally {
    let summary = null;
    try { summary = JSON.parse(await readFile(join(root, "kernel-state/trace/kernel-summary.json"), "utf8")).payload; }
    catch { /* No execution restart. Missing evidence keeps whole authorization held. */ }
    await writeBenchmarkAudit(join(root, "trace"), "terminal-accounting.json", {
      accounting: summary?.accounting ?? null, maximumReservedAuthorizationUsd: .15, grantConsumed: true,
      providerChargesReconciled: false, replayAllowed: false, cliElapsedMilliseconds: performance.now() - start,
      summaryPresent: summary !== null, allComplete: summary?.allComplete === true,
      timingBoundary: KERNEL_BENCHMARK_PROTOCOL.primaryTiming });
    console.log(JSON.stringify({ benchmarkId: grant.benchmarkId, status: summary?.allComplete ? "completed" : "incomplete",
      aggregates: summary?.aggregates ?? null, warmRatios: summary?.warmRatios ?? null,
      learningInclusiveRatios: summary?.learningInclusiveRatios ?? null, accounting: summary?.accounting ?? null,
      kernelJobMeasured: true, isolatedLab: true, maximumIsObservedNotAbsolute: true }));
  }
} });
