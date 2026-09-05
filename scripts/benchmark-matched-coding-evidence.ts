import * as ts from "typescript";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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
import { runCodingBenchmarkArm } from "../src/coding-repair-benchmark-runner.ts";
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
    cases: structuredClone(LIVE_CODING_BENCHMARK_CORPUS.cases.slice(0, caseCount)),
  };
}

function knownSpend(receipts: CodingBenchmarkArmReceipt[]): number {
  if (receipts.some((receipt) => receipt.result.accountedCostUsd === null)) {
    throw new Error("A completed benchmark arm has unknown spend; further paid execution is blocked.");
  }
  return receipts.reduce((total, receipt) => total + receipt.result.accountedCostUsd!, 0);
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
const sourceIdentityMethod = await assertExactSourceCheckout(config.sourceRevision);
const armLimits = {
  ...structuredClone(INITIAL_CODING_REPAIR_LIMITS),
  maximumModelSpendUsd: config.maximumModelSpendUsdPerArm,
};
const corpus = selectedCorpus(config.caseCount);
if (corpus.cases.length !== 1) {
  throw new Error("The fresh live benchmark requires its complete frozen one-task corpus.");
}
const corpusDigest = liveCodingBenchmarkCorpusDigest();
const constitutionSource = await readFile(
  new URL("../constitution/constitution.v1.json", import.meta.url),
  "utf8",
);
const constitutionDigest = sha256(constitutionSource);
const client = new OpenAIResponsesClient({ apiKey: config.apiKey });
const modelImplementationDigest = await digestSourceFiles([
  "src/luna-coding-repair-model.ts",
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
    "src/coding-repair-benchmark-runner.ts",
    "src/coding-repair-prompt.ts",
    "src/coding-repair-artifacts.ts",
  ]),
  policyDigest: await digestSourceFiles(["src/coding-repair-policy.ts"]),
  verifierDigest: await digestSourceFiles([
    "src/genome-lab-verifier.ts",
    "src/genome-lab.ts",
    "src/coding-repair-live-benchmark-case.ts",
  ]),
  environmentDigest: sha256(canonicalJson({
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    typescript: ts.version,
    benchmarkRuntimeSchemaVersion: 2,
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
        const spentUsd = knownSpend(progress.armReceipts);
        if (
          spentUsd + armLimits.maximumModelSpendUsd
          > config.maximumSpendUsd + 1e-9
        ) {
          throw new Error(
            "The live coding benchmark stopped before exceeding its owner-authorized spend cap.",
          );
        }
        const result = await runCodingBenchmarkArm({
          method,
          benchmarkCase,
          context,
          verify: (candidate) => verifyLiveCodingBenchmarkCandidate({
            candidate,
            objective: benchmarkCase.objective,
            acceptanceCriteria: benchmarkCase.acceptanceCriteria,
            constitutionDigest,
            maximumBudgetUsd: armLimits.maximumModelSpendUsd,
          }),
          model: createLunaCodingRepairModel({ client, context }),
          limits: armLimits,
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
        if (result.accountedCostUsd === null) {
          throw new Error(
            "The arm result has unknown spend; it was preserved and further paid execution is blocked.",
          );
        }
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
        accountedCostUsd: Number(knownSpend(progress.armReceipts).toFixed(6)),
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
