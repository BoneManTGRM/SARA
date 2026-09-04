import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import { runMatchedCodingRepairBenchmarkV3 } from "../src/coding-repair-matched-benchmark-v3.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { buildCodingRepairPrompt } from "../src/coding-repair-prompt.ts";
import {
  buildCodingRepairGovernanceSignals,
  summarizeCodingRepairGovernanceTrend,
} from "../src/coding-repair-tgrm-governance.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type {
  CodingRepairAttemptLesson,
  ProgramVerificationResult,
} from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);

function lesson(
  cycle: number,
  outcome: CodingRepairAttemptLesson["outcome"],
  scoreDelta: number,
  sourceSignals: string[],
): CodingRepairAttemptLesson {
  const beforeScore = scoreDelta > 0 ? 0.6 : 0.8;
  const afterScore = beforeScore + scoreDelta;
  return {
    schemaVersion: 1,
    cycle,
    requestedStrategy: "surgical",
    proposalDigest: digest(`proposal-${cycle}`),
    championArtifactDigest: digest(`champion-${cycle}`),
    proposedArtifactDigest: digest(`proposed-${cycle}`),
    changedPaths: ["src/retry-after.ts"],
    changedFiles: 1,
    changedLines: sourceSignals.length || 1,
    beforeScore,
    afterScore,
    scoreDelta,
    beforeFailureFingerprints: [digest(`before-failure-${cycle}`)],
    afterFailureFingerprints: [digest(`after-failure-${cycle}`)],
    beforeCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    afterCompletedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    preservedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
    lostChecks: [],
    newlyReachedChecks: [],
    outcome,
    reasonCode: outcome === "accepted_improvement" ? "monotonic_improvement" : "regression_or_no_progress",
    rye: scoreDelta > 0 ? 1 : 0,
    beforeFailures: [{
      kind: "behavior",
      code: "RETRY_AFTER_REMAINS",
      file: "src/retry-after.ts",
      line: 1,
      severity: "medium",
    }],
    afterFailures: [{
      kind: "behavior",
      code: "RETRY_AFTER_REMAINS",
      file: "src/retry-after.ts",
      line: 1,
      severity: "medium",
    }],
    sourceChanges: sourceSignals.length ? [{
      schemaVersion: 1,
      path: "src/retry-after.ts",
      beforeContentDigest: digest(`before-source-${cycle}`),
      afterContentDigest: digest(`after-source-${cycle}`),
      addedSignals: sourceSignals,
      removedSignals: [],
      signalDigest: digest(`source-signal-${cycle}`),
    }] : [],
    sourceChangesDigest: digest(`source-changes-${cycle}`),
  };
}

const productiveLesson = lesson(
  1,
  "accepted_improvement",
  0.2,
  ["call:Number.isFinite:+1", "syntax:IfStatement:+1"],
);
const rejectedLesson = lesson(
  2,
  "rolled_back",
  0,
  ["call:Math.round:+1"],
);

function trendFor(remainingCycles: number, lessons = [productiveLesson, rejectedLesson]) {
  return summarizeCodingRepairGovernanceTrend(
    buildCodingRepairGovernanceSignals({ lessons, limits: INITIAL_CODING_REPAIR_LIMITS }),
    { remainingCycles },
  );
}

function promptFixture(): {
  candidate: ProgramCandidateProposal;
  verification: ProgramVerificationResult;
} {
  const candidate: ProgramCandidateProposal = {
    schemaVersion: 1,
    candidateKind: "typescript_program",
    programName: "V5 final-cycle fixture",
    summary: "fixture",
    limitations: [],
    files: [
      {
        path: "src/retry-after.ts",
        content: "export const retryAfterMs = (value: string): number => Number(value) * 1000;\n",
      },
      {
        path: "tests/retry-after.test.ts",
        content: "TOP_SECRET_EXPECTED_RETRY_AFTER_VALUE_7429\n",
      },
    ],
  };
  const verification: ProgramVerificationResult = {
    passed: false,
    score: 0.8,
    artifactDigest: digest("prompt-artifact"),
    failures: [{
      kind: "behavior",
      code: "RETRY_AFTER_REMAINS",
      file: "src/retry-after.ts",
      line: 1,
      column: 1,
      evidenceDigest: digest("prompt-evidence"),
      fingerprint: digest("prompt-failure"),
      severity: "medium",
      existedBeforeRepair: true,
    }],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [digest("prompt-evidence")],
  };
  return { candidate, verification };
}

