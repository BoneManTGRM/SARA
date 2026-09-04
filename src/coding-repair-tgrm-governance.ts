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
  governanceAction: "advance" | "hold" | "conserve" | "retreat";
};

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("TGRM governance metric must be finite.");
  return Math.round(value * 1_000_000) / 1_000_000;
}

function boundedRatio(value: number): number {
  return rounded(Math.max(0, Math.min(1, value)));
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

  // Adapt the report's Drift Score concept to SARA's existing deterministic verifier.
  // Only negative verified movement contributes: score regression and previously-passing checks lost.
  const scoreRegression = Math.max(0, -input.lesson.scoreDelta);
  const checkRegression = Math.min(1, input.lesson.lostChecks.length / 5);
  const driftScore = boundedRatio(scoreRegression + checkRegression);
  const verifiedGain = boundedRatio(Math.max(0, input.lesson.scoreDelta));

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

export function digestCodingRepairGovernanceSignals(
  signals: readonly CodingRepairGovernanceSignal[],
): string {
  return sha256(canonicalJson(signals));
}
