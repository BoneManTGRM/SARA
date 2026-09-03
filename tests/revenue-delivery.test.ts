import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRevenueDelivery,
  deliverySecretDigest,
  recordRevenueDeliveryDownload,
  revokeRevenueDelivery,
} from "../src/revenue-delivery.ts";
import type { RevenuePilotJob } from "../src/revenue-pilot.ts";

const SECRET = "delivery-secret-with-at-least-thirty-two-characters";
const REPORT_DIGEST = "a".repeat(64);

function completedJob(overrides: Partial<RevenuePilotJob> = {}): RevenuePilotJob {
  return {
    id: "job-delivery-test",
    input: {
      opportunityId: "delivery-test",
      sourceUrl: "https://github.com/example/project",
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
      recentCommitDays: 1,
    },
    plan: {
      schemaVersion: 1,
      serviceId: "public-repository-readiness-snapshot",
      serviceName: "Public Repository Readiness Snapshot",
      opportunityId: "delivery-test",
      sourceUrl: "https://github.com/example/project",
      decision: "offer_ready",
      priceUsd: 149,
      maximumExecutionCostUsd: 3,
      monthlyOwnerBudgetCeilingUsd: 50,
      mayBeginFulfillment: false,
      fitScore: 100,
      repository: "https://github.com/example/project",
      disqualifyingRisks: [],
      evidenceGaps: [],
      requiredCapabilities: [],
      includedDeliverables: [],
      missingCapabilities: [],
      learningObjectives: [],
      roles: [],
      safestNextStep: "Owner review.",
    },
    status: "owner_review",
    nextRole: null,
    completedRoles: ["independent_verifier", "delivery_operator"],
    receipts: [
      {
        role: "independent_verifier",
        workerId: "verifier",
        outputDigest: "b".repeat(64),
        costUsd: 0.1,
        verificationPassed: true,
        completedAt: "2026-09-03T12:00:00.000Z",
      },
      {
        role: "delivery_operator",
        workerId: "compiler",
        outputDigest: "c".repeat(64),
        costUsd: 0,
        verificationPassed: null,
        completedAt: "2026-09-03T12:01:00.000Z",
        reportDigest: REPORT_DIGEST,
      },
    ],
    activeLease: null,
    actualExecutionCostUsd: 0.1,
    revenueEvidenceId: "revenue-evidence",
    externalDeliveryAuthorized: false,
    deliveryApprovalId: null,
    deliveredAt: null,
    createdAt: "2026-09-03T11:00:00.000Z",
    updatedAt: "2026-09-03T12:01:00.000Z",
    ...overrides,
  };
}

describe("secure revenue delivery", () => {
  it("requires independent verification and exact report evidence", () => {
    assert.throws(() => createRevenueDelivery({
      id: "delivery-invalid",
      job: completedJob({ receipts: [] }),
      reportDigest: REPORT_DIGEST,
      accessSecretDigest: deliverySecretDigest(SECRET),
      approvalId: "approval",
    }), /verification/iu);
    assert.throws(() => createRevenueDelivery({
      id: "delivery-mismatch",
      job: completedJob(),
      reportDigest: "d".repeat(64),
      accessSecretDigest: deliverySecretDigest(SECRET),
      approvalId: "approval",
    }), /digest/iu);
  });

  it("enforces expiration, revocation, and download limits without storing the secret", () => {
    const delivery = createRevenueDelivery({
      id: "delivery-secure",
      job: completedJob(),
      reportDigest: REPORT_DIGEST,
      accessSecretDigest: deliverySecretDigest(SECRET),
      approvalId: "approval",
      now: new Date("2026-09-03T12:00:00.000Z"),
      lifetimeHours: 1,
      maximumDownloads: 1,
    });
    assert.equal(JSON.stringify(delivery).includes(SECRET), false);
    assert.throws(() => recordRevenueDeliveryDownload(delivery, "wrong-secret"), /authentication/iu);
    const downloaded = recordRevenueDeliveryDownload(delivery, SECRET, new Date("2026-09-03T12:30:00.000Z"));
    assert.equal(downloaded.status, "delivered");
    assert.equal(downloaded.downloadCount, 1);
    assert.throws(
      () => recordRevenueDeliveryDownload(downloaded, SECRET, new Date("2026-09-03T12:31:00.000Z")),
      /limit/iu,
    );
    assert.throws(
      () => recordRevenueDeliveryDownload(delivery, SECRET, new Date("2026-09-03T13:00:00.001Z")),
      /expired/iu,
    );
    assert.throws(() => recordRevenueDeliveryDownload(revokeRevenueDelivery(delivery), SECRET), /revoked/iu);
  });
});
