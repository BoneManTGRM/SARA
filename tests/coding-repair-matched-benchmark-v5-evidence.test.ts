import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import { runMatchedCodingRepairBenchmarkV5 } from "../src/coding-repair-matched-benchmark-v5.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 evidence fixture",
  summary: "A minimal deterministic evidence fixture.",
  limitations: [],
  files: [
    { path: "src/value.ts", content: "export const value = 0;\n" },
    { path: "tests/value.test.ts", content: "// immutable verifier stand-in\n" },
  ],
};

function verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult> {
  const passed = candidate.files[0].content.includes("42");
  const failure: CodingFailureSignal = {
    kind: "behavior",
    code: "VALUE_REMAINS",
    file: "src/value.ts",
    line: 1,
    column: 1,
    evidenceDigest: sha256("value-evidence"),
    fingerprint: sha256("value-failure"),
    severity: "medium",
    existedBeforeRepair: true,
  };
  return Promise.resolve({
    passed,
    score: passed ? 1 : 0.8,
    artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures: passed ? [] : [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [passed ? sha256("verified") : failure.evidenceDigest],
  });
}

const model: CodingRepairModel = {
  async propose({ candidate, verification, strategy }) {
    const current = candidate.files[0].content;
    return {
      proposal: {
        schemaVersion: 1,
        baseArtifactDigest: verification.artifactDigest,
        failureFingerprint: verification.failures[0].fingerprint,
        strategy,
        changes: [{
          path: "src/value.ts",
          expectedContentDigest: sha256(current),
          replacementText: "export const value = 42;\n",
        }],
        limitations: [],
      },
      inputTokens: 10,
      outputTokens: 10,
      accountedCostUsd: 0.01,
    };
  },
};

describe("V5 matched benchmark evidence", () => {
  it("binds horizon-aware diversification to the contract, pair, and authority envelope", async () => {
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
