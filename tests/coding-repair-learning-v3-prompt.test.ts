import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { buildCodingRepairAttemptLesson } from "../src/coding-repair-lessons.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { buildCodingRepairPrompt } from "../src/coding-repair-prompt.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const PRIOR_SOURCE_LITERAL = "PRIOR_SOURCE_LITERAL_MUST_NOT_LEAK";
const HIDDEN_TEST_CONTENT = "HIDDEN_EXPECTED_OUTPUT_MUST_NOT_LEAK";

function candidate(source: string): ProgramCandidateProposal {
  return {
    schemaVersion: 1,
    candidateKind: "typescript_program",
    programName: "V3 prompt projection fixture",
    summary: "Verifies compact learning evidence at the actual Luna prompt boundary.",
    limitations: [],
    files: [
      { path: "src/retry-delay.ts", content: source },
      { path: "tests/retry-delay.test.ts", content: HIDDEN_TEST_CONTENT },
    ],
  };
}

function failure(code: string, proposal: ProgramCandidateProposal): CodingFailureSignal {
  return {
    kind: "behavior",
    code,
    file: "src/retry-delay.ts",
    line: 1,
    column: 1,
    evidenceDigest: sha256(`${code}:evidence`),
    fingerprint: sha256(`${code}:${proposal.files[0].content}`),
    severity: "medium",
    existedBeforeRepair: true,
  };
}

function verification(
  proposal: ProgramCandidateProposal,
  code: string,
  score: number,
): ProgramVerificationResult {
  const failures = [failure(code, proposal)];
  return {
    passed: false,
    score,
    artifactDigest: sha256(JSON.stringify(proposal.files)),
    failures,
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: failures.map((item) => item.evidenceDigest),
  };
}

describe("V3 Luna prompt learning boundary", () => {
  it("exposes bounded semantic tactics but no prior source literal, test content, or internal artifact identity", () => {
    const beforeCandidate = candidate([
      "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
      `  const note = "${PRIOR_SOURCE_LITERAL}";`,
      "  return baseMs * attempt;",
      "}",
      "",
    ].join("\n"));
    const afterCandidate = candidate([
      "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
      "  if (!Number.isInteger(attempt)) throw new RangeError('invalid');",
      "  return Math.round(baseMs * attempt);",
      "}",
      "",
    ].join("\n"));
    const before = verification(beforeCandidate, "RETRY_DELAY_VALIDATION", 0.6);
    const after = verification(afterCandidate, "RETRY_DELAY_CAP_REMAINS", 0.6);
    const proposalDigest = sha256("rejected-proposal");
    const lesson = buildCodingRepairAttemptLesson({
      cycle: 1,
      requestedStrategy: "surgical",
      proposalDigest,
      championArtifactDigest: before.artifactDigest,
      proposedArtifactDigest: after.artifactDigest,
      changedPaths: ["src/retry-delay.ts", "tests/retry-delay.test.ts"],
      changedFiles: 1,
      changedLines: 4,
      before,
      after,
      beforeCandidate,
      afterCandidate,
      outcome: "rolled_back",
      reasonCode: "regression_or_no_progress",
      rye: 0,
    });

    const prompt = buildCodingRepairPrompt({
      objective: "Return a bounded exponential retry delay.",
      acceptanceCriteria: ["Reject invalid attempts.", "Never exceed the supplied cap."],
      candidate: afterCandidate,
      artifactDigest: after.artifactDigest,
      failures: after.failures,
      previouslyPassingChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
      remainingCycles: 2,
      remainingCostUsd: 0.14,
      verifiedLessons: [],
      constitutionDigest: sha256("constitution"),
      limits: INITIAL_CODING_REPAIR_LIMITS,
      strategy: "surgical",
      attemptLessons: [lesson],
    });
    const payload = JSON.parse(prompt.split("\n").slice(2).join("\n")) as Record<string, unknown>;
    const projected = payload.previousAttemptLessons as Array<Record<string, unknown>>;

    assert.equal(projected.length, 1);
    assert.equal(projected[0].outcome, "rolled_back");
    assert.deepEqual(projected[0].afterFailures, [{
      kind: "behavior",
      code: "RETRY_DELAY_CAP_REMAINS",
      file: "src/retry-delay.ts",
      line: 1,
      severity: "medium",
    }]);
    assert((payload.rejectedSourceSignals as string[]).includes("call:Math.round:+1"));
    assert((payload.rejectedSourceSignals as string[]).includes("call:Number.isInteger:+1"));
    assert.match(payload.previousAttemptLessonsDigest as string, /^[a-f0-9]{64}$/u);
    assert.match(payload.previousAttemptEvidenceDigest as string, /^[a-f0-9]{64}$/u);
    assert.equal("championArtifactDigest" in projected[0], false);
    assert.equal("proposedArtifactDigest" in projected[0], false);
    assert.equal("sourceChanges" in projected[0], false);
    assert.equal(prompt.includes(PRIOR_SOURCE_LITERAL), false);
    assert.equal(prompt.includes(HIDDEN_TEST_CONTENT), false);
  });
});
