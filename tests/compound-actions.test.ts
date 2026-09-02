import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { compoundMandateApprovalTarget, validateCompoundMandateInput } from "../src/compounding.ts";
import { sha256 } from "../src/canonical.ts";
import { authenticateOwnerPrincipal, SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { PolicyDeniedError } from "../src/policy.ts";
import type {
  CompoundMandateInput,
  CompoundPurchaseExecutor,
  OwnerApproval,
  Principal,
} from "../src/types.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "compound-actions-owner-token";
const owner: Principal = authenticateOwnerPrincipal(OWNER_TOKEN);

async function kernel(): Promise<SaraKernel> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-compound-test-"));
  cleanup.push(stateDirectory);
  return SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256(OWNER_TOKEN) });
}

function mandateInput(overrides: Partial<CompoundMandateInput> = {}): CompoundMandateInput {
  return validateCompoundMandateInput({
    providerId: "cloudflare",
    operation: "workers-ai-inference",
    targetId: "account:owner:workers-ai",
    maximumTotalUsd: 100,
    maximumPerActionUsd: 40,
    expiresAt: "2027-08-31T00:00:00.000Z",
    purpose: "Use paid inference only after free capacity is exhausted and evidence supports the work.",
    ...overrides,
  });
}

function mandateApproval(input: CompoundMandateInput): OwnerApproval {
  return {
    approvalId: `approval-${input.providerId}`,
    action: "money_transfer",
    targetId: compoundMandateApprovalTarget(input),
    approvedAt: "2026-09-02T00:00:00.000Z",
    ownerId: owner.id,
  };
}

function executor(
  execute: CompoundPurchaseExecutor["execute"] = async ({ amountUsd }) => ({
    chargedUsd: amountUsd,
    externalReference: "provider-charge-1",
  }),
): CompoundPurchaseExecutor {
  return { providerId: "cloudflare", operation: "workers-ai-inference", execute };
}

