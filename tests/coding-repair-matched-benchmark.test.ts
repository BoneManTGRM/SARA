import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import { runMatchedCodingRepairBenchmark } from "../src/coding-repair-matched-benchmark.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Matched benchmark fixture",
  summary: "A deterministic matched control fixture.",
  limitations: [],
  files: [
    { path: "src/value.ts", content: "export const value = 0;\n" },
    { path: "tests/value.test.ts", content: "// immutable hidden-test stand-in\n" },
  ],
};

function numericValue(candidate: ProgramCandidateProposal): number {
  const match = candidate.files[0].content.match(/value = (-?\d+)/u);
  if (!match) throw new Error("Fixture value is malformed.");
  return Number(match[1]);
}

function failure(code: string, candidate: ProgramCandidateProposal): CodingFailureSignal {
  return {
    kind: "behavior",
    code,
    file: "src/value.ts",
    line: 1,
    column: 1,
    evidenceDigest: sha256(`${code}:evidence`),
    fingerprint: sha256(`${code}:${candidate.files[0].content}`),
    severity: "medium",
    existedBeforeRepair: true,
  };
}

async function verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult> {
  const value = numericValue(candidate);
  const passed = value === 42;
  const score = passed ? 1 : value === 1 ? 0.8 : value === 2 ? 0.7 : value === 0 ? 0.6 : 0.4;
  const failures = passed ? [] : [failure(value === 1 ? "NEEDS_FINAL_REPAIR" : `VALUE_${value}`, candidate)];
  return {
    passed,
    score,
    artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures,
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: failures.length ? failures.map((item) => item.evidenceDigest) : [sha256("verified")],
  };
}

function observedLessons(
  request: Parameters<CodingRepairModel["propose"]>[0],
): Array<Record<string, unknown>> {
  return (
    (request as unknown as { attemptLessons?: Array<Record<string, unknown>> }).attemptLessons ?? []
  );
}

function makeModel(
  counter: { calls: number; learnedCalls: number },
  completeFirst = false,
): CodingRepairModel {
  return {
    async propose(request) {
      counter.calls += 1;
      const lessons = observedLessons(request);
      if (lessons.some((lesson) => lesson.outcome === "rolled_back")) counter.learnedCalls += 1;
      const current = numericValue(request.candidate);
      const nextValue = completeFirst
        ? 42
        : current === 0
          ? 1
          : current === 1 && lessons.some((lesson) => lesson.outcome === "rolled_back")
            ? 42
            : current === 1
              ? -1
              : current === -1
                ? 2
                : 2;
      return {
        proposal: {
          schemaVersion: 1,
          baseArtifactDigest: request.verification.artifactDigest,
          failureFingerprint: request.verification.failures[0].fingerprint,
          strategy: request.strategy,
          changes: [{
            path: "src/value.ts",
            expectedContentDigest: sha256(request.candidate.files[0].content),
            replacementText: `export const value = ${nextValue};\n`,
          }],
          limitations: [],
        },
        inputTokens: 100,
        outputTokens: 20,
        accountedCostUsd: 0.01,
      };
    },
  };
}

function benchmarkInput(
  model: CodingRepairModel,
  verifier: (candidate: ProgramCandidateProposal) => Promise<ProgramVerificationResult> = verify,
): Parameters<typeof runMatchedCodingRepairBenchmark>[0] {
  return {
    caseId: "latest-state-versus-reparodynamic-learning-v2",
    sourceCommit: "a".repeat(40),
    modelRouteKey: "openai:gpt-5.6-luna:paid",
    environment: { node: "test", platform: "test", typescript: "test" },
    objective: "Return the verified value 42.",
    acceptanceCriteria: ["The immutable verifier observes value 42."],
    constitutionDigest: "b".repeat(64),
    memoryContextDigest: "c".repeat(64),
    baseline,
    verify: verifier,
    model,
  };
}

