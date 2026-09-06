import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { parseCodingBenchmarkCommand } from "../src/coding-repair-benchmark-command.ts";
import { persistentBenchmarkStateDirectory } from "../src/coding-benchmark-owner.ts";
import { OBSERVED_REUSE_BENCHMARK_GRANT as grant, assertCodingBenchmarkRuntimeAuthority } from "../src/coding-benchmark-readiness.ts";
import { initializeCodingBenchmarkStore, withCodingBenchmarkExecution, type CodingBenchmarkManifest } from "../src/coding-repair-benchmark-store.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
import { assertCurrentImplementation, currentBenchmarkCase, CURRENT_COMPONENT_PINS } from "../src/current-coding-benchmark.ts";
import { OBSERVED_REUSE_PROTOCOL, runObservedReuseBenchmark } from "../src/observed-reuse-benchmark.ts";
// Fixed new implementation pins; historical runner and its grant remain unchanged.
const hardeningPins = {
  "src/repair-memory-snapshot.ts": "4b2d04606eeb3450986a2cc9d4521b519b6526db689cd2828de17158774fcc23",
  "src/coding-repair-memory.ts": "e2bcc68365b13b4574036e7c015f14c7b8a1770eefcb67377785d5cdb5064955",
  "src/reusable-coding-candidate-generator.ts": "fbef343b2d278d8ba827e4199cc7d8925c9cb2d47aa7bdeaf5f122da3cc74bea",
  "src/reuse-speed-benchmark.ts": "d55ad68a692315fd455705841f30a732b244cdcf497e186e2733f591ec26018a",
  "src/observed-reuse-benchmark.ts": "051f25101377e1a5c2a3edc203ec2803255c41332763d793bd592da6bab71872",
  "src/bounded-provider-body.ts": "77573a94e7292c387e82b3106749ed7ab2dd83997595aa71732b774b8d9b31b1",
  "src/self-build-http-timing.ts": "bcd8c0c27cd8256d623cd909974cba28e4268208d627ff7e790b57a4fa9c5558",
  "src/main.ts": "6882ba4389374411310f75b3ab9e0f7bd48507cfff20a8955269264ac28d94e0"
};
for (const [path, digest] of Object.entries(hardeningPins)) {
  if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error("HARDENED_REUSE_SOURCE_DRIFT");
}
const start = performance.now();
const config = parseCodingBenchmarkCommand({ args: process.argv.slice(2), env: process.env, maximumCases: 1 });
if (config.benchmarkId !== grant.benchmarkId || config.maximumSpendUsd !== .15 || config.maximumModelSpendUsdPerArm !== .05 ||
  config.sourceRevision !== process.env.RAILWAY_GIT_COMMIT_SHA ||
  config.stateDirectory !== await persistentBenchmarkStateDirectory(process.env.SARA_STATE_DIRECTORY)) throw new Error("REUSE_SPEED_EXACT_GRANT_REQUIRED");
const beforeDispatch = () => assertCodingBenchmarkRuntimeAuthority({ benchmarkId: config.benchmarkId, environment: process.env });
await beforeDispatch(); await assertCurrentImplementation();
const native = await NativeCodingVerifier.create(); if (!native) throw new Error("REUSE_SPEED_NATIVE_UNAVAILABLE");
const harness = await Promise.all(["src/observed-reuse-benchmark.ts", "src/bounded-provider-body.ts", "src/self-build-http-timing.ts", "src/main.ts", "scripts/benchmark-observed-reuse.ts", "src/coding-benchmark-readiness.ts",
  "src/coding-benchmark-owner.ts", "src/coding-benchmark-evidence.ts", "src/coding-benchmark-audit.ts", "src/coding-benchmark-github-relay.ts",
  "src/reusable-coding-candidate-generator.ts", "src/coding-repair-memory.ts", "src/coding-repair-singleflight.ts", "src/repair-memory-snapshot.ts"]
  .map(async path => [path, sha256(await readFile(new URL(`../${path}`, import.meta.url)))]));
const manifest: CodingBenchmarkManifest = { schemaVersion: 1, benchmarkId: grant.benchmarkId,
  bindings: { sourceCommit: sha256(config.sourceRevision), authorityDigest: config.authorityDigest,
    corpusDigest: sha256(canonicalJson(currentBenchmarkCase())), modelDigest: sha256(canonicalJson(CURRENT_COMPONENT_PINS)),
    controllerDigest: sha256(canonicalJson(harness)), policyDigest: sha256(canonicalJson(OBSERVED_REUSE_PROTOCOL)),
    verifierDigest: native.engineDigest, environmentDigest: sha256(canonicalJson({ node: process.version, platform: process.platform, arch: process.arch })) },
  maximumSpendUsd: .15, currentCanaryPercent: 5, caseIds: ["maximum-observed-reuse-components"], createdAt: new Date().toISOString() };
await initializeCodingBenchmarkStore({ stateDirectory: config.stateDirectory, manifest });
await withCodingBenchmarkExecution({ stateDirectory: config.stateDirectory, manifest, execute: async () => {
  const root = join(config.stateDirectory,"coding-repair-benchmarks",grant.benchmarkId);
  await writeBenchmarkAudit(join(root,"trace"),"trial-registration.json", { manifest, harness, componentPins: CURRENT_COMPONENT_PINS,
    protocol: OBSERVED_REUSE_PROTOCOL, hardeningPins, setupMilliseconds: performance.now()-start, exactRevision: config.sourceRevision });
  try {
    await runObservedReuseBenchmark({ directory: join(root,"reuse-state"), benchmarkId: grant.benchmarkId,
      apiKey: config.apiKey, native, executionKind: "live", beforeDispatch });
  } finally {
    const raw = await readFile(join(root,"reuse-state/trace/reuse-summary.json"),"utf8");
    const summary = JSON.parse(raw).payload;
    await writeBenchmarkAudit(join(root,"trace"),"terminal-accounting.json", { ...summary.accounting,
      maximumReservedAuthorizationUsd: .15, grantConsumed: true, replayAllowed: false, providerChargesReconciled: false,
      cliElapsedMilliseconds: performance.now()-start, summarySha256: sha256(raw),
      included: "CLI setup,empty benchmark memory,all jobs,learning,failures,actual fresh checks,mandatory receipts",
      excluded: "process/module startup,deployment,CI,evidence retrieval; not normal production HTTP/kernel jobs" });
    console.log(JSON.stringify({ benchmarkId: grant.benchmarkId, status: summary.allComplete ? "completed" : "incomplete",
      aggregates: summary.aggregates, warmRatios: summary.warmRatios, learningInclusiveRatios: summary.learningInclusiveRatios,
      accounting: summary.accounting, maximumIsObservedNotAbsolute: true }));
  }
} });
