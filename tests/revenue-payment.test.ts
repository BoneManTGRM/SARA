import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { compileCommercialTerms } from "../src/commercial-terms.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { paymentClientSecretDigest } from "../src/revenue-payment.ts";
import type { RevenuePilotInput } from "../src/revenue-pilot.ts";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_USDC_CONTRACT,
  type VerifiedUsdcPayment,
} from "../src/usdc-payment.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "payment-owner-token";
const CLIENT_SECRET = "client-secret-with-more-than-thirty-two-characters";
const RECIPIENT = `0x${"2".repeat(40)}`;

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "sara-revenue-payment-"));
  cleanup.push(path);
  return path;
}

function opportunity(id: string): RevenuePilotInput {
  return {
    opportunityId: id,
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
  };
}

function terms() {
  return compileCommercialTerms({
    businessName: "Owner Test Business",
    contactEmail: "owner@example.com",
    governingLaw: "the laws selected by the owner",
  });
}

function payment(transaction = "a"): VerifiedUsdcPayment {
  const transactionHash = `0x${transaction.repeat(64)}`;
  return {
    schemaVersion: 1,
    provider: "base-usdc-direct",
    chainId: BASE_MAINNET_CHAIN_ID,
    tokenContract: BASE_USDC_CONTRACT,
    transactionHash,
    transactionReferenceDigest: sha256(transactionHash),
    senderAddress: `0x${"1".repeat(40)}`,
    recipientAddress: RECIPIENT,
    amountAtomic: "149000000",
    amountUsd: 149,
    blockNumber: 100,
    latestBlockNumber: 111,
    confirmations: 12,
    verifiedAt: "2026-09-03T12:00:00.000Z",
  };
}

async function setup() {
  const kernel = await SaraKernel.boot({
    stateDirectory: await directory(),
    ownerTokenSha256: sha256(OWNER_TOKEN),
    bootstrapRevenueCapabilities: true,
  });
  const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity("direct-usdc-job"));
  const intent = await kernel.createRevenuePaymentIntent(SARA_PRINCIPAL, {
    id: "pay_direct_usdc_job",
    jobId: job.id,
    recipientAddress: RECIPIENT,
    clientSecretDigest: paymentClientSecretDigest(CLIENT_SECRET),
    customerReferenceDigest: sha256("customer@example.com"),
    terms: terms(),
  });
  return { kernel, job, intent };
}

describe("durable direct USDC revenue payment", () => {
  it("binds a confirmed transaction once without treating it as realized before owner approval", async () => {
    const { kernel, intent } = await setup();
    await assert.rejects(() => kernel.inspectRevenuePaymentIntent(intent.id, "wrong-secret"), /authentication/iu);
    const confirmed = await kernel.confirmRevenuePayment(SARA_PRINCIPAL, intent.id, CLIENT_SECRET, payment());
    assert.equal(confirmed.status, "confirmed");
    assert.equal((await kernel.getStatus()).realizedProfit.collectedRevenueUsd, 0);

    const replay = await kernel.confirmRevenuePayment(SARA_PRINCIPAL, intent.id, CLIENT_SECRET, payment());
    assert.equal(replay.payment?.transactionReferenceDigest, confirmed.payment?.transactionReferenceDigest);
    assert.equal(
      (await kernel.inspectAudit()).filter(({ type }) => type === "revenue_payment_intent_snapshot").length,
      2,
    );
  });

  it("requires exact owner approval before recording revenue and queuing fulfillment", async () => {
    const { kernel, job, intent } = await setup();
    await kernel.confirmRevenuePayment(SARA_PRINCIPAL, intent.id, CLIENT_SECRET, payment());
    const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
    await assert.rejects(() => kernel.authorizeRevenuePilotFromConfirmedPayment(owner, job.id, intent.id, {
      approvalId: "wrong-target",
      action: "contract_commitment",
      targetId: "wrong-target",
      approvedAt: "2026-09-03T12:01:00.000Z",
      ownerId: owner.id,
    }), /approval/iu);
    const approved = await kernel.authorizeRevenuePilotFromConfirmedPayment(owner, job.id, intent.id, {
      approvalId: "approve-usdc-job",
      action: "contract_commitment",
      targetId: `revenue-pilot:${job.id}:fulfillment`,
      approvedAt: "2026-09-03T12:01:00.000Z",
      ownerId: owner.id,
    });
    assert.equal(approved.job.status, "queued");
    assert.equal(approved.paymentIntent.status, "authorized");
    assert.equal((await kernel.getStatus()).realizedProfit.collectedRevenueUsd, 149);

    const replay = await kernel.authorizeRevenuePilotFromConfirmedPayment(owner, job.id, intent.id, {
      approvalId: "approve-usdc-job-replay",
      action: "contract_commitment",
      targetId: `revenue-pilot:${job.id}:fulfillment`,
      approvedAt: "2026-09-03T12:02:00.000Z",
      ownerId: owner.id,
    });
    assert.equal(replay.job.revenueEvidenceId, approved.job.revenueEvidenceId);
    assert.equal((await kernel.getStatus()).realizedProfit.collectedRevenueUsd, 149);
  });

  it("enforces one active checkout and one paid fulfillment at a time", async () => {
    const { kernel, intent } = await setup();
    const secondJob = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity("second-direct-usdc-job"));
    await assert.rejects(() => kernel.createRevenuePaymentIntent(SARA_PRINCIPAL, {
      id: "pay_second_usdc_job",
      jobId: secondJob.id,
      recipientAddress: RECIPIENT,
      clientSecretDigest: paymentClientSecretDigest(`${CLIENT_SECRET}-second`),
      customerReferenceDigest: sha256("second@example.com"),
      terms: terms(),
    }), /one-job commercial lane/iu);

    await kernel.confirmRevenuePayment(SARA_PRINCIPAL, intent.id, CLIENT_SECRET, payment());
    const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
    const firstJob = (await kernel.getStatus()).revenuePilotJobs.find(({ id }) => id === intent.jobId)!;
    await kernel.authorizeRevenuePilotFromConfirmedPayment(owner, firstJob.id, intent.id, {
      approvalId: "approve-first-usdc-job",
      action: "contract_commitment",
      targetId: `revenue-pilot:${firstJob.id}:fulfillment`,
      approvedAt: "2026-09-03T12:01:00.000Z",
      ownerId: owner.id,
    });
    await assert.rejects(() => kernel.createRevenuePaymentIntent(SARA_PRINCIPAL, {
      id: "pay_second_usdc_job",
      jobId: secondJob.id,
      recipientAddress: RECIPIENT,
      clientSecretDigest: paymentClientSecretDigest(`${CLIENT_SECRET}-second`),
      customerReferenceDigest: sha256("second@example.com"),
      terms: terms(),
    }), /still fulfilling/iu);
  });
});
