import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileLearningCampaign,
  LEARNING_MAXIMUM_FAILED_ROOTS_PER_CAPABILITY,
  learningContractDigest,
  selectLearningGap,
  type LearningContract,
} from "../src/learning-campaign.ts";
import type { StoredEvent } from "../src/store.ts";
import type { Job } from "../src/types.ts";

const contract: LearningContract = {
  capabilityId: "bounded-retry-fixture",
  objective: "Return the supplied fixture unchanged.",
  publicCriteria: ["Use only the supplied fixture."],
  acceptanceTests: [
    { name: "one", input: { value: 1 }, expected: { value: 1 } },
    { name: "two", input: { value: 2 }, expected: { value: 2 } },
  ],
  estimatedEffort: 1,
};

const campaign = compileLearningCampaign({
  id: "bounded-retry-campaign",
  maximumRequests: 100,
  contracts: [contract],
});
const contractDigest = learningContractDigest(contract);

const sourceJob: Job = {
  id: "source-job",
  kind: "self_development",
  status: "authorized",
  workCard: {
    id: "source-work-card",
    objective: "Complete useful work that needs the fixture capability.",
    expectedOwnerValue: 10,
    requiredCapabilities: [contract.capabilityId],
    missingCapabilities: [contract.capabilityId],
    acceptanceCriteria: ["Produce a verified result."],
    maximumBudgetUsd: 0,
    prohibitedActions: [],
    createdAt: "2026-09-11T00:00:00.000Z",
  },
};

function failedRoot(index: number): Job {
  return {
    id: `failed-root-${index}`,
    kind: "self_development",
    status: "failed",
    learningCampaignId: campaign.id,
    learningCapabilityId: contract.capabilityId,
    learningContractDigest: contractDigest,
    learningSourceJobId: sourceJob.id,
    workCard: {
      id: `failed-root-card-${index}`,
      objective: contract.objective,
      expectedOwnerValue: 10,
      requiredCapabilities: [contract.capabilityId],
      missingCapabilities: [contract.capabilityId],
      acceptanceCriteria: contract.publicCriteria,
      maximumBudgetUsd: 0,
      prohibitedActions: [],
      createdAt: `2026-09-11T00:0${index}:00.000Z`,
    },
  };
}

function selection(index: number): StoredEvent {
  return {
    type: "learning_gap_selected",
    data: {
      campaignId: campaign.id,
      capabilityId: contract.capabilityId,
      contractDigest,
      sourceJobId: sourceJob.id,
    },
    occurredAt: `2026-09-11T00:0${index}:00.000Z`,
  } as StoredEvent;
}

test("fresh learning roots stop after three terminal failures", () => {
  assert.equal(LEARNING_MAXIMUM_FAILED_ROOTS_PER_CAPABILITY, 3);

  const twoRoots = [failedRoot(1), failedRoot(2)];
  const retry = selectLearningGap(campaign, [sourceJob, ...twoRoots], [selection(1), selection(2)]);
  assert.equal(retry?.contract.capabilityId, contract.capabilityId);
  assert.equal(retry?.sourceJob.id, sourceJob.id);

  const threeRoots = [...twoRoots, failedRoot(3)];
  const stopped = selectLearningGap(campaign, [sourceJob, ...threeRoots], [selection(1), selection(2), selection(3)]);
  assert.equal(stopped, undefined);
});
