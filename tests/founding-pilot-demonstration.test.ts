import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSaraFoundingPilotDemonstration,
  SARA_DEMONSTRATION_REVISION,
} from "../src/founding-pilot-demonstration.ts";

describe("SARA unpaid founding-pilot demonstration", () => {
  it("builds a complete owner-review report from one immutable public revision", () => {
    const artifact = buildSaraFoundingPilotDemonstration();

    assert.equal(artifact.artifactKind, "UNPAID_DEMONSTRATION");
    assert.equal(artifact.customerInvolved, false);
    assert.equal(artifact.ownerReviewCompleted, false);
    assert.equal(artifact.externalPublicationAuthorized, false);
    assert.equal(artifact.report.status, "ready_for_owner_review");
    assert.equal(artifact.report.readiness, "attention_required");
    assert.equal(artifact.report.findings.length, 2);
    assert.deepEqual(artifact.report.evidenceGaps, []);
    assert.equal(artifact.report.externalDeliveryAuthorized, false);
  });

  it("pins every evidence claim to the same repository and exact commit", () => {
    const artifact = buildSaraFoundingPilotDemonstration();
    const urls = [
      ...artifact.report.categoryEvidence.flatMap((record) => record.evidenceUrls),
      ...artifact.report.findings.map((finding) => finding.evidenceUrl),
    ];

    assert.ok(urls.length > 0);
    for (const url of urls) {
      assert.match(url, /^https:\/\/github\.com\/BoneManTGRM\/SARA\/blob\//u);
      assert.ok(url.includes(`/${SARA_DEMONSTRATION_REVISION}/`));
      assert.doesNotMatch(url, /\/blob\/(?:main|master)\//u);
    }
  });

  it("states the actual workflow observations without claiming a complete security audit", () => {
    const artifact = buildSaraFoundingPilotDemonstration();
    const [pinning, permissions] = artifact.report.findings;

    assert.equal(pinning?.id, "workflow-actions-use-movable-tags");
    assert.equal(pinning?.confidence, "confirmed");
    assert.match(pinning?.evidenceUrl ?? "", /#L12-L13$/u);
    assert.equal(permissions?.id, "ci-token-permissions-implicit");
    assert.equal(permissions?.confidence, "supported");
    assert.match(artifact.report.limitations.join(" "), /did not inspect repository settings/iu);
    assert.doesNotMatch(JSON.stringify(artifact), /no vulnerabilities|fully secure|certified|compliant/iu);
  });

  it("is deterministic and integrity-binds the compiled report", () => {
    const first = buildSaraFoundingPilotDemonstration();
    const second = buildSaraFoundingPilotDemonstration();

    assert.deepEqual(first, second);
    assert.match(first.reportDigest, /^[a-f0-9]{64}$/u);
    assert.equal(first.reportDigest, "bf24280d90ad216d06cc37be17a9b077d5de75c9b3565c2558bcc286379e468d");
  });
});
