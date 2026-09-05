import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCodingBenchmarkPromotion,
  summarizeCodingBenchmark,
  type CodingBenchmarkArmResult,
  type CodingBenchmarkPairReceipt,
  type CodingBenchmarkTaskClass,
} from "../src/coding-repair-benchmark.ts";

const digest = (character: string): string => character.repeat(64);
const taskClasses: CodingBenchmarkTaskClass[] = [
  "synthetic",
  "reconstructed_sara",
  "licensed_public",
];

function arm(input: {
  method: CodingBenchmarkArmResult["method"];
  success: boolean;
  milliseconds: number;
  regression?: boolean;
}): CodingBenchmarkArmResult {
  return {
    method: input.method,
    verifiedComplete: input.success,
    finalScore: input.success ? 1 : 0.5,
    activeExecutionMilliseconds: input.milliseconds,
    accountedCostUsd: 0.1,
    inputTokens: 100,
    outputTokens: 50,
    cycles: input.method === "luna" ? 1 : 2,
    rollbacks: 0,
    changedFiles: 1,
    changedLines: 3,
    rye: input.success ? 1 : 0,
    regression: input.regression ?? false,
    criticalRegression: false,
    failureCode: input.success ? null : "verification_failed",
    finalArtifactDigest: input.method === "luna" ? digest("a") : digest("b"),
    verifierEvidenceDigests: [digest("c")],
  };
}

function pair(input: {
  index: number;
  normalSuccess: boolean;
  reparodynamicSuccess: boolean;
  normalMilliseconds?: number;
  reparodynamicMilliseconds?: number;
  reparodynamicRegression?: boolean;
}): CodingBenchmarkPairReceipt {
  const taskClass = taskClasses[(input.index - 1) % taskClasses.length];
  return {
    schemaVersion: 1,
    benchmarkId: "11111111-1111-4111-8111-111111111111",
    pairIndex: input.index,
    caseId: `quality-${String(input.index).padStart(3, "0")}`,
    taskClass,
    taskFamily: `family-${taskClasses.indexOf(taskClass) + 1}`,
    executionKind: "live",
    order: input.index % 2 === 0
      ? ["luna", "luna_reparodynamic"]
      : ["luna_reparodynamic", "luna"],
    bindings: {
      sourceCommit: digest("1"),
      corpusDigest: digest("2"),
      modelDigest: digest("3"),
      controllerDigest: digest("4"),
      policyDigest: digest("5"),
      verifierDigest: digest("6"),
      environmentDigest: digest("7"),
      authorityDigest: digest("8"),
    },
    normal: arm({
      method: "luna",
      success: input.normalSuccess,
      milliseconds: input.normalMilliseconds ?? 1_000,
    }),
    reparodynamic: arm({
      method: "luna_reparodynamic",
      success: input.reparodynamicSuccess,
      milliseconds: input.reparodynamicMilliseconds ?? 500,
      regression: input.reparodynamicRegression,
    }),
    completedAt: "2026-09-04T00:00:00.000Z",
  };
}

describe("coding benchmark absolute quality floor", () => {
  it("does not promote faster failure even when success is equivalent", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: false,
      reparodynamicSuccess: false,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 1_000 });
    assert.equal(summary.paired.relativeTimeReduction, 0.5);
    assert.equal(summary.reparodynamic.verifiedSuccessRate, 0);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "hold");
    assert.ok(decision.reasonCodes.includes("verified_quality_floor_not_met"));
  });

  it("does not expand on a supported lift while absolute verified success remains below 80 percent", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: index < 6,
      reparodynamicSuccess: index < 12,
      normalMilliseconds: 1_000,
      reparodynamicMilliseconds: 1_000,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 4_000 });
    assert.equal(summary.paired.verifiedSuccessDelta, 0.2);
    assert.ok(summary.paired.verifiedSuccessDelta95.lower > 0);
    assert.equal(summary.reparodynamic.verifiedSuccessRate, 0.4);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "hold");
    assert.ok(decision.reasonCodes.includes("verified_quality_floor_not_met"));
  });

  it("holds when noncritical regressions increase despite an otherwise supported speed gain", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: true,
      reparodynamicSuccess: true,
      reparodynamicRegression: index === 0,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 1_000 });
    assert.equal(summary.reparodynamic.regressions, 1);
    assert.equal(summary.normal.regressions, 0);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "hold");
    assert.ok(decision.reasonCodes.includes("noncritical_regression_increase"));
  });
});
