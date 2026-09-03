import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { CommercialTerms } from "./commercial-terms.ts";
import type { RevenuePilotJob } from "./revenue-pilot.ts";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_USDC_CONTRACT,
  BASE_USDC_PAYMENT_AMOUNT_ATOMIC,
  type VerifiedUsdcPayment,
} from "./usdc-payment.ts";

export type RevenuePaymentIntent = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  provider: "base-usdc-direct";
  status: "awaiting_payment" | "confirmed" | "authorized" | "expired" | "refunded" | "disputed";
  chainId: 8453;
  network: "Base";
  token: "USDC";
  tokenContract: typeof BASE_USDC_CONTRACT;
  amountAtomic: "149000000";
  amountUsd: 149;
  recipientAddress: string;
  clientSecretDigest: string;
  customerReferenceDigest: string;
  termsVersion: string;
  termsDigest: string;
  createdAt: string;
  expiresAt: string;
  payment: VerifiedUsdcPayment | null;
  revenueEvidenceId: string | null;
  updatedAt: string;
};

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const ADDRESS = /^0x[a-f0-9]{40}$/i;

export function paymentClientSecretDigest(secret: string): string {
  if (secret.length < 32 || secret.length > 256) throw new Error("Payment client secret is invalid.");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function paymentClientSecretMatches(intent: RevenuePaymentIntent, secret: string): boolean {
  if (secret.length < 32 || secret.length > 256) return false;
  const received = Buffer.from(createHash("sha256").update(secret, "utf8").digest("hex"), "hex");
  const expected = Buffer.from(intent.clientSecretDigest, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createRevenuePaymentIntent(input: {
  id: string;
  job: RevenuePilotJob;
  recipientAddress: string;
  clientSecretDigest: string;
  customerReferenceDigest: string;
  terms: CommercialTerms;
  now?: Date;
  lifetimeMinutes?: number;
}): RevenuePaymentIntent {
  if (input.job.status !== "offer_ready" || input.job.plan.priceUsd !== 149) {
    throw new Error("Only an offer-ready $149 pilot may receive a payment intent.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.id)) throw new Error("Payment intent id is invalid.");
  const recipientAddress = input.recipientAddress.toLowerCase();
  if (!ADDRESS.test(recipientAddress)) throw new Error("Receiving wallet must be one 20-byte EVM address.");
  if (!SHA256_HEX.test(input.clientSecretDigest) || !SHA256_HEX.test(input.customerReferenceDigest)) {
    throw new Error("Payment and customer references must be SHA-256 digests.");
  }
  if (!SHA256_HEX.test(input.terms.digest)) throw new Error("Commercial terms digest is invalid.");
  const lifetimeMinutes = input.lifetimeMinutes ?? 60;
  if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes < 15 || lifetimeMinutes > 24 * 60) {
    throw new Error("Payment intent lifetime must be 15–1440 minutes.");
  }
  const now = input.now ?? new Date();
  return {
    schemaVersion: 1,
    id: input.id,
    jobId: input.job.id,
    provider: "base-usdc-direct",
    status: "awaiting_payment",
    chainId: BASE_MAINNET_CHAIN_ID,
    network: "Base",
    token: "USDC",
    tokenContract: BASE_USDC_CONTRACT,
    amountAtomic: BASE_USDC_PAYMENT_AMOUNT_ATOMIC.toString() as "149000000",
    amountUsd: 149,
    recipientAddress,
    clientSecretDigest: input.clientSecretDigest.toLowerCase(),
    customerReferenceDigest: input.customerReferenceDigest.toLowerCase(),
    termsVersion: input.terms.version,
    termsDigest: input.terms.digest.toLowerCase(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lifetimeMinutes * 60_000).toISOString(),
    payment: null,
    revenueEvidenceId: null,
    updatedAt: now.toISOString(),
  };
}

export function confirmRevenuePaymentIntent(
  intent: RevenuePaymentIntent,
  payment: VerifiedUsdcPayment,
  now = new Date(),
): RevenuePaymentIntent {
  if (intent.status === "confirmed" || intent.status === "authorized") {
    if (intent.payment?.transactionReferenceDigest === payment.transactionReferenceDigest) return structuredClone(intent);
    throw new Error("Payment intent is already bound to a different transaction.");
  }
  if (intent.status !== "awaiting_payment") throw new Error(`Payment intent is ${intent.status}.`);
  if (now.getTime() > Date.parse(intent.expiresAt)) throw new Error("Payment intent expired before confirmation.");
  if (
    payment.chainId !== intent.chainId ||
    payment.tokenContract !== intent.tokenContract ||
    payment.recipientAddress !== intent.recipientAddress ||
    payment.amountAtomic !== intent.amountAtomic ||
    payment.amountUsd !== intent.amountUsd
  ) {
    throw new Error("Verified payment does not match the exact payment intent.");
  }
  return { ...structuredClone(intent), status: "confirmed", payment: structuredClone(payment), updatedAt: now.toISOString() };
}

export function authorizedRevenuePaymentIntent(
  intent: RevenuePaymentIntent,
  revenueEvidenceId: string,
  now = new Date(),
): RevenuePaymentIntent {
  if (intent.status === "authorized" && intent.revenueEvidenceId === revenueEvidenceId) return structuredClone(intent);
  if (intent.status !== "confirmed" || !intent.payment) throw new Error("A confirmed on-chain payment is required.");
  if (!revenueEvidenceId.trim()) throw new Error("Revenue evidence id is required.");
  return { ...structuredClone(intent), status: "authorized", revenueEvidenceId, updatedAt: now.toISOString() };
}

export function publicPaymentIntent(intent: RevenuePaymentIntent, now = new Date()): Omit<
  RevenuePaymentIntent,
  "clientSecretDigest" | "customerReferenceDigest" | "payment" | "revenueEvidenceId"
> & { transactionReferenceDigest: string | null } {
  const status = intent.status === "awaiting_payment" && now.getTime() > Date.parse(intent.expiresAt)
    ? "expired"
    : intent.status;
  const { clientSecretDigest: _secret, customerReferenceDigest: _customer, payment, revenueEvidenceId: _revenue, ...safe } = intent;
  return { ...safe, status, transactionReferenceDigest: payment?.transactionReferenceDigest ?? null };
}

export function paymentIntentEvidenceDigest(intent: RevenuePaymentIntent): string {
  if (!intent.payment) throw new Error("Payment intent has no payment evidence.");
  return sha256(canonicalJson({
    intentId: intent.id,
    jobId: intent.jobId,
    termsDigest: intent.termsDigest,
    payment: intent.payment,
  }));
}
