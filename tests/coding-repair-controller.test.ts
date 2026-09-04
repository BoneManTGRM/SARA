import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1, candidateKind: "typescript_program", programName: "Repair fixture", summary: "fixture", limitations: [],
  files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: "export const value = 1;\n" },
    { path: "tests/value.test.ts", content: "// frozen\n" },
  ],
};

function result(candidate: ProgramCandidateProposal, score: number, failures: CodingFailureSignal[]): ProgramVerificationResult {
  return { passed: score === 1 && failures.length === 0, score, artifactDigest: sha256(JSON.stringify(candidate.files)), failures, completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: [sha256(String(score))] };
}

const typeFailure: CodingFailureSignal = { kind: "type", code: "TS2322", file: "src/value.ts", line: 1, column: 1, evidenceDigest: "a".repeat(64), fingerprint: "b".repeat(64), severity: "medium", existedBeforeRepair: true };

describe("Reparodynamic coding controller", () => {
  it("retains a verified improvement with an artifact-bound receipt", async () => {
    const before = result(baseline, 0.8, [typeFailure]);
    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => candidate.files[1].content.includes("42") ? result(candidate, 1, []) : before,
      model: { propose: async () => ({ proposal: { schemaVersion: 1, baseArtifactDigest: before.artifactDigest, failureFingerprint: typeFailure.fingerprint, strategy: "surgical", changes: [{ path: "src/value.ts", expectedContentDigest: sha256(baseline.files[1].content), replacementText: "export const value = 42;\n" }], limitations: [] }, inputTokens: 10, outputTokens: 10, accountedCostUsd: 0.01 }) },
    });
    assert.equal(run.state, "VERIFIED_CANDIDATE");
    assert.equal(run.receipts[0].outcome, "verified_complete");
    assert.equal(run.receipts[0].afterArtifactDigest, run.verification.artifactDigest);
  });

  it("rolls back a non-improving proposal and keeps the baseline champion", async () => {
    const before = result(baseline, 0.8, [typeFailure]);
    const run = await runCodingRepairController({
      baseline,
      verify: async () => before,
      model: { propose: async ({ candidate, verification, strategy }) => ({ proposal: { schemaVersion: 1, baseArtifactDigest: verification.artifactDigest, failureFingerprint: typeFailure.fingerprint, strategy, changes: [{ path: "src/value.ts", expectedContentDigest: sha256(candidate.files[1].content), replacementText: "export const value = 2;\n" }], limitations: [] }, inputTokens: 10, outputTokens: 10, accountedCostUsd: 0.01 }) },
    });
    assert.equal(run.state, "STOPPED");
    assert.equal(run.receipts[0].outcome, "rolled_back");
    assert.deepEqual(run.champion, baseline);
  });
});
