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
const classes: CodingBenchmarkTaskClass[] = [
  "synthetic",
  "reconstructed_sara",
  "licensed_public",
];

function arm(input: {
  method: CodingBenchmarkArmResult["method"];
  milliseconds: number;
  costUsd: number | null;
}): CodingBenchmarkArmResult {
  return {
    method: input.method,
    verifiedComplete: true,
    finalScore: 1,
    activeExecutionMilliseconds: input.milliseconds,
    accountedCostUsd: input.costUsd,
    inputTokens: input.costUsd === null ? null : 100,
    outputTokens: input.costUsd === null ? null : 50,
    cycles: input.method === "luna" ? 1 : 2,
    rollbacks: 0,
    changedFiles: 1,
    changedLines: 3,
    rye: 1,
    regression: false,
    criticalRegression: false,
    failureCode: null,
    finalArtifactDigest: input.method === "luna" ? digest("a") : digest("b"),
    verifierEvidenceDigests: [digest("c")],
  };
}

function pair(input: {
  index: number;
  taskClass: CodingBenchmarkTaskClass;
  normalMilliseconds?: number;
  reparodynamicMilliseconds?: number;
  normalCostUsd?: number | null;
  reparodynamicCostUsd?: number | null;
}): CodingBenchmarkPairReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: "11111111-1111-4111-8111-111111111111",
    pairIndex: input.index,
    caseId: `safety-${String(input.index).padStart(3, "0")}`,
    taskClass: input.taskClass,
    taskFamily: `family-${classes.indexOf(input.taskClass) + 1}`,
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
      milliseconds: input.normalMilliseconds ?? 1_000,
      costUsd: input.normalCostUsd === undefined ? 0.1 : input.normalCostUsd,
    }),
    reparodynamic: arm({
      method: "luna_reparodynamic",
      milliseconds: input.reparodynamicMilliseconds ?? 1_000,
      costUsd: input.reparodynamicCostUsd === undefined ? 0.1 : input.reparodynamicCostUsd,
    }),
    completedAt: "2026-09-04T00:00:00.000Z",
  };
}

function balancedPairs(
  customize: (index: number) => Partial<Parameters<typeof pair>[0]> = () => ({}),
): CodingBenchmarkPairReceipt[] {
  return Array.from({ length: 30 }, (_, index) => pair({
    index: index + 1,
    taskClass: classes[index % classes.length],
    ...customize(index),
  }));
}

describe("coding benchmark promotion safety", () => {
  it("supports a substantial paired time reduction at equivalent verified success", () => {
    const summary = summarizeCodingBenchmark({
      pairs: balancedPairs(() => ({
        normalMilliseconds: 1_000,
        reparodynamicMilliseconds: 500,
      })),
      bootstrapSamples: 2_000,
    });
    assert.equal(summary.evidenceLevel, "MEASURED");
    assert.equal(summary.paired.relativeTimeReduction, 0.5);
    assert.equal(summary.paired.relativeTimeReduction95.lower, 0.5);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "expand_canary");
    assert.ok(decision.reasonCodes.includes("equivalent_success_time_reduction_supported"));
  });

  it("does not promote from a single favorable cost pair when other costs are unknown", () => {
    const summary = summarizeCodingBenchmark({
      pairs: balancedPairs((index) => index === 0
        ? { normalCostUsd: 0.1, reparodynamicCostUsd: 0.05 }
        : { normalCostUsd: null, reparodynamicCostUsd: null }),
      bootstrapSamples: 1_000,
    });
    assert.equal(summary.paired.costComparablePairs, 1);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "hold");
    assert.ok(decision.reasonCodes.includes("no_supported_major_benefit"));
  });

  it("keeps a token three-class sample at LAB until every class has ten cases", () => {
    const taskClasses: CodingBenchmarkTaskClass[] = [
      ...Array.from({ length: 28 }, () => "synthetic" as const),
      "reconstructed_sara",
      "licensed_public",
    ];
    const summary = summarizeCodingBenchmark({
      pairs: taskClasses.map((taskClass, index) => pair({
        index: index + 1,
        taskClass,
      })),
      bootstrapSamples: 1_000,
    });
    assert.equal(summary.distinctTaskClasses, 3);
    assert.equal(summary.evidenceLevel, "LAB");
  });
});
