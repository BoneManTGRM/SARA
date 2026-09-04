import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCodingBenchmarkPromotion,
  summarizeCodingBenchmark,
  type CodingBenchmarkPairReceipt,
  type CodingBenchmarkTaskClass,
} from "../src/coding-repair-benchmark.ts";

const digest = (character: string): string => character.repeat(64);

function pair(input: {
  index: number;
  normalSuccess: boolean;
  reparodynamicSuccess: boolean;
  normalCostUsd?: number | null;
  reparodynamicCostUsd?: number | null;
  normalMilliseconds?: number;
  reparodynamicMilliseconds?: number;
  taskClass?: CodingBenchmarkTaskClass;
  taskFamily?: string;
  environmentDigest?: string;
  executionKind?: "simulated" | "live";
  normalCriticalRegression?: boolean;
  reparodynamicCriticalRegression?: boolean;
}): CodingBenchmarkPairReceipt {
  const taskClass = input.taskClass ?? "synthetic";
  const taskFamily = input.taskFamily ?? "bounded-typescript";
  const normalMilliseconds = input.normalMilliseconds ?? 1_000;
  const reparodynamicMilliseconds = input.reparodynamicMilliseconds ?? 1_000;
  return {
    schemaVersion: 1,
    benchmarkId: "11111111-1111-4111-8111-111111111111",
    pairIndex: input.index,
    caseId: `case-${String(input.index).padStart(3, "0")}`,
    taskClass,
    taskFamily,
    executionKind: input.executionKind ?? "live",
    order: input.index % 2 === 0 ? ["luna", "luna_reparodynamic"] : ["luna_reparodynamic", "luna"],
    bindings: {
      sourceCommit: digest("1"),
      corpusDigest: digest("2"),
      modelDigest: digest("3"),
      controllerDigest: digest("4"),
      policyDigest: digest("5"),
      verifierDigest: digest("6"),
      environmentDigest: input.environmentDigest ?? digest("7"),
      authorityDigest: digest("8"),
    },
    normal: {
      method: "luna",
      verifiedComplete: input.normalSuccess,
      finalScore: input.normalSuccess ? 1 : 0.8,
      activeExecutionMilliseconds: normalMilliseconds,
      accountedCostUsd: input.normalCostUsd === undefined ? 0.1 : input.normalCostUsd,
      inputTokens: 100,
      outputTokens: 50,
      cycles: 1,
      rollbacks: 0,
      changedFiles: 1,
      changedLines: 3,
      rye: input.normalSuccess ? 1 : 0,
      regression: false,
      criticalRegression: input.normalCriticalRegression ?? false,
      failureCode: input.normalSuccess ? null : "verification_failed",
      finalArtifactDigest: digest("a"),
      verifierEvidenceDigests: [digest("b")],
    },
    reparodynamic: {
      method: "luna_reparodynamic",
      verifiedComplete: input.reparodynamicSuccess,
      finalScore: input.reparodynamicSuccess ? 1 : 0.8,
      activeExecutionMilliseconds: reparodynamicMilliseconds,
      accountedCostUsd: input.reparodynamicCostUsd === undefined ? 0.1 : input.reparodynamicCostUsd,
      inputTokens: 100,
      outputTokens: 50,
      cycles: input.reparodynamicSuccess ? 2 : 3,
      rollbacks: input.reparodynamicSuccess ? 0 : 1,
      changedFiles: 1,
      changedLines: 3,
      rye: input.reparodynamicSuccess ? 1 : 0,
      regression: false,
      criticalRegression: input.reparodynamicCriticalRegression ?? false,
      failureCode: input.reparodynamicSuccess ? null : "verification_failed",
      finalArtifactDigest: digest("c"),
      verifierEvidenceDigests: [digest("d")],
    },
    completedAt: "2026-09-04T00:00:00.000Z",
  };
}

describe("matched Reparodynamic coding benchmark", () => {
  it("measures a supported success lift and opens only the next canary stage", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: index < 6,
      reparodynamicSuccess: index < 12,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 4_000 });
    assert.equal(summary.evidenceLevel, "MEASURED");
    assert.equal(summary.paired.verifiedSuccessDelta, 0.2);
    assert.ok(summary.paired.verifiedSuccessDelta95.lower > 0);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "expand_canary");
    assert.equal(decision.recommendedCanaryPercent, 20);
    assert.ok(decision.reasonCodes.includes("verified_success_gain_supported"));
  });

  it("holds when the matched interval crosses zero", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: index < 15,
      reparodynamicSuccess: index >= 15,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 4_000 });
    assert.ok(summary.paired.verifiedSuccessDelta95.lower <= 0);
    assert.ok(summary.paired.verifiedSuccessDelta95.upper >= 0);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "hold");
    assert.equal(decision.recommendedCanaryPercent, 5);
    assert.ok(decision.reasonCodes.includes("no_supported_major_benefit"));
  });

  it("requires replicated evidence across three material task classes before full canary", () => {
    const classes: CodingBenchmarkTaskClass[] = ["synthetic", "reconstructed_sara", "licensed_public"];
    const pairs = Array.from({ length: 100 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: false,
      reparodynamicSuccess: true,
      taskClass: classes[index % classes.length],
      taskFamily: `family-${index % 3}`,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 4_000 });
    assert.equal(summary.evidenceLevel, "REPLICATED");

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 50 });
    assert.equal(decision.action, "expand_canary");
    assert.equal(decision.recommendedCanaryPercent, 100);
  });

  it("marks mixed or changed benchmark bindings stale and blocks promotion", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: false,
      reparodynamicSuccess: true,
      environmentDigest: index === 29 ? digest("9") : digest("7"),
    }));
    const summary = summarizeCodingBenchmark({
      pairs,
      expectedBindings: { environmentDigest: digest("7") },
      bootstrapSamples: 2_000,
    });
    assert.equal(summary.evidenceLevel, "STALE");
    assert.ok(summary.staleReasons.includes("mixed_environment_digest"));

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "hold");
    assert.ok(decision.reasonCodes.includes("stale_evidence"));
  });

  it("accepts a supported cost reduction only at equivalent verified success", () => {
    const pairs = Array.from({ length: 30 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: true,
      reparodynamicSuccess: true,
      normalCostUsd: 0.1,
      reparodynamicCostUsd: 0.05,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 2_000 });
    assert.equal(summary.paired.verifiedSuccessDelta, 0);
    assert.ok(summary.paired.relativeCostReduction95?.lower !== undefined);
    assert.ok(summary.paired.relativeCostReduction95!.lower >= 0.25);

    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
    assert.equal(decision.action, "expand_canary");
    assert.ok(decision.reasonCodes.includes("equivalent_success_cost_reduction_supported"));
  });

  it("recommends rollback when critical regressions increase", () => {
    const pairs = Array.from({ length: 10 }, (_, index) => pair({
      index: index + 1,
      normalSuccess: true,
      reparodynamicSuccess: true,
      reparodynamicCriticalRegression: index === 0,
    }));
    const summary = summarizeCodingBenchmark({ pairs, bootstrapSamples: 1_000 });
    const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 20 });
    assert.equal(decision.action, "rollback_to_shadow");
    assert.equal(decision.recommendedCanaryPercent, 0);
    assert.ok(decision.reasonCodes.includes("critical_regression_increase"));
  });
});
