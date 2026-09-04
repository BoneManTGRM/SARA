import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runPairedCodingBenchmark } from "../src/coding-repair-benchmark.ts";
import { digestCodingBenchmarkBindings, type CodingBenchmarkBindings } from "../src/coding-repair-evidence.ts";

const bindings: CodingBenchmarkBindings = {
  repositoryDigest: sha256("repository"), commitDigest: sha256("commit"), criteriaDigest: sha256("criteria"),
  modelDigest: sha256("model"), baselineMethodDigest: sha256("baseline"), reparodynamicMethodDigest: sha256("repair"),
  verifierDigest: sha256("verifier"), environmentDigest: sha256("environment"), authorityDigest: sha256("authority"),
  budgetDigest: sha256("budget"), compilerDigest: sha256("compiler"), runtimeDigest: sha256("runtime"), toolchainDigest: sha256("toolchain"),
};
const measurement = {
  verified: true, firstPass: true, score: 1, retries: 0, cycles: 1, rolledBackRepairs: 0,
  criticalRegressions: 0, escapedRegressions: 0, changedFiles: 0, changedLines: 0,
  inputTokens: 100, outputTokens: 50, accountedCostUsd: 0.04, repairCostUsd: 0,
  activeExecutionMilliseconds: 10, rye: 1, reusedVerifiedLessons: 0,
  completionDigest: sha256("completion"), evidenceDigests: [sha256("evidence")],
};

describe("paired coding benchmark runner", () => {
  it("runs both arms against one deeply frozen digest-only task identity and records deterministic order", async () => {
    const observed: Array<{ arm: string; task: unknown }> = [];
    const task = {
      taskId: "task-1", taskClass: "licensed_public_typescript" as const, trialIndex: 2, evidenceKind: "real" as const,
      taskDigest: sha256("task-1"), caseDigest: sha256("case-1"), startingArtifactDigest: sha256("artifact-1"),
      licenseDigest: sha256("mit-license"), bindings,
    };
    const receipt = await runPairedCodingBenchmark({
      pairId: randomUUID(), protocolDigest: sha256("protocol"), corpusVersion: "repair-v1", corpusDigest: sha256("corpus"),
      currentIdentityDigest: digestCodingBenchmarkBindings(bindings), task, canaryPercent: 5,
      runBaseline: async (received) => { observed.push({ arm: "baseline", task: received }); return measurement; },
      runReparodynamic: async (received) => { observed.push({ arm: "reparodynamic", task: received }); return { ...measurement, retries: 1, cycles: 2, repairCostUsd: 0.01, accountedCostUsd: 0.05, rye: 10 }; },
      observedAt: "2026-09-04T00:00:00.000Z",
    });
    assert.deepEqual(observed.map((entry) => entry.arm), receipt.executionOrder);
    assert.equal(observed[0]!.task, observed[1]!.task);
    assert.equal(Object.isFrozen(observed[0]!.task), true);
    assert.equal(Object.isFrozen((observed[0]!.task as { bindings: object }).bindings), true);
    assert.equal(receipt.identityDigest, digestCodingBenchmarkBindings(bindings));
    assert.equal(receipt.baseline.arm, "baseline");
    assert.equal(receipt.reparodynamic.arm, "reparodynamic");
  });
});
