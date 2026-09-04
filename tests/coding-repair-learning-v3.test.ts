import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController, type CodingRepairModel } from "../src/coding-repair-controller.ts";
import {
  projectCodingRepairAttemptLessonsForModel,
} from "../src/coding-repair-lessons.ts";
import {
  summarizeCodingRepairSourceChanges,
} from "../src/coding-repair-source-signals.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const HIDDEN_TEST_CONTENT = "HIDDEN_EXPECTED_RESULT_7331";
const PRIVATE_LITERAL = "PRIVATE_LITERAL_MUST_NOT_APPEAR";

function candidate(source: string): ProgramCandidateProposal {
  return {
    schemaVersion: 1,
    candidateKind: "typescript_program",
    programName: "Learning V3 fixture",
    summary: "A fresh held-out deterministic retry-delay fixture.",
    limitations: [],
    files: [
      { path: "src/retry-delay.ts", content: source },
      { path: "tests/retry-delay.test.ts", content: HIDDEN_TEST_CONTENT },
    ],
  };
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

function verify(proposal: ProgramCandidateProposal): ProgramVerificationResult {
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

const baseline = candidate([
  "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
  `  const note = "${PRIVATE_LITERAL}";`,
  "  return baseMs * attempt;",
  "}",
  "",
].join("\n"));

describe("information-dense Reparodynamic learning v3", () => {
  it("summarizes source tactics deterministically without source literals or protected-test content", () => {
    const repaired = candidate([
      "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
      "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
      "  return Math.min(capMs, baseMs * 2 ** attempt);",
      "}",
      "",
    ].join("\n"));
    const first = summarizeCodingRepairSourceChanges({
      before: baseline,
      after: repaired,
      changedPaths: ["tests/retry-delay.test.ts", "src/retry-delay.ts"],
    });
    const second = summarizeCodingRepairSourceChanges({
      before: structuredClone(baseline),
      after: structuredClone(repaired),
      changedPaths: ["src/retry-delay.ts", "tests/retry-delay.test.ts"],
    });

    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(first[0].path, "src/retry-delay.ts");
    assert(first[0].addedSignals.includes("call:Number.isInteger:+1"));
    assert(first[0].addedSignals.includes("call:Math.min:+1"));
    assert(first[0].addedSignals.includes("new:RangeError:+1"));
    assert(first[0].addedSignals.includes("operator:**:+1"));
    assert.match(first[0].signalDigest, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(first).includes(PRIVATE_LITERAL), false);
    assert.equal(JSON.stringify(first).includes(HIDDEN_TEST_CONTENT), false);
  });

  it("feeds compact semantic failure and source-tactic evidence to the next model call", async () => {
    const observedLessons: Array<ReturnType<typeof projectCodingRepairAttemptLessonsForModel>> = [];
    let modelCalls = 0;
    await runCodingRepairController({
      baseline,
      verify: async (proposal) => verify(proposal),
      model: {
        propose: async (request) => {
          modelCalls += 1;
          observedLessons.push(projectCodingRepairAttemptLessonsForModel(request.attemptLessons ?? []));
          const current = request.candidate.files[0].content;
          const replacementText = modelCalls === 1
            ? [
              "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
              "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
              "  return baseMs * attempt;",
              "}",
              "",
            ].join("\n")
            : modelCalls === 2
              ? current.replace("baseMs * attempt", "Math.round(baseMs * attempt)")
              : [
                "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
                "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
                "  return Math.min(capMs, baseMs * 2 ** attempt);",
                "}",
                "",
              ].join("\n");
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
      },
    });

    assert.equal(modelCalls, 3);
    assert.equal(observedLessons[0].length, 0);
    assert.equal(observedLessons[1][0].afterFailures[0].code, "RETRY_DELAY_CAP_REMAINS");
    assert(observedLessons[1][0].sourceSignals.includes("call:Number.isInteger:+1"));
    assert.equal("championArtifactDigest" in observedLessons[1][0], false);
    assert.equal(JSON.stringify(observedLessons).includes(HIDDEN_TEST_CONTENT), false);
    assert.equal(JSON.stringify(observedLessons).includes(PRIVATE_LITERAL), false);
  });

  it("lets a fresh held-out deterministic model use rejected tactics without more cycles or authority", async () => {
    let calls = 0;
    const model: CodingRepairModel = {
      async propose(request) {
        calls += 1;
        const current = request.candidate.files[0].content;
        const compact = projectCodingRepairAttemptLessonsForModel(request.attemptLessons ?? []);
        const sawRejectedRound = compact.some((lesson) => (
          lesson.outcome === "rolled_back" && lesson.sourceSignals.includes("call:Math.round:+1")
        ));
        const replacementText = calls === 1
          ? [
            "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
            "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
            "  return baseMs * attempt;",
            "}",
            "",
          ].join("\n")
          : !sawRejectedRound
            ? current.replace("baseMs * attempt", "Math.round(baseMs * attempt)")
            : [
              "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
              "  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('invalid');",
              "  return Math.min(capMs, baseMs * 2 ** attempt);",
              "}",
              "",
            ].join("\n");
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

    const run = await runCodingRepairController({
      baseline,
      verify: async (proposal) => verify(proposal),
      model,
    });

    assert.equal(calls, 3);
    assert.equal(run.state, "VERIFIED_CANDIDATE");
    assert.equal(run.verification.passed, true);
    assert.deepEqual(run.receipts.map((receipt) => receipt.outcome), [
      "accepted_improvement",
      "rolled_back",
      "verified_complete",
    ]);
  });

  it("keeps source summaries and model projections bounded", () => {
    const huge = candidate([
      "export function retryDelay(attempt: number, baseMs: number, capMs: number): number {",
      ...Array.from({ length: 80 }, (_, index) => `  Math.floor(${index});`),
      "  return 0;",
      "}",
      "",
    ].join("\n"));
    const summaries = summarizeCodingRepairSourceChanges({
      before: baseline,
      after: huge,
      changedPaths: ["src/retry-delay.ts"],
    });
    assert(summaries[0].addedSignals.length <= 24);
  });
});
