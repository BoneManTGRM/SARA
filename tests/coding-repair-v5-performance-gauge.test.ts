import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController, type CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);
const privateBehaviorOutput = "PRIVATE_HIDDEN_BEHAVIOR_OUTPUT";
const behavioralEvidenceDigest = digest("aggregate-behavior:1-of-4");

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 performance gauge fixture",
  summary: "Deterministic aggregate-only mechanism evidence.",
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

function verification(candidate: ProgramCandidateProposal): ProgramVerificationResult {
  return {
    passed: false,
    score: 0.8,
    artifactDigest: digest(JSON.stringify(candidate.files)),
    failures: [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [digest("failure")],
    behavioralChecks: {
      schemaVersion: 1,
      passed: 1,
      total: 4,
      evidenceDigest: behavioralEvidenceDigest,
      disclosure: "aggregate_only",
    },
    privateTestNames: ["must-never-escape"],
    rawBehaviorOutput: privateBehaviorOutput,
  } as ProgramVerificationResult;
}

type PerformanceGaugeView = {
  schemaVersion: 1;
  evidenceLevel: "DETERMINISTIC_SINGLE_RUN";
  verifierExecutions: number;
  advisoryOnlyCounterfactualVerifierExecutions: number;
  semanticRepeatRejections: number;
  verifierExecutionsAvoided: number;
  modelCalls: number;
  completionGain: number;
  scoreGain: number;
  behavioralProgress: {
    disclosure: "aggregate_only";
    comparable: boolean;
    baseline: { passed: number; total: number; evidenceDigest: string };
    final: { passed: number; total: number; evidenceDigest: string };
    passedDelta: number | null;
    completionRatioDelta: number | null;
  } | null;
  counterfactualBasis: "semantic_tactic_repeat_rejections_only";
  limitsDigest: string;
  evidenceDigest: string;
  generalClaimSupported: false;
};

describe("V5 bounded performance gauge", () => {
  it("measures avoided verification and preserves only aggregate behavioral evidence", async () => {
    const replacements = [
      "export const value = Math.round(1.4);\n",
      "export const value = Math.round(1.4) + 0;\n",
      "export const value = Math.round(1.4) + 1;\n",
    ];
    const observedModelVerifications: unknown[] = [];
    let modelCalls = 0;
    let verifierCalls = 0;
    const model: CodingRepairModel = {
      async propose(request) {
        observedModelVerifications.push(structuredClone(request.verification));
        const replacementText = replacements[modelCalls];
        modelCalls += 1;
        return {
          proposal: {
            schemaVersion: 1,
            baseArtifactDigest: request.verification.artifactDigest,
            failureFingerprint: request.verification.failures[0].fingerprint,
            strategy: request.strategy,
            changes: [{
              path: "src/value.ts",
              expectedContentDigest: digest(request.candidate.files[0].content),
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

    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => {
        verifierCalls += 1;
        return verification(candidate);
      },
      model,
    });

    const gauge: PerformanceGaugeView = run.performanceGauge;
    assert(gauge, "the controller must emit a bounded performance gauge");
    assert.equal(gauge.schemaVersion, 1);
    assert.equal(gauge.evidenceLevel, "DETERMINISTIC_SINGLE_RUN");
    assert.equal(gauge.verifierExecutions, verifierCalls);
    assert.equal(gauge.verifierExecutions, 3);
    assert.equal(gauge.advisoryOnlyCounterfactualVerifierExecutions, 4);
    assert.equal(gauge.semanticRepeatRejections, 1);
    assert.equal(gauge.verifierExecutionsAvoided, 1);
    assert.equal(gauge.modelCalls, modelCalls);
    assert.equal(gauge.modelCalls, 3);
    assert.equal(gauge.completionGain, 0);
    assert.equal(gauge.scoreGain, 0);
    assert.equal(gauge.counterfactualBasis, "semantic_tactic_repeat_rejections_only");
    assert.equal(gauge.generalClaimSupported, false);
    assert.match(gauge.limitsDigest, /^[a-f0-9]{64}$/u);
    assert.match(gauge.evidenceDigest, /^[a-f0-9]{64}$/u);

    assert(gauge.behavioralProgress);
    assert.equal(gauge.behavioralProgress.disclosure, "aggregate_only");
    assert.equal(gauge.behavioralProgress.comparable, true);
    assert.deepEqual(gauge.behavioralProgress.baseline, {
      passed: 1,
      total: 4,
      evidenceDigest: behavioralEvidenceDigest,
    });
    assert.deepEqual(gauge.behavioralProgress.final, gauge.behavioralProgress.baseline);
    assert.equal(gauge.behavioralProgress.passedDelta, 0);
    assert.equal(gauge.behavioralProgress.completionRatioDelta, 0);

    assert.equal(JSON.stringify(observedModelVerifications).includes(privateBehaviorOutput), false);
    assert.equal(JSON.stringify(run).includes(privateBehaviorOutput), false);
    assert.equal(JSON.stringify(observedModelVerifications).includes("must-never-escape"), false);
    assert.equal(JSON.stringify(run).includes("must-never-escape"), false);
  });
});
