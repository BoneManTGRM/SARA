import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  evaluateCodingBenchmarkPromotion,
  summarizeCodingBenchmark,
  type CodingBenchmarkArmResult,
  type CodingBenchmarkBindings,
  type CodingBenchmarkPairReceipt,
} from "../src/coding-repair-benchmark.ts";
import {
  initializeCodingBenchmarkStore,
  persistCodingBenchmarkArmReceipt,
  persistCodingBenchmarkEvidenceSnapshot,
  persistCodingBenchmarkPairReceipt,
} from "../src/coding-repair-benchmark-store.ts";

const digest = (character: string): string => character.repeat(64);
const benchmarkId = "11111111-1111-4111-8111-111111111111";
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

function arm(method: CodingBenchmarkArmResult["method"]): CodingBenchmarkArmResult {
  return {
    method,
    verifiedComplete: true,
    finalScore: 1,
    activeExecutionMilliseconds: 1_000,
    accountedCostUsd: 0.1,
    inputTokens: 100,
    outputTokens: 50,
    cycles: 1,
    rollbacks: 0,
    changedFiles: 1,
    changedLines: 1,
    rye: 1,
    regression: false,
    criticalRegression: false,
    failureCode: null,
    finalArtifactDigest: method === "luna" ? digest("a") : digest("b"),
    verifierEvidenceDigests: [digest("c")],
  };
}

function pair(): CodingBenchmarkPairReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    pairIndex: 1,
    caseId: "case-001",
    taskClass: "synthetic",
    taskFamily: "completion",
    executionKind: "live",
    order: ["luna_reparodynamic", "luna"],
    bindings,
    normal: arm("luna"),
    reparodynamic: arm("luna_reparodynamic"),
    completedAt: "2026-09-04T00:01:00.000Z",
  };
}

test("an evidence snapshot requires every case in the frozen manifest", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-benchmark-completion-"));
  try {
    await initializeCodingBenchmarkStore({
      stateDirectory,
      manifest: {
        schemaVersion: 1,
        benchmarkId,
        bindings,
        currentCanaryPercent: 5,
        maximumSpendUsd: 1,
        caseIds: ["case-001", "case-002"],
        createdAt: "2026-09-04T00:00:00.000Z",
      },
    });
    for (const method of ["luna", "luna_reparodynamic"] as const) {
      await persistCodingBenchmarkArmReceipt({
        stateDirectory,
        receipt: {
          schemaVersion: 1,
          benchmarkId,
          pairIndex: 1,
          caseId: "case-001",
          bindings,
          result: arm(method),
          completedAt: "2026-09-04T00:00:30.000Z",
        },
      });
    }
    await persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() });
    const summary = summarizeCodingBenchmark({ pairs: [pair()], bootstrapSamples: 500 });
    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    await assert.rejects(
      persistCodingBenchmarkEvidenceSnapshot({ stateDirectory, summary, decision }),
      /entire frozen benchmark corpus/,
    );
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
