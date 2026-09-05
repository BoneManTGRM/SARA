import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/experimental-v5/coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { buildCodingRepairPrompt } from "../src/experimental-v5/coding-repair-prompt.ts";
import {
  buildCodingRepairGovernanceSignals,
  summarizeCodingRepairGovernanceTrend,
} from "../src/experimental-v5/coding-repair-tgrm-governance.ts";
import type {
  CodingFailureSignal,
  CodingRepairAttemptLesson,
  ProgramVerificationResult,
} from "../src/experimental-v5/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 semantic novelty fixture",
  summary: "fixture",
  limitations: [],
  files: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
};

const failure: CodingFailureSignal = {
  kind: "behavior",
  code: "VALUE_WRONG",
  file: "src/value.ts",
  line: 1,
  column: 1,
  evidenceDigest: digest("value-evidence"),
  fingerprint: digest("value-failure"),
  severity: "medium",
  existedBeforeRepair: true,
};

function verification(candidate: ProgramCandidateProposal, passed = false): ProgramVerificationResult {
  return {
    passed,
    score: passed ? 1 : 0.8,
    artifactDigest: digest(JSON.stringify(candidate.files)),
    failures: passed ? [] : [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [digest(passed ? "pass" : "failure")],
  };
}

function lesson(input: {
  cycle: number;
  proposal: string;
  addedSignals: string[];
}): CodingRepairAttemptLesson {
  return {
    schemaVersion: 1,
    cycle: input.cycle,
    requestedStrategy: "surgical",
    proposalDigest: digest(input.proposal),
    championArtifactDigest: digest("champion"),
    proposedArtifactDigest: digest(`proposed-${input.cycle}`),
    changedPaths: ["src/value.ts"],
    changedFiles: 1,
    changedLines: 1,
    beforeScore: 0.8,
    afterScore: 0.8,
    scoreDelta: 0,
    beforeFailureFingerprints: [failure.fingerprint],
    afterFailureFingerprints: [failure.fingerprint],
    beforeCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    afterCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    preservedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
    lostChecks: [],
    newlyReachedChecks: [],
    outcome: "rolled_back",
    reasonCode: "regression_or_no_progress",
    rye: 0,
    beforeFailures: [{ kind: "behavior", code: "VALUE_WRONG", file: "src/value.ts", line: 1, severity: "medium" }],
    afterFailures: [{ kind: "behavior", code: "VALUE_WRONG", file: "src/value.ts", line: 1, severity: "medium" }],
    sourceChanges: [{
      schemaVersion: 1,
      path: "src/value.ts",
      beforeContentDigest: digest("before"),
      afterContentDigest: digest(`after-${input.cycle}`),
      addedSignals: input.addedSignals,
      removedSignals: [],
      signalDigest: digest(`signals-${input.cycle}`),
    }],
    sourceChangesDigest: digest(`changes-${input.cycle}`),
  };
}

function modelFor(replacements: readonly string[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    propose: async ({
      candidate,
      verification: currentVerification,
      strategy,
    }: {
      candidate: ProgramCandidateProposal;
      verification: ProgramVerificationResult;
      strategy: "surgical" | "deep";
    }) => {
      const replacementText = replacements[calls];
      calls += 1;
      const current = candidate.files.find((file) => file.path === "src/value.ts")?.content ?? "";
      return {
        proposal: {
          schemaVersion: 1 as const,
          baseArtifactDigest: currentVerification.artifactDigest,
          failureFingerprint: currentVerification.failures[0].fingerprint,
          strategy,
          changes: [{
            path: "src/value.ts",
            expectedContentDigest: digest(current),
            replacementText,
          }],
          limitations: [],
        },
        inputTokens: 10,
        outputTokens: 10,
        accountedCostUsd: 0.01,
      };
    },
  };
}

describe("TGRM V5 causal semantic novelty gate", () => {
  it("treats a tactic-family superset as the same stagnant approach and makes the blocked family explicit", () => {
    const attempts = [
      lesson({ cycle: 1, proposal: "round", addedSignals: ["call:Math.round:+1"] }),
      lesson({
        cycle: 2,
        proposal: "round-plus",
        addedSignals: ["call:Math.round:+2", "operator:+:+1"],
      }),
    ];
    const trend = summarizeCodingRepairGovernanceTrend(buildCodingRepairGovernanceSignals({
      lessons: attempts,
      limits: INITIAL_CODING_REPAIR_LIMITS,
    }));

    assert.equal(trend.semanticRepeatStreak, 2);
    assert.equal(trend.noGainStreak, 2);
    assert.equal(trend.action, "rethink");
    assert.equal(trend.allowSameTacticFamily, false);

    const prompt = buildCodingRepairPrompt({
      objective: "Return the correct value.",
      acceptanceCriteria: ["The exported value must be correct."],
      candidate: baseline,
      artifactDigest: verification(baseline).artifactDigest,
      failures: [failure],
      previouslyPassingChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
      remainingCycles: 1,
      remainingCostUsd: 0.13,
      verifiedLessons: [],
      constitutionDigest: digest("constitution"),
      limits: INITIAL_CODING_REPAIR_LIMITS,
      strategy: "surgical",
      attemptLessons: attempts,
    });

    assert.match(prompt, /blockedTacticSignals/u);
    assert.match(prompt, /call:Math\.round/u);
    assert.match(prompt, /minimumNovelTacticSignals/u);
    assert.match(prompt, /pre-verification/u);
  });

  it("does not block a shared tactic used against a different unresolved failure class", () => {
    const first = lesson({ cycle: 1, proposal: "round-value", addedSignals: ["call:Math.round:+1"] });
    const second = lesson({ cycle: 2, proposal: "round-other", addedSignals: ["call:Math.round:+1"] });
    second.changedPaths = ["src/other.ts"];
    second.beforeFailureFingerprints = [digest("other-failure")];
    second.afterFailureFingerprints = [digest("other-failure")];
    second.beforeFailures = [{
      kind: "behavior",
      code: "OTHER_WRONG",
      file: "src/other.ts",
      line: 1,
      severity: "medium",
    }];
    second.afterFailures = structuredClone(second.beforeFailures);
    second.sourceChanges = (second.sourceChanges ?? []).map((change) => ({
      ...change,
      path: "src/other.ts",
    }));

    const trend = summarizeCodingRepairGovernanceTrend(buildCodingRepairGovernanceSignals({
      lessons: [first, second],
      limits: INITIAL_CODING_REPAIR_LIMITS,
    }));

    assert.equal(trend.noGainStreak, 2);
    assert.equal(trend.semanticRepeatStreak, 1);
    assert.equal(trend.action, "conserve");
    assert.equal(trend.allowSameTacticFamily, true);
    assert.deepEqual(trend.blockedTacticSignals, []);
  });

  it("rejects a cosmetically different but semantically stagnant final proposal before another verifier run", async () => {
    let verifierCalls = 0;
    const model = modelFor([
      "export const value = Math.round(1.4);\n",
      "export const value = Math.round(1.4) + 0;\n",
      "export const value = Math.round(1.4) + 1;\n",
    ]);
    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => {
        verifierCalls += 1;
        return verification(candidate);
      },
      model,
    });

    assert.equal(model.calls, 3);
    assert.equal(verifierCalls, 3, "baseline plus the first two proposals should be verified");
    assert.equal(run.receipts[2].outcome, "duplicate_rejected");
    assert.equal(run.receipts[2].reasonCode, "semantic_tactic_repeat");
    assert.deepEqual(run.champion, baseline);
  });

  it("allows a final proposal that adds a genuinely new bounded tactic signal", async () => {
    let verifierCalls = 0;
    const model = modelFor([
      "export const value = Math.round(1.4);\n",
      "export const value = Math.round(1.4) + 0;\n",
      "export const value = Math.min(Math.round(1.4), 2);\n",
    ]);
    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => {
        verifierCalls += 1;
        const source = candidate.files[0].content;
        return verification(candidate, source.includes("Math.min"));
      },
      model,
    });

    assert.equal(model.calls, 3);
    assert.equal(verifierCalls, 4);
    assert.equal(run.state, "VERIFIED_CANDIDATE");
    assert.equal(run.receipts[2].outcome, "verified_complete");
  });
});
