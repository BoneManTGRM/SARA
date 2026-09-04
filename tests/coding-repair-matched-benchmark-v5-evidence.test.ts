import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import { runMatchedCodingRepairBenchmarkV5 } from "../src/coding-repair-matched-benchmark-v5.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import {
  buildCodingRepairGovernanceSignals,
  summarizeCodingRepairGovernanceTrend,
} from "../src/coding-repair-tgrm-governance.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 evidence fixture",
  summary: "A deterministic three-cycle evidence fixture.",
  limitations: [],
  files: [
    { path: "src/value.ts", content: "export const value = 0;\n" },
    { path: "tests/value.test.ts", content: "// immutable verifier stand-in\n" },
  ],
};

function verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult> {
  const source = candidate.files[0].content;
  const passed = source.includes("42");
  const initial = source.includes("= 0");
  const code = initial ? "VALUE_VALIDATION" : "VALUE_REMAINS";
  const failure: CodingFailureSignal = {
    kind: "behavior",
    code,
    file: "src/value.ts",
    line: 1,
    column: 1,
    evidenceDigest: sha256(`${code}:evidence`),
    fingerprint: sha256(`${code}:class`),
    severity: "medium",
    existedBeforeRepair: true,
  };
  return Promise.resolve({
    passed,
    score: passed ? 1 : initial ? 0.6 : 0.8,
    artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures: passed ? [] : [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [passed ? sha256("verified") : failure.evidenceDigest],
  });
}

const model: CodingRepairModel = {
  async propose(request) {
    const current = request.candidate.files[0].content;
    const remainingCycles = INITIAL_CODING_REPAIR_LIMITS.maximumCycles - request.cycle + 1;
    const trend = summarizeCodingRepairGovernanceTrend(
      buildCodingRepairGovernanceSignals({
        lessons: request.attemptLessons ?? [],
        limits: INITIAL_CODING_REPAIR_LIMITS,
      }),
      { remainingCycles },
    );
    const replacementText = request.cycle === 1
      ? "export const value = 1;\n"
      : request.cycle === 2
        ? "export const value = Math.round(1);\n"
        : trend.action === "diversify"
          ? "export const value = 42;\n"
          : current.replace("Math.round", "Math.ceil");
    return {
      proposal: {
        schemaVersion: 1,
        baseArtifactDigest: request.verification.artifactDigest,
        failureFingerprint: request.verification.failures[0].fingerprint,
        strategy: request.strategy,
        changes: [{
          path: "src/value.ts",
          expectedContentDigest: sha256(current),
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

type HorizonDecisionEvidence = {
  schemaVersion: 1;
  finalModelCycle: number;
  remainingCyclesAtFinalCall: number;
  inputLessonsDigest: string;
  signalsDigest: string;
  trend: {
    action: string;
    finalOpportunity: boolean;
    allowSameTacticFamily: boolean;
  };
};

describe("V5 matched benchmark evidence", () => {
  it("binds the actual horizon decision to the contract, pair, and authority envelope", async () => {
    const result = await runMatchedCodingRepairBenchmarkV5({
      caseId: "v5-evidence-fixture",
      sourceCommit: "a".repeat(40),
      modelRouteKey: "deterministic:v5-evidence:v1",
      environment: { node: "test", platform: "test", typescript: "test" },
      objective: "Return the verified value 42.",
      acceptanceCriteria: ["The independent verifier observes value 42."],
      constitutionDigest: "b".repeat(64),
      memoryContextDigest: "c".repeat(64),
      baseline,
      verify,
      model,
    });

    assert.equal(result.valid, true);
    assert.equal(result.control.verifiedComplete, false);
    assert.equal(result.canary.verifiedComplete, true);
    assert.equal(result.schemaVersion, 5);
    assert.equal(result.contract.schemaVersion, 5);
    assert.equal(result.contract.canaryPolicy, "bounded_reparodynamic_horizon_learning_v5");
    assert.deepEqual(result.contract.horizonGovernance, {
      horizonSource: "controller_owned_remaining_cycles_within_existing_three_cycle_ceiling",
      finalOpportunity: "remaining_cycles_equals_one",
      diversifyTrigger: "prior_verified_gain_plus_latest_evidence_backed_no_gain_rejection",
      missingTacticEvidence: "conserve_without_invented_novelty",
      tacticFamilyRule: "disallow_latest_rejected_family_only_for_diversify_rethink_or_retreat",
      authorityEffect: "selection_only_no_cycle_budget_or_mutation_ceiling_expansion",
    });

    const horizonDecision = Reflect.get(result, "horizonDecision") as HorizonDecisionEvidence | undefined;
    assert(horizonDecision, "V5 result must expose its actual final-call governance evidence.");
    assert.equal(horizonDecision.schemaVersion, 1);
    assert.equal(horizonDecision.finalModelCycle, 3);
    assert.equal(horizonDecision.remainingCyclesAtFinalCall, 1);
    assert.equal(horizonDecision.trend.action, "diversify");
    assert.equal(horizonDecision.trend.finalOpportunity, true);
    assert.equal(horizonDecision.trend.allowSameTacticFamily, false);
    assert.match(horizonDecision.inputLessonsDigest, /^[a-f0-9]{64}$/u);
    assert.match(horizonDecision.signalsDigest, /^[a-f0-9]{64}$/u);

    assert.match(result.contractDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.pairDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.authorityDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.evidenceEnvelopeDigest, /^[a-f0-9]{64}$/u);
    assert.equal(result.authority.maximumCycles, 3);
    assert.equal(result.authority.repositoryMutation, false);
    assert.equal(result.authority.merge, false);
    assert.equal(result.authority.deploy, false);
    assert.equal(result.authority.promotion, false);
    assert.equal(result.generalClaimSupported, false);
  });
});
