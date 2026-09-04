import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { aggregateCodingBenchmarkPairs, evaluateCodingRollout, type CodingBenchmarkPairReceipt } from "../src/coding-repair-evidence.ts";

function pair(index: number, options: { repairVerified?: boolean; escapedRegressions?: number; repairElapsed?: number; repairCost?: number; repairScore?: number; canaryPercent?: number; taskId?: string; taskDigest?: string } = {}): CodingBenchmarkPairReceipt {
  return {
    schemaVersion: 1,
    pairId: randomUUID(),
    protocolDigest: sha256("protocol-v1"),
    corpusVersion: "repair-v1",
    taskId: options.taskId ?? `task-${index}`,
    taskDigest: options.taskDigest ?? sha256(options.taskId ?? `task-${index}`),
    canaryPercent: options.canaryPercent ?? 5,
    executionOrder: ["baseline", "reparodynamic"],
    baseline: { arm: "baseline", verified: false, score: 0.8, retries: 0, rolledBackRepairs: 0, escapedRegressions: 0, accountedCostUsd: 0, elapsedMilliseconds: 100, rye: 0, evidenceDigests: [sha256(`b-${index}`)] },
    reparodynamic: { arm: "reparodynamic", verified: options.repairVerified ?? true, score: options.repairScore ?? 1, retries: 1, rolledBackRepairs: 0, escapedRegressions: options.escapedRegressions ?? 0, accountedCostUsd: options.repairCost ?? 0.05, elapsedMilliseconds: options.repairElapsed ?? 110, rye: 10, evidenceDigests: [sha256(`r-${index}`)] },
    observedAt: new Date(Date.UTC(2026, 8, 4, 0, index)).toISOString(),
  };
}

describe("Reparodynamic coding evidence gates", () => {
  it("aggregates paired baseline and Reparodynamic measurements", () => {
    const aggregate = aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts: [pair(1), pair(2, { repairVerified: false, repairScore: 0.8 })], corpusVersion: "repair-v1", canaryPercent: 5 });
    assert.equal(aggregate.comparablePairs, 2);
    assert.equal(aggregate.baseline.verifiedSuccessRate, 0);
    assert.equal(aggregate.reparodynamic.verifiedSuccessRate, 0.5);
    assert.equal(aggregate.successRateGainPercentagePoints, 50);
    assert.equal(aggregate.reparodynamic.meanRetries, 1);
    assert.equal(aggregate.incrementalMeanCostUsd, 0.05);
    assert.match(aggregate.aggregateDigest, /^[a-f0-9]{64}$/u);
  });

  it("expands only after the minimum paired evidence passes quality, time, cost, regression, and RYE gates", () => {
    const aggregate = aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts: Array.from({ length: 12 }, (_, index) => pair(index)), corpusVersion: "repair-v1", canaryPercent: 5 });
    const decision = evaluateCodingRollout({ aggregate });
    assert.equal(decision.decision, "expand");
    assert.equal(decision.nextCanaryPercent, 10);
    assert.equal(decision.claimStatus, "measured_directional");
  });

  it("rolls back immediately when independently measured output contains an escaped regression", () => {
    const receipts = Array.from({ length: 12 }, (_, index) => pair(index));
    receipts[4] = pair(4, { escapedRegressions: 1 });
    const aggregate = aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts, corpusVersion: "repair-v1", canaryPercent: 5 });
    const decision = evaluateCodingRollout({ aggregate });
    assert.equal(decision.decision, "rollback");
    assert.equal(decision.nextCanaryPercent, 0);
    assert(decision.reasonCodes.includes("escaped_regression"));
  });

  it("holds expansion when repeated trials do not cover enough unique tasks", () => {
    const receipts = Array.from({ length: 12 }, (_, index) => pair(index, { taskId: "task-one" }));
    const aggregate = aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts, corpusVersion: "repair-v1", canaryPercent: 5 });
    const decision = evaluateCodingRollout({ aggregate });
    assert.equal(aggregate.uniqueTasks, 1);
    assert.equal(decision.decision, "hold");
    assert(decision.reasonCodes.includes("insufficient_unique_tasks"));
  });

  it("marks default use only after sustained evidence at the full canary stage", () => {
    const receipts = Array.from({ length: 50 }, (_, index) => pair(index, { canaryPercent: 100, taskId: `task-${index % 20}` }));
    const aggregate = aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts, corpusVersion: "repair-v1", canaryPercent: 100 });
    const decision = evaluateCodingRollout({ aggregate });
    assert.equal(aggregate.uniqueTasks, 20);
    assert.equal(decision.decision, "eligible_default");
    assert.equal(decision.claimStatus, "sustained_verified_improvement");
  });

  it("rejects a changed task digest within one frozen corpus", () => {
    const receipts = [
      pair(1, { taskId: "task-one", taskDigest: sha256("version-one") }),
      pair(2, { taskId: "task-one", taskDigest: sha256("version-two") }),
    ];
    assert.throws(
      () => aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts, corpusVersion: "repair-v1", canaryPercent: 5 }),
      /task identity changed/,
    );
  });

  it("rejects unsupported fields so raw model output cannot enter receipts", () => {
    const receipt = pair(1) as CodingBenchmarkPairReceipt & { outputText?: string };
    receipt.outputText = "untrusted raw output";
    assert.throws(
      () => aggregateCodingBenchmarkPairs({ protocolDigest: sha256("protocol-v1"), receipts: [receipt], corpusVersion: "repair-v1", canaryPercent: 5 }),
      /unsupported fields/,
    );
  });

});
