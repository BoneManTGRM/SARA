import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { buildCodingRepairPrompt, validateCodingRepairProposal } from "../src/coding-repair-prompt.ts";
import type { CodingRepairProposal } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const HIDDEN_TEST_CONTENT = "HIDDEN_EXPECTED_VALUE_9001";
const candidate: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Fixture",
  summary: "fixture",
  limitations: [],
  files: [
    { path: "src/index.ts", content: "export const ok = true;\n" },
    { path: "src/value.ts", content: "export const value = 1;\n" },
    { path: "tests/value.test.ts", content: HIDDEN_TEST_CONTENT },
  ],
};

function proposal(path = "src/value.ts"): CodingRepairProposal {
  const content = candidate.files.find((file) => file.path === path)?.content ?? "";
  return {
    schemaVersion: 1,
    baseArtifactDigest: "a".repeat(64),
    failureFingerprint: "b".repeat(64),
    strategy: "surgical",
    changes: [{
      path,
      expectedContentDigest: sha256(content),
      replacementText: "export const value = 2;\n",
    }],
    limitations: [],
  };
}

describe("strict coding repair proposal", () => {
  it("rejects stale artifacts, unknown files, model-authored tests, and strategy escalation", () => {
    const validate = (candidateProposal: CodingRepairProposal) => validateCodingRepairProposal({
      proposal: candidateProposal,
      candidate,
      artifactDigest: "a".repeat(64),
      failureFingerprints: new Set(["b".repeat(64)]),
      limits: INITIAL_CODING_REPAIR_LIMITS,
      expectedStrategy: "surgical",
    });
    assert.throws(() => validate({ ...proposal(), baseArtifactDigest: "c".repeat(64) }), /stale artifact/);
    assert.throws(() => validate({ ...proposal(), changes: [{ path: "src/missing.ts", expectedContentDigest: sha256(""), replacementText: "x" }] }), /unknown or duplicate/);
    assert.throws(() => validate(proposal("tests/value.test.ts")), /protected path/);
    assert.throws(() => validate({ ...proposal(), strategy: "deep" }), /strategy escalation/);
  });

  it("supplies bounded negative evidence and generic hypotheses without hidden-test content", () => {
    const attemptLessons = [{
      schemaVersion: 1,
      cycle: 1,
      requestedStrategy: "surgical",
      proposalDigest: "d".repeat(64),
      championArtifactDigest: "a".repeat(64),
      proposedArtifactDigest: "e".repeat(64),
      changedPaths: ["src/value.ts"],
      changedFiles: 1,
      changedLines: 1,
      beforeScore: 0.8,
      afterScore: 0.8,
      scoreDelta: 0,
      beforeFailureFingerprints: ["b".repeat(64)],
      afterFailureFingerprints: ["b".repeat(64)],
      beforeCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
      afterCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
      preservedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
      lostChecks: [],
      newlyReachedChecks: [],
      outcome: "rolled_back",
      reasonCode: "regression_or_no_progress",
      rye: 0,
    }];
    const prompt = buildCodingRepairPrompt({
      objective: "Repair the allocation invariant.",
      acceptanceCriteria: [
        "Reject invalid totals.",
        "The exact sum equals the total.",
        "Use stable deterministic tie ordering.",
      ],
      candidate,
      artifactDigest: "a".repeat(64),
      failures: [{
        kind: "behavior",
        code: "VISIBLE_FAILURE",
        file: "",
        line: 0,
        column: 0,
        evidenceDigest: "f".repeat(64),
        fingerprint: "b".repeat(64),
        severity: "medium",
        existedBeforeRepair: true,
      }],
      previouslyPassingChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
      remainingCycles: 2,
      remainingCostUsd: 0.14,
      verifiedLessons: [],
      constitutionDigest: "c".repeat(64),
      limits: INITIAL_CODING_REPAIR_LIMITS,
      strategy: "surgical",
      attemptLessons,
    } as Parameters<typeof buildCodingRepairPrompt>[0]);

    const payload = JSON.parse(prompt.split("\n").at(-1)!) as Record<string, unknown>;
    assert.equal(payload.requiredStrategy, "surgical");
    assert.deepEqual(payload.unresolvedFailureFingerprints, ["b".repeat(64)]);
    assert.equal((payload.previousAttemptLessons as unknown[]).length, 1);
    assert.match(String(payload.previousAttemptLessonsDigest), /^[a-f0-9]{64}$/u);
    assert.deepEqual(payload.rejectedProposalDigests, ["d".repeat(64)]);
    assert.equal(payload.preservedChampionDigest, "a".repeat(64));
    assert.deepEqual(
      payload.repairHypotheses,
      ["input_validation", "exact_sum_invariant", "deterministic_ordering", "behavioral_invariant"],
    );
    assert.match(String(payload.repairHypothesesDigest), /^[a-f0-9]{64}$/u);
    assert.match(String(payload.smallestSafeChange), /smallest/i);
    assert.equal(prompt.includes(HIDDEN_TEST_CONTENT), false);
  });
});
