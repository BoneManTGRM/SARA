import { createHash, timingSafeEqual } from "node:crypto";
import type { RevenuePilotJob } from "./revenue-pilot.ts";

export type RevenueDelivery = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  reportDigest: string;
  status: "active" | "delivered" | "revoked";
  accessSecretDigest: string;
  createdAt: string;
  expiresAt: string;
  maximumDownloads: number;
  downloadCount: number;
  lastDownloadedAt: string | null;
  approvalId: string;
  revokedAt: string | null;
};

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export function deliverySecretDigest(secret: string): string {
  if (secret.length < 32 || secret.length > 256) throw new Error("Delivery secret is invalid.");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function deliverySecretMatches(delivery: RevenueDelivery, secret: string): boolean {
  if (secret.length < 32 || secret.length > 256) return false;
  const received = createHash("sha256").update(secret, "utf8").digest();
  const expected = Buffer.from(delivery.accessSecretDigest, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createRevenueDelivery(input: {
  id: string;
  job: RevenuePilotJob;
  reportDigest: string;
  accessSecretDigest: string;
  approvalId: string;
  now?: Date;
  lifetimeHours?: number;
  maximumDownloads?: number;
}): RevenueDelivery {
  if (input.job.status !== "owner_review" || input.job.externalDeliveryAuthorized) {
    throw new Error("Only a completed owner-review job may be approved for delivery.");
  }
  const reportReceipt = input.job.receipts.find((receipt) => receipt.role === "delivery_operator");
  const verifier = input.job.receipts.find((receipt) => receipt.role === "independent_verifier");
  if (
    verifier?.verificationPassed !== true ||
    !reportReceipt?.reportDigest ||
    reportReceipt.reportDigest !== input.reportDigest ||
    !SHA256_HEX.test(input.reportDigest)
  ) {
    throw new Error("A passing independent verification and exact compiled report digest are required.");
  }
  if (!SHA256_HEX.test(input.accessSecretDigest)) throw new Error("Delivery access digest is invalid.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.id)) throw new Error("Delivery id is invalid.");
  if (!input.approvalId.trim()) throw new Error("Exact owner delivery approval is required.");
  const lifetimeHours = input.lifetimeHours ?? 72;
  if (!Number.isInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 168) {
    throw new Error("Delivery lifetime must be 1–168 hours.");
  }
  const maximumDownloads = input.maximumDownloads ?? 3;
  if (!Number.isInteger(maximumDownloads) || maximumDownloads < 1 || maximumDownloads > 10) {
    throw new Error("Delivery download limit must be 1–10.");
  }
  const now = input.now ?? new Date();
  return {
    schemaVersion: 1,
    id: input.id,
    jobId: input.job.id,
    reportDigest: input.reportDigest.toLowerCase(),
    status: "active",
    accessSecretDigest: input.accessSecretDigest.toLowerCase(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lifetimeHours * 3_600_000).toISOString(),
    maximumDownloads,
    downloadCount: 0,
    lastDownloadedAt: null,
    approvalId: input.approvalId.trim(),
    revokedAt: null,
  };
}

export function recordRevenueDeliveryDownload(delivery: RevenueDelivery, secret: string, now = new Date()): RevenueDelivery {
  if (!deliverySecretMatches(delivery, secret)) throw new Error("Delivery access authentication failed.");
  if (delivery.status === "revoked") throw new Error("Delivery access was revoked.");
  if (now.getTime() > Date.parse(delivery.expiresAt)) throw new Error("Delivery access expired.");
  if (delivery.downloadCount >= delivery.maximumDownloads) throw new Error("Delivery download limit reached.");
  return {
    ...structuredClone(delivery),
    status: "delivered",
    downloadCount: delivery.downloadCount + 1,
    lastDownloadedAt: now.toISOString(),
  };
}

export function revokeRevenueDelivery(delivery: RevenueDelivery, now = new Date()): RevenueDelivery {
  if (delivery.status === "revoked") return structuredClone(delivery);
  return { ...structuredClone(delivery), status: "revoked", revokedAt: now.toISOString() };
}
