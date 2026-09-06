import * as ts from "typescript";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { persistentBenchmarkStateDirectory } from "../src/coding-benchmark-owner.ts";
import { createBenchmarkAudit, benchmarkSpendExposure, writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { assertCodingBenchmarkRuntimeAuthority } from "../src/coding-benchmark-readiness.ts";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { parseCodingBenchmarkCommand } from "../src/coding-repair-benchmark-command.ts";
import { verifyCodingBenchmarkSourceIdentity, type CodingBenchmarkSourceIdentityMethod } from "../src/coding-benchmark-source-identity.ts";
import type { CodingBenchmarkCorpus } from "../src/coding-repair-benchmark-corpus.ts";
import {
  LIVE_CODING_BENCHMARK_CORPUS,
  liveCodingBenchmarkCorpusDigest,
  verifyLiveCodingBenchmarkCandidate,
} from "../src/coding-repair-live-benchmark-case.ts";
import {
  initializeCodingBenchmarkStore,
  withCodingBenchmarkExecution,
  loadCodingBenchmarkProgress,
  missingCodingBenchmarkArms,
  persistCodingBenchmarkArmReceipt,
  persistCodingBenchmarkEvidenceSnapshot,
  persistCodingBenchmarkPairReceipt,
  type CodingBenchmarkArmReceipt,
  type CodingBenchmarkManifest,
} from "../src/coding-repair-benchmark-store.ts";
import { runCurrentCodingBenchmarkArm, currentBenchmarkCase, assertCurrentImplementation, CURRENT_COMPONENT_PINS } from "../src/current-coding-benchmark.ts";
import { CURRENT_CODING_BENCHMARK_GRANT } from "../src/coding-benchmark-readiness.ts";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
import {
  evaluateCodingBenchmarkPromotion,
  summarizeCodingBenchmark,
  type CodingBenchmarkBindings,
  type CodingBenchmarkMethod,
  type CodingBenchmarkPairReceipt,
} from "../src/coding-repair-benchmark.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";

const cliStarted = performance.now();
const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);

async function assertExactSourceCheckout(expectedRevision: string): Promise<CodingBenchmarkSourceIdentityMethod> {
  try {
    const [revisionResult, statusResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 5_000,
      }),
      execFileAsync("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 5_000,
      }),
    ]);
    return verifyCodingBenchmarkSourceIdentity({
      expectedRevision,
      gitRevision: String(revisionResult.stdout),
      gitTrackedChanges: String(statusResult.stdout),
    });
  } catch (error) {
    if (error instanceof Error && /clean tracked source checkout|does not match|malformed/iu.test(error.message)) {
      throw error;
    }
    return verifyCodingBenchmarkSourceIdentity({
      expectedRevision,
      railwayGitCommitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
    });
  }
}

async function digestSourceFiles(paths: string[]): Promise<string> {
  const sources = await Promise.all(paths.map(async (path) => ({
    path,
    content: await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
  })));
  return sha256(canonicalJson(sources));
}

function selectedCorpus(caseCount: number): CodingBenchmarkCorpus {
  return {
    ...structuredClone(LIVE_CODING_BENCHMARK_CORPUS),
    corpusId: "sara-current-components-free-windows-v1",
    limitations: ["One previously used authored task, one cold paired observation; not general speed evidence.",
      "Current component pipeline including native checking and two fresh TS5 final checks; no kernel job or persistent repair reuse measured.",
      "The control shares retry policy and within-task lessons; this is not all Reparodynamics off.",
      "Protected acceptance content is excluded from model prompts; immutable test path/digest metadata may be visible."],
    cases: [currentBenchmarkCase()],
  };
}

function exposure(receipts: CodingBenchmarkArmReceipt[], maximumArmSpendUsd: number) {
  return benchmarkSpendExposure(receipts.map(receipt => receipt.result.accountedCostUsd), maximumArmSpendUsd);
}

function assertManifestMatches(
  expected: Omit<CodingBenchmarkManifest, "createdAt">,
  actual: CodingBenchmarkManifest,
): void {
  const comparable = ({ createdAt: _createdAt, ...rest }: CodingBenchmarkManifest) => rest;
  if (canonicalJson(comparable(actual)) !== canonicalJson(expected)) {
    throw new Error(
      "The existing benchmark manifest does not match this source, corpus, authority, budget, or canary stage.",
    );
  }
}

