import assert from "node:assert/strict";
import {
  authorizeRevenuePilotForTesting,
  claimRevenuePilotTestingRole,
  completeRevenuePilotTestingRole,
  createRevenuePilotTestingJob,
  type RevenuePilotTestingInput,
} from "../src/revenue-pilot-testing.ts";

const input: RevenuePilotTestingInput = {
  opportunityId: "proof-no-price-testing",
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
};

let job = createRevenuePilotTestingJob(
  input,
  undefined,
  new Date("2026-09-04T18:30:00.000Z"),
);
assert.equal(job.status, "testing_ready");
assert.equal(Object.hasOwn(job.input, "customerBudgetUsd"), false);
assert.equal(Object.hasOwn(job.plan, "priceUsd"), false);
assert.equal(job.plan.billingMode, "testing_no_charge");
assert.equal(job.plan.revenueRecognitionAllowed, false);
assert.equal(job.plan.externalDeliveryAllowed, false);

job = authorizeRevenuePilotForTesting(job, {
  testingAuthorizationId: "proof-no-price-testing-authorization",
  ownerApprovalTarget: `revenue-pilot-test:${job.id}:fulfillment`,
}, new Date("2026-09-04T18:30:30.000Z"));

const roles = ["work_director", "specialist_worker", "independent_verifier", "delivery_operator"] as const;
for (const [index, role] of roles.entries()) {
  const minute = index + 31;
  const claimedAt = new Date(`2026-09-04T18:${minute}:00.000Z`);
  const completedAt = new Date(`2026-09-04T18:${minute}:10.000Z`).toISOString();
  const claimed = claimRevenuePilotTestingRole(
    job,
    role === "independent_verifier" ? "proof-independent-verifier" : `proof-${role}`,
    claimedAt,
    60,
  );
  job = completeRevenuePilotTestingRole(claimed.job, {
    leaseId: claimed.lease.id,
    role,
    outputDigest: String.fromCharCode(97 + index).repeat(64),
    costUsd: 0,
    verificationPassed: role === "independent_verifier" ? true : null,
    completedAt,
    ...(role === "delivery_operator" ? { reportDigest: "e".repeat(64) } : {}),
  });
}

assert.equal(job.status, "testing_complete");
assert.equal(job.actualExecutionCostUsd, 0);
assert.equal(job.revenueEvidenceId, null);
assert.equal(job.externalDeliveryAuthorized, false);
assert.equal(job.deliveryApprovalId, null);
assert.equal(job.deliveredAt, null);

console.log(JSON.stringify({
  proof: "SARA_REVENUE_PILOT_NO_PRICE_TESTING",
  result: "PASS",
  billingMode: job.plan.billingMode,
  customerBudgetFieldPresent: Object.hasOwn(job.input, "customerBudgetUsd"),
  priceFieldPresent: Object.hasOwn(job.plan, "priceUsd"),
  revenueRecognized: job.revenueEvidenceId !== null,
  externalDeliveryAuthorized: job.externalDeliveryAuthorized,
  finalStatus: job.status,
  actualExecutionCostUsd: job.actualExecutionCostUsd,
}, null, 2));
