import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AutonomousLearningWorker } from "../src/autonomous-learning-worker.ts";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { compileLearningCampaign, type LearningCampaignInput, type LearningContract } from "../src/learning-campaign.ts";
import type { CandidateGenerator } from "../src/types.ts";

const ownerToken = "curriculum-continuation-owner";
const identityTests = [
  { name: "object", input: { value: 7 }, expected: { value: 7 } },
  { name: "array", input: [3, 5], expected: [3, 5] },
];
const contract = (capabilityId: string): LearningContract => ({
  capabilityId,
  objective: `Preserve input while exercising ${capabilityId}.`,
  publicCriteria: ["Return the supplied input unchanged."],
  acceptanceTests: identityTests,
  estimatedEffort: 1,
});
const generator: CandidateGenerator = {
  id: "curriculum-continuation-fixture",
  external: false,
  maximumCostUsd: 0,
  async generate() {
    return {
      schemaVersion: 1,
      skillName: "Curriculum continuation fixture",
      summary: "Deterministic test fixture only.",
      source: "export function runSkill(input: unknown): unknown { return input; }",
      tests: [{ name: "producer", input: 1, expected: 1 }],
      limitations: ["Fixture only; no production-learning claim."],
    };
  },
};

async function setup(contracts: LearningContract[]) {
  const directory = await mkdtemp(join(tmpdir(), "sara-curriculum-continuation-"));
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(ownerToken) });
  const owner = kernel.authenticateOwnerToken(ownerToken);
  const now = Date.now();
  await kernel.activateStandingMandate(owner, {
    id: "curriculum-learning",
    ownerId: owner.id,
    allowedActions: ["business_candidate_development"],
    allowedChannels: ["internal"],
    allowedServiceIds: ["skill-learning"],
    maximumCostPerActionUsd: 0,
    maximumConcurrentActions: 1,
    maximumDailyActions: 20,
    startsAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
  }, {
    approvalId: "curriculum-learning-approval",
    ownerId: owner.id,
    action: "required_owner_approval_change",
    targetId: "standing-mandate:curriculum-learning",
    approvedAt: new Date(now).toISOString(),
  });
  const campaign: LearningCampaignInput = {
    id: "approved-curriculum-continuation",
    maximumRequests: 100,
    contracts,
  };
  await kernel.configureLearningCampaign(owner, campaign, compileLearningCampaign(campaign).digest);
  return { directory, kernel, owner };
}

test("idle worker seeds the next frozen curriculum gap and re-enters the bounded learning pipeline", async () => {
  const { directory, kernel } = await setup([contract("curriculum-only-gap")]);
  try {
    const worker = new AutonomousLearningWorker(kernel, generator);
    const result = await worker.tick();
    assert.equal(result.status, "qualified");

    const campaign = await kernel.learningCampaignStatus();
    assert.equal(campaign.campaign?.reserved, 1);
    assert.equal(campaign.campaign?.remaining, 99);
    assert.equal(campaign.selections.length, 1);
    const selection = campaign.selections[0] as { campaignId: string; capabilityId: string; sourceJobId: string };
    assert.equal(selection.campaignId, "approved-curriculum-continuation");
    assert.equal(selection.capabilityId, "curriculum-only-gap");

    const state = await kernel.getStatus();
    const learningJob = state.jobs.find(job => job.learningCampaignId === "approved-curriculum-continuation");
    assert.ok(learningJob);
    assert.equal(learningJob.learningSourceJobId, selection.sourceJobId);
    const sourceJob = state.jobs.find(job => job.id === selection.sourceJobId);
    assert.ok(sourceJob);
    assert.equal(sourceJob.learningCampaignId, undefined);
    assert.equal(sourceJob.workCard.maximumBudgetUsd, 0);
    assert.equal(sourceJob.workCard.expectedOwnerValue, 1);
    assert.deepEqual(sourceJob.workCard.requiredCapabilities, ["curriculum-only-gap"]);

    assert.equal((await worker.tick()).status, "idle");
    assert.equal((await kernel.learningCampaignStatus()).selections.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an actual task-derived gap remains higher priority than curriculum fallback", async () => {
  const { directory, kernel } = await setup([contract("curriculum-first"), contract("task-gap")]);
  try {
    const source = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Handle a real authorized task gap.",
      expectedOwnerValue: 5,
      requiredCapabilities: ["task-gap"],
      acceptanceCriteria: ["Preserve the task input."],
      maximumBudgetUsd: 0,
    });
    const worker = new AutonomousLearningWorker(kernel, generator);
    assert.equal((await worker.tick()).status, "qualified");
    const campaign = await kernel.learningCampaignStatus();
    const selection = campaign.selections[0] as { capabilityId: string; sourceJobId: string };
    assert.equal(selection.capabilityId, "task-gap");
    assert.equal(selection.sourceJobId, source.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
