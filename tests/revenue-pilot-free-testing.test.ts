import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeRevenuePilot,
  authorizeRevenuePilotDelivery,
  compileRevenuePilot,
  type RevenuePilotInput,
  type RevenuePilotJob,
} from "../src/revenue-pilot.ts";
import {
  authorizeRevenuePilotForTesting,
  claimRevenuePilotTestingRole,
  compileRevenuePilotForTesting,
  completeRevenuePilotTestingRole,
  createRevenuePilotTestingJob,
  type RevenuePilotTestingInput,
} from "../src/revenue-pilot-testing.ts";

function qualified(overrides: Partial<RevenuePilotTestingInput> = {}): RevenuePilotTestingInput {
  return {
    opportunityId: "testing-public-repo-1",
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
    desiredTurnaroundDays: 3,
    recentCommitDays: 7,
    ...overrides,
  };
}

function commercialInput(): RevenuePilotInput {
  return { ...qualified(), customerBudgetUsd: 149 };
}

describe("owner-only no-price revenue-pilot testing", () => {
  it("removes price and payment qualification only from the explicit testing plan", () => {
    const testingPlan = compileRevenuePilotForTesting(qualified());
    const commercialPlan = compileRevenuePilot(commercialInput());

    assert.equal(testingPlan.decision, "offer_ready");
    assert.equal(Object.hasOwn(testingPlan, "priceUsd"), false);
    assert.equal(testingPlan.billingMode, "testing_no_charge");
    assert.equal(testingPlan.externalDeliveryAllowed, false);
    assert.equal(testingPlan.revenueRecognitionAllowed, false);
    assert.equal(testingPlan.evidenceGaps.some((gap) => /budget|price|payment/i.test(gap)), false);
    assert.match(testingPlan.safestNextStep, /testing|test run/i);
    assert.doesNotMatch(testingPlan.safestNextStep, /payment/i);

    assert.equal(commercialPlan.priceUsd, 149);
    assert.match(commercialPlan.safestNextStep, /payment/i);
  });

  it("authorizes testing without payment while the commercial authorizer rejects the test job", () => {
    const createdAt = new Date("2026-09-04T17:00:00.000Z");
    const testingJob = createRevenuePilotTestingJob(qualified(), undefined, createdAt);

    assert.equal(testingJob.status, "testing_ready");
    assert.equal(Object.hasOwn(testingJob.plan, "priceUsd"), false);
    assert.equal(Object.hasOwn(testingJob.input, "customerBudgetUsd"), false);
    assert.throws(() => authorizeRevenuePilot(testingJob as unknown as RevenuePilotJob, {
      collectedRevenueUsd: 0,
      revenueEvidenceId: "not-real-revenue",
      ownerApprovalTarget: `revenue-pilot:${testingJob.id}:fulfillment`,
    }), /offer-ready/i);
    assert.throws(() => authorizeRevenuePilotForTesting(testingJob, {
      testingAuthorizationId: "test-authorization-1",
      ownerApprovalTarget: "wrong-target",
    }), /target-bound owner approval/i);

    const authorized = authorizeRevenuePilotForTesting(testingJob, {
      testingAuthorizationId: "test-authorization-1",
      ownerApprovalTarget: `revenue-pilot-test:${testingJob.id}:fulfillment`,
    }, new Date("2026-09-04T17:00:30.000Z"));

    assert.equal(authorized.status, "queued");
    assert.equal(authorized.nextRole, "work_director");
    assert.equal(authorized.revenueEvidenceId, null);
    assert.equal(authorized.externalDeliveryAuthorized, false);
    assert.equal(authorized.testingAuthorizationId, "test-authorization-1");
  });

  it("runs the bounded worker sequence but cannot become a customer delivery", () => {
    let job = createRevenuePilotTestingJob(
      qualified(),
      undefined,
      new Date("2026-09-04T17:00:00.000Z"),
    );
    job = authorizeRevenuePilotForTesting(job, {
      testingAuthorizationId: "test-authorization-2",
      ownerApprovalTarget: `revenue-pilot-test:${job.id}:fulfillment`,
    }, new Date("2026-09-04T17:00:30.000Z"));

    const roles = ["work_director", "specialist_worker", "independent_verifier", "delivery_operator"] as const;
    for (const [index, role] of roles.entries()) {
      const minute = index + 1;
      const workerId = role === "independent_verifier" ? "independent-test-verifier" : `test-${role}`;
      const claimed = claimRevenuePilotTestingRole(
        job,
        workerId,
        new Date(`2026-09-04T17:0${minute}:00.000Z`),
        60,
      );
      assert.equal(claimed.lease.role, role);
      job = completeRevenuePilotTestingRole(claimed.job, {
        leaseId: claimed.lease.id,
        role,
        outputDigest: String.fromCharCode(97 + index).repeat(64),
        costUsd: 0,
        verificationPassed: role === "independent_verifier" ? true : null,
        completedAt: `2026-09-04T17:0${minute}:10.000Z`,
        ...(role === "delivery_operator" ? { reportDigest: "e".repeat(64) } : {}),
      });
    }

    assert.equal(job.status, "testing_complete");
    assert.equal(job.revenueEvidenceId, null);
    assert.equal(job.externalDeliveryAuthorized, false);
    assert.equal(job.actualExecutionCostUsd, 0);
    assert.throws(() => authorizeRevenuePilotDelivery(job as unknown as RevenuePilotJob, {
      approvalId: "delivery-approval",
      ownerApprovalTarget: `revenue-pilot:${job.id}:delivery`,
    }), /completed owner-review/i);
  });
});
