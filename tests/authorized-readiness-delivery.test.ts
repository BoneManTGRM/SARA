import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileAuthorizedAutomatedReadinessDelivery } from "../src/authorized-readiness-delivery.ts";
import type { RepositoryReadinessReportArtifact } from "../src/repository-readiness-report-artifacts.ts";
import type { RevenueDelivery } from "../src/revenue-delivery.ts";

const digest = "a".repeat(64);

function artifact(): RepositoryReadinessReportArtifact {
  return {
    schemaVersion: 1,
    jobId: "job-1",
    sourceOutputDigest: "b".repeat(64),
    reportDigest: digest,
    storedAt: "2026-09-03T12:00:00.000Z",
    report: {
      schemaVersion: 1,
      offer: "$149 Public Repository Readiness Snapshot",
      repository: "https://github.com/example/project",
      immutableCommitSha: "c".repeat(40),
      status: "ready_for_owner_review",
      readiness: "baseline_observed",
      categoryEvidence: [],
      findings: [],
      evidenceGaps: [],
      limitations: ["Bounded evidence only."],
      externalDeliveryAuthorized: false,
      safestNextStep: "Owner review.",
    },
  };
}

function delivery(overrides: Partial<RevenueDelivery> = {}): RevenueDelivery {
  return {
    schemaVersion: 1,
    id: "delivery-1",
    jobId: "job-1",
    reportDigest: digest,
    status: "active",
    accessSecretDigest: "d".repeat(64),
    createdAt: "2026-09-03T12:01:00.000Z",
    expiresAt: "2026-09-10T12:01:00.000Z",
    maximumDownloads: 10,
    downloadCount: 0,
    lastDownloadedAt: null,
    approvalId: "standing-mandate:receipt",
    revokedAt: null,
    ...overrides,
  };
}

describe("authorized automated readiness delivery", () => {
  it("produces an exact-artifact Authorized projection without a human-review claim", () => {
    const result = compileAuthorizedAutomatedReadinessDelivery(artifact(), delivery());
    assert.equal(result.authorization.status, "AUTHORIZED_AUTOMATED_DELIVERY");
    assert.equal(result.authorization.humanReviewed, false);
    assert.equal(result.report.status, "authorized_automated_delivery");
    assert.equal(result.report.externalDeliveryAuthorized, true);
    assert.match(result.reportDigest, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(result).toLowerCase().includes("controlled"), false);
  });

  it("rejects a changed report identity and revoked access", () => {
    assert.throws(
      () => compileAuthorizedAutomatedReadinessDelivery(artifact(), delivery({ reportDigest: "e".repeat(64) })),
      /exact source report/u,
    );
    assert.throws(
      () => compileAuthorizedAutomatedReadinessDelivery(artifact(), delivery({ status: "revoked" })),
      /exact source report/u,
    );
  });
});
