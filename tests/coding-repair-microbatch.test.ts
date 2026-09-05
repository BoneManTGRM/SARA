import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runVerifiedCodingMicroBatch } from "../src/coding-repair-microbatch.ts";

const tasks = [
  { id: "a", objective: "Return x + 1", source: "export const f = (x) => x;" },
  { id: "b", objective: "Return x * 2", source: "export const f = (x) => x;" },
  { id: "c", objective: "Return x - 1", source: "export const f = (x) => x;" },
] as const;

const fourTasks = [
  ...tasks,
  { id: "d", objective: "Return x / 2", source: "export const f = (x) => x;" },
] as const;

describe("verified coding microbatch", () => {
  it("completes three independent repairs in one model call only when each independently verifies", async () => {
    let batchCalls = 0;
    let singleCalls = 0;
    const result = await runVerifiedCodingMicroBatch({
      tasks,
      maximumSpendUsd: 0.15,
      model: {
        async proposeBatch(requests) {
          batchCalls += 1;
          return {
            proposals: requests.map((task) => ({ id: task.id, source: `${task.source}\n// fixed` })),
            accountedCostUsd: 0.03,
            inputTokens: 300,
            outputTokens: 300,
            elapsedMilliseconds: 100,
          };
        },
        async proposeSingle() {
          singleCalls += 1;
          throw new Error("single fallback should not be needed");
        },
      },
      verify: async (_task, candidate) => ({ passed: candidate.includes("// fixed"), score: 1 }),
    });

    assert.equal(batchCalls, 1);
    assert.equal(singleCalls, 0);
    assert.equal(result.verifiedComplete, 3);
    assert.equal(result.modelCalls, 1);
    assert.equal(result.modelCallThroughputRatio, 3);
    assert.equal(result.modelCallThroughputIncreasePercent, 200);
    assert.equal(result.accuracyPreserved, true);
    assert.equal(result.generalClaimSupported, false);
  });

  it("supports a four-repair verified batch with a 300% model-call throughput ceiling", async () => {
    const result = await runVerifiedCodingMicroBatch({
      tasks: fourTasks,
      maximumSpendUsd: 0.15,
      model: {
        async proposeBatch(requests) {
          return {
            proposals: requests.map((task) => ({ id: task.id, source: `${task.source}\n// fixed` })),
            accountedCostUsd: 0.04,
            inputTokens: 400,
            outputTokens: 400,
            elapsedMilliseconds: 100,
          };
        },
        async proposeSingle() { throw new Error("unused"); },
      },
      verify: async (_task, candidate) => ({ passed: candidate.includes("// fixed"), score: 1 }),
    });

    assert.equal(result.verifiedComplete, 4);
    assert.equal(result.modelCalls, 1);
    assert.equal(result.modelCallThroughputRatio, 4);
    assert.equal(result.modelCallThroughputIncreasePercent, 300);
    assert.equal(result.accuracyPreserved, true);
  });

  it("keeps verified batch repairs and retries only the failed member", async () => {
    let singleCalls = 0;
    const result = await runVerifiedCodingMicroBatch({
      tasks,
      maximumSpendUsd: 0.15,
      model: {
        async proposeBatch(requests) {
          return {
            proposals: requests.map((task) => ({
              id: task.id,
              source: task.id === "b" ? task.source : `${task.source}\n// fixed`,
            })),
            accountedCostUsd: 0.03,
            inputTokens: 300,
            outputTokens: 250,
            elapsedMilliseconds: 100,
          };
        },
        async proposeSingle(task) {
          singleCalls += 1;
          return {
            proposal: { id: task.id, source: `${task.source}\n// fixed` },
            accountedCostUsd: 0.01,
            inputTokens: 100,
            outputTokens: 100,
            elapsedMilliseconds: 100,
          };
        },
      },
      verify: async (_task, candidate) => ({ passed: candidate.includes("// fixed"), score: candidate.includes("// fixed") ? 1 : 0 }),
    });

    assert.equal(singleCalls, 1);
    assert.equal(result.verifiedComplete, 3);
    assert.equal(result.modelCalls, 2);
    assert.equal(result.accountedCostUsd, 0.04);
    assert.equal(result.results.find((entry) => entry.id === "a")?.attempts, 1);
    assert.equal(result.results.find((entry) => entry.id === "b")?.attempts, 2);
    assert.equal(result.results.find((entry) => entry.id === "c")?.attempts, 1);
    assert.equal(result.accuracyPreserved, true);
  });

  it("runs independent failed-member fallbacks concurrently and accounts wall-clock model time", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    const result = await runVerifiedCodingMicroBatch({
      tasks: fourTasks,
      maximumSpendUsd: 0.15,
      model: {
        async proposeBatch(requests) {
          return {
            proposals: requests.map((task) => ({
              id: task.id,
              source: task.id === "a" || task.id === "d" ? `${task.source}\n// fixed` : task.source,
            })),
            accountedCostUsd: 0.04,
            inputTokens: 400,
            outputTokens: 300,
            elapsedMilliseconds: 100,
          };
        },
        async proposeSingle(task) {
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, task.id === "b" ? 25 : 15));
          inFlight -= 1;
          return {
            proposal: { id: task.id, source: `${task.source}\n// fixed` },
            accountedCostUsd: 0.01,
            inputTokens: 100,
            outputTokens: 100,
            elapsedMilliseconds: task.id === "b" ? 125 : 115,
          };
        },
      },
      verify: async (_task, candidate) => ({ passed: candidate.includes("// fixed"), score: candidate.includes("// fixed") ? 1 : 0 }),
    });

    assert.equal(maximumInFlight, 2);
    assert.equal(result.verifiedComplete, 4);
    assert.equal(result.modelCalls, 3);
    assert.equal(result.accountedCostUsd, 0.06);
    assert.equal(result.activeModelMilliseconds, 225);
    assert.equal(result.accuracyPreserved, true);
  });

  it("fails closed on malformed batch identity instead of applying a proposal to the wrong task", async () => {
    await assert.rejects(
      () => runVerifiedCodingMicroBatch({
        tasks,
        maximumSpendUsd: 0.15,
        model: {
          async proposeBatch() {
            return {
              proposals: [
                { id: "a", source: "x" },
                { id: "a", source: "y" },
                { id: "c", source: "z" },
              ],
              accountedCostUsd: 0.01,
              inputTokens: 10,
              outputTokens: 10,
              elapsedMilliseconds: 10,
            };
          },
          async proposeSingle() { throw new Error("unused"); },
        },
        verify: async () => ({ passed: true, score: 1 }),
      }),
      /batch proposal identities/i,
    );
  });
});
