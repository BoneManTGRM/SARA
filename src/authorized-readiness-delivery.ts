import { canonicalJson, sha256 } from "./canonical.ts";
import type { RepositoryReadinessReportArtifact } from "./repository-readiness-report-artifacts.ts";
import type { RevenueDelivery } from "./revenue-delivery.ts";

export type AuthorizedAutomatedReadinessDelivery = {
  schemaVersion: 1;
  deliveredAt: string | null;
  authorization: {
    status: "AUTHORIZED_AUTOMATED_DELIVERY";
    displayStatus: "Authorized — Automated Delivery";
    operator: "SARA Automated Analysis System";
    humanReviewed: false;
    sourceReportDigest: string;
    authorizationReceiptId: string;
    authorizedAt: string;
    limitations: string;
  };
  reportDigest: string;
  report: Omit<RepositoryReadinessReportArtifact["report"], "status" | "externalDeliveryAuthorized" | "safestNextStep"> & {
    status: "authorized_automated_delivery";
    externalDeliveryAuthorized: true;
    safestNextStep: string;
  };
};

export function compileAuthorizedAutomatedReadinessDelivery(
  artifact: RepositoryReadinessReportArtifact,
  delivery: RevenueDelivery,
): AuthorizedAutomatedReadinessDelivery {
  if (delivery.reportDigest !== artifact.reportDigest || delivery.status === "revoked") {
    throw new Error("Delivery authorization does not match the exact source report.");
  }
  const authorization = {
    status: "AUTHORIZED_AUTOMATED_DELIVERY" as const,
    displayStatus: "Authorized — Automated Delivery" as const,
    operator: "SARA Automated Analysis System" as const,
    humanReviewed: false as const,
    sourceReportDigest: artifact.reportDigest,
    authorizationReceiptId: delivery.approvalId,
    authorizedAt: delivery.createdAt,
    limitations: "Automated authorization confirms exact-artifact verification and deterministic compilation under an owner-issued standing mandate; it is not human specialist approval, certification, penetration testing, or a security guarantee.",
  };
  const report = {
    ...artifact.report,
    status: "authorized_automated_delivery" as const,
    externalDeliveryAuthorized: true as const,
    safestNextStep: "Use this bounded readiness snapshot with its stated evidence limits; obtain qualified human review for material security, legal, regulatory, or production decisions.",
  };
  return {
    schemaVersion: 1,
    deliveredAt: delivery.lastDownloadedAt,
    authorization,
    reportDigest: sha256(canonicalJson({ authorization, report })),
    report,
  };
}
