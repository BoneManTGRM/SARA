import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { aggregateCodingBenchmarkPairs, evaluateCodingRollout, type CodingBenchmarkPairReceipt } from "../src/coding-repair-evidence.ts";

function pair(index: number, options: { repairVerified?: boolean; escapedRegressions?: number; repairElapsed?: number; repairCost?: number; repairScore?: number } = {}): CodingBenchmarkPairReceipt {
  return {
    schemaVersion: 1,
    pairId: randomUUID(),
    corpusVersion: "repair-v1",
    taskId: `task-${index}`,
    taskDigest: sha256(`task-${index}`),
    canaryPercent: 5,
    executionOrder: ["baseline", "reparodynamic"],
    baseline: { arm: "baseline", verified: false, score: 0.8, retries: 0, rolledBackRepairs: 0, escapedRegressions: 0, accountedCostUsd: 0, elapsedMilliseconds: 100, rye: 0, evidenceDigests: [sha256(`b-${index}`)] },
    reparodynamic: { arm: "reparodynamic", verified: options.repairVerified ?? true, score: options.repairScore ?? 1, retries: 1, rolledBackRepairs: 0, escapedRegressions: options.escapedRegressions ?? 0, accountedCostUsd: options.repairCost ?? 0.05, elapsedMilliseconds: options.repairElapsed ?? 110, rye: 10, evidenceDigests: [sha256(`r-${index}`)] },
    observedAt: new Date(Date.UTC(2026, 8, 4, 0, index)).toISOString(),
  };
}

describe("Reparodynamic coding evidence gates", () => {
  it("aggregates paired baseline and Reparodynamic measurements", () => {
    const aggregate = aggregateCodingBenchmarkPairs({ receipts: [pair(1), pair(2, { repairVerified: false, repairScore: 0.8 })], corpusVersion: "repair-v1", canaryPercent: 5 });
    assert.equal(aggregate.comparablePairs, 2);
    assert.equal(aggregate.baseline.verifiedSuccessRate, 0);
    assert.equal(aggregate.reparodynamic.verifiedSuccessRate, 0.5);
    assert.equal(aggregate.successRateGainPercentagePoints, 50);
    assert.equal(aggregate.reparodynamic.meanRetries, 1);
    assert.equal(aggregate.incrementalMeanCostUsd, 0.05);
    assert.match(aggregate.aggregateDigest, /^[a-f0-9]{64}$/u);
  });

  it("expands only after the minimum paired evidence passes quality, time, cost, regression, and RYE gates", () => {
    const aggregate = aggregateCodingBenchmarkPairs({ receipts: Array.from({ length: 12 }, (_, index) => pair(index)), corpusVersion: "repair-v1", canaryPercent: 5 });
    const decision = evaluateCodingRollout({ aggregate });
    assert.equal(decision.decision, "expand");
    assert.equal(decision.nextCanaryPercent, 10);
    assert.equal(decision.claimStatus, "measured_directional");
  });

  it("rolls back immediately when independently measured output contains an escaped regression", () => {
    const receipts = Array.from({ length: 12 }, (_, index) => pair(index));
    receipts[4] = pair(4, { escapedRegressions: 1 });
    const aggregate = aggregateCodingBenchmarkPairs({ receipts, corpusVersion: "repair-v1", canaryPercent: 5 });
    const decision = evaluateCodingRollout({ aggregate });
    assert.equal(decision.decision, "rollback");
    assert.equal(decision.nextCanaryPercent, 0);
    assert(decision.reasonCodes.includes("escaped_regression"));
  });
});
