import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeRevenuePilot,
  claimRevenuePilotRole,
  compileRevenuePilot,
  completeRevenuePilotRole,
  createRevenuePilotJob,
  PILOT_ROLES,
  type RevenuePilotInput,
} from "../src/revenue-pilot.ts";

function qualified(overrides: Partial<RevenuePilotInput> = {}): RevenuePilotInput {
  return {
    opportunityId: "github-issue-123",
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
    recentCommitDays: 7,
    ...overrides,
  };
}

describe("$50 revenue pilot policy", () => {
  it("prepares one bounded $149 offer without pretending it is paid work", () => {
    const plan = compileRevenuePilot(qualified());

    assert.equal(plan.decision, "offer_ready");
    assert.equal(plan.priceUsd, 149);
    assert.equal(plan.maximumExecutionCostUsd, 3);
    assert.equal(plan.monthlyOwnerBudgetCeilingUsd, 50);
    assert.equal(plan.mayBeginFulfillment, false);
    assert.deepEqual(plan.roles, PILOT_ROLES);
    assert.deepEqual(plan.missingCapabilities, []);
    assert.match(plan.safestNextStep, /payment/i);
  });

  it("rejects forbidden scope and discovery sources that prohibit automation", () => {
    const plan = compileRevenuePilot(
      qualified({ sourceAllowsAutomatedDiscovery: false, requestsProductionChanges: true }),
    );

    assert.equal(plan.decision, "reject");
    assert.equal(plan.mayBeginFulfillment, false);
    assert.match(plan.disqualifyingRisks.join(" "), /automated discovery/i);
    assert.match(plan.disqualifyingRisks.join(" "), /production changes/i);
  });

  it("does not retain credentials or fragments from opportunity URLs", () => {
    const withQuery = compileRevenuePilot(qualified({ sourceUrl: "https://example.com/jobs/1?token=secret" }));
    const withFragment = compileRevenuePilot(qualified({ sourceUrl: "https://example.com/jobs/1#private" }));

    assert.equal(withQuery.sourceUrl, null);
    assert.equal(withFragment.sourceUrl, null);
    assert.equal(JSON.stringify(withQuery).includes("secret"), false);
    const job = createRevenuePilotJob(qualified({ sourceUrl: "https://example.com/jobs/1?token=secret" }));
    assert.equal(JSON.stringify(job).includes("secret"), false);
  });

  it("turns missing capabilities into bounded learning objectives", () => {
    const plan = compileRevenuePilot(qualified(), ["public-repository-inventory"]);

    assert.equal(plan.decision, "owner_review");
    assert.deepEqual(plan.missingCapabilities, [
      "readiness-analysis",
      "independent-report-verification",
      "delivery-package-generation",
    ]);
    assert.equal(plan.learningObjectives.length, 3);
    assert.ok(plan.learningObjectives.every((objective) => objective.maximumBudgetUsd === 0));
  });

  it("supports several bounded public-repository services without increasing authority", () => {
    const cases = [
      ["documentation-clarity-review", "release_readiness", 79, 1],
      ["ci-workflow-readiness-review", "security_baseline", 99, 2],
      ["dependency-hygiene-brief", "dependency_health", 79, 1],
    ] as const;

    for (const [requestedServiceId, primaryGoal, priceUsd, maximumExecutionCostUsd] of cases) {
      const plan = compileRevenuePilot(qualified({
        requestedServiceId,
        primaryGoal,
        customerBudgetUsd: priceUsd,
      }));

      assert.equal(plan.decision, "offer_ready");
      assert.equal(plan.serviceId, requestedServiceId);
      assert.equal(plan.priceUsd, priceUsd);
      assert.equal(plan.maximumExecutionCostUsd, maximumExecutionCostUsd);
      assert.equal(plan.mayBeginFulfillment, false);
    }
  });

  it("rejects unknown services and holds mismatched goals for owner review", () => {
    assert.throws(
      () => compileRevenuePilot(qualified({ requestedServiceId: "not-a-service" as RevenuePilotInput["requestedServiceId"] })),
      /service/i,
    );
    const plan = compileRevenuePilot(qualified({
      requestedServiceId: "dependency-hygiene-brief",
      primaryGoal: "security_baseline",
      customerBudgetUsd: 79,
    }));
    assert.equal(plan.decision, "owner_review");
    assert.match(plan.evidenceGaps.join(" "), /goal/i);
  });
});

