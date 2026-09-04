import { canonicalJson, sha256 } from "./canonical.ts";
import type {
  CodingRepairAttemptLesson,
  CodingRepairLimits,
  CodingRepairSourceChangeSummary,
} from "./coding-repair-types.ts";

const MAX_TACTIC_SIGNALS = 32;
const MAX_PROBLEM_SIGNALS = 8;
const SEMANTIC_REPEAT_THRESHOLD = 0.5;

export type CodingRepairGovernanceSignal = {
  schemaVersion: 1;
  cycle: number;
  strategy: "surgical" | "deep";
  fileBudgetRatio: number;
  lineBudgetRatio: number;
  blastRadiusRatio: number;
  energyHeadroom: number;
  driftScore: number;
  verifiedGain: number;
  problemSignals: string[];
  problemFamilyDigest: string | null;
  tacticSignals: string[];
  tacticFamilyDigest: string | null;
  noGain: boolean;
  governanceAction: "advance" | "hold" | "conserve" | "retreat";
};

export type CodingRepairGovernanceTrend = {
  schemaVersion: 1;
  observedCycles: number;
  semanticRepeatStreak: number;
  semanticSimilarity: number;
  repeatedTacticSignals: string[];
  blockedTacticSignals: string[];
  minimumNovelTacticSignals: number;
  noGainStreak: number;
  action: "advance" | "hold" | "conserve" | "rethink" | "retreat";
  allowSameTacticFamily: boolean;
};

export type CodingRepairTacticNoveltyAssessment = {
  schemaVersion: 1;
  required: boolean;
  allowed: boolean;
  proposedTacticSignals: string[];
  novelTacticSignals: string[];
  blockedTacticSignals: string[];
  reasonCode:
    | "not_required"
    | "insufficient_signal_evidence"
    | "materially_novel"
    | "semantic_tactic_repeat";
};

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("TGRM governance metric must be finite.");
  return Math.round(value * 1_000_000) / 1_000_000;
}

function boundedRatio(value: number): number {
  return rounded(Math.max(0, Math.min(1, value)));
}

function normalizeTacticSignal(signal: string): string {
  return signal.replace(/:[+-]\d+$/u, "");
}

function orderedUnique(values: readonly string[], maximum = MAX_TACTIC_SIGNALS): string[] {
  return [...new Set(values)].sort().slice(0, maximum);
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return orderedUnique(left.filter((value) => rightSet.has(value)));
}

function union(left: readonly string[], right: readonly string[]): string[] {
  return orderedUnique([...left, ...right]);
}

function overlapCoefficient(left: readonly string[], right: readonly string[]): number {
  if (!left.length || !right.length) return 0;
  return boundedRatio(intersection(left, right).length / Math.min(left.length, right.length));
}

export function codingRepairTacticSignals(
  sourceChanges: readonly CodingRepairSourceChangeSummary[],
): string[] {
  return orderedUnique(sourceChanges.flatMap((change) => [
    ...change.addedSignals.map(normalizeTacticSignal),
    ...change.removedSignals.map((signal) => `removed:${normalizeTacticSignal(signal)}`),
  ]));
}

function codingRepairProblemSignals(lesson: CodingRepairAttemptLesson): string[] {
  const visibleFailures = [
    ...(lesson.beforeFailures ?? []),
    ...(lesson.afterFailures ?? []),
  ];
  if (visibleFailures.length) {
    return orderedUnique(visibleFailures.map((failure) => `failure:${sha256(canonicalJson({
      kind: failure.kind,
      code: failure.code,
      file: failure.file,
    }))}`), MAX_PROBLEM_SIGNALS);
  }

  return orderedUnique([
    ...lesson.beforeFailureFingerprints,
    ...lesson.afterFailureFingerprints,
  ].map((fingerprint) => `fingerprint:${fingerprint}`), MAX_PROBLEM_SIGNALS);
}

function familyDigest(signals: readonly string[]): string | null {
  return signals.length ? sha256(canonicalJson(signals)) : null;
}

export function buildCodingRepairGovernanceSignal(input: {
  lesson: CodingRepairAttemptLesson;
  limits: CodingRepairLimits;
}): CodingRepairGovernanceSignal {
  const maximumFiles = input.lesson.requestedStrategy === "surgical"
    ? input.limits.surgicalFiles
    : input.limits.deepFiles;
  const maximumChangedLines = input.lesson.requestedStrategy === "surgical"
    ? input.limits.surgicalChangedLines
    : input.limits.deepChangedLines;
  if (maximumFiles <= 0 || maximumChangedLines <= 0) {
    throw new RangeError("TGRM governance requires positive existing repair limits.");
  }

  const fileBudgetRatio = boundedRatio(input.lesson.changedFiles / maximumFiles);
  const lineBudgetRatio = boundedRatio(input.lesson.changedLines / maximumChangedLines);
  const blastRadiusRatio = Math.max(fileBudgetRatio, lineBudgetRatio);
  const energyHeadroom = boundedRatio(1 - blastRadiusRatio);

  const scoreRegression = Math.max(0, -input.lesson.scoreDelta);
  const checkRegression = Math.min(1, input.lesson.lostChecks.length / 5);
  const driftScore = boundedRatio(scoreRegression + checkRegression);
  const verifiedGain = boundedRatio(Math.max(0, input.lesson.scoreDelta));
  const noGain = verifiedGain === 0 && input.lesson.newlyReachedChecks.length === 0;
  const problemSignals = codingRepairProblemSignals(input.lesson);
  const tacticSignals = codingRepairTacticSignals(input.lesson.sourceChanges ?? []);

  let governanceAction: CodingRepairGovernanceSignal["governanceAction"] = "hold";
  if (driftScore > 0 || blastRadiusRatio >= 1) {
    governanceAction = "retreat";
  } else if (
    input.lesson.outcome === "rolled_back" ||
    input.lesson.outcome === "duplicate_rejected" ||
    blastRadiusRatio >= 0.5
  ) {
    governanceAction = "conserve";
  } else if (verifiedGain > 0 || input.lesson.outcome === "accepted_improvement") {
    governanceAction = "advance";
  }

  return {
    schemaVersion: 1,
    cycle: input.lesson.cycle,
    strategy: input.lesson.requestedStrategy,
    fileBudgetRatio,
    lineBudgetRatio,
    blastRadiusRatio,
    energyHeadroom,
    driftScore,
    verifiedGain,
    problemSignals,
    problemFamilyDigest: familyDigest(problemSignals),
    tacticSignals,
    tacticFamilyDigest: familyDigest(tacticSignals),
    noGain,
    governanceAction,
  };
}

