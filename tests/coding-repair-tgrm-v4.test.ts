import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  buildCodingRepairGovernanceSignals,
  summarizeCodingRepairGovernanceTrend,
} from "../src/coding-repair-tgrm-governance.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { buildCodingRepairPrompt } from "../src/coding-repair-prompt.ts";
import type { CodingRepairAttemptLesson, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);

function lesson(overrides: Partial<CodingRepairAttemptLesson> = {}): CodingRepairAttemptLesson {
  return {
    schemaVersion: 1,
    cycle: 1,
    requestedStrategy: "surgical",
    proposalDigest: digest("proposal"),
    championArtifactDigest: digest("champion"),
    proposedArtifactDigest: digest("proposed"),
    changedPaths: ["src/value.ts"],
    changedFiles: 1,
    changedLines: 1,
    beforeScore: 0.8,
    afterScore: 0.8,
    scoreDelta: 0,
    beforeFailureFingerprints: [digest("failure")],
    afterFailureFingerprints: [digest("failure")],
    beforeCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    afterCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    preservedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
    lostChecks: [],
    newlyReachedChecks: [],
    outcome: "rolled_back",
    reasonCode: "regression_or_no_progress",
    rye: 0,
    sourceChanges: [{
      schemaVersion: 1,
      path: "src/value.ts",
      beforeContentDigest: digest("before"),
      afterContentDigest: digest("after"),
      addedSignals: ["call:Math.round:+1"],
      removedSignals: [],
      signalDigest: digest("rounding-tactic"),
    }],
    sourceChangesDigest: digest("changes"),
    ...overrides,
  };
}

describe("TGRM V4 semantic stagnation governance", () => {
  it("detects repeated failed tactic families even when proposal digests differ", () => {
    const signals = buildCodingRepairGovernanceSignals({
      lessons: [
        lesson({ cycle: 1, proposalDigest: digest("proposal-a") }),
        lesson({ cycle: 2, proposalDigest: digest("proposal-b"), proposedArtifactDigest: digest("proposed-b") }),
      ],
      limits: INITIAL_CODING_REPAIR_LIMITS,
    });

    const trend = summarizeCodingRepairGovernanceTrend(signals);
    assert.equal(trend.semanticRepeatStreak, 2);
    assert.equal(trend.noGainStreak, 2);
    assert.equal(trend.action, "rethink");
    assert.equal(trend.allowSameTacticFamily, false);
  });

  it("does not penalize a materially novel tactic that produces verified gain", () => {
    const signals = buildCodingRepairGovernanceSignals({
      lessons: [
        lesson({ cycle: 1 }),
        lesson({
          cycle: 2,
          proposalDigest: digest("proposal-novel"),
          proposedArtifactDigest: digest("proposed-novel"),
          afterScore: 1,
          scoreDelta: 0.2,
          outcome: "accepted_improvement",
          reasonCode: "monotonic_improvement",
          sourceChanges: [{
            schemaVersion: 1,
            path: "src/value.ts",
            beforeContentDigest: digest("before-novel"),
            afterContentDigest: digest("after-novel"),
            addedSignals: ["syntax:IfStatement:+1", "new:RangeError:+1"],
            removedSignals: [],
            signalDigest: digest("validation-tactic"),
          }],
          sourceChangesDigest: digest("changes-novel"),
        }),
      ],
      limits: INITIAL_CODING_REPAIR_LIMITS,
    });

    const trend = summarizeCodingRepairGovernanceTrend(signals);
    assert.equal(trend.semanticRepeatStreak, 1);
    assert.equal(trend.noGainStreak, 0);
    assert.equal(trend.action, "advance");
    assert.equal(trend.allowSameTacticFamily, true);
  });

  it("projects a deterministic rethink instruction to Luna after semantic stagnation", () => {
    const candidate: ProgramCandidateProposal = {
      schemaVersion: 1,
      candidateKind: "typescript_program",
      programName: "v4 fixture",
      summary: "fixture",
      limitations: [],
      files: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
    };
    const verification: ProgramVerificationResult = {
      passed: false,
      score: 0.8,
      artifactDigest: digest("artifact"),
      failures: [{
        kind: "behavior",
        code: "VALUE_WRONG",
        file: "src/value.ts",
        line: 1,
        column: 1,
        evidenceDigest: digest("evidence"),
        fingerprint: digest("failure"),
        severity: "medium",
        existedBeforeRepair: true,
      }],
      completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
      evidenceDigests: [digest("evidence")],
    };

    const prompt = buildCodingRepairPrompt({
      objective: "Return the correct value.",
      acceptanceCriteria: ["Value is correct."],
      candidate,
      artifactDigest: verification.artifactDigest,
      failures: verification.failures,
      previouslyPassingChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
      remainingCycles: 1,
      remainingCostUsd: 0.1,
      verifiedLessons: [],
      constitutionDigest: digest("constitution"),
      limits: INITIAL_CODING_REPAIR_LIMITS,
      strategy: "surgical",
      attemptLessons: [
        lesson({ cycle: 1, proposalDigest: digest("proposal-a") }),
        lesson({ cycle: 2, proposalDigest: digest("proposal-b"), proposedArtifactDigest: digest("proposed-b") }),
      ],
    });

    assert(prompt.includes('"action":"rethink"'));
    assert(prompt.includes('"allowSameTacticFamily":false'));
    assert(prompt.includes("materially different tactic family"));
  });
});
