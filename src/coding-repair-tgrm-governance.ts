import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingRepairAttemptLesson, CodingRepairLimits } from "./coding-repair-types.ts";

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
  tacticFamilyDigest: string | null;
  noGain: boolean;
  governanceAction: "advance" | "hold" | "conserve" | "retreat";
};

export type CodingRepairGovernanceTrend = {
  schemaVersion: 1;
  observedCycles: number;
  semanticRepeatStreak: number;
  noGainStreak: number;
  remainingCycles: number | null;
  finalOpportunity: boolean;
  action: "advance" | "hold" | "conserve" | "diversify" | "rethink" | "retreat";
  allowSameTacticFamily: boolean;
};

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("TGRM governance metric must be finite.");
  return Math.round(value * 1_000_000) / 1_000_000;
}

function boundedRatio(value: number): number {
  return rounded(Math.max(0, Math.min(1, value)));
}

function normalizeRemainingCycles(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new RangeError("TGRM governance remaining cycles must stay within the existing repair horizon.");
  }
  return value;
}

function normalizeTacticSignal(signal: string): string {
  return signal.replace(/:[+-]\d+$/u, "");
}

function tacticFamilyDigest(lesson: CodingRepairAttemptLesson): string | null {
  const signals = [...new Set((lesson.sourceChanges ?? []).flatMap((change) => [
    ...change.addedSignals.map(normalizeTacticSignal),
    ...change.removedSignals.map((signal) => `removed:${normalizeTacticSignal(signal)}`),
  ]))].sort().slice(0, 32);
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
    tacticFamilyDigest: tacticFamilyDigest(input.lesson),
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
  options: { remainingCycles?: number } = {},
): CodingRepairGovernanceTrend {
  const remainingCycles = normalizeRemainingCycles(options.remainingCycles);
  const finalOpportunity = remainingCycles === 1;
  const bounded = signals.slice(-2);
  if (!bounded.length) {
    return {
      schemaVersion: 1,
      observedCycles: 0,
      semanticRepeatStreak: 0,
      noGainStreak: 0,
      remainingCycles,
      finalOpportunity,
      action: "hold",
      allowSameTacticFamily: true,
    };
  }

  let noGainStreak = 0;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    if (!bounded[index].noGain) break;
    noGainStreak += 1;
  }

  const latestDigest = bounded[bounded.length - 1].tacticFamilyDigest;
  let semanticRepeatStreak = latestDigest ? 1 : 0;
  if (latestDigest) {
    for (let index = bounded.length - 2; index >= 0; index -= 1) {
      if (bounded[index].tacticFamilyDigest !== latestDigest) break;
      semanticRepeatStreak += 1;
    }
  }

  const latest = bounded[bounded.length - 1];
  const priorVerifiedGain = bounded
    .slice(0, -1)
    .some((signal) => signal.verifiedGain > 0 || signal.governanceAction === "advance");
  const finalRollbackWithEvidence = (
    finalOpportunity &&
    priorVerifiedGain &&
    latest.noGain &&
    latest.governanceAction === "conserve" &&
    latest.tacticFamilyDigest !== null
  );

  let action: CodingRepairGovernanceTrend["action"] = latest.governanceAction;
  if (latest.governanceAction === "retreat") {
    action = "retreat";
  } else if (latest.verifiedGain > 0 || latest.governanceAction === "advance") {
    action = "advance";
  } else if (noGainStreak >= 2 && semanticRepeatStreak >= 2) {
    action = "rethink";
  } else if (finalRollbackWithEvidence) {
    action = "diversify";
  } else if (noGainStreak >= 2 || latest.governanceAction === "conserve") {
    action = "conserve";
  }

  return {
    schemaVersion: 1,
    observedCycles: bounded.length,
    semanticRepeatStreak,
    noGainStreak,
    remainingCycles,
    finalOpportunity,
    action,
    allowSameTacticFamily: !["diversify", "rethink", "retreat"].includes(action),
  };
}

export function digestCodingRepairGovernanceSignals(
  signals: readonly CodingRepairGovernanceSignal[],
): string {
  return sha256(canonicalJson(signals));
}
