import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { workerModelRouteKey, type WorkerModelClient } from "../src/model-router.ts";
import type { RevenuePilotInput } from "../src/revenue-pilot.ts";
import type { OwnerApproval } from "../src/types.ts";
import { PILOT_REQUIRED_CAPABILITIES } from "../src/revenue-pilot.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "revenue-pilot-owner-token";

function opportunity(): RevenuePilotInput {
  return {
    opportunityId: "public-opportunity-1",
    sourceUrl: "https://github.com/example/project/issues/123",
    sourceAllowsAutomatedDiscovery: true,
    discoveredFromPublicSource: true,
    repoUrl: "https://github.com/example/project",
    repositoryIsPublic: true,
    repositoryOwnerPermissionConfirmed: true,
    requiresPrivateAccess: false,
    containsRegulatedOrPrivateData: false,
    requestsProductionChanges: false,
    requestsExploitValidation: false,
    primaryGoal: "release_readiness",
    customerBudgetUsd: 149,
    desiredTurnaroundDays: 3,
    recentCommitDays: 5,
  };
}

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sara-revenue-pilot-"));
  cleanup.push(directory);
  return directory;
}

async function registerPilotCapabilities(kernel: SaraKernel): Promise<void> {
  for (const capabilityId of PILOT_REQUIRED_CAPABILITIES) {
    await kernel.registerCapability(SARA_PRINCIPAL, {
      id: capabilityId,
      name: capabilityId,
      status: "available",
      evidence: [`test-evidence:${capabilityId}`],
      limitations: ["Bound to the public-repository readiness pilot."],
    });
  }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SARA durable revenue pilot kernel", () => {
  it("does not spend learning effort on a rejected opportunity", async () => {
    const kernel = await SaraKernel.boot({
      stateDirectory: await stateDirectory(),
      ownerTokenSha256: sha256(OWNER_TOKEN),
    });
    const rejected = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, {
      ...opportunity(),
      opportunityId: "rejected-opportunity",
      sourceAllowsAutomatedDiscovery: false,
      requestsProductionChanges: true,
    });

    assert.equal(rejected.status, "rejected");
    assert.equal((await kernel.getStatus()).jobs.length, 0);
  });

  it("queues zero-cost SHADOW learning work for missing revenue skills", async () => {
    const kernel = await SaraKernel.boot({
      stateDirectory: await stateDirectory(),
      ownerTokenSha256: sha256(OWNER_TOKEN),
    });
    const pilot = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
    const status = await kernel.getStatus();

    assert.equal(pilot.status, "owner_review");
    assert.deepEqual(pilot.plan.missingCapabilities, [...PILOT_REQUIRED_CAPABILITIES]);
    assert.equal(status.jobs.length, PILOT_REQUIRED_CAPABILITIES.length);
    assert.ok(status.jobs.every((job) => job.workCard.maximumBudgetUsd === 0));
    assert.ok(status.jobs.every((job) => job.workCard.acceptanceCriteria.some((criterion) => /SHADOW/i.test(criterion))));

    await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
    assert.equal((await kernel.getStatus()).jobs.length, PILOT_REQUIRED_CAPABILITIES.length);

    await registerPilotCapabilities(kernel);
    const refreshed = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
    assert.equal(refreshed.id, pilot.id);
    assert.equal(refreshed.status, "offer_ready");
    assert.deepEqual(refreshed.plan.missingCapabilities, []);
  });

  it("deduplicates public opportunities and preserves the offer across restart", async () => {
    const directory = await stateDirectory();
    const digest = sha256(OWNER_TOKEN);
    const first = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest });
    await registerPilotCapabilities(first);
    const job = await first.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
    const duplicate = await first.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());

    assert.equal(duplicate.id, job.id);
    assert.equal(job.status, "offer_ready");
    assert.equal((await first.getStatus()).revenuePilotJobs.length, 1);

    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest });
    const restored = (await restarted.getStatus()).revenuePilotJobs[0];
    assert.equal(restored.id, job.id);
    assert.equal(restored.plan.opportunityId, opportunity().opportunityId);
  });

  it("requires exact realized revenue and owner contract approval before leasing work", async () => {
    const kernel = await SaraKernel.boot({
      stateDirectory: await stateDirectory(),
      ownerTokenSha256: sha256(OWNER_TOKEN),
    });
    const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
    await registerPilotCapabilities(kernel);
    const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());

    await assert.rejects(() => kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "worker-1"), /available/i);
    const revenue = await kernel.recordLedgerEntry(owner, {
      kind: "revenue",
      source: "customer",
      amountUsd: 149,
      realized: true,
      recurringMonthly: false,
      description: `Collected revenue for ${job.id}`,
      occurredAt: "2026-09-02T00:00:00.000Z",
    });
    const targetId = `revenue-pilot:${job.id}:fulfillment`;
    const approval: OwnerApproval = {
      approvalId: "approve-revenue-pilot-1",
      action: "contract_commitment",
      targetId,
      approvedAt: "2026-09-02T00:01:00.000Z",
      ownerId: owner.id,
    };

    const authorized = await kernel.authorizeRevenuePilotJob(owner, job.id, revenue.id, approval);
    assert.equal(authorized.status, "queued");
    const claim = await kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "worker-1", 60);
    assert.equal(claim.lease.role, "work_director");
  });

  it("persists role receipts and refuses stale lease completion", async () => {
    const directory = await stateDirectory();
    const digest = sha256(OWNER_TOKEN);
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest });
    const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
    await registerPilotCapabilities(kernel);
    const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
    const revenue = await kernel.recordLedgerEntry(owner, {
      kind: "revenue",
      source: "customer",
      amountUsd: 149,
      realized: true,
      recurringMonthly: false,
      description: `Collected revenue for ${job.id}`,
      occurredAt: "2026-09-02T00:00:00.000Z",
    });
    const approval: OwnerApproval = {
      approvalId: "approve-revenue-pilot-2",
      action: "contract_commitment",
      targetId: `revenue-pilot:${job.id}:fulfillment`,
      approvedAt: "2026-09-02T00:01:00.000Z",
      ownerId: owner.id,
    };
    await kernel.authorizeRevenuePilotJob(owner, job.id, revenue.id, approval);
    const claim = await kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "worker-1", 60);
    await kernel.completeRevenuePilotRole(SARA_PRINCIPAL, job.id, {
      leaseId: claim.lease.id,
      role: "work_director",
      outputDigest: "a".repeat(64),
      costUsd: 0,
      verificationPassed: null,
      completedAt: new Date().toISOString(),
    });
    await assert.rejects(
      () => kernel.completeRevenuePilotRole(SARA_PRINCIPAL, job.id, {
        leaseId: claim.lease.id,
        role: "work_director",
        outputDigest: "a".repeat(64),
        costUsd: 0,
        verificationPassed: null,
        completedAt: new Date().toISOString(),
      }),
      /active lease/i,
    );

    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest });
    const restored = (await restarted.getStatus()).revenuePilotJobs[0];
    assert.equal(restored.nextRole, "specialist_worker");
    assert.equal(restored.receipts.at(-1)?.role, "work_director");
  });

  it("durably records Luna success and bounded all-route failure without prompt content", async () => {
    // Catches routed model work bypassing the job cap, audit policy, or durable receipt boundary.
    const directory = await stateDirectory();
    const digest = sha256(OWNER_TOKEN);
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest });
    const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
    await registerPilotCapabilities(kernel);
    const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
    const revenue = await kernel.recordLedgerEntry(owner, {
      kind: "revenue",
      source: "customer",
      amountUsd: 149,
      realized: true,
      recurringMonthly: false,
      description: `Collected revenue for ${job.id}`,
      occurredAt: "2026-09-02T00:00:00.000Z",
    });
    await kernel.authorizeRevenuePilotJob(owner, job.id, revenue.id, {
      approvalId: "approve-model-routed-pilot",
      action: "contract_commitment",
      targetId: `revenue-pilot:${job.id}:fulfillment`,
      approvedAt: "2026-09-02T00:01:00.000Z",
      ownerId: owner.id,
    });
    const claim = await kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "luna-director", 300);
    const luna: WorkerModelClient = {
      routeKey: workerModelRouteKey({ provider: "openai", model: "gpt-5.6-luna", billingMode: "paid" }),
      maximumWallTimeMs: 1_000,
      async countInputTokens() {
        return 1_000;
      },
      async execute() {
        return { outputText: "bounded director work packet", inputTokens: 1_000, billableOutputTokens: 200 };
      },
    };

    const execution = await kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL, {
      jobId: job.id,
      leaseId: claim.lease.id,
      prompt: "PRIVATE_PROMPT_MARKER that must never persist",
      taskKind: "requirements_analysis",
      dataClassification: "public",
      maximumTaskCostUsd: 0.05,
      allowGeminiFreeTier: false,
      clients: [luna],
      verificationPassed: null,
    });

    assert.equal(execution.outputText, "bounded director work packet");
    assert.equal(execution.job.actualExecutionCostUsd, 0.01);
    assert.equal(execution.job.nextRole, "specialist_worker");
    assert.equal(execution.evidence.model, "gpt-5.6-luna");
    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest });
    const restored = (await restarted.getStatus()).revenuePilotJobs[0];
    assert.equal(restored.receipts.at(-1)?.modelExecution?.model, "gpt-5.6-luna");
    assert.equal(JSON.stringify(await restarted.inspectAudit()).includes("PRIVATE_PROMPT_MARKER"), false);

    const failedClaim = await restarted.claimRevenuePilotRole(SARA_PRINCIPAL, "luna-specialist", 300);
    const failingLuna: WorkerModelClient = {
      ...luna,
      async execute() {
        throw new Error("SECRET_PROVIDER_BODY");
      },
    };
    await assert.rejects(
      () => restarted.runRevenuePilotRoleWithModel(SARA_PRINCIPAL, {
        jobId: job.id,
        leaseId: failedClaim.lease.id,
        prompt: "SECOND_PRIVATE_PROMPT_MARKER",
        taskKind: "routine_code",
        dataClassification: "public",
        maximumTaskCostUsd: 0.1,
        allowGeminiFreeTier: true,
        clients: [failingLuna],
        verificationPassed: null,
      }),
      /cost was recorded/i,
    );
    const afterFailure = (await restarted.getStatus()).revenuePilotJobs[0];
    assert.equal(afterFailure.status, "failed");
    assert.equal(afterFailure.activeLease, null);
    assert.equal(afterFailure.actualExecutionCostUsd, 0.03);
    assert.equal(afterFailure.receipts.at(-1)?.modelFailure?.attemptCount, 2);
    const audit = JSON.stringify(await restarted.inspectAudit());
    assert.equal(audit.includes("SECOND_PRIVATE_PROMPT_MARKER"), false);
    assert.equal(audit.includes("SECRET_PROVIDER_BODY"), false);
  });
});
