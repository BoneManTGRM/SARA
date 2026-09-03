import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicRepositoryEvidenceSnapshot } from "../src/public-repository-evidence.ts";
import { compileRepositoryReadinessWorkerOutput } from "../src/repository-readiness-report-artifacts.ts";

const repository = "https://github.com/BoneManTGRM/SARA";
const commit = "c14f5113c34271abd69e0a9fbcbd29d4dcf4f750";
const files = [
  {
    path: "package.json",
    sourceText: "{\n  \"name\": \"sara\"\n}\n",
  },
  {
    path: "src/index.ts",
    sourceText: "export function run(): string {\n  return \"ok\";\n}\n",
  },
  {
    path: ".github/workflows/ci.yml",
    sourceText: "name: CI\non: [push]\njobs: {}\n",
  },
] as const;

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
    openIssues: 0,
    licenseSpdx: "NOASSERTION",
  },
  inventory: files.map((file) => ({ path: file.path, type: "blob" as const, size: file.sourceText.length })),
  inventoryTruncated: true,
  sampledFiles: files.map((file) => ({
    path: file.path,
    permalink: `${repository}/blob/${commit}/${file.path}`,
    sourceText: file.sourceText,
    sourceTruncated: false,
  })),
  limitations: ["Only three bounded public files were sampled."],
};

describe("deterministic readiness category evidence binding", () => {
  it("derives reviewed status and immutable evidence URLs from sampled file paths, not model discretion", () => {
    const outputText = JSON.stringify({
      categoryEvidence: [
        { category: "code", note: "Only sampled source code was reviewed." },
        { category: "dependencies", note: "Only the sampled package manifest was reviewed." },
        { category: "secret_exposure", note: "Only visible sampled text was reviewed." },
        { category: "release_controls", note: "Only the sampled CI workflow was reviewed." },
      ],
      findings: [],
      evidenceLimitations: ["No workflow execution or dedicated secret scan was supplied."],
    });

    const report = compileRepositoryReadinessWorkerOutput({ outputText, snapshot });
    const byCategory = new Map(report.categoryEvidence.map((entry) => [entry.category, entry]));

    assert.equal(report.status, "ready_for_owner_review");
    assert.deepEqual(byCategory.get("dependencies")?.evidenceUrls, [snapshot.sampledFiles[0].permalink]);
    assert.deepEqual(byCategory.get("code")?.evidenceUrls, [snapshot.sampledFiles[1].permalink]);
    assert.deepEqual(byCategory.get("release_controls")?.evidenceUrls, [snapshot.sampledFiles[2].permalink]);
    assert.deepEqual(
      byCategory.get("secret_exposure")?.evidenceUrls,
      snapshot.sampledFiles.map((file) => file.permalink).sort(),
    );
    assert.ok(report.categoryEvidence.every((entry) => entry.status === "reviewed"));
    assert.ok(report.limitations.includes(
      "SARA deterministically derived category evidence availability and immutable URLs from the bounded sampled-file paths; reviewed means only that eligible sampled evidence was available, not that the category passed or was complete.",
    ));
  });
});
