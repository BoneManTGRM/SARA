import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicRepositoryEvidenceSnapshot } from "../src/public-repository-evidence.ts";
import { compileRepositoryReadinessWorkerOutput } from "../src/repository-readiness-report-artifacts.ts";

const repository = "https://github.com/BoneManTGRM/SARA";
const commit = "c14f5113c34271abd69e0a9fbcbd29d4dcf4f750";
const permalink = `${repository}/blob/${commit}/package.json`;

const snapshot: PublicRepositoryEvidenceSnapshot = {
  schemaVersion: 1,
  provider: "github",
  repository,
  immutableCommitSha: commit,
  defaultBranch: "main",
  collectedAt: "2026-09-03T00:00:00.000Z",
  collectionMode: "anonymous_read_only",
  repositoryFacts: {
    archived: false,
    disabled: false,
    fork: false,
    stars: 0,
    openIssues: 1,
    licenseSpdx: "NOASSERTION",
  },
  inventory: [{ path: "package.json", type: "blob", size: 120 }],
  inventoryTruncated: true,
  sampledFiles: [{
    path: "package.json",
    permalink,
    sourceText: "{\n  \"name\": \"sara\",\n  \"private\": true\n}\n",
    sourceTruncated: true,
  }],
  limitations: ["Only one bounded public file was sampled."],
};

describe("repository-readiness worker local repair", () => {
  it("replaces only a missing or non-string category note with a transparent deterministic fallback", () => {
    const outputText = JSON.stringify({
      categoryEvidence: [
        {
          category: "code",
          status: "reviewed",
          evidenceUrls: [permalink],
          note: { summary: "model returned the wrong shape" },
        },
        {
          category: "dependencies",
          status: "reviewed",
          evidenceUrls: [permalink],
          note: "Dependency evidence was limited to the sampled package manifest.",
        },
        {
          category: "secret_exposure",
          status: "reviewed",
          evidenceUrls: [permalink],
          note: "Secret-exposure evidence was limited to the sampled public text.",
        },
        {
          category: "release_controls",
          status: "reviewed",
          evidenceUrls: [permalink],
          note: "Release-control evidence was limited to the sampled public text.",
        },
      ],
      findings: [],
      evidenceLimitations: ["The model output required no evidence or finding repair."],
    });

    const report = compileRepositoryReadinessWorkerOutput({ outputText, snapshot });

    assert.equal(report.status, "ready_for_owner_review");
    assert.equal(
      report.categoryEvidence.find(({ category }) => category === "code")?.note,
      "Reviewed only from the listed immutable sampled evidence; the model's malformed note was replaced locally.",
    );
    assert.ok(report.limitations.includes(
      "SARA deterministically replaced 1 missing or malformed category evidence note; no evidence URL, finding, priority, confidence, or recommendation was invented.",
    ));
  });
});
