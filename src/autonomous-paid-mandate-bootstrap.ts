import { compileStandingMandate, type StandingMandate, type StandingMandateInput } from "./autonomy.ts";
import { SaraKernel } from "./kernel.ts";

export const AUTONOMOUS_PAID_MANDATE_ID = "autonomous-paid-readiness-2026-09-04-v1";

export function autonomousPaidMandate(ownerId: string): StandingMandateInput {
  return {
    id: AUTONOMOUS_PAID_MANDATE_ID,
    allowedActions: ["fixed_service_fulfillment", "verified_report_delivery"],
    allowedChannels: ["approved_api"],
    allowedServiceIds: ["public-repository-readiness-snapshot"],
    maximumCostPerActionUsd: 3,
    maximumDailyActions: 10,
    maximumConcurrentActions: 1,
    startsAt: "2026-09-04T00:00:00.000Z",
    expiresAt: "2026-10-04T00:00:00.000Z",
    ownerId,
  };
}

export function autonomousPaidMandateDigest(ownerId = "OWNER"): string {
  return compileStandingMandate(autonomousPaidMandate(ownerId)).digest;
}

export async function activateApprovedAutonomousPaidMandate(input: {
  kernel: SaraKernel;
  ownerToken?: string;
  approvedDigest?: string;
  now?: Date;
}): Promise<StandingMandate | null> {
  const approvedDigest = input.approvedDigest?.trim().toLowerCase();
  if (!approvedDigest) return null;
  if (!/^[a-f0-9]{64}$/u.test(approvedDigest)) {
    throw new Error("SARA_AUTONOMOUS_PAID_MANDATE_APPROVED_SHA256 must be a SHA-256 digest.");
  }
  const ownerToken = input.ownerToken?.trim();
  if (!ownerToken) throw new Error("The exact autonomous paid mandate requires the configured owner credential.");
  const owner = input.kernel.authenticateOwnerToken(ownerToken);
  const mandateInput = autonomousPaidMandate(owner.id);
  const compiled = compileStandingMandate(mandateInput);
  if (compiled.digest !== approvedDigest) {
    throw new Error("The approved autonomous paid mandate digest does not match the exact bounded mandate.");
  }
  const existing = (await input.kernel.getStatus()).standingMandate;
  if (existing?.id === compiled.id && existing.revokedAt) {
    throw new Error("The autonomous paid mandate was revoked and cannot be reactivated by a deployment restart.");
  }
  const now = (input.now ?? new Date()).getTime();
  if (now < Date.parse(compiled.startsAt)) throw new Error("The approved autonomous paid mandate is not active yet.");
  if (now >= Date.parse(compiled.expiresAt)) return null;
  return input.kernel.activateStandingMandate(owner, mandateInput, {
    approvalId: `deployment-exact-digest:${approvedDigest}`,
    action: "required_owner_approval_change",
    targetId: `standing-mandate:${compiled.id}`,
    approvedAt: new Date(now).toISOString(),
    ownerId: owner.id,
  });
}
