import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController, type CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);
const privateBehaviorOutput = "PRIVATE_HIDDEN_BEHAVIOR_OUTPUT";
const behavioralSuiteDigest = digest("aggregate-behavior-suite");
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
      suiteDigest: behavioralSuiteDigest,
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
  accountedCostUsd: number;
  completionGain: number;
  scoreGain: number;
  behavioralProgress: {
    disclosure: "aggregate_only";
    comparable: boolean;
    baseline: { passed: number; total: number; suiteDigest: string; evidenceDigest: string };
    final: { passed: number; total: number; suiteDigest: string; evidenceDigest: string };
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
    assert.equal(gauge.accountedCostUsd, 0.03);
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
      suiteDigest: behavioralSuiteDigest,
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

  it("discards aggregate counters outside the safe integer range", async () => {
    const privateUnsafeOutput = "PRIVATE_UNSAFE_COUNTER_OUTPUT";
    let verifierCalls = 0;
    let modelCalls = 0;
    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => {
        verifierCalls += 1;
        return {
          passed: true,
          score: 1,
          artifactDigest: digest(JSON.stringify(candidate.files)),
          failures: [],
          completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
          evidenceDigests: [digest("unsafe-counter-verification")],
          behavioralChecks: {
            schemaVersion: 1,
            passed: Number.MAX_SAFE_INTEGER + 1,
            total: Number.MAX_SAFE_INTEGER + 1,
            suiteDigest: behavioralSuiteDigest,
            evidenceDigest: digest("unsafe-counter-evidence"),
            disclosure: "aggregate_only",
          },
          rawBehaviorOutput: privateUnsafeOutput,
        } as ProgramVerificationResult;
      },
      model: {
        async propose() {
          modelCalls += 1;
          throw new Error("An already verified candidate must not invoke the model.");
        },
      },
    });

    assert.equal(verifierCalls, 1);
    assert.equal(modelCalls, 0);
    assert.equal(run.state, "VERIFIED_CANDIDATE");
    assert.equal(run.performanceGauge.behavioralProgress, null);
    assert.equal(run.performanceGauge.verifierExecutions, 1);
    assert.equal(run.performanceGauge.modelCalls, 0);
    assert.equal(run.performanceGauge.accountedCostUsd, 0);
    assert.equal(JSON.stringify(run).includes(privateUnsafeOutput), false);
  });

  it("refuses aggregate deltas when the behavioral suite identity changes", async () => {
    const firstSuiteDigest = digest("behavior-suite-a");
    const secondSuiteDigest = digest("behavior-suite-b");
    const firstEvidenceDigest = digest("behavior-suite-a:1-of-4");
    const secondEvidenceDigest = digest("behavior-suite-b:4-of-4");
    let verifierCalls = 0;
    const run = await runCodingRepairController({
      baseline,
      verify: async (candidate) => {
        verifierCalls += 1;
        if (verifierCalls === 1) {
          return {
            passed: false,
            score: 0.8,
            artifactDigest: digest(JSON.stringify(candidate.files)),
            failures: [failure],
            completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
            evidenceDigests: [firstEvidenceDigest],
            behavioralChecks: {
              schemaVersion: 1,
              passed: 1,
              total: 4,
              suiteDigest: firstSuiteDigest,
              evidenceDigest: firstEvidenceDigest,
              disclosure: "aggregate_only",
            },
          } as ProgramVerificationResult;
        }
        return {
          passed: true,
          score: 1,
          artifactDigest: digest(JSON.stringify(candidate.files)),
          failures: [],
          completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
          evidenceDigests: [secondEvidenceDigest],
          behavioralChecks: {
            schemaVersion: 1,
            passed: 4,
            total: 4,
            suiteDigest: secondSuiteDigest,
            evidenceDigest: secondEvidenceDigest,
            disclosure: "aggregate_only",
          },
        } as ProgramVerificationResult;
      },
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
            inputTokens: 10,
            outputTokens: 10,
            accountedCostUsd: 0.01,
          };
        },
      },
    });

    assert.equal(run.state, "VERIFIED_CANDIDATE");
    assert.equal(verifierCalls, 2);
    assert.deepEqual(run.performanceGauge.behavioralProgress, {
      disclosure: "aggregate_only",
      comparable: false,
      baseline: {
        passed: 1,
        total: 4,
        suiteDigest: firstSuiteDigest,
        evidenceDigest: firstEvidenceDigest,
      },
      final: {
        passed: 4,
        total: 4,
        suiteDigest: secondSuiteDigest,
        evidenceDigest: secondEvidenceDigest,
      },
      passedDelta: null,
      completionRatioDelta: null,
    });
  });
});
