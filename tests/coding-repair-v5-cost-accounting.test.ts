import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/experimental-v5/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/experimental-v5/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);
const tinyAccountedCostUsd = 0.0000004;

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 exact cost fixture",
  summary: "Preserve every positively accounted model cost in bounded evidence.",
  limitations: [],
  files: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
};

const failure: CodingFailureSignal = {
  kind: "behavior",
  code: "VALUE_WRONG",
  file: "src/value.ts",
  line: 1,
  column: 1,
  evidenceDigest: digest("tiny-cost-failure-evidence"),
  fingerprint: digest("tiny-cost-failure"),
  severity: "medium",
  existedBeforeRepair: true,
};

function verification(candidate: ProgramCandidateProposal): ProgramVerificationResult {
  const passed = candidate.files[0].content.includes("value = 2");
  return {
    passed,
    score: passed ? 1 : 0.8,
    artifactDigest: digest(JSON.stringify(candidate.files)),
    failures: passed ? [] : [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [digest(passed ? "tiny-cost-pass" : "tiny-cost-fail")],
  };
}

describe("V5 exact accounted cost evidence", () => {
  it("does not round a positive sub-micro cost down to zero", async () => {
    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => verification(candidate),
      model: {
        async propose(request) {
          return {
            proposal: {
              schemaVersion: 1,
              baseArtifactDigest: request.verification.artifactDigest,
              failureFingerprint: request.verification.failures[0].fingerprint,
              strategy: request.strategy,
              changes: [{
                path: "src/value.ts",
                expectedContentDigest: digest(request.candidate.files[0].content),
                replacementText: "export const value = 2;\n",
              }],
              limitations: [],
            },
            inputTokens: 1,
            outputTokens: 1,
            accountedCostUsd: tinyAccountedCostUsd,
          };
        },
      },
    });

    assert.equal(run.state, "VERIFIED_CANDIDATE");
    assert.equal(run.accountedCostUsd, tinyAccountedCostUsd);
    assert.equal(run.performanceGauge.modelCalls, 1);
    assert.equal(run.performanceGauge.accountedCostUsd, run.accountedCostUsd);
    assert(run.performanceGauge.accountedCostUsd > 0);
  });
});
