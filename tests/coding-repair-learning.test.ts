import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runCodingRepairController, type CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const HIDDEN_TEST_CONTENT = "HIDDEN_EXPECTED_VALUE_9001";

function candidate(source = "export const value = 0;\n"): ProgramCandidateProposal {
  return {
    schemaVersion: 1,
    candidateKind: "typescript_program",
    programName: "Learning fixture",
    summary: "fixture",
    limitations: [],
    files: [
      { path: "src/value.ts", content: source },
      { path: "tests/value.test.ts", content: HIDDEN_TEST_CONTENT },
    ],
  };
}

function signal(
  fingerprint: string,
  kind: CodingFailureSignal["kind"] = "behavior",
  code = "VISIBLE_FAILURE",
): CodingFailureSignal {
  return {
    kind,
    code,
    file: kind === "type" ? "src/value.ts" : "",
    line: kind === "type" ? 1 : 0,
    column: kind === "type" ? 1 : 0,
    evidenceDigest: sha256(`${fingerprint}:evidence`),
    fingerprint,
    severity: "medium",
    existedBeforeRepair: true,
  };
}

function verification(
  proposal: ProgramCandidateProposal,
  score: number,
  failures: CodingFailureSignal[],
  completedChecks: ProgramVerificationResult["completedChecks"] = [
    "source_policy",
    "syntax",
    "typecheck",
    "behavior_tests",
    "artifact_integrity",
  ],
): ProgramVerificationResult {
  return {
    passed: score === 1 && failures.length === 0,
    score,
    artifactDigest: sha256(JSON.stringify(proposal.files)),
    failures,
    completedChecks,
    evidenceDigests: failures.length
      ? failures.map((failure) => failure.evidenceDigest)
      : [sha256("verified")],
  };
}

function lessonsFrom(request: Parameters<CodingRepairModel["propose"]>[0]): Array<Record<string, unknown>> {
  return structuredClone(
    ((request as unknown as { attemptLessons?: Array<Record<string, unknown>> }).attemptLessons) ?? [],
  );
}

describe("bounded within-run Reparodynamic learning", () => {
  it("feeds a bounded rollback lesson into the next repair without protected-test content", async () => {
    const baseline = candidate();
    const failure = signal("a".repeat(64));
    const observedLessons: Array<Array<Record<string, unknown>>> = [];
    let modelCalls = 0;

    const run = await runCodingRepairController({
      baseline,
      verify: async (proposal) => verification(proposal, 0.8, [failure]),
      model: {
        propose: async (request) => {
          modelCalls += 1;
          observedLessons.push(lessonsFrom(request));
          const current = request.candidate.files[0].content;
          return {
            proposal: {
              schemaVersion: 1,
              baseArtifactDigest: request.verification.artifactDigest,
              failureFingerprint: request.verification.failures[0].fingerprint,
              strategy: request.strategy,
              changes: [{
                path: "src/value.ts",
                expectedContentDigest: sha256(current),
                replacementText: `export const value = ${modelCalls};\n`,
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
    assert.equal(observedLessons[1].length, 1);
    assert.equal(observedLessons[1][0].outcome, "rolled_back");
    assert.equal(JSON.stringify(observedLessons).includes(HIDDEN_TEST_CONTENT), false);

    const learningRun = run as typeof run & {
      attemptLessons: Array<Record<string, unknown>>;
      attemptLessonsDigest: string;
    };
    assert.equal(learningRun.attemptLessons.length, 2);
    assert.equal(JSON.stringify(learningRun.attemptLessons).includes(HIDDEN_TEST_CONTENT), false);
    assert.equal(
      learningRun.attemptLessonsDigest,
      sha256(canonicalJson(learningRun.attemptLessons)),
    );
  });

  it("shows the next cycle both a retained improvement and a rolled-back regression", async () => {
    const baseline = candidate("export const value: number = 'bad';\n");
    const typeFailure = signal("b".repeat(64), "type", "TS2322");
    const behaviorFailure = signal("c".repeat(64));
    const observedLessons: Array<Array<Record<string, unknown>>> = [];
    let modelCalls = 0;

    const run = await runCodingRepairController({
      baseline,
      verify: async (proposal) => {
        const source = proposal.files[0].content;
        if (source.includes("'bad'")) {
          return verification(
            proposal,
            0.6,
            [typeFailure],
            ["source_policy", "syntax", "typecheck"],
          );
        }
        if (source.includes("= 1")) return verification(proposal, 0.8, [behaviorFailure]);
        if (source.includes("= 2")) return verification(proposal, 0.7, [behaviorFailure]);
        if (source.includes("= 42")) return verification(proposal, 1, []);
        return verification(proposal, 0.4, [behaviorFailure]);
      },
      model: {
        propose: async (request) => {
          modelCalls += 1;
          observedLessons.push(lessonsFrom(request));
          const current = request.candidate.files[0].content;
          const nextValue = modelCalls === 1 ? 1 : modelCalls === 2 ? 2 : 42;
          return {
            proposal: {
              schemaVersion: 1,
              baseArtifactDigest: request.verification.artifactDigest,
              failureFingerprint: request.verification.failures[0].fingerprint,
              strategy: request.strategy,
              changes: [{
                path: "src/value.ts",
                expectedContentDigest: sha256(current),
                replacementText: `export const value: number = ${nextValue};\n`,
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
    assert.equal(modelCalls, 3);
    assert.deepEqual(
      observedLessons[2].map((lesson) => lesson.outcome),
      ["accepted_improvement", "rolled_back"],
    );
    assert.deepEqual(
      run.receipts.map((receipt) => receipt.outcome),
      ["accepted_improvement", "rolled_back", "verified_complete"],
    );
  });

  it("rejects an exact duplicate proposal without re-running the verifier", async () => {
    const baseline = candidate();
    const failure = signal("d".repeat(64));
    let verifierCalls = 0;
    let modelCalls = 0;

    const run = await runCodingRepairController({
      baseline,
      verify: async (proposal) => {
        verifierCalls += 1;
        return verification(proposal, 0.8, [failure]);
      },
      model: {
        propose: async (request) => {
          modelCalls += 1;
          const current = request.candidate.files[0].content;
          return {
            proposal: {
              schemaVersion: 1,
              baseArtifactDigest: request.verification.artifactDigest,
              failureFingerprint: request.verification.failures[0].fingerprint,
              strategy: request.strategy,
              changes: [{
                path: "src/value.ts",
                expectedContentDigest: sha256(current),
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

    assert.equal(modelCalls, 3);
    assert.equal(verifierCalls, 2);
    assert.deepEqual(
      run.receipts.map((receipt) => receipt.outcome),
      ["rolled_back", "duplicate_rejected", "duplicate_rejected"],
    );
  });

  it("does not mutate or call a model for an already verified candidate", async () => {
    const baseline = candidate("export const value = 42;\n");
    let modelCalls = 0;
    const run = await runCodingRepairController({
      baseline,
      verify: async (proposal) => verification(proposal, 1, []),
      model: {
        propose: async () => {
          modelCalls += 1;
          throw new Error("model must not be called");
        },
      },
    });

    const learningRun = run as typeof run & {
      attemptLessons: Array<Record<string, unknown>>;
      attemptLessonsDigest: string;
    };
    assert.equal(modelCalls, 0);
    assert.deepEqual(run.champion, baseline);
    assert.deepEqual(run.receipts, []);
    assert.deepEqual(learningRun.attemptLessons, []);
    assert.equal(learningRun.attemptLessonsDigest, sha256(canonicalJson([])));
  });
});
