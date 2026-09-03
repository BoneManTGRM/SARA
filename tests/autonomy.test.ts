import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  compileBusinessCandidate,
  compileStandingMandate,
  evaluateRoutineAction,
  type RoutineActionRequest,
} from "../src/autonomy.ts";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import type { OwnerApproval } from "../src/types.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "autonomy-test-owner-token";
const OWNER_DIGEST = sha256(OWNER_TOKEN);

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function kernelAt(now = "2026-09-03T12:00:00.000Z") {
  const directory = await mkdtemp(join(tmpdir(), "sara-autonomy-test-"));
  cleanup.push(directory);
  const kernel = await SaraKernel.boot({
    stateDirectory: directory,
    ownerTokenSha256: OWNER_DIGEST,
    now: () => new Date(now),
  });
  return { kernel, owner: kernel.authenticateOwnerToken(OWNER_TOKEN), directory };
}

function request(overrides: Partial<RoutineActionRequest> = {}): RoutineActionRequest {
  return {
    id: "action-1",
    kind: "opportunity_research",
    targetId: "public-github:example/repository",
    channel: "public_web",
    serviceId: "public-repository-readiness-snapshot",
    estimatedCostUsd: 0,
    external: false,
    requestedAt: "2026-09-03T12:00:00.000Z",
    platform: "github_public_api",
    ...overrides,
  };
}

