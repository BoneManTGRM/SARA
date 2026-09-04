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
  summary: "A two-step deterministic repair fixture.",
  limitations: [],
  files: [
    { path: "src/value.ts", content: "export const value = 0;\n" },
    { path: "tests/value.test.ts", content: "// immutable hidden-test stand-in\n" },
  ],
};

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
  const source = candidate.files[0].content;
  const passed = source.includes("42");
  const score = passed ? 1 : source.includes("1") ? 0.8 : 0.6;
  const failures = passed ? [] : [failure(source.includes("1") ? "NEEDS_FINAL_REPAIR" : "NEEDS_FIRST_REPAIR", candidate)];
  return {
    passed,
    score,
    artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures,
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: failures.length ? failures.map((item) => item.evidenceDigest) : [sha256("verified")],
  };
}

function makeModel(counter: { calls: number }, completeFirst = false): CodingRepairModel {
  return {
    async propose({ candidate, verification, strategy }) {
      counter.calls += 1;
      const nextValue = completeFirst || counter.calls > 1 ? 42 : 1;
      return {
        proposal: {
          schemaVersion: 1,
          baseArtifactDigest: verification.artifactDigest,
          failureFingerprint: verification.failures[0].fingerprint,
          strategy,
          changes: [{
            path: "src/value.ts",
            expectedContentDigest: sha256(candidate.files[0].content),
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
    caseId: "two-step-fixture-v1",
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
  it("uses the first Luna proposal as the one-shot control and measures only bounded continuation", async () => {
    const counter = { calls: 0 };
    const result = await runMatchedCodingRepairBenchmark(benchmarkInput(makeModel(counter)));

    assert.equal(counter.calls, 2);
    assert.equal(result.valid, true);
    assert.equal(result.control.verifiedComplete, false);
    assert.equal(result.canary.verifiedComplete, true);
    assert.equal(result.control.accountedCostUsd, 0.01);
    assert.equal(result.canary.accountedCostUsd, 0.02);
    assert.equal(result.physicalSpendUsd, 0.02);
    assert.equal(result.deltas.verifiedCompletion, 1);
    assert(result.deltas.activeExecutionMilliseconds >= 0);
    assert.equal(result.timeAndCostComparable, false);
    assert.equal(result.conclusion.verifiedCompletionImproved, true);
    assert.equal(result.conclusion.executionTimeReduced, null);
    assert.equal(result.conclusion.costReduced, null);
    assert.equal(result.conclusion.verifiedVelocityImproved, true);
    assert.equal(result.conclusion.verifiedCostEfficiencyImproved, true);
    assert.equal(result.generalClaimSupported, false);
    assert.equal(result.contract.controlPolicy, "same_first_luna_proposal_then_stop");
    assert.equal(result.contract.canaryPolicy, "same_first_luna_proposal_then_bounded_verify_repair_retain");
    assert.equal(result.contract.limits.maximumCycles, INITIAL_CODING_REPAIR_LIMITS.maximumCycles);
    assert.equal(result.receipts.length, 2);
    assert.deepEqual(result.receipts.map((receipt) => receipt.outcome), ["accepted_improvement", "verified_complete"]);
    assert.equal(result.authority.repositoryMutation, false);
    assert.equal(result.authority.merge, false);
    assert.equal(result.authority.deploy, false);
    assert.equal(result.authority.promotion, false);
    assert.match(result.baselineVerificationDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.control.verificationDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.canary.verificationDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.contractDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.receiptsDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.pairDigest, /^[a-f0-9]{64}$/u);
  });

  it("rejects any attempt to increase the existing canary authority before verification or model use", async () => {
    const counter = { calls: 0 };
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
    assert.equal(counter.calls, 0);
    assert.equal(verifierCalls, 0);
  });

  it("invalidates the pair when independent post-verification evidence changes", async () => {
    const counter = { calls: 0 };
    let verifierCalls = 0;
    const result = await runMatchedCodingRepairBenchmark(benchmarkInput(makeModel(counter), async (candidate) => {
      verifierCalls += 1;
      const checked = await verify(candidate);
      return verifierCalls === 4 ? { ...checked, evidenceDigests: [sha256("unstable-post-verification")] } : checked;
    }));

    assert.equal(result.valid, false);
    assert(result.invalidReasons.includes("control_post_verification_changed"));
    assert.equal(counter.calls, 2);
    assert.equal(verifierCalls, 5);
  });

  it("compares raw time and cost only when both arms reach the same verified outcome", async () => {
    const counter = { calls: 0 };
    const result = await runMatchedCodingRepairBenchmark(benchmarkInput(makeModel(counter, true)));

    assert.equal(result.valid, true);
    assert.equal(result.control.verifiedComplete, true);
    assert.equal(result.canary.verifiedComplete, true);
    assert.equal(result.timeAndCostComparable, true);
    assert.equal(result.conclusion.costReduced, false);
    assert.notEqual(result.conclusion.executionTimeReduced, null);
    assert.equal(counter.calls, 1);
  });
});