function retryAfterCandidate(source: string): ProgramCandidateProposal {
  return {
    schemaVersion: 1,
    candidateKind: "typescript_program",
    programName: "Fresh Retry-After horizon holdout",
    summary: "A fresh HTTP Retry-After fixture with an independently executed verifier.",
    limitations: [],
    files: [
      { path: "src/retry-after.ts", content: source },
      {
        path: "tests/retry-after.test.ts",
        content: [
          'import { retryAfterMs } from "../src/retry-after.ts";',
          'const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");',
          'const equal = (actual: unknown, expected: unknown, label: string) => { if (actual !== expected) throw new Error(`${label}: ${String(actual)}`); };',
          'equal(retryAfterMs(undefined, now, 5000), null, "missing");',
          'equal(retryAfterMs("", now, 5000), null, "blank");',
          'equal(retryAfterMs("2", now, 5000), 2000, "delta-seconds");',
          'equal(retryAfterMs("100", now, 5000), 5000, "cap");',
          'equal(retryAfterMs("Wed, 21 Oct 2015 07:28:03 GMT", now, 5000), 3000, "http-date");',
          'equal(retryAfterMs("-1", now, 5000), null, "negative");',
          'equal(retryAfterMs("not-a-date", now, 5000), null, "invalid");',
          "",
        ].join("\n"),
      },
    ],
  };
}

const baseline = retryAfterCandidate([
  "export function retryAfterMs(value: string | undefined, nowMs: number, capMs: number): number | null {",
  '  const marker: number = "broken";',
  "  if (value === undefined) return null;",
  "  return Number(value) * 1000;",
  "}",
  "",
].join("\n"));

function firstRepair(): string {
  return [
    "export function retryAfterMs(value: string | undefined, nowMs: number, capMs: number): number | null {",
    '  if (value === undefined || value.trim() === "") return null;',
    "  const seconds = Number(value);",
    "  if (!Number.isFinite(seconds) || seconds < 0) return null;",
    "  return seconds * 1000;",
    "}",
    "",
  ].join("\n");
}

function rejectedRoundingRepair(): string {
  return firstRepair().replace("return seconds * 1000;", "return Math.round(seconds * 1000);");
}

function completeRepair(): string {
  return [
    "export function retryAfterMs(value: string | undefined, nowMs: number, capMs: number): number | null {",
    '  if (value === undefined || value.trim() === "") return null;',
    "  const seconds = Number(value);",
    "  const delayMs = Number.isInteger(seconds) && seconds >= 0",
    "    ? seconds * 1000",
    "    : Date.parse(value) - nowMs;",
    "  if (!Number.isFinite(delayMs) || delayMs < 0) return null;",
    "  return Math.min(capMs, delayMs);",
    "}",
    "",
  ].join("\n");
}

