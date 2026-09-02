import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DIGITAL_JOB_KINDS,
  compileDigitalWorkCard,
  compileDigitalWorkHandoff,
  digitalJobAcceptanceTarget,
  digitalJobDeliveryTarget,
  type DigitalJobKind,
  type DigitalWorkRequest,
} from "../src/digital-work.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";

const OWNER_TOKEN = "digital-work-owner-token";
const OWNER_DIGEST = createHash("sha256").update(OWNER_TOKEN).digest("hex");
const SHA = "a".repeat(64);

function request(kind: DigitalJobKind = "documentation", overrides: Partial<DigitalWorkRequest> = {}): DigitalWorkRequest {
  return {
    kind,
    objective: "Produce a tested public-repository deliverable.",
    sourceUrl: "https://github.com/example/project/issues/42",
    buyerReference: "public-bounty-42",
    authorizedScope: "Public repository and named issue only.",
    expectedDeliverables: ["One review-ready artifact"],
    acceptanceCriteria: ["Artifact passes the declared verifier"],
    acceptanceCriteriaAutomatable: true,
    maximumBudgetUsd: 0,
    offeredCompensationUsd: 149,
    safety: {
      publicOrOwnerProvidedNonSensitiveInput: true,
      requiresCredentials: false,
      containsPrivateCustomerData: false,
      requiresHumanIdentity: false,
      requiresRegulatedJudgment: false,
      requiresSecurityExploitation: false,
      requiresExternalAccountCreation: false,
    },
    ...overrides,
  };
}

async function kernel(): Promise<SaraKernel> {
  return SaraKernel.boot({ stateDirectory: await mkdtemp(join(tmpdir(), "sara-digital-work-")), ownerTokenSha256: OWNER_DIGEST });
}

