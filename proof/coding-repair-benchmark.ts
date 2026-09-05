import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/canonical.ts";
import {
  evaluateCodingBenchmarkPromotion,
  summarizeCodingBenchmark,
  type CodingBenchmarkBindings,
} from "../src/coding-repair-benchmark.ts";
import {
  initializeCodingBenchmarkStore,
  loadCodingBenchmarkProgress,
  persistCodingBenchmarkArmReceipt,
  persistCodingBenchmarkEvidenceSnapshot,
  persistCodingBenchmarkPairReceipt,
} from "../src/coding-repair-benchmark-store.ts";
import {
  runMatchedCodingBenchmarkCase,
  type CodingBenchmarkCase,
} from "../src/coding-repair-benchmark-runner.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (character: string): string => character.repeat(64);
const benchmarkId = "11111111-1111-4111-8111-111111111111";
const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Offline benchmark proof",
  summary: "A deterministic fixture for the no-spend evidence chain.",
  limitations: [],
  files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: "export const value = 1;\n" },
    { path: "tests/value.test.ts", content: "// immutable deterministic behavior\n" },
  ],
};
const benchmarkCase: CodingBenchmarkCase = {
  schemaVersion: 1,
  caseId: "offline-proof-001",
  taskClass: "synthetic",
  taskFamily: "offline-proof",
  objective: "Repair value so it equals 42.",
  acceptanceCriteria: ["The exported value equals 42."],
  baseline,
};
const bindings: CodingBenchmarkBindings = {
  sourceCommit: digest("1"),
  corpusDigest: digest("2"),
  modelDigest: digest("3"),
  controllerDigest: digest("4"),
  policyDigest: digest("5"),
  verifierDigest: digest("6"),
  environmentDigest: digest("7"),
  authorityDigest: digest("8"),
};

function verify(candidate: ProgramCandidateProposal): ProgramVerificationResult {
  const passed = candidate.files.some(
    (file) => file.path === "src/value.ts" && file.content.includes("42"),
  );
  const failure = {
    kind: "behavior" as const,
    code: "EXPECTED_42",
    file: "src/value.ts",
    line: 1,
    column: 1,
    evidenceDigest: digest("a"),
    fingerprint: digest("b"),
    severity: "medium" as const,
    existedBeforeRepair: true,
  };
  return {
    passed,
    score: passed ? 1 : 0.8,
    artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures: passed ? [] : [failure],
    completedChecks: [
      "source_policy",
      "syntax",
      "typecheck",
      "behavior_tests",
      "artifact_integrity",
    ],
    evidenceDigests: passed ? [digest("c")] : [failure.evidenceDigest],
  };
}

function model(): CodingRepairModel {
  return {
    propose: async ({ candidate, verification, strategy }) => ({
      proposal: {
        schemaVersion: 1,
        baseArtifactDigest: verification.artifactDigest,
        failureFingerprint: verification.failures[0].fingerprint,
        strategy,
        changes: [{
          path: "src/value.ts",
          expectedContentDigest: sha256(
            candidate.files.find((file) => file.path === "src/value.ts")!.content,
          ),
          replacementText: "export const value = 42;\n",
        }],
        limitations: [],
      },
      inputTokens: 20,
      outputTokens: 10,
      accountedCostUsd: 0.01,
    }),
  };
}

const stateDirectory = await mkdtemp(join(tmpdir(), "sara-benchmark-proof-"));
try {
  await initializeCodingBenchmarkStore({
    stateDirectory,
    manifest: {
      schemaVersion: 1,
      benchmarkId,
      bindings,
      currentCanaryPercent: 5,
      maximumSpendUsd: 0.3,
      caseIds: [benchmarkCase.caseId],
      createdAt: "2026-09-04T00:00:00.000Z",
    },
  });
  const pair = await runMatchedCodingBenchmarkCase({
    benchmarkId,
    pairIndex: 1,
    benchmarkCase,
    bindings,
    context: {
      objective: benchmarkCase.objective,
      acceptanceCriteria: benchmarkCase.acceptanceCriteria,
      missingCapabilities: [],
      constitutionDigest: digest("d"),
      memoryContext: { contextDigest: digest("e"), memories: [] },
    },
    verify: async (candidate) => verify(candidate),
    modelFor: () => model(),
    executionKind: "simulated",
    onArm: (receipt) => persistCodingBenchmarkArmReceipt({ stateDirectory, receipt }),
    completedAt: () => "2026-09-04T00:01:00.000Z",
  });
  await persistCodingBenchmarkPairReceipt({ stateDirectory, pair });
  const summary = summarizeCodingBenchmark({ pairs: [pair], bootstrapSamples: 500 });
  const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
  await persistCodingBenchmarkEvidenceSnapshot({ stateDirectory, summary, decision });
  const progress = await loadCodingBenchmarkProgress({ stateDirectory, benchmarkId });
  assert.equal(progress.armReceipts.length, 2);
  assert.equal(progress.pairs.length, 1);
  assert.equal(progress.snapshots.length, 1);
  assert.equal(summary.evidenceLevel, "SIMULATED");
  assert.equal(decision.action, "hold");
  assert.ok(decision.reasonCodes.includes("insufficient_matched_live_evidence"));
  console.log(JSON.stringify({
    proof: "coding-repair-benchmark",
    result: "PASS",
    evidenceLevel: summary.evidenceLevel,
    action: decision.action,
    pairCount: summary.pairCount,
    proofDigest: summary.proofDigest,
  }, null, 2));
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