async function loadOrInitialize(input: {
  stateDirectory: string;
  manifest: Omit<CodingBenchmarkManifest, "createdAt">;
}): Promise<Awaited<ReturnType<typeof loadCodingBenchmarkProgress>>> {
  try {
    const progress = await loadCodingBenchmarkProgress({
      stateDirectory: input.stateDirectory,
      benchmarkId: input.manifest.benchmarkId,
    });
    assertManifestMatches(input.manifest, progress.manifest);
    return progress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await initializeCodingBenchmarkStore({
      stateDirectory: input.stateDirectory,
      manifest: { ...input.manifest, createdAt: new Date().toISOString() },
    });
    return loadCodingBenchmarkProgress({
      stateDirectory: input.stateDirectory,
      benchmarkId: input.manifest.benchmarkId,
    });
  }
}

const config = parseCodingBenchmarkCommand({
  args: process.argv.slice(2),
  env: process.env,
  maximumCases: LIVE_CODING_BENCHMARK_CORPUS.cases.length,
});
if (config.benchmarkId !== CURRENT_CODING_BENCHMARK_GRANT.benchmarkId) throw new Error("CURRENT_PILOT_GRANT_REQUIRED");
const sourceIdentityMethod = await assertExactSourceCheckout(config.sourceRevision);
await assertCurrentImplementation();
const native = await NativeCodingVerifier.create();
if (!native) throw new Error("CURRENT_PILOT_NATIVE_REQUIRED");
const assertRuntimeAuthority = () => assertCodingBenchmarkRuntimeAuthority({ benchmarkId: config.benchmarkId, environment: process.env });
// Fail before creating/consuming any new claim. The original unresolved exposure
// remains blocked even if an operator changes the UUID or state path.
await assertRuntimeAuthority();
if (config.maximumSpendUsd !== 0.15 || config.maximumModelSpendUsdPerArm !== 0.075
    || config.stateDirectory !== await persistentBenchmarkStateDirectory(process.env.SARA_STATE_DIRECTORY)) {
  throw new Error("The benchmark must use the original equal ceilings and existing persistent lab directory.");
}
const armLimits = {
  ...structuredClone(INITIAL_CODING_REPAIR_LIMITS),
  maximumModelSpendUsd: config.maximumModelSpendUsdPerArm,
};
const corpus = selectedCorpus(config.caseCount);
if (corpus.cases.length !== 1) {
  throw new Error("The fresh live benchmark requires its complete frozen one-task corpus.");
}
const corpusDigest = sha256(canonicalJson({ historicalTaskDigest: liveCodingBenchmarkCorpusDigest(), case: currentBenchmarkCase() }));
const constitutionSource = await readFile(
  new URL("../constitution/constitution.v1.json", import.meta.url),
  "utf8",
);
const constitutionDigest = sha256(constitutionSource);
const client = new OpenAIResponsesClient({ apiKey: config.apiKey });
let observedModelIdentity: string | null = null;
const modelImplementationDigest = await digestSourceFiles([
  "src/luna-coding-repair-model.ts", "src/adaptive-coding-repair-model.ts",
  "src/openai-worker.ts",
  "src/model-router.ts",
]);
const bindings: CodingBenchmarkBindings = {
  sourceCommit: sha256(config.sourceRevision),
  corpusDigest,
  modelDigest: sha256(canonicalJson({
    routeKey: client.routeKey,
    implementationDigest: modelImplementationDigest,
  })),
  controllerDigest: await digestSourceFiles([
    "src/coding-repair-controller.ts",
    "src/coding-repair-benchmark-runner.ts", "src/current-coding-benchmark-runner.ts", "src/current-coding-benchmark.ts",
    "src/coding-repair-prompt.ts",
    "src/coding-repair-artifacts.ts",
    "src/coding-benchmark-audit.ts",
    "src/coding-benchmark-readiness.ts",
  ]),
  policyDigest: await digestSourceFiles(["src/coding-repair-policy.ts"]),
  verifierDigest: await digestSourceFiles([
    "src/genome-lab-verifier.ts", "src/native-coding-verifier.ts", "src/fresh-typecheck-host.ts", "tools/native-checker/integrity.json",
    "src/genome-lab.ts",
    "src/coding-repair-live-benchmark-case.ts",
  ]),
  environmentDigest: sha256(canonicalJson({
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    typescript: ts.version,
    benchmarkRuntimeSchemaVersion: 3,
    nativeEngineDigest: native.engineDigest,
    measuredScope: "current_components_cold_pilot",
    sourceIdentityMethod,
  })),
  authorityDigest: config.authorityDigest,
};
const manifest: Omit<CodingBenchmarkManifest, "createdAt"> = {
  schemaVersion: 1,
  benchmarkId: config.benchmarkId,
  bindings,
  currentCanaryPercent: config.currentCanaryPercent,
  maximumSpendUsd: config.maximumSpendUsd,
  caseIds: corpus.cases.map((benchmarkCase) => benchmarkCase.caseId),
};
let progress = await loadOrInitialize({
  stateDirectory: config.stateDirectory,
  manifest,
});