describe("SARA bounded digital job control plane", () => {
  it("supports seven useful digital job families with least-privilege tool envelopes", () => {
    assert.deepEqual(DIGITAL_JOB_KINDS, [
      "software_change",
      "software_testing",
      "documentation",
      "localization",
      "public_research",
      "data_transformation",
      "repository_assessment",
    ]);
    for (const kind of DIGITAL_JOB_KINDS) {
      const card = compileDigitalWorkCard(request(kind));
      assert.equal(card.maximumBudgetUsd, 0);
      assert.equal(card.executionBoundary, "ISOLATED_DRAFT_ONLY");
      assert.ok(card.allowedTools.length >= 3);
      assert.ok(card.prohibitedActions.includes("spend or move money"));
    }
  });

  it("requires human review only for professional judgment or non-automatable acceptance", () => {
    assert.equal(compileDigitalWorkCard(request("documentation")).requiresHumanReview, false);
    assert.equal(compileDigitalWorkCard(request("repository_assessment")).requiresHumanReview, true);
    assert.equal(compileDigitalWorkCard(request("software_testing", { acceptanceCriteriaAutomatable: false })).requiresHumanReview, true);
  });

  it("rejects paid execution, private data, credentials, accounts, impersonation, and exploit work", () => {
    assert.throws(() => compileDigitalWorkCard(request("documentation", { maximumBudgetUsd: 1 })), /\$0 owner-funded/);
    for (const key of [
      "requiresCredentials",
      "containsPrivateCustomerData",
      "requiresHumanIdentity",
      "requiresRegulatedJudgment",
      "requiresSecurityExploitation",
      "requiresExternalAccountCreation",
    ] as const) {
      assert.throws(
        () => compileDigitalWorkCard(request("documentation", { safety: { ...request().safety, [key]: true } })),
        /prohibited authority/,
      );
    }
  });

  it("compiles an exact executor handoff only after owner authorization", async () => {
    const sara = await kernel();
    const owner = sara.authenticateOwnerToken(OWNER_TOKEN);
    const job = await sara.createDigitalWorkJob(SARA_PRINCIPAL, request("documentation"));
    assert.equal(job.status, "qualified");
    assert.throws(() => compileDigitalWorkHandoff(job, sara.constitutionDigest), /authorized digital job/);
    const authorized = await sara.authorizeDigitalWorkJob(owner, job.id, {
      approvalId: "accept-1",
      action: "contract_commitment",
      targetId: digitalJobAcceptanceTarget(job.id),
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    const handoff = compileDigitalWorkHandoff(authorized, sara.constitutionDigest);
    assert.equal(handoff.kind, "documentation");
    assert.equal(handoff.maximumBudgetUsd, 0);
    assert.ok(handoff.allowedTools.includes("document_writer"));
  });

  it("runs automatable work unattended to review-ready evidence but never self-authorizes delivery", async () => {
    const sara = await kernel();
    const owner = sara.authenticateOwnerToken(OWNER_TOKEN);
    const created = await sara.createDigitalWorkJob(SARA_PRINCIPAL, request("software_testing"));
    const authorized = await sara.authorizeDigitalWorkJob(owner, created.id, {
      approvalId: "accept-2",
      action: "contract_commitment",
      targetId: digitalJobAcceptanceTarget(created.id),
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    const running = await sara.startDigitalWorkJob(SARA_PRINCIPAL, authorized.id, "zero-cost-test-executor", 0);
    assert.equal(running.status, "running");
    const completed = await sara.completeDigitalWorkJob(SARA_PRINCIPAL, running.id, {
      artifactDigest: SHA,
      artifactReference: "draft://artifact/software-testing-42",
      summary: "Tests completed with reproducible evidence.",
      verification: [{ command: "npm test", exitCode: 0, outputDigest: "b".repeat(64) }],
    });
    assert.equal(completed.status, "review_ready");
    await assert.rejects(
      sara.authorizeDigitalWorkDelivery(SARA_PRINCIPAL, completed.id, {
        approvalId: "deliver-fake",
        action: "contract_commitment",
        targetId: digitalJobDeliveryTarget(completed),
        approvedAt: new Date().toISOString(),
        ownerId: "sara",
      }),
      /owner/i,
    );
  });

  it("lets a registered zero-cost adapter complete an authorized job without owner labor", async () => {
    const sara = await kernel();
    const owner = sara.authenticateOwnerToken(OWNER_TOKEN);
    const created = await sara.createDigitalWorkJob(SARA_PRINCIPAL, request("documentation"));
    await sara.authorizeDigitalWorkJob(owner, created.id, {
      approvalId: "accept-adapter",
      action: "contract_commitment",
      targetId: digitalJobAcceptanceTarget(created.id),
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    let receivedTools: string[] = [];
    const completed = await sara.runDigitalWorkJob(SARA_PRINCIPAL, created.id, {
      id: "zero-cost-document-adapter",
      maximumCostUsd: 0,
      supportedKinds: ["documentation"],
      async execute(handoff) {
        receivedTools = handoff.allowedTools;
        return {
          artifactDigest: SHA,
          artifactReference: "draft://artifact/adapter-document",
          summary: "Documentation adapter completed the bounded work.",
          verification: [{ command: "docs:verify", exitCode: 0, outputDigest: "9".repeat(64) }],
        };
      },
    });
    assert.ok(receivedTools.includes("document_writer"));
    assert.equal(completed.status, "review_ready");
  });

  it("routes repository assessments through a real human-review gate", async () => {
    const sara = await kernel();
    const owner = sara.authenticateOwnerToken(OWNER_TOKEN);
    const created = await sara.createDigitalWorkJob(SARA_PRINCIPAL, request("repository_assessment"));
    await sara.authorizeDigitalWorkJob(owner, created.id, {
      approvalId: "accept-3",
      action: "contract_commitment",
      targetId: digitalJobAcceptanceTarget(created.id),
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    await sara.startDigitalWorkJob(SARA_PRINCIPAL, created.id, "nico-read-only-assessor", 0);
    const completed = await sara.completeDigitalWorkJob(SARA_PRINCIPAL, created.id, {
      artifactDigest: SHA,
      artifactReference: "draft://nico/report-42",
      summary: "Automated assessment draft completed.",
      verification: [{ command: "nico:verify-draft", exitCode: 0, outputDigest: "c".repeat(64) }],
    });
    assert.equal(completed.status, "human_review_required");
    const reviewed = await sara.recordDigitalWorkHumanReview(owner, completed.id, {
      reviewer: "owner",
      decision: "approved",
      evidenceDigest: "d".repeat(64),
    });
    assert.equal(reviewed.status, "review_ready");
  });

  it("requires digest-bound owner delivery approval and owner-attested settled payment", async () => {
    const sara = await kernel();
    const owner = sara.authenticateOwnerToken(OWNER_TOKEN);
    const created = await sara.createDigitalWorkJob(SARA_PRINCIPAL, request("documentation"));
    await sara.authorizeDigitalWorkJob(owner, created.id, {
      approvalId: "accept-4",
      action: "contract_commitment",
      targetId: digitalJobAcceptanceTarget(created.id),
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    await sara.startDigitalWorkJob(SARA_PRINCIPAL, created.id, "zero-cost-document-executor", 0);
    const completed = await sara.completeDigitalWorkJob(SARA_PRINCIPAL, created.id, {
      artifactDigest: SHA,
      artifactReference: "draft://artifact/document-42",
      summary: "Documentation artifact verified.",
      verification: [{ command: "docs:verify", exitCode: 0, outputDigest: "e".repeat(64) }],
    });
    await assert.rejects(
      sara.authorizeDigitalWorkDelivery(owner, completed.id, {
        approvalId: "deliver-wrong",
        action: "contract_commitment",
        targetId: `digital-job:${completed.id}:deliver:${"f".repeat(64)}`,
        approvedAt: new Date().toISOString(),
        ownerId: owner.id,
      }),
      /approval/i,
    );
    const deliveryAuthorized = await sara.authorizeDigitalWorkDelivery(owner, completed.id, {
      approvalId: "deliver-4",
      action: "contract_commitment",
      targetId: digitalJobDeliveryTarget(completed),
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    const delivered = await sara.recordDigitalWorkDelivery(SARA_PRINCIPAL, deliveryAuthorized.id, "f".repeat(64));
    assert.equal(delivered.status, "delivered");
    const paid = await sara.recordDigitalWorkPayment(owner, delivered.id, 149, "1".repeat(64));
    assert.equal(paid.status, "paid");
    assert.equal((await sara.getStatus()).realizedProfit.collectedRevenueUsd, 149);
  });
});