describe("durable sequential revenue worker", () => {
  it("requires collected revenue and target-bound owner approval before work", () => {
    const job = createRevenuePilotJob(qualified(), undefined, new Date("2026-09-02T00:00:00.000Z"));

    assert.equal(job.status, "offer_ready");
    assert.throws(
      () => authorizeRevenuePilot(job, {
        collectedRevenueUsd: 0,
        revenueEvidenceId: "ledger-1",
        ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
      }),
      /collected revenue/i,
    );
    assert.throws(
      () => authorizeRevenuePilot(job, {
        collectedRevenueUsd: 149,
        revenueEvidenceId: "ledger-1",
        ownerApprovalTarget: "wrong-target",
      }),
      /target-bound owner approval/i,
    );
  });

  it("binds payment authorization to the selected service price", () => {
    const job = createRevenuePilotJob(qualified({
      requestedServiceId: "documentation-clarity-review",
      primaryGoal: "release_readiness",
      customerBudgetUsd: 79,
    }), undefined, new Date("2026-09-02T00:00:00.000Z"));

    assert.equal(job.plan.priceUsd, 79);
    assert.throws(() => authorizeRevenuePilot(job, {
      collectedRevenueUsd: 78.99,
      revenueEvidenceId: "ledger-docs",
      ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
    }), /79\.00/);
    assert.equal(authorizeRevenuePilot(job, {
      collectedRevenueUsd: 79,
      revenueEvidenceId: "ledger-docs",
      ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
    }).status, "queued");
  });

  it("leases one role at a time, survives expiry, and stops at owner-reviewed delivery", () => {
    let job = createRevenuePilotJob(qualified(), undefined, new Date("2026-09-02T00:00:00.000Z"));
    job = authorizeRevenuePilot(job, {
      collectedRevenueUsd: 149,
      revenueEvidenceId: "ledger-1",
      ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
    }, new Date("2026-09-02T00:00:30.000Z"));

    const first = claimRevenuePilotRole(job, "worker-a", new Date("2026-09-02T00:01:00.000Z"), 60);
    assert.equal(first.lease.role, "work_director");
    assert.throws(
      () => claimRevenuePilotRole(first.job, "worker-b", new Date("2026-09-02T00:01:30.000Z"), 60),
      /already leased/i,
    );
    const reclaimed = claimRevenuePilotRole(first.job, "worker-b", new Date("2026-09-02T00:02:01.000Z"), 60);
    assert.equal(reclaimed.lease.role, "work_director");
    assert.notEqual(reclaimed.lease.id, first.lease.id);

    let active = completeRevenuePilotRole(reclaimed.job, {
      leaseId: reclaimed.lease.id,
      role: reclaimed.lease.role,
      outputDigest: "a".repeat(64),
      costUsd: 0,
      verificationPassed: null,
      completedAt: "2026-09-02T00:02:20.000Z",
    });

    const remainingRoles = ["specialist_worker", "independent_verifier", "delivery_operator"] as const;
    for (const [index, role] of remainingRoles.entries()) {
      const minute = 3 + index;
      const claimed = claimRevenuePilotRole(
        active,
        `worker-${role}`,
        new Date(`2026-09-02T00:0${minute}:00.000Z`),
        60,
      );
      assert.equal(claimed.lease.role, role);
      const outputDigest = {
        specialist_worker: "b".repeat(64),
        independent_verifier: "c".repeat(64),
        delivery_operator: "d".repeat(64),
      }[role];
      const completion = {
        leaseId: claimed.lease.id,
        role,
        outputDigest,
        costUsd: role === "specialist_worker" ? 1.25 : 0.25,
        verificationPassed: role === "independent_verifier" ? true : null,
        completedAt: `2026-09-02T00:0${minute}:20.000Z`,
      };
      if (role === "delivery_operator") {
        assert.throws(() => completeRevenuePilotRole(claimed.job, completion), /compiled report digest/i);
      }
      active = completeRevenuePilotRole(claimed.job, {
        ...completion,
        ...(role === "delivery_operator" ? { reportDigest: "e".repeat(64) } : {}),
      });
    }

    assert.equal(active.status, "owner_review");
    assert.equal(active.nextRole, null);
    assert.equal(active.actualExecutionCostUsd, 1.75);
    assert.deepEqual(active.completedRoles, PILOT_ROLES);
    assert.equal(active.externalDeliveryAuthorized, false);
    assert.equal(active.receipts.at(-1)?.reportDigest, "e".repeat(64));
  });

  it("fails closed when verification fails or the $3 job cap would be exceeded", () => {
    let job = createRevenuePilotJob(qualified(), undefined, new Date("2026-09-02T00:00:00.000Z"));
    job = authorizeRevenuePilot(job, {
      collectedRevenueUsd: 149,
      revenueEvidenceId: "ledger-1",
      ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
    }, new Date("2026-09-02T00:00:30.000Z"));
    const director = claimRevenuePilotRole(job, "director", new Date("2026-09-02T00:01:00.000Z"), 60);
    job = completeRevenuePilotRole(director.job, {
      leaseId: director.lease.id,
      role: "work_director",
      outputDigest: "d".repeat(64),
      costUsd: 0,
      verificationPassed: null,
      completedAt: "2026-09-02T00:01:10.000Z",
    });
    const worker = claimRevenuePilotRole(job, "worker", new Date("2026-09-02T00:02:00.000Z"), 60);
    assert.throws(
      () => completeRevenuePilotRole(worker.job, {
        leaseId: worker.lease.id,
        role: "specialist_worker",
        outputDigest: "b".repeat(64),
        costUsd: 3.01,
        verificationPassed: null,
        completedAt: "2026-09-02T00:02:10.000Z",
      }),
      /\$3\.00 execution cap/i,
    );

    job = completeRevenuePilotRole(worker.job, {
      leaseId: worker.lease.id,
      role: "specialist_worker",
      outputDigest: "b".repeat(64),
      costUsd: 1,
      verificationPassed: null,
      completedAt: "2026-09-02T00:02:10.000Z",
    });
    const verifier = claimRevenuePilotRole(job, "verifier", new Date("2026-09-02T00:03:00.000Z"), 60);
    job = completeRevenuePilotRole(verifier.job, {
      leaseId: verifier.lease.id,
      role: "independent_verifier",
      outputDigest: "c".repeat(64),
      costUsd: 0.25,
      verificationPassed: false,
      completedAt: "2026-09-02T00:03:10.000Z",
    });
    assert.equal(job.status, "failed");
    assert.equal(job.nextRole, null);
  });

  it("requires the independent verifier to be a different logical worker", () => {
    let job = createRevenuePilotJob(qualified(), undefined, new Date("2026-09-02T00:00:00.000Z"));
    job = authorizeRevenuePilot(job, {
      collectedRevenueUsd: 149,
      revenueEvidenceId: "ledger-1",
      ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
    }, new Date("2026-09-02T00:00:30.000Z"));
    for (const [index, role] of (["work_director", "specialist_worker"] as const).entries()) {
      const minute = 1 + index;
      const claim = claimRevenuePilotRole(job, "same-worker", new Date(`2026-09-02T00:0${minute}:00.000Z`), 60);
      job = completeRevenuePilotRole(claim.job, {
        leaseId: claim.lease.id,
        role,
        outputDigest: role === "work_director" ? "a".repeat(64) : "b".repeat(64),
        costUsd: 0,
        verificationPassed: null,
        completedAt: `2026-09-02T00:0${minute}:10.000Z`,
      });
    }
    const verifier = claimRevenuePilotRole(job, "same-worker", new Date("2026-09-02T00:03:00.000Z"), 60);
    assert.throws(
      () => completeRevenuePilotRole(verifier.job, {
        leaseId: verifier.lease.id,
        role: "independent_verifier",
        outputDigest: "c".repeat(64),
        costUsd: 0,
        verificationPassed: true,
        completedAt: "2026-09-02T00:03:10.000Z",
      }),
      /different logical worker/i,
    );
  });

  it("rejects completion after a role lease expires", () => {
    let job = createRevenuePilotJob(qualified(), undefined, new Date("2026-09-02T00:00:00.000Z"));
    job = authorizeRevenuePilot(job, {
      collectedRevenueUsd: 149,
      revenueEvidenceId: "ledger-1",
      ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
    }, new Date("2026-09-02T00:00:30.000Z"));
    const claim = claimRevenuePilotRole(job, "worker", new Date("2026-09-02T00:01:00.000Z"), 30);
    assert.throws(
      () => completeRevenuePilotRole(claim.job, {
        leaseId: claim.lease.id,
        role: "work_director",
        outputDigest: "a".repeat(64),
        costUsd: 0,
        verificationPassed: null,
        completedAt: "2026-09-02T00:01:31.000Z",
      }),
      /lease expired/i,
    );
  });
});
