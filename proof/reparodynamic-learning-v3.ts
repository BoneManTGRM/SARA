import assert from "node:assert/strict";
import { sha256 } from "../src/canonical.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import { projectCodingRepairAttemptLessonsForModel } from "../src/coding-repair-information-lessons.ts";
import { runMatchedCodingRepairBenchmarkV3 } from "../src/coding-repair-matched-benchmark-v3.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

function candidate(source: string): ProgramCandidateProposal {
  return {
    schemaVersion: 1,
    candidateKind: "typescript_program",
    programName: "Fresh retry-delay matched holdout",
    summary: "A deterministic retry-delay fixture not used by the earlier allocate-cents trace.",
    limitations: [],
    files: [
      { path: "src/retry-delay.ts", content: source },
      { path: "tests/retry-delay.test.ts", content: "// immutable independent verifier stand-in\n" },
    ],
  };
}

const baseline = candidate([
  "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
  "  return baseMs * attempt;",
  "}",
  "",
].join("\n"));

function firstRepair(): string {
  return [
    "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
    "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
    "  return baseMs * attempt;",
    "}",
    "",
  ].join("\n");
}

function completeRepair(): string {
  return [
    "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
    "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
    "  return Math.min(capMs, baseMs * 2 ** attempt);",
    "}",
    "",
  ].join("\n");
}

function failure(code: string, proposal: ProgramCandidateProposal): CodingFailureSignal {
  return {
    kind: "behavior",
    code,
    file: "src/retry-delay.ts",
    line: 1,
    column: 1,
    evidenceDigest: sha256(`${code}:evidence`),
    fingerprint: sha256(`${code}:${proposal.files[0].content}`),
    severity: "medium",
    existedBeforeRepair: true,
  };
}

async function verify(proposal: ProgramCandidateProposal): Promise<ProgramVerificationResult> {
  const source = proposal.files[0].content;
  const complete = source.includes("Math.min") && source.includes("2 ** attempt") && source.includes("Number.isInteger");
  const partial = source.includes("Number.isInteger");
  const score = complete ? 1 : partial ? 0.8 : 0.6;
  const failures = complete ? [] : [failure(partial ? "RETRY_DELAY_CAP_REMAINS" : "RETRY_DELAY_VALIDATION", proposal)];
  return {
    passed: complete,
    score,
    artifactDigest: sha256(JSON.stringify(proposal.files)),
    failures,
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: failures.length ? failures.map((item) => item.evidenceDigest) : [sha256("verified")],
  };
}

function makeModel(counter: { calls: number; learnedCalls: number }): CodingRepairModel {
  return {
    async propose(request) {
      counter.calls += 1;
      const current = request.candidate.files[0].content;
      const lessons = projectCodingRepairAttemptLessonsForModel(request.attemptLessons ?? []);
      const sawRejectedRound = lessons.some((lesson) => (
        lesson.outcome === "rolled_back" && lesson.sourceSignals.includes("call:Math.round:+1")
      ));
      if (sawRejectedRound) counter.learnedCalls += 1;
      const replacementText = request.cycle === 1
        ? firstRepair()
        : sawRejectedRound
          ? completeRepair()
          : request.cycle === 2
            ? current.replace("baseMs * attempt", "Math.round(baseMs * attempt)")
            : current.replace("Math.round", "Math.ceil");
      return {
        proposal: {
          schemaVersion: 1,
          baseArtifactDigest: request.verification.artifactDigest,
          failureFingerprint: request.verification.failures[0].fingerprint,
          strategy: request.strategy,
          changes: [{
            path: "src/retry-delay.ts",
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
}

const counter = { calls: 0, learnedCalls: 0 };
const result = await runMatchedCodingRepairBenchmarkV3({
  caseId: "retry-delay-information-learning-v3-holdout",
  sourceCommit: "d".repeat(40),
  modelRouteKey: "deterministic:matched-holdout:v1",
  environment: { node: process.version, platform: process.platform, typescript: "5.9.3" },
  objective: "Return a bounded deterministic exponential retry delay.",
  acceptanceCriteria: [
    "Reject invalid attempts.",
    "Use exponential growth.",
    "Never exceed the supplied cap.",
  ],
  constitutionDigest: "e".repeat(64),
  memoryContextDigest: "f".repeat(64),
  baseline,
  verify,
  model: makeModel(counter),
});

assert.equal(result.valid, true);
assert.equal(result.control.verifiedComplete, false);
assert.equal(result.control.score, 0.8);
assert.equal(result.canary.verifiedComplete, true);
assert.equal(result.canary.score, 1);
assert.equal(result.deltas.verifiedCompletion, 1);
assert.equal(result.deltas.verificationScore, 0.2);
assert.equal(result.control.accountedCostUsd, 0.03);
assert.equal(result.canary.accountedCostUsd, 0.03);
assert.equal(result.physicalSpendUsd, 0.05);
assert.equal(result.physicalModelCalls, 5);
assert.equal(counter.calls, 5);
assert.equal(counter.learnedCalls, 1);
assert.equal(result.generalClaimSupported, false);
assert.equal(result.authority.repositoryMutation, false);
assert.equal(result.authority.merge, false);
assert.equal(result.authority.deploy, false);
assert.equal(result.authority.promotion, false);

console.log(JSON.stringify({
  proof: "SARA_REPARODYNAMIC_INFORMATION_LEARNING_V3",
  result: "PASS",
  evidenceLevel: "DETERMINISTIC_MATCHED_HOLDOUT",
  benchmark: result,
}, null, 2));