describe("matched Reparodynamic coding benchmark", () => {
  it("compares bounded latest-state retry against bounded rollback learning under identical limits", async () => {
    const counter = { calls: 0, learnedCalls: 0 };
    const result = await runMatchedCodingRepairBenchmark(benchmarkInput(makeModel(counter)));

    assert.equal(result.valid, true);
    assert.equal(result.control.verifiedComplete, false);
    assert.equal(result.canary.verifiedComplete, true);
    assert.equal(result.control.accountedCostUsd, 0.03);
    assert.equal(result.canary.accountedCostUsd, 0.03);
    assert.equal(result.physicalSpendUsd, 0.05);
    assert.equal(result.physicalModelCalls, 5);
    assert.equal(counter.calls, 5);
    assert.equal(counter.learnedCalls, 1);
    assert.equal(result.control.modelCalls, 3);
    assert.equal(result.canary.modelCalls, 3);
    assert.equal(result.deltas.verifiedCompletion, 1);
    assert.equal(result.timeAndCostComparable, false);
    assert.equal(result.conclusion.verifiedCompletionImproved, true);
    assert.equal(result.conclusion.executionTimeReduced, null);
    assert.equal(result.conclusion.costReduced, null);
    assert.equal(result.generalClaimSupported, false);
    assert.equal(result.contract.controlPolicy, "bounded_latest_state_luna_retry");
    assert.equal(result.contract.canaryPolicy, "bounded_reparodynamic_rollback_learning_v2");
    assert.equal(result.contract.sharedFirstProposal, true);
    assert.deepEqual(result.contract.armLimits.control, result.contract.armLimits.canary);
    assert.deepEqual(
      result.contract.reasoningSchedule.control,
      result.contract.reasoningSchedule.canary,
    );
    assert.deepEqual(
      result.contract.reasoningSchedule.canary,
      ["medium", "medium", "medium"],
    );
    assert.equal(result.contract.learning.control, "record_only_not_fed_to_model");
    assert.equal(result.contract.learning.canary, "bounded_last_two_lessons_fed_to_model");
    assert.equal(result.contract.armLimits.canary.maximumCycles, INITIAL_CODING_REPAIR_LIMITS.maximumCycles);
    assert.equal(result.contract.armLimits.canary.maximumModelSpendUsd, INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd);
    assert.equal(result.contract.physicalMaximumSpendUsd, INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd);
    assert.deepEqual(result.control.receipts.map((receipt) => receipt.outcome), [
      "advanced_latest_state",
      "advanced_latest_state",
      "advanced_latest_state",
    ]);
    assert.deepEqual(result.canary.receipts.map((receipt) => receipt.outcome), [
      "accepted_improvement",
      "rolled_back",
      "verified_complete",
    ]);
    assert.equal(result.control.attemptLessons.length, 2);
    assert.equal(result.canary.attemptLessons.length, 2);
    assert.deepEqual(
      result.canary.attemptLessons.map((lesson) => lesson.outcome),
      ["accepted_improvement", "rolled_back"],
    );
    assert.match(result.control.attemptLessonsDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.canary.attemptLessonsDigest, /^[a-f0-9]{64}$/u);
    assert.equal(result.control.duplicateRejections, 0);
    assert.equal(result.canary.duplicateRejections, 0);
    assert.equal(result.authority.repositoryMutation, false);
    assert.equal(result.authority.merge, false);
    assert.equal(result.authority.deploy, false);
    assert.equal(result.authority.promotion, false);
    assert.match(result.sharedFirstProposalDigest, /^[a-f0-9]{64}$/u);
    assert.equal(result.control.receipts[0].proposalDigest, result.sharedFirstProposalDigest);
    assert.equal(result.canary.receipts[0].proposalDigest, result.sharedFirstProposalDigest);
    assert.match(result.contractDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.pairDigest, /^[a-f0-9]{64}$/u);
  });

  it("rejects any attempt to increase arm or physical authority before verification or model use", async () => {
    const counter = { calls: 0, learnedCalls: 0 };
    let verifierCalls = 0;
    await assert.rejects(
      runMatchedCodingRepairBenchmark({
        ...benchmarkInput(makeModel(counter), async (candidate) => {
          verifierCalls += 1;
          return verify(candidate);
        }),
        limits: { ...INITIAL_CODING_REPAIR_LIMITS, maximumCycles: INITIAL_CODING_REPAIR_LIMITS.maximumCycles + 1 },
      }),
      /cannot expand maximumCycles/,
    );
    await assert.rejects(
      runMatchedCodingRepairBenchmark({
        ...benchmarkInput(makeModel(counter)),
        physicalMaximumSpendUsd: INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd + 0.01,
      }),
      /cannot expand physical spend/,
    );
    assert.equal(counter.calls, 0);
    assert.equal(verifierCalls, 0);
  });

  it("invalidates the pair when either arm changes under independent post-verification", async () => {
    const counter = { calls: 0, learnedCalls: 0 };
    let verifiedCandidateChecks = 0;
    const result = await runMatchedCodingRepairBenchmark(benchmarkInput(makeModel(counter), async (candidate) => {
      const checked = await verify(candidate);
      if (numericValue(candidate) === 42) {
        verifiedCandidateChecks += 1;
        if (verifiedCandidateChecks === 2) {
          return { ...checked, evidenceDigests: [sha256("unstable-post-verification")] };
        }
      }
      return checked;
    }));

    assert.equal(result.valid, false);
    assert(result.invalidReasons.some((reason) => reason.endsWith("_post_verification_changed")));
  });

  it("compares raw time and cost only when both matched arms independently verify", async () => {
    const counter = { calls: 0, learnedCalls: 0 };
    const result = await runMatchedCodingRepairBenchmark(benchmarkInput(makeModel(counter, true)));

    assert.equal(result.valid, true);
    assert.equal(result.control.verifiedComplete, true);
    assert.equal(result.canary.verifiedComplete, true);
    assert.equal(result.timeAndCostComparable, true);
    assert.equal(result.control.accountedCostUsd, result.canary.accountedCostUsd);
    assert.equal(result.physicalSpendUsd, 0.01);
    assert.equal(result.physicalModelCalls, 1);
    assert.equal(counter.calls, 1);
    assert.equal(result.conclusion.costReduced, false);
    assert.notEqual(result.conclusion.executionTimeReduced, null);
  });
});
