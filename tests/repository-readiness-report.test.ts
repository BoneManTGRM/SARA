import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileRepositoryReadinessReport,
  type RepositoryReadinessReportInput,
} from "../src/repository-readiness-report.ts";

const SHA = "a".repeat(40);
const REPOSITORY = "https://github.com/example/project";

function permalink(path: string, line = ""): string {
  return `${REPOSITORY}/blob/${SHA}/${path}${line}`;
}

function validInput(): RepositoryReadinessReportInput {
  return {
    repository: REPOSITORY,
    immutableCommitSha: SHA,
    categoryEvidence: [
      { category: "release_controls", status: "reviewed", evidenceUrls: [permalink(".github/workflows/ci.yml")], note: "CI workflow reviewed." },
      { category: "secret_exposure", status: "reviewed", evidenceUrls: [permalink(".gitignore")], note: "Public secret-control evidence reviewed." },
      { category: "dependencies", status: "reviewed", evidenceUrls: [permalink("package.json")], note: "Dependency manifest reviewed." },
      { category: "code", status: "reviewed", evidenceUrls: [permalink("src/index.ts")], note: "Bounded source sample reviewed." },
    ],
    findings: [
      {
        id: "release-permissions",
        category: "release_controls",
        priority: "high",
        confidence: "confirmed",
        title: "Workflow permissions are not explicit",
        observation: "The workflow does not declare a permissions block.",
        recommendation: "Declare the minimum required token permissions at workflow or job scope.",
        evidenceUrl: permalink(".github/workflows/ci.yml", "#L1-L12"),
      },
      {
        id: "dependency-range",
        category: "dependencies",
        priority: "medium",
        confidence: "supported",
        title: "A runtime dependency uses a broad range",
        observation: "The public manifest accepts multiple future minor versions.",
        recommendation: "Review the update policy and preserve a reproducible lockfile.",
        evidenceUrl: permalink("package.json", "#L18-L20"),
      },
    ],
    evidenceLimitations: ["Only the bounded public evidence packet was inspected."],
  };
}

describe("$149 repository readiness report gate", () => {
  it("builds a stable owner-review report with conservative authority", () => {
    const input = validInput();
    const before = structuredClone(input);
    const report = compileRepositoryReadinessReport(input);

    assert.equal(report.status, "ready_for_owner_review");
    assert.equal(report.readiness, "attention_required");
    assert.equal(report.externalDeliveryAuthorized, false);
    assert.deepEqual(report.evidenceGaps, []);
    assert.deepEqual(report.categoryEvidence.map((record) => record.category), [
      "code",
      "dependencies",
      "secret_exposure",
      "release_controls",
    ]);
    assert.deepEqual(report.findings.map((finding) => finding.id), ["release-permissions", "dependency-range"]);
    assert.match(report.safestNextStep, /owner must review/i);
    assert.deepEqual(input, before);
    assert.deepEqual(compileRepositoryReadinessReport(input), report);
    assert.deepEqual(compileRepositoryReadinessReport({
      ...input,
      categoryEvidence: [...input.categoryEvidence].reverse(),
      findings: [...input.findings].reverse(),
    }), report);
  });

  it("stops before owner review when a category is unavailable", () => {
    const input = validInput();
    input.findings = input.findings.filter((finding) => finding.category !== "secret_exposure");
    input.categoryEvidence = input.categoryEvidence.map((record) => record.category === "secret_exposure"
      ? { ...record, status: "unavailable" as const, evidenceUrls: [], note: "Secret-scanning status was not publicly observable." }
      : record);

    const report = compileRepositoryReadinessReport(input);
    assert.equal(report.status, "needs_evidence");
    assert.equal(report.readiness, "incomplete");
    assert.deepEqual(report.evidenceGaps, ["secret_exposure: Secret-scanning status was not publicly observable."]);
    assert.match(report.safestNextStep, /Resolve every evidence gap/);
  });

  it("rejects branch-relative, cross-repository, and unanchored finding evidence", () => {
    for (const evidenceUrl of [
      `${REPOSITORY}/blob/main/src/index.ts#L1`,
      `https://github.com/other/project/blob/${SHA}/src/index.ts#L1`,
      permalink("src/index.ts"),
    ]) {
      const input = validInput();
      input.findings = [{ ...input.findings[0], evidenceUrl }];
      assert.throws(() => compileRepositoryReadinessReport(input), /same repository and immutable commit with a line anchor/i);
    }
  });

  it("rejects duplicate categories and finding identifiers", () => {
    const duplicateCategory = validInput();
    duplicateCategory.categoryEvidence = [
      ...duplicateCategory.categoryEvidence.slice(0, 3),
      duplicateCategory.categoryEvidence[0],
    ];
    assert.throws(() => compileRepositoryReadinessReport(duplicateCategory), /Duplicate evidence category/);

    const duplicateFinding = validInput();
    duplicateFinding.findings = [duplicateFinding.findings[0], duplicateFinding.findings[0]];
    assert.throws(() => compileRepositoryReadinessReport(duplicateFinding), /Duplicate finding id/);
  });

  it("rejects a finding that was not included in its category evidence record", () => {
    const input = validInput();
    input.findings = [{
      ...input.findings[0],
      evidenceUrl: permalink(".github/workflows/release.yml", "#L1-L4"),
    }];
    assert.throws(() => compileRepositoryReadinessReport(input), /outside its category evidence record/);
  });

  it("rejects unsupported assurance claims", () => {
    const input = validInput();
    input.findings = [{
      ...input.findings[0],
      observation: "This repository is vulnerability-free.",
    }];
    assert.throws(() => compileRepositoryReadinessReport(input), /unsupported assurance claim/);
  });

  it("rejects inherited object keys as priorities", () => {
    const input = validInput();
    input.findings = [{
      ...input.findings[0],
      priority: "constructor" as RepositoryReadinessReportInput["findings"][number]["priority"],
    }];
    assert.throws(() => compileRepositoryReadinessReport(input), /priority is invalid/i);
  });

  it("requires owner attention for any finding priority", () => {
    const input = validInput();
    input.findings = [{ ...input.findings[0], priority: "low" }];
    assert.equal(compileRepositoryReadinessReport(input).readiness, "attention_required");
  });

  it("permits a no-finding baseline without representing it as proof of safety", () => {
    const input = validInput();
    input.findings = [];
    const report = compileRepositoryReadinessReport(input);

    assert.equal(report.status, "ready_for_owner_review");
    assert.equal(report.readiness, "baseline_observed");
    assert.match(report.limitations.join(" "), /absence .* is not evidence/i);
  });
});
