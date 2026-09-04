import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runMatchedCodingRepairBenchmark } from "../src/coding-repair-matched-benchmark.ts";
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

describe("matched Reparodynamic coding benchmark", () => {
  it("uses the first Luna proposal as the one-shot control and measures only bounded continuation", async () => {
    let calls = 0;
    const result = await runMatchedCodingRepairBenchmark({
      caseId: "two-step-fixture-v1",
      sourceCommit: "a".repeat(40),
      modelRouteKey: "openai:gpt-5.6-luna:paid",
      environment: { node: "test", platform: "test", typescript: "test" },
      objective: "Return the verified value 42.",
      acceptanceCriteria: ["The immutable verifier observes value 42."],
      constitutionDigest: "b".repeat(64),
      memoryContextDigest: "c".repeat(64),
      baseline,
      verify,
      model: {
        async propose({ candidate, verification, strategy }) {
          calls += 1;
          const nextValue = calls === 1 ? 1 : 42;
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
      },
    });

    assert.equal(calls, 2);
    assert.equal(result.valid, true);
    assert.equal(result.control.verifiedComplete, false);
    assert.equal(result.canary.verifiedComplete, true);
    assert.equal(result.control.accountedCostUsd, 0.01);
    assert.equal(result.canary.accountedCostUsd, 0.02);
    assert.equal(result.physicalSpendUsd, 0.02);
    assert.equal(result.deltas.verifiedCompletion, 1);
    assert(result.deltas.activeExecutionMilliseconds >= 0);
    assert.equal(result.conclusion.verifiedCompletionImproved, true);
    assert.equal(result.conclusion.verifiedVelocityImproved, true);
    assert.equal(result.generalClaimSupported, false);
    assert.equal(result.authority.repositoryMutation, false);
    assert.equal(result.authority.merge, false);
    assert.equal(result.authority.deploy, false);
    assert.equal(result.authority.promotion, false);
    assert.match(result.contractDigest, /^[a-f0-9]{64}$/u);
    assert.match(result.pairDigest, /^[a-f0-9]{64}$/u);
  });
});
