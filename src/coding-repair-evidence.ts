export type CodingBenchmarkArmName = "baseline" | "reparodynamic";

export type CodingBenchmarkArmObservation = {
  arm: CodingBenchmarkArmName;
  verified: boolean;
  score: number;
  retries: number;
  rolledBackRepairs: number;
  escapedRegressions: number;
  accountedCostUsd: number;
  elapsedMilliseconds: number;
  rye: number;
  evidenceDigests: string[];
};

export type CodingBenchmarkPairReceipt = {
  schemaVersion: 1;
  pairId: string;
  corpusVersion: string;
  taskId: string;
  taskDigest: string;
  canaryPercent: number;
  executionOrder: readonly [CodingBenchmarkArmName, CodingBenchmarkArmName];
  baseline: CodingBenchmarkArmObservation;
  reparodynamic: CodingBenchmarkArmObservation;
  observedAt: string;
};

export type CodingBenchmarkArmAggregate = {
  verifiedSuccesses: number;
  verifiedSuccessRate: number;
  meanScore: number;
  meanRetries: number;
  rolledBackRepairRate: number;
  escapedRegressionRate: number;
  totalCostUsd: number;
  meanCostUsd: number;
  medianElapsedMilliseconds: number;
  meanRye: number;
};

export type CodingBenchmarkAggregate = {
  schemaVersion: 1;
  corpusVersion: string;
  canaryPercent: number;
  comparablePairs: number;
  baseline: CodingBenchmarkArmAggregate;
  reparodynamic: CodingBenchmarkArmAggregate;
  successRateGainPercentagePoints: number;
  meanScoreGain: number;
  medianElapsedRatio: number | null;
  incrementalMeanCostUsd: number;
  meanRyeGain: number;
  aggregateDigest: string;
};

export type CodingRolloutDecision = {
  decision: "hold" | "expand" | "rollback" | "eligible_default";
  currentCanaryPercent: number;
  nextCanaryPercent: number;
  claimStatus: "insufficient_evidence" | "measured_directional" | "sustained_verified_improvement";
  reasonCodes: string[];
  evidenceDigest: string;
};

export type CodingRolloutPolicy = {
  minimumComparablePairs: number;
  minimumPairsForDefaultEligibility: number;
  minimumSuccessRateGain: number;
  minimumMeanScoreGain: number;
  maximumSuccessRateLoss: number;
  maximumMedianElapsedRatio: number;
  maximumHardMedianElapsedRatio: number;
  maximumMeanRepairCostUsd: number;
  maximumEscapedRegressionRate: number;
  minimumMeanRye: number;
  stages: readonly number[];
};

export const INITIAL_CODING_ROLLOUT_POLICY: CodingRolloutPolicy = Object.freeze({
  minimumComparablePairs: 12,
  minimumPairsForDefaultEligibility: 50,
  minimumSuccessRateGain: 0.05,
  minimumMeanScoreGain: 0.02,
  maximumSuccessRateLoss: 0.02,
  maximumMedianElapsedRatio: 1.25,
  maximumHardMedianElapsedRatio: 1.5,
  maximumMeanRepairCostUsd: 0.15,
  maximumEscapedRegressionRate: 0,
  minimumMeanRye: 0.000001,
  stages: [5, 10, 25, 50, 100],
});

export function assertCodingBenchmarkPairReceipt(_receipt: CodingBenchmarkPairReceipt): void {
  throw new Error("Coding benchmark evidence validation is not implemented.");
}

export function aggregateCodingBenchmarkPairs(_input: {
  receipts: readonly CodingBenchmarkPairReceipt[];
  corpusVersion: string;
  canaryPercent: number;
}): CodingBenchmarkAggregate {
  throw new Error("Coding benchmark aggregation is not implemented.");
}

export function evaluateCodingRollout(_input: {
  aggregate: CodingBenchmarkAggregate;
  policy?: CodingRolloutPolicy;
}): CodingRolloutDecision {
  throw new Error("Coding benchmark rollout evaluation is not implemented.");
}
