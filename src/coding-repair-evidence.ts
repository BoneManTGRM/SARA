import { canonicalJson, sha256 } from "./canonical.ts";

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
  protocolDigest: string;
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
  protocolDigest: string;
  corpusVersion: string;
  canaryPercent: number;
  comparablePairs: number;
  uniqueTasks: number;
  baseline: CodingBenchmarkArmAggregate;
  reparodynamic: CodingBenchmarkArmAggregate;
  reparodynamicVerifiedWins: number;
  baselineVerifiedWins: number;
  verifiedTies: number;
  successRateGainPercentagePoints: number;
  meanScoreGain: number;
  medianElapsedRatio: number | null;
  elapsedComparablePairs: number;
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
  minimumUniqueTasks: number;
  minimumPairsForDefaultEligibility: number;
  minimumUniqueTasksForDefaultEligibility: number;
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
  minimumUniqueTasks: 8,
  minimumPairsForDefaultEligibility: 50,
  minimumUniqueTasksForDefaultEligibility: 20,
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

const HEX_64 = /^[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PAIR_KEYS = ["baseline", "canaryPercent", "corpusVersion", "executionOrder", "observedAt", "pairId", "protocolDigest", "reparodynamic", "schemaVersion", "taskDigest", "taskId"] as const;
const OBSERVATION_KEYS = ["accountedCostUsd", "arm", "elapsedMilliseconds", "escapedRegressions", "evidenceDigests", "retries", "rolledBackRepairs", "rye", "score", "verified"] as const;
const ARM_AGGREGATE_KEYS = ["escapedRegressionRate", "meanCostUsd", "meanRetries", "meanRye", "meanScore", "medianElapsedMilliseconds", "rolledBackRepairRate", "totalCostUsd", "verifiedSuccessRate", "verifiedSuccesses"] as const;
const AGGREGATE_KEYS = ["aggregateDigest", "baseline", "baselineVerifiedWins", "canaryPercent", "comparablePairs", "corpusVersion", "elapsedComparablePairs", "incrementalMeanCostUsd", "meanRyeGain", "meanScoreGain", "medianElapsedRatio", "protocolDigest", "reparodynamic", "reparodynamicVerifiedWins", "schemaVersion", "successRateGainPercentagePoints", "uniqueTasks", "verifiedTies"] as const;
const DECISION_KEYS = ["claimStatus", "currentCanaryPercent", "decision", "evidenceDigest", "nextCanaryPercent", "reasonCodes"] as const;

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} is outside its allowed range.`);
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}

function assertObservation(observation: CodingBenchmarkArmObservation, expectedArm: CodingBenchmarkArmName): void {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) throw new Error("Coding benchmark observation is malformed.");
  exactKeys(observation, OBSERVATION_KEYS, "Coding benchmark observation");
  if (observation.arm !== expectedArm) throw new Error("Coding benchmark arm identity is invalid.");
  if (typeof observation.verified !== "boolean") throw new Error("Coding benchmark verified status is malformed.");
  finiteRange(observation.score, 0, 1, "Coding benchmark score");
  nonNegativeInteger(observation.retries, "Coding benchmark retries");
  nonNegativeInteger(observation.rolledBackRepairs, "Coding benchmark rolled-back repairs");
  nonNegativeInteger(observation.escapedRegressions, "Coding benchmark escaped regressions");
  if (observation.rolledBackRepairs > observation.retries) throw new Error("Rolled-back repairs cannot exceed retries.");
  finiteRange(observation.accountedCostUsd, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark cost");
  finiteRange(observation.elapsedMilliseconds, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark elapsed time");
  finiteRange(observation.rye, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark RYE");
  if (!Array.isArray(observation.evidenceDigests) || observation.evidenceDigests.length < 1 || observation.evidenceDigests.length > 64) {
    throw new Error("Coding benchmark evidence digest count is invalid.");
  }
  if (new Set(observation.evidenceDigests).size !== observation.evidenceDigests.length || observation.evidenceDigests.some((digest) => !HEX_64.test(digest))) {
    throw new Error("Coding benchmark evidence digests are invalid.");
  }
}

export function assertCodingBenchmarkPairReceipt(receipt: CodingBenchmarkPairReceipt): void {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Coding benchmark pair is malformed.");
  exactKeys(receipt, PAIR_KEYS, "Coding benchmark pair");
  if (receipt.schemaVersion !== 1) throw new Error("Coding benchmark pair schema version is unsupported.");
  if (!UUID_V4.test(receipt.pairId)) throw new Error("Coding benchmark pair id is malformed.");
  if (!HEX_64.test(receipt.protocolDigest)) throw new Error("Coding benchmark protocol digest is malformed.");
  if (!SAFE_ID.test(receipt.corpusVersion) || !SAFE_ID.test(receipt.taskId)) throw new Error("Coding benchmark corpus or task id is malformed.");
  if (!HEX_64.test(receipt.taskDigest)) throw new Error("Coding benchmark task digest is malformed.");
  if (!Number.isInteger(receipt.canaryPercent) || receipt.canaryPercent < 1 || receipt.canaryPercent > 100) {
    throw new Error("Coding benchmark canary percent must be an integer from 1 through 100.");
  }
  if (!Array.isArray(receipt.executionOrder) || receipt.executionOrder.length !== 2 || new Set(receipt.executionOrder).size !== 2 || !receipt.executionOrder.includes("baseline") || !receipt.executionOrder.includes("reparodynamic")) {
    throw new Error("Coding benchmark execution order must contain both arms exactly once.");
  }
  const observedAt = new Date(receipt.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.toISOString() !== receipt.observedAt) {
    throw new Error("Coding benchmark observation time must be a canonical ISO timestamp.");
  }
  assertObservation(receipt.baseline, "baseline");
  assertObservation(receipt.reparodynamic, "reparodynamic");
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function armAggregate(observations: readonly CodingBenchmarkArmObservation[]): CodingBenchmarkArmAggregate {
  const verifiedSuccesses = observations.filter((observation) => observation.verified).length;
  return {
    verifiedSuccesses,
    verifiedSuccessRate: observations.length ? verifiedSuccesses / observations.length : 0,
    meanScore: mean(observations.map((observation) => observation.score)),
    meanRetries: mean(observations.map((observation) => observation.retries)),
    rolledBackRepairRate: observations.length
      ? observations.filter((observation) => observation.rolledBackRepairs > 0).length / observations.length
      : 0,
    escapedRegressionRate: observations.length
      ? observations.filter((observation) => observation.escapedRegressions > 0).length / observations.length
      : 0,
    totalCostUsd: observations.reduce((total, observation) => total + observation.accountedCostUsd, 0),
    meanCostUsd: mean(observations.map((observation) => observation.accountedCostUsd)),
    medianElapsedMilliseconds: median(observations.map((observation) => observation.elapsedMilliseconds)),
    meanRye: mean(observations.map((observation) => observation.rye)),
  };
}

function unsignedAggregate(aggregate: CodingBenchmarkAggregate): Omit<CodingBenchmarkAggregate, "aggregateDigest"> {
  const { aggregateDigest: _digest, ...unsigned } = aggregate;
  return unsigned;
}

function assertArmAggregate(aggregate: CodingBenchmarkArmAggregate): void {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) throw new Error("Coding benchmark arm aggregate is malformed.");
  exactKeys(aggregate, ARM_AGGREGATE_KEYS, "Coding benchmark arm aggregate");
  nonNegativeInteger(aggregate.verifiedSuccesses, "Coding benchmark verified success count");
  finiteRange(aggregate.verifiedSuccessRate, 0, 1, "Coding benchmark verified success rate");
  finiteRange(aggregate.meanScore, 0, 1, "Coding benchmark mean score");
  finiteRange(aggregate.meanRetries, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark mean retries");
  finiteRange(aggregate.rolledBackRepairRate, 0, 1, "Coding benchmark rolled-back repair rate");
  finiteRange(aggregate.escapedRegressionRate, 0, 1, "Coding benchmark escaped regression rate");
  finiteRange(aggregate.totalCostUsd, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark total cost");
  finiteRange(aggregate.meanCostUsd, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark mean cost");
  finiteRange(aggregate.medianElapsedMilliseconds, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark median elapsed time");
  finiteRange(aggregate.meanRye, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark mean RYE");
}

export function assertCodingBenchmarkAggregate(aggregate: CodingBenchmarkAggregate): void {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) throw new Error("Coding benchmark aggregate is malformed.");
  exactKeys(aggregate, AGGREGATE_KEYS, "Coding benchmark aggregate");
  if (aggregate.schemaVersion !== 1 || !HEX_64.test(aggregate.protocolDigest) || !SAFE_ID.test(aggregate.corpusVersion)) {
    throw new Error("Coding benchmark aggregate identity is malformed.");
  }
  if (!Number.isInteger(aggregate.canaryPercent) || aggregate.canaryPercent < 1 || aggregate.canaryPercent > 100) {
    throw new Error("Coding benchmark aggregate canary percent is malformed.");
  }
  nonNegativeInteger(aggregate.comparablePairs, "Coding benchmark comparable pair count");
  nonNegativeInteger(aggregate.uniqueTasks, "Coding benchmark unique task count");
  nonNegativeInteger(aggregate.elapsedComparablePairs, "Coding benchmark elapsed comparison count");
  nonNegativeInteger(aggregate.reparodynamicVerifiedWins, "Coding benchmark Reparodynamic verified win count");
  nonNegativeInteger(aggregate.baselineVerifiedWins, "Coding benchmark baseline verified win count");
  nonNegativeInteger(aggregate.verifiedTies, "Coding benchmark verified tie count");
  assertArmAggregate(aggregate.baseline);
  assertArmAggregate(aggregate.reparodynamic);
  finiteRange(aggregate.successRateGainPercentagePoints, -100, 100, "Coding benchmark success-rate gain");
  finiteRange(aggregate.meanScoreGain, -1, 1, "Coding benchmark mean score gain");
  if (aggregate.medianElapsedRatio !== null) finiteRange(aggregate.medianElapsedRatio, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark elapsed ratio");
  finiteRange(aggregate.incrementalMeanCostUsd, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark incremental cost");
  finiteRange(aggregate.meanRyeGain, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark mean RYE gain");
  if (aggregate.uniqueTasks > aggregate.comparablePairs || aggregate.elapsedComparablePairs > aggregate.comparablePairs) {
    throw new Error("Coding benchmark aggregate counts are inconsistent.");
  }
  if (aggregate.reparodynamicVerifiedWins + aggregate.baselineVerifiedWins + aggregate.verifiedTies !== aggregate.comparablePairs) {
    throw new Error("Coding benchmark paired outcome counts are inconsistent.");
  }
  if (aggregate.baseline.verifiedSuccesses > aggregate.comparablePairs || aggregate.reparodynamic.verifiedSuccesses > aggregate.comparablePairs) {
    throw new Error("Coding benchmark verified success counts are inconsistent.");
  }
  if (!HEX_64.test(aggregate.aggregateDigest) || sha256(canonicalJson(unsignedAggregate(aggregate))) !== aggregate.aggregateDigest) {
    throw new Error("Coding benchmark aggregate digest verification failed.");
  }
}

export function aggregateCodingBenchmarkPairs(input: {
  receipts: readonly CodingBenchmarkPairReceipt[];
  protocolDigest: string;
  corpusVersion: string;
  canaryPercent: number;
}): CodingBenchmarkAggregate {
  if (!HEX_64.test(input.protocolDigest)) throw new Error("Coding benchmark protocol digest is malformed.");
  if (!SAFE_ID.test(input.corpusVersion)) throw new Error("Coding benchmark corpus version is malformed.");
  if (!Number.isInteger(input.canaryPercent) || input.canaryPercent < 1 || input.canaryPercent > 100) {
    throw new Error("Coding benchmark canary percent must be an integer from 1 through 100.");
  }
  const selected = input.receipts.filter((receipt) => {
    assertCodingBenchmarkPairReceipt(receipt);
    return receipt.protocolDigest === input.protocolDigest
      && receipt.corpusVersion === input.corpusVersion
      && receipt.canaryPercent === input.canaryPercent;
  });
  const pairIds = new Set<string>();
  const taskDigests = new Map<string, string>();
  for (const receipt of selected) {
    if (pairIds.has(receipt.pairId)) throw new Error("Coding benchmark pair ids must be unique.");
    const knownTaskDigest = taskDigests.get(receipt.taskId);
    if (knownTaskDigest && knownTaskDigest !== receipt.taskDigest) {
      throw new Error("Coding benchmark task identity changed within the frozen corpus.");
    }
    pairIds.add(receipt.pairId);
    taskDigests.set(receipt.taskId, receipt.taskDigest);
  }
  const baseline = armAggregate(selected.map((receipt) => receipt.baseline));
  const reparodynamic = armAggregate(selected.map((receipt) => receipt.reparodynamic));
  const elapsedRatios = selected
    .filter((receipt) => receipt.baseline.elapsedMilliseconds > 0)
    .map((receipt) => receipt.reparodynamic.elapsedMilliseconds / receipt.baseline.elapsedMilliseconds);
  const unsigned = {
    schemaVersion: 1 as const,
    protocolDigest: input.protocolDigest,
    corpusVersion: input.corpusVersion,
    canaryPercent: input.canaryPercent,
    comparablePairs: selected.length,
    uniqueTasks: taskDigests.size,
    baseline,
    reparodynamic,
    reparodynamicVerifiedWins: selected.filter((receipt) => !receipt.baseline.verified && receipt.reparodynamic.verified).length,
    baselineVerifiedWins: selected.filter((receipt) => receipt.baseline.verified && !receipt.reparodynamic.verified).length,
    verifiedTies: selected.filter((receipt) => receipt.baseline.verified === receipt.reparodynamic.verified).length,
    successRateGainPercentagePoints: (reparodynamic.verifiedSuccessRate - baseline.verifiedSuccessRate) * 100,
    meanScoreGain: mean(selected.map((receipt) => receipt.reparodynamic.score - receipt.baseline.score)),
    medianElapsedRatio: elapsedRatios.length ? median(elapsedRatios) : null,
    elapsedComparablePairs: elapsedRatios.length,
    incrementalMeanCostUsd: mean(selected.map((receipt) => receipt.reparodynamic.accountedCostUsd - receipt.baseline.accountedCostUsd)),
    meanRyeGain: mean(selected.map((receipt) => receipt.reparodynamic.rye - receipt.baseline.rye)),
  };
  return { ...unsigned, aggregateDigest: sha256(canonicalJson(unsigned)) };
}

function nextStage(current: number, stages: readonly number[]): number {
  const sorted = [...new Set(stages)].sort((left, right) => left - right);
  return sorted.find((stage) => stage > current) ?? current;
}

function assertPolicy(policy: CodingRolloutPolicy): void {
  for (const value of [policy.minimumComparablePairs, policy.minimumUniqueTasks, policy.minimumPairsForDefaultEligibility, policy.minimumUniqueTasksForDefaultEligibility]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Coding rollout evidence counts must be positive safe integers.");
  }
  if (policy.minimumPairsForDefaultEligibility < policy.minimumComparablePairs || policy.minimumUniqueTasksForDefaultEligibility < policy.minimumUniqueTasks) {
    throw new Error("Coding rollout default gates may not be weaker than canary expansion gates.");
  }
  if (!Array.isArray(policy.stages) || !policy.stages.length || policy.stages.some((stage) => !Number.isInteger(stage) || stage < 1 || stage > 100) || !policy.stages.includes(100)) {
    throw new Error("Coding rollout stages must be bounded percentages and include 100.");
  }
}

function unsignedDecision(decision: CodingRolloutDecision): Omit<CodingRolloutDecision, "evidenceDigest"> {
  const { evidenceDigest: _digest, ...unsigned } = decision;
  return unsigned;
}

export function assertCodingRolloutDecision(input: {
  aggregate: CodingBenchmarkAggregate;
  decision: CodingRolloutDecision;
}): void {
  assertCodingBenchmarkAggregate(input.aggregate);
  const decision = input.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("Coding rollout decision is malformed.");
  exactKeys(decision, DECISION_KEYS, "Coding rollout decision");
  if (!Number.isInteger(decision.currentCanaryPercent) || decision.currentCanaryPercent !== input.aggregate.canaryPercent) {
    throw new Error("Coding rollout decision current canary scope is malformed.");
  }
  if (!Number.isInteger(decision.nextCanaryPercent) || decision.nextCanaryPercent < 0 || decision.nextCanaryPercent > 100) {
    throw new Error("Coding rollout decision next canary scope is malformed.");
  }
  if (!Array.isArray(decision.reasonCodes) || !decision.reasonCodes.length || decision.reasonCodes.some((reason) => !SAFE_ID.test(reason))) {
    throw new Error("Coding rollout decision reason codes are malformed.");
  }
  const expected = sha256(canonicalJson({ aggregateDigest: input.aggregate.aggregateDigest, ...unsignedDecision(decision) }));
  if (!HEX_64.test(decision.evidenceDigest) || decision.evidenceDigest !== expected) {
    throw new Error("Coding rollout decision digest verification failed.");
  }
}

export function evaluateCodingRollout(input: {
  aggregate: CodingBenchmarkAggregate;
  policy?: CodingRolloutPolicy;
}): CodingRolloutDecision {
  const policy = input.policy ?? INITIAL_CODING_ROLLOUT_POLICY;
  assertPolicy(policy);
  assertCodingBenchmarkAggregate(input.aggregate);
  const aggregate = input.aggregate;
  const reasons: string[] = [];
  const successGain = aggregate.successRateGainPercentagePoints / 100;
  const hardFailure =
    aggregate.reparodynamic.escapedRegressionRate > policy.maximumEscapedRegressionRate
    || successGain < -policy.maximumSuccessRateLoss
    || aggregate.reparodynamic.meanCostUsd > policy.maximumMeanRepairCostUsd
    || (aggregate.medianElapsedRatio !== null && aggregate.medianElapsedRatio > policy.maximumHardMedianElapsedRatio);
  let decision: CodingRolloutDecision["decision"] = "hold";
  let nextCanaryPercent = aggregate.canaryPercent;
  let claimStatus: CodingRolloutDecision["claimStatus"] = "insufficient_evidence";

  if (hardFailure) {
    decision = "rollback";
    nextCanaryPercent = 0;
    if (aggregate.reparodynamic.escapedRegressionRate > policy.maximumEscapedRegressionRate) reasons.push("escaped_regression");
    if (successGain < -policy.maximumSuccessRateLoss) reasons.push("verified_success_drop");
    if (aggregate.reparodynamic.meanCostUsd > policy.maximumMeanRepairCostUsd) reasons.push("repair_cost_limit");
    if (aggregate.medianElapsedRatio !== null && aggregate.medianElapsedRatio > policy.maximumHardMedianElapsedRatio) reasons.push("hard_elapsed_limit");
  } else if (aggregate.comparablePairs < policy.minimumComparablePairs || aggregate.uniqueTasks < policy.minimumUniqueTasks) {
    if (aggregate.comparablePairs < policy.minimumComparablePairs) reasons.push("insufficient_comparable_pairs");
    if (aggregate.uniqueTasks < policy.minimumUniqueTasks) reasons.push("insufficient_unique_tasks");
  } else {
    claimStatus = "measured_directional";
    const successImproved = successGain >= policy.minimumSuccessRateGain;
    const scoreImproved = aggregate.meanScoreGain >= policy.minimumMeanScoreGain;
    const elapsedAcceptable = aggregate.elapsedComparablePairs === aggregate.comparablePairs
      && aggregate.medianElapsedRatio !== null
      && aggregate.medianElapsedRatio <= policy.maximumMedianElapsedRatio;
    const ryeAcceptable = aggregate.reparodynamic.meanRye >= policy.minimumMeanRye;
    if ((successImproved || scoreImproved) && elapsedAcceptable && ryeAcceptable) {
      if (aggregate.canaryPercent < 100) {
        decision = "expand";
        nextCanaryPercent = nextStage(aggregate.canaryPercent, policy.stages);
        reasons.push("verified_improvement_gate_passed");
      } else if (aggregate.comparablePairs >= policy.minimumPairsForDefaultEligibility && aggregate.uniqueTasks >= policy.minimumUniqueTasksForDefaultEligibility) {
        decision = "eligible_default";
        claimStatus = "sustained_verified_improvement";
        reasons.push("default_evidence_gate_passed");
      } else {
        if (aggregate.comparablePairs < policy.minimumPairsForDefaultEligibility) reasons.push("default_requires_more_pairs");
        if (aggregate.uniqueTasks < policy.minimumUniqueTasksForDefaultEligibility) reasons.push("default_requires_more_unique_tasks");
      }
    } else {
      if (!successImproved && !scoreImproved) reasons.push("no_material_quality_gain");
      if (!elapsedAcceptable) reasons.push("elapsed_gate_not_met");
      if (!ryeAcceptable) reasons.push("rye_gate_not_met");
    }
  }
  const unsigned = {
    decision,
    currentCanaryPercent: aggregate.canaryPercent,
    nextCanaryPercent,
    claimStatus,
    reasonCodes: reasons,
  };
  const result = { ...unsigned, evidenceDigest: sha256(canonicalJson({ aggregateDigest: aggregate.aggregateDigest, ...unsigned })) };
  assertCodingRolloutDecision({ aggregate, decision: result });
  return result;
}
