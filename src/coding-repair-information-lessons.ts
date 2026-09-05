import { canonicalJson, sha256 } from "./canonical.ts";
import { boundCodingRepairAttemptLessons } from "./coding-repair-lessons-base.ts";
import {
  digestCodingRepairSourceChanges,
  normalizeCodingRepairSourceChanges,
  summarizeCodingRepairSourceChanges,
} from "./coding-repair-source-signals.ts";
import type {
  CodingFailureKind,
  CodingFailureSignal,
  CodingRepairAttemptLesson,
  CodingRepairFailureSummary,
  CodingRepairHypothesis,
  CodingRepairModelAttemptLesson,
  CodingVerificationCheck,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

const MAX_FAILURES = 8;
const MAX_SOURCE_SIGNALS = 24;
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,239}$/u;
const FAILURE_KINDS = new Set<CodingFailureKind>([
  "syntax", "type", "test", "behavior", "policy", "security", "integrity", "timeout", "unknown",
]);
const SEVERITIES = new Set<CodingFailureSignal["severity"]>(["low", "medium", "high", "critical"]);

function safeFailureCode(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:/-]+/gu, "_").slice(0, 80) || "UNSPECIFIED";
}

function summarizeFailure(failure: CodingFailureSignal): CodingRepairFailureSummary {
  return normalizeFailureSummary({
    kind: failure.kind,
    code: failure.code,
    file: failure.file,
    line: failure.line,
    severity: failure.severity,
  });
}

function normalizeFailureSummary(failure: CodingRepairFailureSummary): CodingRepairFailureSummary {
  if (!FAILURE_KINDS.has(failure.kind)) {
    throw new Error("Coding repair information lesson contains an unsupported failure kind.");
  }
  if (!SEVERITIES.has(failure.severity)) {
    throw new Error("Coding repair information lesson contains an unsupported failure severity.");
  }
  const file = failure.file.startsWith("src/") && SAFE_PATH.test(failure.file) && !failure.file.includes("..")
    ? failure.file
    : "";
  return {
    kind: failure.kind,
    code: safeFailureCode(failure.code),
    file,
    line: Number.isInteger(failure.line) && failure.line > 0 ? Math.min(failure.line, 1_000_000) : 0,
    severity: failure.severity,
  };
}

function boundFailures(values: readonly CodingRepairFailureSummary[]): CodingRepairFailureSummary[] {
  return values.slice(0, MAX_FAILURES).map((failure) => normalizeFailureSummary(structuredClone(failure)));
}

export function enrichCodingRepairAttemptLesson(input: {
  lesson: CodingRepairAttemptLesson;
  before: ProgramVerificationResult;
  after: ProgramVerificationResult;
  beforeCandidate?: ProgramCandidateProposal;
  afterCandidate?: ProgramCandidateProposal;
}): CodingRepairAttemptLesson {
  const beforeCandidate = input.beforeCandidate;
  const afterCandidate = input.afterCandidate;
  const sourceChanges = beforeCandidate && afterCandidate
    ? summarizeCodingRepairSourceChanges({
      before: beforeCandidate,
      after: afterCandidate,
      changedPaths: input.lesson.changedPaths,
    })
    : [];
  return {
    ...structuredClone(input.lesson),
    beforeFailures: input.before.failures.map(summarizeFailure),
    afterFailures: input.after.failures.map(summarizeFailure),
    sourceChanges,
    sourceChangesDigest: digestCodingRepairSourceChanges(sourceChanges),
  };
}

export function boundInformationRichCodingRepairAttemptLessons(
  lessons: readonly CodingRepairAttemptLesson[],
): CodingRepairAttemptLesson[] {
  const originals = new Map(lessons.map((lesson) => [`${lesson.cycle}:${lesson.proposalDigest}`, lesson]));
  return boundCodingRepairAttemptLessons(lessons).map((base) => {
    const original = originals.get(`${base.cycle}:${base.proposalDigest}`);
    const sourceChanges = normalizeCodingRepairSourceChanges(original?.sourceChanges ?? []);
    return {
      ...base,
      beforeFailures: boundFailures(original?.beforeFailures ?? []),
      afterFailures: boundFailures(original?.afterFailures ?? []),
      sourceChanges,
      sourceChangesDigest: digestCodingRepairSourceChanges(sourceChanges),
    };
  });
}

function orderedChecks(values: readonly CodingVerificationCheck[]): CodingVerificationCheck[] {
  const order: readonly CodingVerificationCheck[] = [
    "source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity",
  ];
  const present = new Set(values);
  return order.filter((check) => present.has(check));
}

function attemptedHypotheses(lesson: CodingRepairAttemptLesson): CodingRepairHypothesis[] {
  const changes = lesson.sourceChanges ?? [];
  const signals = changes.flatMap((change) => [...change.addedSignals, ...change.removedSignals]);
  const text = signals.join("\n");
  const hypotheses: CodingRepairHypothesis[] = [];
  const add = (hypothesis: CodingRepairHypothesis): void => {
    if (!hypotheses.includes(hypothesis) && hypotheses.length < 6) hypotheses.push(hypothesis);
  };
  if (/(?:call:Number\.isFinite|call:Number\.isInteger|new:RangeError|operator:<|operator:<=)/u.test(text)) {
    add("input_validation");
  }
  if (/(?:call:Math\.floor|call:reduce|operator:%)/u.test(text)) add("exact_sum_invariant");
  if (/(?:call:sort|syntax:ConditionalExpression|operator:===)/u.test(text)) add("deterministic_ordering");
  if (/(?:call:clearTimeout|call:clearInterval|call:abort|syntax:TryStatement)/u.test(text)) add("state_cleanup");
  if (/(?:call:setTimeout|call:fetch|call:local|call:method)/u.test(text)) add("retry_safety");
  if (changes.length > 1) add("cross_module_consistency");
  if (/(?:syntax:InterfaceDeclaration|syntax:TypeAliasDeclaration)/u.test(text)) add("type_contract");
  if (signals.length) add("behavioral_invariant");
  return hypotheses;
}

export function projectCodingRepairAttemptLessonsForModel(
  lessons: readonly CodingRepairAttemptLesson[],
): CodingRepairModelAttemptLesson[] {
  return boundInformationRichCodingRepairAttemptLessons(lessons).map((lesson) => {
    const sourceSignals = [...new Set((lesson.sourceChanges ?? []).flatMap((change) => [
      ...change.addedSignals,
      ...change.removedSignals,
    ]))].sort().slice(0, MAX_SOURCE_SIGNALS);
    return {
      schemaVersion: 1,
      cycle: lesson.cycle,
      requestedStrategy: lesson.requestedStrategy,
      proposalDigest: lesson.proposalDigest,
      changedPaths: [...lesson.changedPaths],
      changedLines: lesson.changedLines,
      scoreDelta: lesson.scoreDelta,
      lostChecks: orderedChecks(lesson.lostChecks),
      newlyReachedChecks: orderedChecks(lesson.newlyReachedChecks),
      outcome: lesson.outcome,
      reasonCode: lesson.reasonCode,
      beforeFailures: boundFailures(lesson.beforeFailures ?? []),
      afterFailures: boundFailures(lesson.afterFailures ?? []),
      sourceSignals,
      sourceSignalsDigest: sha256(canonicalJson(sourceSignals)),
      attemptedHypotheses: attemptedHypotheses(lesson),
    };
  });
}

export function digestCodingRepairModelAttemptLessons(
  lessons: readonly CodingRepairAttemptLesson[],
): string {
  return sha256(canonicalJson(projectCodingRepairAttemptLessonsForModel(lessons)));
}
