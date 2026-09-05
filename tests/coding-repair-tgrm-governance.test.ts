import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  buildCodingRepairGovernanceSignal,
  digestCodingRepairGovernanceSignal,
} from "../src/coding-repair-tgrm-governance.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { buildCodingRepairPrompt } from "../src/coding-repair-prompt.ts";
import type { CodingRepairAttemptLesson, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);

function lesson(overrides: Partial<CodingRepairAttemptLesson> = {}): CodingRepairAttemptLesson {
  return {
    schemaVersion: 1,
    cycle: 2,
    requestedStrategy: "surgical",
    proposalDigest: digest("proposal"),
    championArtifactDigest: digest("champion"),
    proposedArtifactDigest: digest("proposed"),
    changedPaths: ["src/value.ts"],
    changedFiles: 1,
    changedLines: 40,
    beforeScore: 0.8,
    afterScore: 0.8,
    scoreDelta: 0,
    beforeFailureFingerprints: [digest("before")],
    afterFailureFingerprints: [digest("after")],
    beforeCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    afterCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    preservedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
    lostChecks: [],
    newlyReachedChecks: [],
    outcome: "rolled_back",
    reasonCode: "regression_or_no_progress",
    rye: 0,
    ...overrides,
  };
}

describe("TGRM governance signals", () => {
  it("measures blast radius against the existing energy budget without expanding it", () => {
    const signal = buildCodingRepairGovernanceSignal({
      lesson: lesson(),
      limits: INITIAL_CODING_REPAIR_LIMITS,
    });

    assert.equal(signal.schemaVersion, 1);
    assert.equal(signal.strategy, "surgical");
    assert.equal(signal.fileBudgetRatio, 0.5);
    assert.equal(signal.lineBudgetRatio, 0.5);
    assert.equal(signal.blastRadiusRatio, 0.5);
    assert.equal(signal.energyHeadroom, 0.5);
    assert.equal(signal.driftScore, 0);
    assert.equal(signal.governanceAction, "conserve");
    assert.match(digestCodingRepairGovernanceSignal(signal), /^[a-f0-9]{64}$/u);
  });

  it("raises drift only for negative verified movement and remains bounded", () => {
    const signal = buildCodingRepairGovernanceSignal({
      lesson: lesson({
        beforeScore: 0.8,
        afterScore: 0.6,
        scoreDelta: -0.2,
        lostChecks: ["typecheck", "behavior_tests"],
        changedFiles: 2,
        changedLines: 80,
      }),
      limits: INITIAL_CODING_REPAIR_LIMITS,
    });

    assert(signal.driftScore > 0);
    assert(signal.driftScore <= 1);
    assert.equal(signal.blastRadiusRatio, 1);
    assert.equal(signal.energyHeadroom, 0);
    assert.equal(signal.governanceAction, "retreat");
  });

  it("does not mistake positive verifier gain for drift", () => {
    const signal = buildCodingRepairGovernanceSignal({
      lesson: lesson({ beforeScore: 0.6, afterScore: 0.8, scoreDelta: 0.2 }),
      limits: INITIAL_CODING_REPAIR_LIMITS,
    });
    assert.equal(signal.driftScore, 0);
    assert.equal(signal.verifiedGain, 0.2);
  });

  it("places measure-repair-validate governance evidence in the Luna prompt without exposing tests", () => {
    const candidate: ProgramCandidateProposal = {
      schemaVersion: 1,
      candidateKind: "typescript_program",
      programName: "governance fixture",
      summary: "fixture",
      limitations: [],
      files: [
        { path: "src/value.ts", content: "export const value = 1;\n" },
        { path: "tests/value.test.ts", content: "HIDDEN_TGRM_TEST_CONTENT" },
      ],
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
      attemptLessons: [lesson()],
    });

    assert(prompt.includes("measure_repair_validate"));
    assert(prompt.includes("blastRadiusRatio"));
    assert(prompt.includes("driftScore"));
    assert(prompt.includes("energyHeadroom"));
    assert.equal(prompt.includes("HIDDEN_TGRM_TEST_CONTENT"), false);
  });
});