export function digestCodingRepairGovernanceSignal(
  signal: CodingRepairGovernanceSignal,
): string {
  return sha256(canonicalJson(signal));
}

export function buildCodingRepairGovernanceSignals(input: {
  lessons: readonly CodingRepairAttemptLesson[];
  limits: CodingRepairLimits;
}): CodingRepairGovernanceSignal[] {
  return input.lessons.slice(-2).map((lesson) => buildCodingRepairGovernanceSignal({
    lesson,
    limits: input.limits,
  }));
}

export function summarizeCodingRepairGovernanceTrend(
  signals: readonly CodingRepairGovernanceSignal[],
): CodingRepairGovernanceTrend {
  const bounded = signals.slice(-2);
  if (!bounded.length) {
    return {
      schemaVersion: 1,
      observedCycles: 0,
      semanticRepeatStreak: 0,
      semanticSimilarity: 0,
      repeatedTacticSignals: [],
      blockedTacticSignals: [],
      minimumNovelTacticSignals: 0,
      noGainStreak: 0,
      action: "hold",
      allowSameTacticFamily: true,
    };
  }

  let noGainStreak = 0;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    if (!bounded[index].noGain) break;
    noGainStreak += 1;
  }

  const latest = bounded[bounded.length - 1];
  const previous = bounded.length > 1 ? bounded[bounded.length - 2] : null;
  const repeatedTacticSignals = previous
    ? intersection(previous.tacticSignals, latest.tacticSignals)
    : [];
  const semanticSimilarity = previous
    ? overlapCoefficient(previous.tacticSignals, latest.tacticSignals)
    : 0;
  const sameProblemFamily = previous
    ? intersection(previous.problemSignals, latest.problemSignals).length > 0
    : false;
  const semanticRepeatStreak = latest.tacticSignals.length === 0
    ? 0
    : previous &&
        sameProblemFamily &&
        repeatedTacticSignals.length > 0 &&
        semanticSimilarity >= SEMANTIC_REPEAT_THRESHOLD
      ? 2
      : 1;

  let action: CodingRepairGovernanceTrend["action"] = latest.governanceAction;
  if (latest.governanceAction === "retreat") {
    action = "retreat";
  } else if (latest.verifiedGain > 0 || latest.governanceAction === "advance") {
    action = "advance";
  } else if (noGainStreak >= 2 && semanticRepeatStreak >= 2) {
    action = "rethink";
  } else if (noGainStreak >= 2 || latest.governanceAction === "conserve") {
    action = "conserve";
  }

  const blockedTacticSignals = action === "rethink" && previous
    ? union(previous.tacticSignals, latest.tacticSignals)
    : [];

  return {
    schemaVersion: 1,
    observedCycles: bounded.length,
    semanticRepeatStreak,
    semanticSimilarity,
    repeatedTacticSignals,
    blockedTacticSignals,
    minimumNovelTacticSignals: action === "rethink" ? 1 : 0,
    noGainStreak,
    action,
    allowSameTacticFamily: action !== "rethink" && action !== "retreat",
  };
}

export function assessCodingRepairTacticNovelty(input: {
  trend: CodingRepairGovernanceTrend;
  sourceChanges: readonly CodingRepairSourceChangeSummary[];
}): CodingRepairTacticNoveltyAssessment {
  const blockedTacticSignals = orderedUnique(input.trend.blockedTacticSignals);
  const proposedTacticSignals = codingRepairTacticSignals(input.sourceChanges);
  const blocked = new Set(blockedTacticSignals);
  const novelTacticSignals = proposedTacticSignals.filter((signal) => !blocked.has(signal));
  const required = input.trend.action === "rethink" && blockedTacticSignals.length > 0;

  if (!required) {
    return {
      schemaVersion: 1,
      required,
      allowed: true,
      proposedTacticSignals,
      novelTacticSignals,
      blockedTacticSignals,
      reasonCode: "not_required",
    };
  }
  if (!proposedTacticSignals.length) {
    return {
      schemaVersion: 1,
      required,
      allowed: true,
      proposedTacticSignals,
      novelTacticSignals,
      blockedTacticSignals,
      reasonCode: "insufficient_signal_evidence",
    };
  }
  const allowed = novelTacticSignals.length >= input.trend.minimumNovelTacticSignals;
  return {
    schemaVersion: 1,
    required,
    allowed,
    proposedTacticSignals,
    novelTacticSignals,
    blockedTacticSignals,
    reasonCode: allowed ? "materially_novel" : "semantic_tactic_repeat",
  };
}

export function digestCodingRepairGovernanceSignals(
  signals: readonly CodingRepairGovernanceSignal[],
): string {
  return sha256(canonicalJson(signals));
}