describe("exception-only autonomy", () => {
  it("fails closed without a mandate and permits only an exact active scope", () => {
    assert.equal(evaluateRoutineAction({ mandate: null, request: request(), emergencyStopped: false }).outcome, "owner_approval");
    const mandate = compileStandingMandate({
      id: "mandate-1",
      allowedActions: ["opportunity_research", "business_candidate_development"],
      allowedChannels: ["public_web"],
      allowedServiceIds: ["public-repository-readiness-snapshot"],
      maximumCostPerActionUsd: 0,
      maximumDailyActions: 10,
      maximumConcurrentActions: 1,
      startsAt: "2026-09-03T00:00:00.000Z",
      expiresAt: "2026-10-03T00:00:00.000Z",
      ownerId: "OWNER",
    });
    assert.equal(evaluateRoutineAction({ mandate, request: request(), emergencyStopped: false }).outcome, "automatic");
    assert.equal(evaluateRoutineAction({ mandate, request: request({ channel: "email" }), emergencyStopped: false }).outcome, "owner_approval");
    assert.equal(evaluateRoutineAction({ mandate, request: request({ estimatedCostUsd: 0.01 }), emergencyStopped: false }).outcome, "owner_approval");
  });

  it("denies hard boundaries regardless of mandate", () => {
    const mandate = compileStandingMandate({
      id: "mandate-1",
      allowedActions: ["opportunity_research"],
      allowedChannels: ["public_web"],
      allowedServiceIds: ["public-repository-readiness-snapshot"],
      maximumCostPerActionUsd: 0,
      maximumDailyActions: 10,
      maximumConcurrentActions: 1,
      startsAt: "2026-09-03T00:00:00.000Z",
      expiresAt: "2026-10-03T00:00:00.000Z",
      ownerId: "OWNER",
    });
    for (const prohibitedKind of ["money_transfer", "financial_account_creation", "credential_access"] as const) {
      assert.equal(evaluateRoutineAction({ mandate, request: request({ kind: prohibitedKind }), emergencyStopped: false }).outcome, "deny");
    }
    assert.equal(evaluateRoutineAction({ mandate, request: request({ kind: "custom_contract" }), emergencyStopped: false }).outcome, "owner_approval");
    assert.equal(evaluateRoutineAction({ mandate, request: request(), emergencyStopped: true }).outcome, "deny");
    assert.equal(evaluateRoutineAction({ mandate, request: request({ platform: "upwork" }), emergencyStopped: false }).code, "PLATFORM_AUTOMATION_DENIED");
    assert.equal(evaluateRoutineAction({
      mandate: { ...mandate, allowedActions: ["opportunity_research", "bounded_outreach"] },
      request: request({ kind: "bounded_outreach", channel: "approved_api", platform: "owner_site" }),
      emergencyStopped: false,
    }).outcome, "owner_approval");
    assert.equal(evaluateRoutineAction({ mandate: { ...mandate, revokedAt: "2026-09-03T11:00:00.000Z" }, request: request(), emergencyStopped: false }).outcome, "owner_approval");
    assert.equal(evaluateRoutineAction({ mandate, request: request({ requestedAt: "2026-11-01T00:00:00.000Z" }), emergencyStopped: false }).outcome, "owner_approval");
  });

  it("enforces daily and concurrency limits", () => {
    const mandate = compileStandingMandate({
      id: "mandate-1",
      allowedActions: ["opportunity_research"],
      allowedChannels: ["public_web"],
      allowedServiceIds: ["public-repository-readiness-snapshot"],
      maximumCostPerActionUsd: 0,
      maximumDailyActions: 1,
      maximumConcurrentActions: 1,
      startsAt: "2026-09-03T00:00:00.000Z",
      expiresAt: "2026-10-03T00:00:00.000Z",
      ownerId: "OWNER",
    });
    assert.equal(evaluateRoutineAction({ mandate, request: request(), emergencyStopped: false, completedToday: 1 }).code, "DAILY_LIMIT");
    assert.equal(evaluateRoutineAction({ mandate, request: request(), emergencyStopped: false, activeActions: 1 }).code, "CONCURRENCY_LIMIT");
  });

  it("persists activation, decisions, exceptions, revocation, and restart", async () => {
    const { kernel, owner, directory } = await kernelAt();
    const targetId = "standing-mandate:exception-only-v1";
    const approval: OwnerApproval = {
      approvalId: "approval-mandate-1",
      action: "required_owner_approval_change",
      targetId,
      approvedAt: "2026-09-03T12:00:00.000Z",
      ownerId: owner.id,
    };
    await kernel.activateStandingMandate(owner, {
      id: "exception-only-v1",
      allowedActions: ["opportunity_research", "business_candidate_development"],
      allowedChannels: ["public_web"],
      allowedServiceIds: ["public-repository-readiness-snapshot"],
      maximumCostPerActionUsd: 0,
      maximumDailyActions: 10,
      maximumConcurrentActions: 1,
      startsAt: "2026-09-03T12:00:00.000Z",
      expiresAt: "2026-10-03T12:00:00.000Z",
      ownerId: owner.id,
    }, approval);
    assert.equal((await kernel.evaluateAutonomousAction(SARA_PRINCIPAL, request())).outcome, "automatic");
    assert.equal((await kernel.evaluateAutonomousAction(SARA_PRINCIPAL, request({ id: "action-2", channel: "email" }))).outcome, "owner_approval");

    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_DIGEST });
    assert.equal((await restarted.getStatus()).standingMandate?.id, "exception-only-v1");
    assert.equal((await restarted.getStatus()).autonomyExceptions.length, 1);
    await restarted.revokeStandingMandate(restarted.authenticateOwnerToken(OWNER_TOKEN), "exception-only-v1", "Owner revoked it.");
    assert.ok((await restarted.getStatus()).standingMandate?.revokedAt);
    assert.equal((await restarted.evaluateAutonomousAction(SARA_PRINCIPAL, request({ id: "action-3" }))).outcome, "owner_approval");
  });

  it("compiles zero-cost business candidates without creating or operating a business", () => {
    const candidate = compileBusinessCandidate({
      id: "candidate-1",
      name: "Repository Readiness Desk",
      customerProblem: "Small maintainers need a bounded release-readiness review.",
      serviceId: "public-repository-readiness-snapshot",
      publicEvidenceUrls: ["https://github.com/example/repository"],
      expectedPriceUsd: 149,
      estimatedDeliveryCostUsd: 3,
    });
    assert.equal(candidate.stage, "SHADOW");
    assert.equal(candidate.maximumDevelopmentCostUsd, 0);
    assert.equal(candidate.mayCreateAccounts, false);
    assert.equal(candidate.mayContactCustomers, false);
    assert.equal(candidate.mayAcceptContracts, false);
  });

  it("lets SARA durably incubate a SHADOW business only inside the active mandate", async () => {
    const { kernel, owner, directory } = await kernelAt();
    const candidateInput = {
      id: "readiness-desk",
      name: "Repository Readiness Desk",
      customerProblem: "Small maintainers need a bounded release-readiness review.",
      serviceId: "public-repository-readiness-snapshot",
      publicEvidenceUrls: ["https://github.com/example/repository"],
      expectedPriceUsd: 149,
      estimatedDeliveryCostUsd: 3,
    };
    await assert.rejects(() => kernel.createBusinessCandidate(SARA_PRINCIPAL, candidateInput, "2026-09-03T12:00:00.000Z"), /No active standing mandate/);
    await kernel.activateStandingMandate(owner, {
      id: "incubator-v1",
      allowedActions: ["business_candidate_development"],
      allowedChannels: ["public_web"],
      allowedServiceIds: ["public-repository-readiness-snapshot"],
      maximumCostPerActionUsd: 0,
      maximumDailyActions: 10,
      maximumConcurrentActions: 1,
      startsAt: "2026-09-03T12:00:00.000Z",
      expiresAt: "2026-10-03T12:00:00.000Z",
      ownerId: owner.id,
    }, {
      approvalId: "approval-incubator",
      action: "required_owner_approval_change",
      targetId: "standing-mandate:incubator-v1",
      approvedAt: "2026-09-03T12:00:00.000Z",
      ownerId: owner.id,
    });
    const candidate = await kernel.createBusinessCandidate(SARA_PRINCIPAL, candidateInput, "2026-09-03T12:00:00.000Z");
    assert.equal(candidate.stage, "SHADOW");
    const restarted = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_DIGEST });
    assert.deepEqual((await restarted.getStatus()).businessCandidates.map(({ id }) => id), ["readiness-desk"]);
  });
});
