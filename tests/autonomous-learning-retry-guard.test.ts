import assert from "node:assert/strict";
import { test } from "node:test";
import { AutonomousLearningWorker } from "../src/autonomous-learning-worker.ts";
import type { SaraKernel } from "../src/kernel.ts";
import type { CandidateGenerator, Job } from "../src/types.ts";

const generator: CandidateGenerator = {
  id: "retry-guard-fixture",
  external: false,
  maximumCostUsd: 0,
  async generate() {
    throw new Error("not called");
  },
};

function learningJob(id: string, status: Job["status"], parent?: string): Job {
  return {
    id,
    kind: "self_development",
    status,
    learningCampaignId: "retry-guard-campaign",
    learningCapabilityId: "retry-guard-capability",
    learningContractDigest: "a".repeat(64),
    learningSourceJobId: "source-job",
    ...(parent ? { learningParentJobId: parent, learningRootJobId: "failed-1" } : {}),
    workCard: {
      id: `card-${id}`,
      objective: "Exercise retry guard.",
      expectedOwnerValue: 1,
      requiredCapabilities: ["autonomous-learning"],
      missingCapabilities: ["retry-guard-capability"],
      acceptanceCriteria: ["Remain bounded."],
      maximumBudgetUsd: 0,
      prohibitedActions: [],
      createdAt: "2026-09-11T00:00:00.000Z",
    },
  };
}

test("worker refuses a stale fourth fresh root after three terminal roots failed", () => {
  const worker = new AutonomousLearningWorker({} as SaraKernel, generator);
  const jobs = [
    learningJob("failed-1", "failed"),
    learningJob("failed-2", "failed"),
    learningJob("failed-3", "failed"),
    learningJob("stale-fourth-root", "authorized"),
  ];
  const retryBudgetExhausted = (worker as unknown as { retryBudgetExhausted(value: Job[]): boolean }).retryBudgetExhausted.bind(worker);
  assert.equal(retryBudgetExhausted(jobs), true);
});

test("worker does not apply the fresh-root ceiling to an authorized child repair", () => {
  const worker = new AutonomousLearningWorker({} as SaraKernel, generator);
  const jobs = [
    learningJob("failed-1", "failed"),
    learningJob("failed-2", "failed"),
    learningJob("failed-3", "failed"),
    learningJob("child-repair", "authorized", "failed-1"),
  ];
  const retryBudgetExhausted = (worker as unknown as { retryBudgetExhausted(value: Job[]): boolean }).retryBudgetExhausted.bind(worker);
  assert.equal(retryBudgetExhausted(jobs), false);
});
