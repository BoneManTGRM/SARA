import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeRevenuePilot,
  compileRevenuePilot,
  createRevenuePilotJob,
  type RevenuePilotInput,
} from "../src/revenue-pilot.ts";

function qualified(overrides: Partial<RevenuePilotInput> = {}): RevenuePilotInput {
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
    customerBudgetUsd: 0,
    desiredTurnaroundDays: 3,
    recentCommitDays: 7,
    ...overrides,
  };
}

const testingOptions = {
  billingMode: "testing_no_charge",
  externalDeliveryAllowed: false,
  revenueRecognitionAllowed: false,
} as const;

describe("owner-only no-price revenue-pilot testing", () => {
  it("removes price and payment qualification only from an explicit testing plan", () => {
    const testingPlan = (compileRevenuePilot as unknown as (
      input: RevenuePilotInput,
      availableCapabilities?: readonly string[],
      options?: typeof testingOptions,
    ) => ReturnType<typeof compileRevenuePilot>)(qualified(), undefined, testingOptions);
    const commercialPlan = compileRevenuePilot(qualified({ customerBudgetUsd: 149 }));

    assert.equal(testingPlan.decision, "offer_ready");
    assert.equal(testingPlan.priceUsd, 0);
    assert.equal((testingPlan as unknown as { billingMode?: string }).billingMode, "testing_no_charge");
    assert.equal(testingPlan.evidenceGaps.some((gap) => /budget|price|payment/i.test(gap)), false);
    assert.match(testingPlan.safestNextStep, /testing/i);
    assert.doesNotMatch(testingPlan.safestNextStep, /payment/i);

    assert.equal(commercialPlan.priceUsd, 149);
    assert.equal((commercialPlan as unknown as { billingMode?: string }).billingMode, "commercial");
    assert.match(commercialPlan.safestNextStep, /payment/i);
  });

  it("does not let the commercial authorizer treat a no-price test job as collected revenue", () => {
    const testingJob = (createRevenuePilotJob as unknown as (
      input: RevenuePilotInput,
      availableCapabilities?: readonly string[],
      now?: Date,
      options?: typeof testingOptions,
    ) => ReturnType<typeof createRevenuePilotJob>)(
      qualified(),
      undefined,
      new Date("2026-09-04T17:00:00.000Z"),
      testingOptions,
    );

    assert.equal(testingJob.plan.priceUsd, 0);
    assert.throws(() => authorizeRevenuePilot(testingJob, {
      collectedRevenueUsd: 0,
      revenueEvidenceId: "not-real-revenue",
      ownerApprovalTarget: `revenue-pilot:${testingJob.id}:fulfillment`,
    }), /testing.*commercial|commercial.*testing/i);
    assert.equal(testingJob.revenueEvidenceId, null);
    assert.equal(testingJob.externalDeliveryAuthorized, false);
  });
});
