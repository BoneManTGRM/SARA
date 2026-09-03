import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { workerModelRouteKey, type WorkerModelClient } from "../src/model-router.ts";
import { PILOT_REQUIRED_CAPABILITIES } from "../src/revenue-pilot.ts";
import type { OwnerApproval } from "../src/types.ts";

const stateDirectory = await mkdtemp(join(tmpdir(), "sara-revenue-proof-"));
const ownerToken = "revenue-pilot-proof-owner";
const ownerTokenSha256 = sha256(ownerToken);

try {
  let kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256 });
  const owner = kernel.authenticateOwnerToken(ownerToken);
  for (const capabilityId of PILOT_REQUIRED_CAPABILITIES) {
    await kernel.registerCapability(SARA_PRINCIPAL, {
      id: capabilityId,
      name: capabilityId,
      status: "available",
      evidence: [`proof:${capabilityId}`],
      limitations: ["Public-repository readiness pilot only."],
    });
  }
  const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, {
    opportunityId: "proof-opportunity-1",
    sourceUrl: "https://github.com/example/project/issues/1",
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
    recentCommitDays: 2,
  });
  const revenue = await kernel.recordLedgerEntry(owner, {
    kind: "revenue",
    source: "customer",
    amountUsd: 149,
    realized: true,
    recurringMonthly: false,
    description: `Collected revenue for ${job.id}`,
    occurredAt: new Date().toISOString(),
  });
  const targetId = `revenue-pilot:${job.id}:fulfillment`;
  const approval: OwnerApproval = {
    approvalId: "proof-owner-approval",
    action: "contract_commitment",
    targetId,
    approvedAt: new Date().toISOString(),
    ownerId: owner.id,
  };
  await kernel.authorizeRevenuePilotJob(owner, job.id, revenue.id, approval);

  const directorClaim = await kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "luna-director", 300);
  const luna: WorkerModelClient = {
    routeKey: workerModelRouteKey({ provider: "openai", model: "gpt-5.6-luna", billingMode: "paid" }),
    maximumWallTimeMs: 1_000,
    async countInputTokens() {
      return 1_000;
    },
    async execute() {
      return { outputText: "bounded proof director packet", inputTokens: 1_000, billableOutputTokens: 200 };
    },
  };
  const routed = await kernel.runRevenuePilotRoleWithModel(SARA_PRINCIPAL, {
    jobId: job.id,
    leaseId: directorClaim.lease.id,
    prompt: "Create the bounded public-repository readiness work packet.",
    taskKind: "requirements_analysis",
    dataClassification: "public",
    maximumTaskCostUsd: 0.05,
    allowGeminiFreeTier: false,
    clients: [luna],
    verificationPassed: null,
  });
  assert.equal(routed.evidence.model, "gpt-5.6-luna");

  const roles = [
    { worker: "specialist", role: "specialist_worker", digest: "b", costUsd: 1.25, verified: null },
    { worker: "verifier", role: "independent_verifier", digest: "c", costUsd: 0.25, verified: true },
    { worker: "delivery", role: "delivery_operator", digest: "d", costUsd: 0.25, verified: null },
  ] as const;
  for (const step of roles) {
    const claim = await kernel.claimRevenuePilotRole(SARA_PRINCIPAL, step.worker, 60);
    assert.equal(claim.lease.role, step.role);
    await kernel.completeRevenuePilotRole(SARA_PRINCIPAL, job.id, {
      leaseId: claim.lease.id,
      role: step.role,
      outputDigest: step.digest.repeat(64),
      costUsd: step.costUsd,
      verificationPassed: step.verified,
      completedAt: new Date().toISOString(),
      ...(step.role === "delivery_operator" ? { reportDigest: "e".repeat(64) } : {}),
    });
  }

  kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256 });
  const restored = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === job.id);
  assert.ok(restored);
  assert.equal(restored.status, "owner_review");
  assert.equal(restored.actualExecutionCostUsd, 1.76);
  assert.equal(restored.externalDeliveryAuthorized, false);
  assert.equal(restored.completedRoles.length, 6);
  const rescanned = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, restored.input);
  assert.equal(rescanned.id, restored.id);
  assert.equal(rescanned.status, "owner_review");
  assert.equal(rescanned.completedRoles.length, 6);

  console.log(JSON.stringify({
    proof: "SARA_REVENUE_PILOT",
    result: "PASS",
    service: restored.plan.serviceId,
    priceUsd: restored.plan.priceUsd,
    executionCostCapUsd: restored.plan.maximumExecutionCostUsd,
    actualExecutionCostUsd: restored.actualExecutionCostUsd,
    rolesCompleted: restored.completedRoles,
    durableReload: "PASS",
    resultingState: restored.status,
    externalDeliveryAuthorized: restored.externalDeliveryAuthorized,
    defaultPaidWorker: routed.evidence.model,
    routedWorkerEvidence: "PASS",
  }, null, 2));
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