function makeMatchedModel(counter: { calls: number; diversifiedCalls: number }): CodingRepairModel {
  return {
    async propose(request) {
      counter.calls += 1;
      const current = request.candidate.files.find((file) => file.path === "src/retry-after.ts")?.content ?? "";
      const remainingCycles = INITIAL_CODING_REPAIR_LIMITS.maximumCycles - request.cycle + 1;
      const trend = summarizeCodingRepairGovernanceTrend(
        buildCodingRepairGovernanceSignals({
          lessons: request.attemptLessons ?? [],
          limits: INITIAL_CODING_REPAIR_LIMITS,
        }),
        { remainingCycles },
      );
      if (trend.action === "diversify") counter.diversifiedCalls += 1;

      const replacementText = request.cycle === 1
        ? firstRepair()
        : request.cycle === 2
          ? rejectedRoundingRepair()
          : trend.action === "diversify"
            ? completeRepair()
            : current.includes("Math.round")
              ? current.replace("Math.round", "Math.ceil")
              : current.replace("return seconds * 1000;", "return Math.ceil(seconds * 1000);");
      return {
        proposal: {
          schemaVersion: 1,
          baseArtifactDigest: request.verification.artifactDigest,
          failureFingerprint: request.verification.failures[0].fingerprint,
          strategy: request.strategy,
          changes: [{
            path: "src/retry-after.ts",
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

describe("TGRM V5 horizon-aware repair governance", () => {
  it("diversifies on the final cycle after one evidence-backed rollback while preserving prior gain", () => {
    const trend = trendFor(1);
    assert.equal(trend.action, "diversify");
    assert.equal(trend.finalOpportunity, true);
    assert.equal(trend.noGainStreak, 1);
    assert.equal(trend.allowSameTacticFamily, false);
  });

  it("continues conserving when more than one repair opportunity remains", () => {
    const trend = trendFor(2);
    assert.equal(trend.action, "conserve");
    assert.equal(trend.finalOpportunity, false);
    assert.equal(trend.allowSameTacticFamily, true);
  });

  it("does not invent a final-cycle diversification signal without source-tactic evidence", () => {
    const noEvidence = lesson(2, "rolled_back", 0, []);
    const trend = trendFor(1, [productiveLesson, noEvidence]);
    assert.equal(trend.action, "conserve");
    assert.equal(trend.finalOpportunity, true);
    assert.equal(trend.allowSameTacticFamily, true);
  });

  it("projects a bounded final-opportunity directive without protected-test disclosure", () => {
    const { candidate, verification } = promptFixture();
    const prompt = buildCodingRepairPrompt({
      objective: "Parse Retry-After safely.",
      acceptanceCriteria: ["Support delta-seconds and HTTP-date values within the supplied cap."],
      candidate,
      artifactDigest: verification.artifactDigest,
      failures: verification.failures,
      previouslyPassingChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
      remainingCycles: 1,
      remainingCostUsd: 0.1,
      verifiedLessons: [],
      constitutionDigest: digest("constitution"),
      limits: INITIAL_CODING_REPAIR_LIMITS,
      strategy: "surgical",
      attemptLessons: [productiveLesson, rejectedLesson],
    });
    const payload = JSON.parse(prompt.split("\n").at(-1) ?? "{}") as {
      tgrmGovernance: {
        trend: { action: string; finalOpportunity: boolean; allowSameTacticFamily: boolean };
        directive: string;
      };
      productiveSourceSignals: string[];
      rejectedSourceSignals: string[];
    };

    assert.equal(payload.tgrmGovernance.trend.action, "diversify");
    assert.equal(payload.tgrmGovernance.trend.finalOpportunity, true);
    assert.equal(payload.tgrmGovernance.trend.allowSameTacticFamily, false);
    assert.match(payload.tgrmGovernance.directive, /Final bounded repair opportunity/u);
    assert(payload.productiveSourceSignals.includes("call:Number.isFinite:+1"));
    assert(payload.rejectedSourceSignals.includes("call:Math.round:+1"));
    assert(!prompt.includes("TOP_SECRET_EXPECTED_RETRY_AFTER_VALUE_7429"));
  });

  it("improves a fresh independently executed matched holdout without another cycle or more authority", async () => {
    const counter = { calls: 0, diversifiedCalls: 0 };
    const objective = "Parse an HTTP Retry-After value into a bounded delay.";
    const acceptanceCriteria = [
      "Return null for missing, blank, negative, or invalid values.",
      "Support non-negative integer delta-seconds.",
      "Support an HTTP-date relative to the supplied current time.",
      "Never exceed the supplied delay cap.",
    ];
    const constitutionDigest = "a".repeat(64);
    const result = await runMatchedCodingRepairBenchmarkV3({
      caseId: "retry-after-final-opportunity-v5-holdout",
      sourceCommit: "b".repeat(40),
      modelRouteKey: "deterministic:horizon-holdout:v1",
      environment: { node: "test", platform: "test", typescript: "test" },
      objective,
      acceptanceCriteria,
      constitutionDigest,
      memoryContextDigest: "c".repeat(64),
      baseline,
      verify: (candidate) => verifyGenomeLabProgramCandidate({
        candidate,
        objective,
        acceptanceCriteria,
        constitutionDigest,
        maximumBudgetUsd: INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd,
      }),
      model: makeMatchedModel(counter),
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
    assert.equal(counter.diversifiedCalls, 1);
    assert.equal(result.authority.maximumCycles, 3);
    assert.equal(result.authority.surgicalFiles, 2);
    assert.equal(result.authority.surgicalChangedLines, 80);
    assert.equal(result.authority.repositoryMutation, false);
    assert.equal(result.authority.merge, false);
    assert.equal(result.authority.deploy, false);
    assert.equal(result.authority.promotion, false);
    assert.equal(result.generalClaimSupported, false);
  });
});