async function recordRevenue(target: SaraKernel, amountUsd = 1_000): Promise<void> {
  await target.recordLedgerEntry(owner, {
    kind: "revenue",
    source: "customer",
    amountUsd,
    realized: true,
    recurringMonthly: false,
    description: "Collected customer payment",
    occurredAt: "2026-09-02T00:00:00.000Z",
  });
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SARA bounded Compound Reserve actions", () => {
  it("spends only collected Compound Reserve through an exact owner-issued mandate", async () => {
    const target = await kernel();
    const input = mandateInput();
    const mandate = await target.createCompoundMandate(owner, input, mandateApproval(input));
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: input.targetId,
        amountUsd: 1,
        description: "Inference before revenue",
      }, executor()),
      /\$0\.00 available Compound Reserve/,
    );

    await recordRevenue(target);
    const decision = await target.recordCompoundingDecision(SARA_PRINCIPAL, {
      objective: "Fund verified inference for collected customer work",
      expectedOwnerValueUsd: 2_000,
      maximumCostUsd: 100,
      confidence: 0.95,
      riskScore: 0.05,
      reserveCoverageMonths: 12,
      evidence: ["paid-pilot", "margin", "benchmark", "retention", "provider-cap"],
    });
    assert.equal(decision.reinvestmentRate, 0.5);

    const purchase = await target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
      mandateId: mandate.id,
      targetId: input.targetId,
      amountUsd: 40,
      description: "Verified Workers AI inference allocation",
    }, executor());
    assert.equal(purchase.status, "settled");
    const status = await target.getStatus();
    assert.equal(status.realizedProfit.reinvestmentUsd, 500);
    assert.equal(status.realizedProfit.ownerDistributionUsd, 500);
    assert.equal(status.compoundReinvestmentSpentUsd, 40);
    assert.equal(status.availableCompoundReserveUsd, 460);
    assert.equal(status.compoundMandates[0].approvalId, mandateApproval(input).approvalId);
    assert.equal(status.compoundPurchases[0].externalReference, "provider-charge-1");
    assert.equal(status.ownerFundedRecurringMonthlyUsd, 0);
  });

  it("rejects forged authority, target drift, per-action excess, and concurrent mandate overspend", async () => {
    const target = await kernel();
    await recordRevenue(target, 400);
    const input = mandateInput({ maximumTotalUsd: 60, maximumPerActionUsd: 40 });
    const mandate = await target.createCompoundMandate(owner, input, mandateApproval(input));
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(
        { id: "sara", kind: "sara", authenticated: true },
        { mandateId: mandate.id, targetId: input.targetId, amountUsd: 1, description: "Forged SARA" },
        executor(),
      ),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "SARA_AUTHORITY_REQUIRED",
    );
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: "account:attacker",
        amountUsd: 1,
        description: "Target drift",
      }, executor()),
      /exactly match/,
    );
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: input.targetId,
        amountUsd: 40.01,
        description: "Per-action excess",
      }, executor()),
      /per-action limit/,
    );

    const pending = Promise.allSettled([
      target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: input.targetId,
        amountUsd: 40,
        description: "Concurrent action A",
      }, executor()),
      target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: input.targetId,
        amountUsd: 40,
        description: "Concurrent action B",
      }, executor()),
    ]);
    const results = await pending;
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(String((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /total limit/);
    assert.equal((await target.getStatus()).compoundReinvestmentSpentUsd, 40);
  });

  it("serializes Compound Reserve reservations across kernels sharing one durable ledger", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-compound-shared-"));
    cleanup.push(stateDirectory);
    const first = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256(OWNER_TOKEN) });
    const second = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256(OWNER_TOKEN) });
    await recordRevenue(first, 400);
    const input = mandateInput({ maximumTotalUsd: 60, maximumPerActionUsd: 40 });
    const mandate = await first.createCompoundMandate(owner, input, mandateApproval(input));
    const results = await Promise.allSettled([
      first.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: mandate.targetId,
        amountUsd: 40,
        description: "Shared-kernel purchase A",
      }, executor()),
      second.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: mandate.id,
        targetId: mandate.targetId,
        amountUsd: 40,
        description: "Shared-kernel purchase B",
      }, executor()),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await first.getStatus()).compoundReinvestmentSpentUsd, 40);
    assert.equal((await second.getStatus()).compoundReinvestmentSpentUsd, 40);
  });

  it("holds ambiguous failures for reconciliation, supports revocation, and freezes on a contract breach", async () => {
    const target = await kernel();
    await recordRevenue(target, 400);
    const firstInput = mandateInput();
    const first = await target.createCompoundMandate(owner, firstInput, mandateApproval(firstInput));
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: first.id,
        targetId: first.targetId,
        amountUsd: 20,
        description: "Provider outage",
      }, executor(async () => { throw new Error("provider unavailable"); })),
      /provider unavailable/,
    );
    const ambiguousStatus = await target.getStatus();
    assert.equal(ambiguousStatus.availableCompoundReserveUsd, 80);
    assert.equal(ambiguousStatus.reservedCompoundPurchaseBudgetUsd, 20);
    assert.equal(ambiguousStatus.compoundPurchases.at(-1)?.status, "reconciliation_required");
    assert.equal(ambiguousStatus.compoundPurchases.at(-1)?.failureCode, "EXECUTOR_OUTCOME_UNKNOWN");

    const revokeTarget = `compound-mandate-revoke:${first.id}`;
    await target.revokeCompoundMandate(owner, first.id, {
      approvalId: "approval-revoke",
      action: "money_transfer",
      targetId: revokeTarget,
      approvedAt: "2026-09-02T00:00:00.000Z",
      ownerId: owner.id,
    });
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: first.id,
        targetId: first.targetId,
        amountUsd: 1,
        description: "Revoked mandate",
      }, executor()),
      /not active/,
    );

    const secondInput = mandateInput({ targetId: "account:owner:workers-ai-v2" });
    const second = await target.createCompoundMandate(owner, secondInput, mandateApproval(secondInput));
    await assert.rejects(
      () => target.executeMandatedCompoundPurchase(SARA_PRINCIPAL, {
        mandateId: second.id,
        targetId: second.targetId,
        amountUsd: 10,
        description: "Exact-charge contract probe",
      }, executor(async () => ({ chargedUsd: 10.01, externalReference: "provider-overcharge" }))),
      /emergency stop engaged/,
    );
    const status = await target.getStatus();
    assert.equal(status.emergencyStopped, true);
    assert.equal(status.compoundReinvestmentSpentUsd, 10.01);
    assert.equal(status.compoundPurchases.at(-1)?.failureCode, "EXECUTOR_CONTRACT_VIOLATION");
  });
});
