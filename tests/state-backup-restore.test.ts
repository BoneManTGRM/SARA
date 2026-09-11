import assert from "node:assert/strict";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AutonomousLearningWorker } from "../src/autonomous-learning-worker.ts";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { compileLearningCampaign, type LearningCampaignInput } from "../src/learning-campaign.ts";
import { readProductionStateFingerprint } from "../src/production-state-fingerprint.ts";
import type { CandidateGenerator } from "../src/types.ts";

const ownerToken = "isolated-backup-restore-owner";
const campaign: LearningCampaignInput = {
  id: "backup-restore-qualification",
  maximumRequests: 10,
  contracts: [{
    capabilityId: "restore-identity-skill",
    objective: "Return the supplied value unchanged after restore.",
    publicCriteria: ["Return the supplied value unchanged."],
    acceptanceTests: [
      { name: "object", input: { restored: true }, expected: { restored: true } },
      { name: "array", input: [3, 1, 4], expected: [3, 1, 4] },
    ],
    estimatedEffort: 1,
  }],
};

const generator: CandidateGenerator = {
  id: "backup-restore-fixture",
  external: false,
  maximumCostUsd: 0,
  async generate() {
    return {
      schemaVersion: 1,
      skillName: "Restore Identity",
      summary: "Deterministic isolated restore fixture.",
      source: "export function runSkill(input: unknown): unknown { return input; }",
      tests: [{ name: "producer", input: { value: 1 }, expected: { value: 1 } }],
      limitations: ["Qualification fixture only."],
    };
  },
};

test("isolated backup and restore preserve authoritative state and candidate artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-backup-restore-"));
  const sourceDirectory = join(root, "source");
  const restoredDirectory = join(root, "restored");
  try {
    const kernel = await SaraKernel.boot({
      stateDirectory: sourceDirectory,
      ownerTokenSha256: sha256(ownerToken),
    });
    const owner = kernel.authenticateOwnerToken(ownerToken);
    const now = new Date();
    await kernel.activateStandingMandate(owner, {
      id: "backup-restore-learning",
      ownerId: owner.id,
      allowedActions: ["business_candidate_development"],
      allowedChannels: ["internal"],
      allowedServiceIds: ["skill-learning"],
      maximumCostPerActionUsd: 0,
      maximumDailyActions: 20,
      maximumConcurrentActions: 1,
      startsAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    }, {
      approvalId: "backup-restore-mandate-approval",
      ownerId: owner.id,
      action: "required_owner_approval_change",
      targetId: "standing-mandate:backup-restore-learning",
      approvedAt: now.toISOString(),
    });
    await kernel.configureLearningCampaign(
      owner,
      campaign,
      compileLearningCampaign(campaign).digest,
    );
    await kernel.registerCapability(SARA_PRINCIPAL, {
      id: "restore-fixture-capability",
      name: "Restore fixture capability",
      status: "available",
      evidence: ["tests/state-backup-restore.test.ts"],
      limitations: ["Isolated qualification fixture."],
    });
    await kernel.recordMemory(SARA_PRINCIPAL, {
      category: "strategic",
      statement: "Isolated restore qualification preserves this measured record.",
      source: "test://state-backup-restore",
      observedAt: now.toISOString(),
      confidence: 1,
      verification: "measured",
      scope: "backup-restore-qualification",
      dependencies: [],
      lastValidatedAt: now.toISOString(),
    });
    await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Exercise the restore identity skill through the bounded learning campaign.",
      expectedOwnerValue: 5,
      requiredCapabilities: ["restore-identity-skill"],
      acceptanceCriteria: ["Return the supplied value unchanged."],
      maximumBudgetUsd: 0,
    });

    const learning = await new AutonomousLearningWorker(kernel, generator).tick();
    assert.equal(learning.status, "qualified");
    const beforeStatus = await kernel.getStatus();
    const beforeCampaign = await kernel.learningCampaignStatus();
    const beforeFingerprint = await readProductionStateFingerprint(sourceDirectory);
    const mutation = beforeStatus.mutations.find((candidate) => candidate.stage === "SHADOW");
    assert.ok(mutation?.artifactRelativePath);
    assert.equal(beforeCampaign.campaign?.reserved, 1);

    await cp(sourceDirectory, restoredDirectory, { recursive: true, force: false });
    const copiedFingerprint = await readProductionStateFingerprint(restoredDirectory);
    assert.deepEqual(copiedFingerprint, beforeFingerprint);
    assert.match(copiedFingerprint.fingerprintDigest, /^[a-f0-9]{64}$/u);
    await stat(join(restoredDirectory, mutation.artifactRelativePath!, "manifest.json"));

    const restored = await SaraKernel.boot({
      stateDirectory: restoredDirectory,
      ownerTokenSha256: sha256(ownerToken),
    });
    const afterStatus = await restored.getStatus();
    const afterCampaign = await restored.learningCampaignStatus();
    const afterFingerprint = await readProductionStateFingerprint(restoredDirectory);

    assert.equal(afterStatus.constitution.digest, beforeStatus.constitution.digest);
    assert.equal(afterStatus.constitution.version, beforeStatus.constitution.version);
    assert.equal(afterStatus.memoryCount, beforeStatus.memoryCount);
    assert.deepEqual(afterStatus.capabilities, beforeStatus.capabilities);
    assert.deepEqual(afterStatus.jobs, beforeStatus.jobs);
    assert.deepEqual(afterStatus.mutations, beforeStatus.mutations);
    assert.deepEqual(afterStatus.standingMandate, beforeStatus.standingMandate);
    assert.equal(afterCampaign.campaign?.id, beforeCampaign.campaign?.id);
    assert.equal(afterCampaign.campaign?.digest, beforeCampaign.campaign?.digest);
    assert.equal(afterCampaign.campaign?.reserved, beforeCampaign.campaign?.reserved);
    assert.equal(afterCampaign.campaign?.remaining, beforeCampaign.campaign?.remaining);
    assert.equal(afterFingerprint.audit.eventCount, beforeFingerprint.audit.eventCount + 1);
    assert.notEqual(afterFingerprint.audit.headHash, beforeFingerprint.audit.headHash);
    assert.equal(afterFingerprint.campaign?.reserved, beforeFingerprint.campaign?.reserved);
    assert.equal(afterFingerprint.mutations.byStage.SHADOW, beforeFingerprint.mutations.byStage.SHADOW);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
