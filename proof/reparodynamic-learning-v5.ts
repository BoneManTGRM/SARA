import assert from "node:assert/strict";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);
const behavioralSuiteDigest = digest("v5-proof-behavior-suite");
const behavioralEvidenceDigest = digest("v5-proof-aggregate-behavior:1-of-4");

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 causal novelty proof",
  summary: "Deterministic mechanism evidence for bounded semantic-repeat rejection.",
  limitations: ["No provider model is called.", "No general performance claim is supported."],
  files: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
};

const failure: CodingFailureSignal = {
  kind: "behavior",
  code: "VALUE_WRONG",
  file: "src/value.ts",
  line: 1,
  column: 1,
  evidenceDigest: digest("v5-proof-value-evidence"),
  fingerprint: digest("v5-proof-value-failure"),
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
    evidenceDigests: [digest("v5-proof-verifier-evidence")],
    behavioralChecks: {
      schemaVersion: 1,
      passed: 1,
      total: 4,
      suiteDigest: behavioralSuiteDigest,
      evidenceDigest: behavioralEvidenceDigest,
      disclosure: "aggregate_only",
    },
  };
}

const replacements = [
  "export const value = Math.round(1.4);\n",
  "export const value = Math.round(1.4) + 0;\n",
  "export const value = Math.round(1.4) + 1;\n",
];
let modelCalls = 0;

const run = await runCodingRepairController({
  baseline,
  verify: async (candidate) => verification(candidate),
  model: {
    async propose(request) {
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
  },
});

const gauge = run.performanceGauge;
assert.equal(run.state, "STOPPED");
assert.equal(run.receipts.length, 3);
assert.equal(gauge.evidenceLevel, "DETERMINISTIC_SINGLE_RUN");
assert.equal(gauge.verifierExecutions, 3);
assert.equal(gauge.advisoryOnlyCounterfactualVerifierExecutions, 4);
assert.equal(gauge.semanticRepeatRejections, 1);
assert.equal(gauge.verifierExecutionsAvoided, 1);
assert.equal(gauge.modelCalls, 3);
assert.equal(gauge.modelCalls, modelCalls);
assert.equal(gauge.accountedCostUsd, 0.03);
assert.equal(gauge.accountedCostUsd, run.accountedCostUsd);
assert.equal(gauge.completionGain, 0);
assert.equal(gauge.scoreGain, 0);
assert.deepEqual(gauge.behavioralProgress, {
  disclosure: "aggregate_only",
  comparable: true,
  baseline: {
    passed: 1,
    total: 4,
    suiteDigest: behavioralSuiteDigest,
    evidenceDigest: behavioralEvidenceDigest,
  },
  final: {
    passed: 1,
    total: 4,
    suiteDigest: behavioralSuiteDigest,
    evidenceDigest: behavioralEvidenceDigest,
  },
  passedDelta: 0,
  completionRatioDelta: 0,
});
assert.equal(gauge.counterfactualBasis, "semantic_tactic_repeat_rejections_only");
assert.equal(gauge.generalClaimSupported, false);
assert.match(gauge.limitsDigest, /^[a-f0-9]{64}$/u);
assert.match(gauge.evidenceDigest, /^[a-f0-9]{64}$/u);

console.log(JSON.stringify({
  proof: "SARA_REPARODYNAMIC_CAUSAL_NOVELTY_V5",
  result: "PASS",
  evidenceLevel: gauge.evidenceLevel,
  mechanism: {
    verifierExecutions: gauge.verifierExecutions,
    advisoryOnlyCounterfactualVerifierExecutions: gauge.advisoryOnlyCounterfactualVerifierExecutions,
    semanticRepeatRejections: gauge.semanticRepeatRejections,
    verifierExecutionsAvoided: gauge.verifierExecutionsAvoided,
    deterministicModelCalls: gauge.modelCalls,
    logicalAccountedCostUsd: gauge.accountedCostUsd,
    completionGain: gauge.completionGain,
    scoreGain: gauge.scoreGain,
    behavioralProgress: gauge.behavioralProgress,
    counterfactualBasis: gauge.counterfactualBasis,
  },
  evidenceDigest: gauge.evidenceDigest,
  limitsDigest: gauge.limitsDigest,
  physicalSpendUsd: 0,
  providerModelCalls: 0,
  generalClaimSupported: gauge.generalClaimSupported,
  authority: {
    maximumCycles: INITIAL_CODING_REPAIR_LIMITS.maximumCycles,
    surgicalFiles: INITIAL_CODING_REPAIR_LIMITS.surgicalFiles,
    surgicalChangedLines: INITIAL_CODING_REPAIR_LIMITS.surgicalChangedLines,
    deepFiles: INITIAL_CODING_REPAIR_LIMITS.deepFiles,
    deepChangedLines: INITIAL_CODING_REPAIR_LIMITS.deepChangedLines,
    maximumModelSpendUsd: INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd,
    repositoryMutation: false,
    merge: false,
    deploy: false,
    promotion: false,
  },
}, null, 2));
