import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runPairedCodingBenchmark } from "../src/coding-repair-benchmark.ts";

const measurement = {
  verified: true,
  score: 1,
  retries: 0,
  rolledBackRepairs: 0,
  escapedRegressions: 0,
  accountedCostUsd: 0,
  elapsedMilliseconds: 10,
  rye: 1,
  evidenceDigests: [sha256("evidence")],
};

describe("paired coding benchmark runner", () => {
  it("runs both arms against one immutable task identity and records deterministic order", async () => {
    const observed: Array<{ arm: string; task: unknown }> = [];
    const task = { taskId: "task-1", taskDigest: sha256("task-1") };
    const receipt = await runPairedCodingBenchmark({
      pairId: randomUUID(),
      protocolDigest: sha256("protocol-v1"),
      corpusVersion: "repair-v1",
      task,
      canaryPercent: 5,
      runBaseline: async (received) => { observed.push({ arm: "baseline", task: received }); return measurement; },
      runReparodynamic: async (received) => { observed.push({ arm: "reparodynamic", task: received }); return { ...measurement, retries: 1, accountedCostUsd: 0.05, rye: 10 }; },
      observedAt: "2026-09-04T00:00:00.000Z",
    });
    assert.deepEqual(observed.map((entry) => entry.arm), receipt.executionOrder);
    assert.deepEqual(observed.map((entry) => entry.task), [task, task]);
    assert.equal(Object.isFrozen(observed[0]!.task), true);
    assert.equal(receipt.baseline.arm, "baseline");
    assert.equal(receipt.reparodynamic.arm, "reparodynamic");
    assert.equal(receipt.taskDigest, task.taskDigest);
  });
});