// This irreversible guard precedes every paid arm. A crash cannot turn missing
// receipt evidence into permission to repeat a possibly charged request.
await withCodingBenchmarkExecution({
  stateDirectory: config.stateDirectory,
  manifest: progress.manifest,
  execute: async () => {
    await writeBenchmarkAudit(join(config.stateDirectory, "coding-repair-benchmarks", config.benchmarkId, "trace"), "trial-registration.json", {
      experiment: "current_components_cold_pilot", implementationRevision: CURRENT_CODING_BENCHMARK_GRANT.registrationSourceRevision,
      runtimeRevision: config.sourceRevision, componentPins: CURRENT_COMPONENT_PINS, nativeEngineDigest: native.engineDigest,
      originalTask: "live-free-windows-001", taskSeenInHistoricalTrial: true,
      methods: { luna: "conventional_retry_and_last_two_lessons_default_TS5_full_files",
        luna_reparodynamic: "current_repair_controller_native_loop_adaptive_format_fresh_TS5_final" },
      finalAcceptance: "fresh_optimized_TS5_final_then_separate_default_TS5_for_both_arms",
      measured: "cold_component_pipeline_only", kernelJobMeasured: false, persistentReuseMeasured: false,
      generalSpeedupClaimPermitted: false, repetitionCount: 1, order: ["luna_reparodynamic", "luna"],
      maximumSpendUsd: 0.15, maximumModelSpendUsdPerArm: 0.075, replayAllowed: false,
    });
    for (let index = 0; index < corpus.cases.length; index += 1) {
      const benchmarkCase = corpus.cases[index]!;
      const pairIndex = index + 1;
      if (progress.pairs.some((pair) => pair.pairIndex === pairIndex)) continue;
      const context = {
        objective: benchmarkCase.objective,
        acceptanceCriteria: [...benchmarkCase.acceptanceCriteria],
        missingCapabilities: [],
        constitutionDigest,
        memoryContext: {
          contextDigest: sha256(canonicalJson({
            corpusDigest,
            caseId: benchmarkCase.caseId,
            objective: benchmarkCase.objective,
            acceptanceCriteria: benchmarkCase.acceptanceCriteria,
          })),
          memories: [],
        },
      };
      // Pair 1 is preregistered Reparodynamic-first by the existing deterministic parity rule.
      const order: [CodingBenchmarkMethod, CodingBenchmarkMethod] = pairIndex % 2 === 0
        ? ["luna", "luna_reparodynamic"]
        : ["luna_reparodynamic", "luna"];
      const missing = new Set(missingCodingBenchmarkArms(progress, pairIndex));
      for (const method of order) {
        if (!missing.has(method)) continue;
        const spentUsd = exposure(progress.armReceipts, config.maximumModelSpendUsdPerArm).totalExposureUsd;
        if (
          spentUsd + armLimits.maximumModelSpendUsd
          > config.maximumSpendUsd + 1e-9
        ) {
          throw new Error(
            "The live coding benchmark stopped before exceeding its owner-authorized spend cap.",
          );
        }
        await assertRuntimeAuthority();
        const audit = createBenchmarkAudit({
          directory: join(config.stateDirectory, "coding-repair-benchmarks", config.benchmarkId, "trace"),
          method, beforeDispatch: assertRuntimeAuthority,
          onModelIdentity: async (identity) => {
            if (observedModelIdentity !== null && observedModelIdentity !== identity) {
              throw new Error("The actual model identity changed within the matched trial.");
            }
            observedModelIdentity = identity;
          },
        });
        const auditedClient = new OpenAIResponsesClient({ apiKey: config.apiKey, fetchImpl: audit.fetch });
        const result = await runCurrentCodingBenchmarkArm({ method, benchmarkCase, context,
          client: auditedClient, native, limits: armLimits, beforeDispatch: assertRuntimeAuthority,
          onEvidence: (kind, payload) => audit.record(kind, payload),
        });
        const receipt: CodingBenchmarkArmReceipt = {
          schemaVersion: 1,
          benchmarkId: config.benchmarkId,
          pairIndex,
          caseId: benchmarkCase.caseId,
          bindings,
          result,
          completedAt: new Date().toISOString(),
        };
        await persistCodingBenchmarkArmReceipt({
          stateDirectory: config.stateDirectory,
          receipt,
        });
        // An unknown arm keeps its full $0.075 reserved. The other arm has a
        // separate equal allocation; continuing it is not permission to retry
        // the failed arm or reclaim its unresolved reservation.
        progress = await loadCodingBenchmarkProgress({
          stateDirectory: config.stateDirectory,
          benchmarkId: config.benchmarkId,
        });
      }
      const completedArms = progress.armReceipts.filter(
        (receipt) => receipt.pairIndex === pairIndex,
      );
      const normal = completedArms.find(
        (receipt) => receipt.result.method === "luna",
      )?.result;
      const reparodynamic = completedArms.find(
        (receipt) => receipt.result.method === "luna_reparodynamic",
      )?.result;
      if (!normal || !reparodynamic) {
        throw new Error(
          "The matched pair cannot be finalized until both immutable arm receipts exist.",
        );
      }
      const pair: CodingBenchmarkPairReceipt = {
        schemaVersion: 1,
        benchmarkId: config.benchmarkId,
        pairIndex,
        caseId: benchmarkCase.caseId,
        taskClass: benchmarkCase.taskClass,
        taskFamily: benchmarkCase.taskFamily,
        executionKind: "live",
        order,
        bindings,
        normal,
        reparodynamic,
        completedAt: new Date().toISOString(),
      };
      await persistCodingBenchmarkPairReceipt({
        stateDirectory: config.stateDirectory,
        pair,
      });
      progress = await loadCodingBenchmarkProgress({
        stateDirectory: config.stateDirectory,
        benchmarkId: config.benchmarkId,
      });
      console.log(JSON.stringify({
        benchmarkId: config.benchmarkId,
        pairIndex,
        caseId: benchmarkCase.caseId,
        order,
        maximumModelSpendUsdPerArm: config.maximumModelSpendUsdPerArm,
        completedPairs: progress.pairs.length,
        totalPairs: corpus.cases.length,
        ...exposure(progress.armReceipts, config.maximumModelSpendUsdPerArm),
        costsAreEstimates: true,
      }));
    }

    const summary = summarizeCodingBenchmark({
      pairs: progress.pairs,
      expectedBindings: bindings,
    });
    const decision = evaluateCodingBenchmarkPromotion({
      summary,
      currentCanaryPercent: config.currentCanaryPercent,
    });
    await persistCodingBenchmarkEvidenceSnapshot({
      stateDirectory: config.stateDirectory,
      summary,
      decision,
    });
    await writeBenchmarkAudit(join(config.stateDirectory, "coding-repair-benchmarks", config.benchmarkId, "trace"), "terminal-accounting.json", {
      ...exposure(progress.armReceipts, config.maximumModelSpendUsdPerArm),
      costsAreEstimates: true, providerChargesReconciled: false,
      cliElapsedMilliseconds: performance.now() - cliStarted,
      included: "CLI preflight, source/task binding, initial/repair/final verification, model requests, failures, and evidence persistence through summary",
      excluded: "process/module startup, deployment, CI, evidence download and subsequent audit",
    });
    console.log(JSON.stringify({
      status: "completed",
      evidenceScope: corpus.evidenceScope,
      promotionEligibleCorpus: corpus.promotionEligible,
      corpusLimitations: corpus.limitations,
      summary,
      decision,
    }, null, 2));
  },
});
