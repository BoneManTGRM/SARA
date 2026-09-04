import { canonicalJson, sha256 } from "./canonical.ts";

export type CodingBenchmarkArmName = "baseline" | "reparodynamic";
export type CodingBenchmarkTaskClass = "synthetic_deterministic" | "reconstructed_sara" | "licensed_public_typescript";
export type CodingBenchmarkEvidenceKind = "real" | "simulated";
export type CodingBenchmarkEvidenceLevel = "SIMULATED" | "LAB" | "MEASURED" | "REPLICATED" | "STALE";

export type CodingBenchmarkBindings = {
  repositoryDigest: string;
  commitDigest: string;
  criteriaDigest: string;
  modelDigest: string;
  baselineMethodDigest: string;
  reparodynamicMethodDigest: string;
  verifierDigest: string;
  environmentDigest: string;
  authorityDigest: string;
  budgetDigest: string;
  compilerDigest: string;
  runtimeDigest: string;
  toolchainDigest: string;
};

export type CodingBenchmarkArmObservation = {
  arm: CodingBenchmarkArmName;
  verified: boolean;
  firstPass: boolean;
  score: number;
  retries: number;
  cycles: number;
  rolledBackRepairs: number;
  criticalRegressions: number;
  escapedRegressions: number;
  changedFiles: number;
  changedLines: number;
  inputTokens: number;
  outputTokens: number;
  accountedCostUsd: number;
  repairCostUsd: number;
  activeExecutionMilliseconds: number;
  rye: number;
  reusedVerifiedLessons: number;
  completionDigest: string;
  evidenceDigests: string[];
};

export type CodingBenchmarkPairReceipt = {
  schemaVersion: 2;
  pairId: string;
  protocolDigest: string;
  corpusVersion: string;
  corpusDigest: string;
  identityDigest: string;
  bindings: CodingBenchmarkBindings;
  taskId: string;
  taskClass: CodingBenchmarkTaskClass;
  trialIndex: number;
  evidenceKind: CodingBenchmarkEvidenceKind;
  taskDigest: string;
  caseDigest: string;
  startingArtifactDigest: string;
  licenseDigest: string | null;
  canaryPercent: number;
  executionOrder: readonly [CodingBenchmarkArmName, CodingBenchmarkArmName];
  baseline: CodingBenchmarkArmObservation;
  reparodynamic: CodingBenchmarkArmObservation;
  observedAt: string;
};

export type CodingBenchmarkArmAggregate = {
  verifiedSuccesses: number;
  verifiedSuccessRate: number;
  firstPassRate: number;
  meanScore: number;
  meanRetries: number;
  meanCycles: number;
  rolledBackRepairRate: number;
  criticalRegressionRate: number;
  escapedRegressionRate: number;
  totalCostUsd: number;
  meanCostUsd: number;
  meanRepairCostUsd: number;
  maximumRepairCostUsd: number;
  totalActiveExecutionMilliseconds: number;
  medianActiveExecutionMilliseconds: number;
  verifiedTasksPerActiveSecond: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanChangedFiles: number;
  meanChangedLines: number;
  meanRye: number;
  meanReusedVerifiedLessons: number;
};

export type CodingBenchmarkConfidenceInterval = {
  low: number;
  high: number;
};

export type CodingBenchmarkConfidenceIntervals = {
  successRateGain: CodingBenchmarkConfidenceInterval;
  costReduction: CodingBenchmarkConfidenceInterval | null;
  activeTimeReduction: CodingBenchmarkConfidenceInterval;
  verifiedTasksPerActiveSecondGain: CodingBenchmarkConfidenceInterval;
};

export type CodingBenchmarkAggregate = {
  schemaVersion: 2;
  protocolDigest: string;
  corpusVersion: string;
  corpusDigest: string;
  evidenceIdentityDigest: string;
  currentIdentityDigest: string;
  canaryPercent: number;
  comparablePairs: number;
  uniqueTasks: number;
  taskClassCounts: Record<CodingBenchmarkTaskClass, number>;
  realPairs: number;
  simulatedPairs: number;
  evidenceLevel: CodingBenchmarkEvidenceLevel;
  baseline: CodingBenchmarkArmAggregate;
  reparodynamic: CodingBenchmarkArmAggregate;
  reparodynamicVerifiedWins: number;
  baselineVerifiedWins: number;
  verifiedTies: number;
  successRateGain: number;
  meanScoreGain: number;
  meanCostReduction: number | null;
  costComparablePairs: number;
  meanActiveTimeReduction: number;
  activeTimeComparablePairs: number;
  meanVerifiedTasksPerActiveSecondGain: number;
  confidenceIntervals: CodingBenchmarkConfidenceIntervals;
  bootstrapSamples: number;
  aggregateDigest: string;
};

export type CodingRolloutControlStatus = "passed" | "failed" | "missing";
export type CodingRolloutControlCheck = {
  status: CodingRolloutControlStatus;
  evidenceDigest: string;
};
export type CodingRolloutControlEvidence = {
  schemaVersion: 1;
  digestBinding: CodingRolloutControlCheck;
  costEnforcement: CodingRolloutControlCheck;
  protectedPaths: CodingRolloutControlCheck;
  crashResume: CodingRolloutControlCheck;
  nicoAssessment: CodingRolloutControlCheck;
  ownerApproval: CodingRolloutControlCheck;
  rollbackDrill: CodingRolloutControlCheck;
  evidenceDigest: string;
};

export type CodingRolloutDecision = {
  decision: "hold" | "expand" | "rollback" | "eligible_default";
  currentCanaryPercent: number;
  nextCanaryPercent: number;
  evidenceLevel: CodingBenchmarkEvidenceLevel;
  claimStatus: "insufficient_evidence" | "measured_directional" | "sustained_verified_improvement";
  majorBenefit: "none" | "verified_success" | "cost_reduction";
  reasonCodes: string[];
  aggregateDigest: string;
  controlsDigest: string;
  evidenceDigest: string;
};

export type CodingRolloutPolicy = {
  minimumMatchedPairs: number;
  minimumPerTaskClass: number;
  minimumPairsForDefaultEligibility: number;
  minimumPerTaskClassForDefaultEligibility: number;
  minimumVerifiedSuccessGain: number;
  minimumCostReduction: number;
  equivalentSuccessTolerance: number;
  maximumSuccessRateLoss: number;
  maximumRepairCostUsd: number;
  stages: readonly number[];
};

export const INITIAL_CODING_ROLLOUT_POLICY: CodingRolloutPolicy = Object.freeze({
  minimumMatchedPairs: 30,
  minimumPerTaskClass: 10,
  minimumPairsForDefaultEligibility: 100,
  minimumPerTaskClassForDefaultEligibility: 20,
  minimumVerifiedSuccessGain: 0.15,
  minimumCostReduction: 0.25,
  equivalentSuccessTolerance: 0.02,
  maximumSuccessRateLoss: 0.02,
  maximumRepairCostUsd: 0.15,
  stages: [5, 10, 25, 50, 100],
});

const HEX_64 = /^[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const TASK_CLASSES: readonly CodingBenchmarkTaskClass[] = [
  "synthetic_deterministic",
  "reconstructed_sara",
  "licensed_public_typescript",
];
const EVIDENCE_LEVELS = new Set<CodingBenchmarkEvidenceLevel>(["SIMULATED", "LAB", "MEASURED", "REPLICATED", "STALE"]);
const BINDING_KEYS = ["authorityDigest", "baselineMethodDigest", "budgetDigest", "commitDigest", "compilerDigest", "criteriaDigest", "environmentDigest", "modelDigest", "reparodynamicMethodDigest", "repositoryDigest", "runtimeDigest", "toolchainDigest", "verifierDigest"] as const;
const OBSERVATION_KEYS = ["accountedCostUsd", "activeExecutionMilliseconds", "arm", "changedFiles", "changedLines", "completionDigest", "criticalRegressions", "cycles", "escapedRegressions", "evidenceDigests", "firstPass", "inputTokens", "outputTokens", "repairCostUsd", "retries", "reusedVerifiedLessons", "rolledBackRepairs", "rye", "score", "verified"] as const;
const PAIR_KEYS = ["baseline", "bindings", "canaryPercent", "caseDigest", "corpusDigest", "corpusVersion", "evidenceKind", "executionOrder", "identityDigest", "licenseDigest", "observedAt", "pairId", "protocolDigest", "reparodynamic", "schemaVersion", "startingArtifactDigest", "taskClass", "taskDigest", "taskId", "trialIndex"] as const;
const ARM_AGGREGATE_KEYS = ["criticalRegressionRate", "escapedRegressionRate", "firstPassRate", "maximumRepairCostUsd", "meanChangedFiles", "meanChangedLines", "meanCostUsd", "meanCycles", "meanRepairCostUsd", "meanRetries", "meanReusedVerifiedLessons", "meanRye", "meanScore", "medianActiveExecutionMilliseconds", "rolledBackRepairRate", "totalActiveExecutionMilliseconds", "totalCostUsd", "totalInputTokens", "totalOutputTokens", "verifiedSuccessRate", "verifiedSuccesses", "verifiedTasksPerActiveSecond"] as const;
const CI_KEYS = ["high", "low"] as const;
const CIS_KEYS = ["activeTimeReduction", "costReduction", "successRateGain", "verifiedTasksPerActiveSecondGain"] as const;
const AGGREGATE_KEYS = ["activeTimeComparablePairs", "aggregateDigest", "baseline", "baselineVerifiedWins", "bootstrapSamples", "canaryPercent", "comparablePairs", "confidenceIntervals", "corpusDigest", "corpusVersion", "costComparablePairs", "currentIdentityDigest", "evidenceIdentityDigest", "evidenceLevel", "meanActiveTimeReduction", "meanCostReduction", "meanScoreGain", "meanVerifiedTasksPerActiveSecondGain", "protocolDigest", "realPairs", "reparodynamic", "reparodynamicVerifiedWins", "schemaVersion", "simulatedPairs", "successRateGain", "taskClassCounts", "uniqueTasks", "verifiedTies"] as const;
const CONTROL_CHECK_KEYS = ["evidenceDigest", "status"] as const;
const CONTROL_KEYS = ["costEnforcement", "crashResume", "digestBinding", "evidenceDigest", "nicoAssessment", "ownerApproval", "protectedPaths", "rollbackDrill", "schemaVersion"] as const;
const DECISION_KEYS = ["aggregateDigest", "claimStatus", "controlsDigest", "currentCanaryPercent", "decision", "evidenceDigest", "evidenceLevel", "majorBenefit", "nextCanaryPercent", "reasonCodes"] as const;

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function assertHexDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !HEX_64.test(value)) throw new Error(`${label} is malformed.`);
}

function assertSafeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} is malformed.`);
}

function assertFiniteRange(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its allowed range.`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

export function digestCodingBenchmarkBindings(bindings: CodingBenchmarkBindings): string {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new Error("Coding benchmark bindings are malformed.");
  exactKeys(bindings, BINDING_KEYS, "Coding benchmark bindings");
  for (const key of BINDING_KEYS) assertHexDigest(bindings[key], `Coding benchmark ${key}`);
  return sha256(canonicalJson(bindings));
}

function assertObservation(observation: CodingBenchmarkArmObservation, expectedArm: CodingBenchmarkArmName): void {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) throw new Error("Coding benchmark observation is malformed.");
  exactKeys(observation, OBSERVATION_KEYS, "Coding benchmark observation");
  if (observation.arm !== expectedArm) throw new Error("Coding benchmark arm identity is invalid.");
  if (typeof observation.verified !== "boolean" || typeof observation.firstPass !== "boolean") throw new Error("Coding benchmark verification flags are malformed.");
  if (observation.firstPass && !observation.verified) throw new Error("A first-pass result must also be verified.");
  assertFiniteRange(observation.score, 0, 1, "Coding benchmark score");
  if (observation.verified && observation.score !== 1) throw new Error("A verified coding result must have a complete score.");
  assertNonNegativeInteger(observation.retries, "Coding benchmark retries");
  assertPositiveInteger(observation.cycles, "Coding benchmark cycles");
  if (observation.retries >= observation.cycles) throw new Error("Coding benchmark retries must be fewer than cycles.");
  assertNonNegativeInteger(observation.rolledBackRepairs, "Coding benchmark rolled-back repairs");
  if (observation.rolledBackRepairs > observation.retries) throw new Error("Rolled-back repairs cannot exceed retries.");
  assertNonNegativeInteger(observation.criticalRegressions, "Coding benchmark critical regressions");
  assertNonNegativeInteger(observation.escapedRegressions, "Coding benchmark escaped regressions");
  assertNonNegativeInteger(observation.changedFiles, "Coding benchmark changed files");
  assertNonNegativeInteger(observation.changedLines, "Coding benchmark changed lines");
  assertNonNegativeInteger(observation.inputTokens, "Coding benchmark input tokens");
  assertNonNegativeInteger(observation.outputTokens, "Coding benchmark output tokens");
  assertFiniteRange(observation.accountedCostUsd, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark accounted cost");
  assertFiniteRange(observation.repairCostUsd, 0, Number.MAX_SAFE_INTEGER, "Coding benchmark repair cost");
  if (observation.repairCostUsd > observation.accountedCostUsd) throw new Error("Coding repair cost cannot exceed total accounted cost.");
  if (expectedArm === "baseline" && observation.repairCostUsd !== 0) throw new Error("The baseline arm cannot report Reparodynamic repair cost.");
  assertFiniteRange(observation.activeExecutionMilliseconds, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "Coding benchmark active execution time");
  assertFiniteRange(observation.rye, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark RYE");
  assertNonNegativeInteger(observation.reusedVerifiedLessons, "Coding benchmark reused lessons");
  assertHexDigest(observation.completionDigest, "Coding benchmark completion digest");
  if (!Array.isArray(observation.evidenceDigests) || observation.evidenceDigests.length < 1 || observation.evidenceDigests.length > 64) {
    throw new Error("Coding benchmark evidence digest count is invalid.");
  }
  if (new Set(observation.evidenceDigests).size !== observation.evidenceDigests.length) throw new Error("Coding benchmark evidence digests must be unique.");
  for (const digest of observation.evidenceDigests) assertHexDigest(digest, "Coding benchmark evidence digest");
}

export function assertCodingBenchmarkPairReceipt(receipt: CodingBenchmarkPairReceipt): void {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Coding benchmark pair is malformed.");
  exactKeys(receipt, PAIR_KEYS, "Coding benchmark pair");
  if (receipt.schemaVersion !== 2) throw new Error("Coding benchmark pair schema version is unsupported.");
  if (!UUID_V4.test(receipt.pairId)) throw new Error("Coding benchmark pair id is malformed.");
  assertHexDigest(receipt.protocolDigest, "Coding benchmark protocol digest");
  assertSafeId(receipt.corpusVersion, "Coding benchmark corpus version");
  assertHexDigest(receipt.corpusDigest, "Coding benchmark corpus digest");
  assertHexDigest(receipt.identityDigest, "Coding benchmark identity digest");
  if (digestCodingBenchmarkBindings(receipt.bindings) !== receipt.identityDigest) throw new Error("Coding benchmark identity digest verification failed.");
  assertSafeId(receipt.taskId, "Coding benchmark task id");
  if (!TASK_CLASSES.includes(receipt.taskClass)) throw new Error("Coding benchmark task class is malformed.");
  assertNonNegativeInteger(receipt.trialIndex, "Coding benchmark trial index");
  if (receipt.evidenceKind !== "real" && receipt.evidenceKind !== "simulated") throw new Error("Coding benchmark evidence kind is malformed.");
  assertHexDigest(receipt.taskDigest, "Coding benchmark task digest");
  assertHexDigest(receipt.caseDigest, "Coding benchmark case digest");
  assertHexDigest(receipt.startingArtifactDigest, "Coding benchmark starting artifact digest");
  if (receipt.taskClass === "licensed_public_typescript") {
    assertHexDigest(receipt.licenseDigest, "Coding benchmark public-task license digest");
  } else if (receipt.licenseDigest !== null) {
    throw new Error("Only licensed public tasks may carry a license digest.");
  }
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
  const totalActiveExecutionMilliseconds = observations.reduce((total, observation) => total + observation.activeExecutionMilliseconds, 0);
  return {
    verifiedSuccesses,
    verifiedSuccessRate: observations.length ? verifiedSuccesses / observations.length : 0,
    firstPassRate: observations.length ? observations.filter((observation) => observation.firstPass).length / observations.length : 0,
    meanScore: mean(observations.map((observation) => observation.score)),
    meanRetries: mean(observations.map((observation) => observation.retries)),
    meanCycles: mean(observations.map((observation) => observation.cycles)),
    rolledBackRepairRate: observations.length ? observations.filter((observation) => observation.rolledBackRepairs > 0).length / observations.length : 0,
    criticalRegressionRate: observations.length ? observations.filter((observation) => observation.criticalRegressions > 0).length / observations.length : 0,
    escapedRegressionRate: observations.length ? observations.filter((observation) => observation.escapedRegressions > 0).length / observations.length : 0,
    totalCostUsd: observations.reduce((total, observation) => total + observation.accountedCostUsd, 0),
    meanCostUsd: mean(observations.map((observation) => observation.accountedCostUsd)),
    meanRepairCostUsd: mean(observations.map((observation) => observation.repairCostUsd)),
    maximumRepairCostUsd: observations.length ? Math.max(...observations.map((observation) => observation.repairCostUsd)) : 0,
    totalActiveExecutionMilliseconds,
    medianActiveExecutionMilliseconds: median(observations.map((observation) => observation.activeExecutionMilliseconds)),
    verifiedTasksPerActiveSecond: totalActiveExecutionMilliseconds > 0 ? verifiedSuccesses / (totalActiveExecutionMilliseconds / 1000) : 0,
    totalInputTokens: observations.reduce((total, observation) => total + observation.inputTokens, 0),
    totalOutputTokens: observations.reduce((total, observation) => total + observation.outputTokens, 0),
    meanChangedFiles: mean(observations.map((observation) => observation.changedFiles)),
    meanChangedLines: mean(observations.map((observation) => observation.changedLines)),
    meanRye: mean(observations.map((observation) => observation.rye)),
    meanReusedVerifiedLessons: mean(observations.map((observation) => observation.reusedVerifiedLessons)),
  };
}

function seedFromDigest(digest: string): number {
  let seed = 0x9e3779b9;
  for (let index = 0; index < digest.length; index += 8) seed ^= Number.parseInt(digest.slice(index, index + 8), 16) >>> 0;
  return seed >>> 0 || 0x6d2b79f5;
}

function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function percentile(sorted: readonly number[], proportion: number): number {
  if (!sorted.length) return 0;
  const position = proportion * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function bootstrapInterval(values: readonly number[], samples: number, seedDigest: string): CodingBenchmarkConfidenceInterval | null {
  if (!values.length) return null;
  if (values.length === 1 || values.every((value) => value === values[0])) return { low: values[0]!, high: values[0]! };
  const random = pseudoRandom(seedFromDigest(seedDigest));
  const estimates: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[Math.floor(random() * values.length)]!;
    estimates.push(total / values.length);
  }
  estimates.sort((left, right) => left - right);
  return { low: percentile(estimates, 0.025), high: percentile(estimates, 0.975) };
}

function evidenceLevel(input: {
  comparablePairs: number;
  simulatedPairs: number;
  taskClassCounts: Record<CodingBenchmarkTaskClass, number>;
  evidenceIdentityDigest: string;
  currentIdentityDigest: string;
}): CodingBenchmarkEvidenceLevel {
  if (input.evidenceIdentityDigest !== input.currentIdentityDigest) return "STALE";
  if (input.simulatedPairs > 0) return "SIMULATED";
  if (input.comparablePairs < 30) return "LAB";
  if (input.comparablePairs >= 100 && TASK_CLASSES.every((taskClass) => input.taskClassCounts[taskClass] > 0)) return "REPLICATED";
  return "MEASURED";
}

function unsignedAggregate(aggregate: CodingBenchmarkAggregate): Omit<CodingBenchmarkAggregate, "aggregateDigest"> {
  const { aggregateDigest: _digest, ...unsigned } = aggregate;
  return unsigned;
}

function assertConfidenceInterval(value: CodingBenchmarkConfidenceInterval, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  exactKeys(value, CI_KEYS, label);
  assertFiniteRange(value.low, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, `${label} low bound`);
  assertFiniteRange(value.high, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, `${label} high bound`);
  if (value.low > value.high) throw new Error(`${label} bounds are inverted.`);
}

function assertArmAggregate(aggregate: CodingBenchmarkArmAggregate): void {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) throw new Error("Coding benchmark arm aggregate is malformed.");
  exactKeys(aggregate, ARM_AGGREGATE_KEYS, "Coding benchmark arm aggregate");
  assertNonNegativeInteger(aggregate.verifiedSuccesses, "Coding benchmark verified successes");
  for (const [label, value] of [
    ["verified success rate", aggregate.verifiedSuccessRate], ["first-pass rate", aggregate.firstPassRate],
    ["mean score", aggregate.meanScore], ["rolled-back repair rate", aggregate.rolledBackRepairRate],
    ["critical regression rate", aggregate.criticalRegressionRate], ["escaped regression rate", aggregate.escapedRegressionRate],
  ] as const) assertFiniteRange(value, 0, 1, `Coding benchmark ${label}`);
  for (const [label, value] of [
    ["mean retries", aggregate.meanRetries], ["mean cycles", aggregate.meanCycles], ["total cost", aggregate.totalCostUsd],
    ["mean cost", aggregate.meanCostUsd], ["mean repair cost", aggregate.meanRepairCostUsd], ["maximum repair cost", aggregate.maximumRepairCostUsd],
    ["total active time", aggregate.totalActiveExecutionMilliseconds], ["median active time", aggregate.medianActiveExecutionMilliseconds],
    ["verified tasks per active second", aggregate.verifiedTasksPerActiveSecond], ["total input tokens", aggregate.totalInputTokens],
    ["total output tokens", aggregate.totalOutputTokens], ["mean changed files", aggregate.meanChangedFiles], ["mean changed lines", aggregate.meanChangedLines],
    ["mean reused lessons", aggregate.meanReusedVerifiedLessons],
  ] as const) assertFiniteRange(value, 0, Number.MAX_SAFE_INTEGER, `Coding benchmark ${label}`);
  assertFiniteRange(aggregate.meanRye, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark mean RYE");
}

export function assertCodingBenchmarkAggregate(aggregate: CodingBenchmarkAggregate): void {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) throw new Error("Coding benchmark aggregate is malformed.");
  exactKeys(aggregate, AGGREGATE_KEYS, "Coding benchmark aggregate");
  if (aggregate.schemaVersion !== 2) throw new Error("Coding benchmark aggregate schema version is unsupported.");
  assertHexDigest(aggregate.protocolDigest, "Coding benchmark aggregate protocol digest");
  assertSafeId(aggregate.corpusVersion, "Coding benchmark aggregate corpus version");
  assertHexDigest(aggregate.corpusDigest, "Coding benchmark aggregate corpus digest");
  assertHexDigest(aggregate.evidenceIdentityDigest, "Coding benchmark aggregate evidence identity digest");
  assertHexDigest(aggregate.currentIdentityDigest, "Coding benchmark aggregate current identity digest");
  if (!Number.isInteger(aggregate.canaryPercent) || aggregate.canaryPercent < 1 || aggregate.canaryPercent > 100) throw new Error("Coding benchmark aggregate canary percent is malformed.");
  assertNonNegativeInteger(aggregate.comparablePairs, "Coding benchmark comparable pairs");
  assertNonNegativeInteger(aggregate.uniqueTasks, "Coding benchmark unique tasks");
  assertNonNegativeInteger(aggregate.realPairs, "Coding benchmark real pairs");
  assertNonNegativeInteger(aggregate.simulatedPairs, "Coding benchmark simulated pairs");
  assertNonNegativeInteger(aggregate.costComparablePairs, "Coding benchmark cost-comparable pairs");
  assertNonNegativeInteger(aggregate.activeTimeComparablePairs, "Coding benchmark active-time-comparable pairs");
  assertPositiveInteger(aggregate.bootstrapSamples, "Coding benchmark bootstrap samples");
  if (aggregate.realPairs + aggregate.simulatedPairs !== aggregate.comparablePairs) throw new Error("Coding benchmark evidence-kind counts are inconsistent.");
  if (aggregate.uniqueTasks > aggregate.comparablePairs || aggregate.costComparablePairs > aggregate.comparablePairs || aggregate.activeTimeComparablePairs > aggregate.comparablePairs) throw new Error("Coding benchmark aggregate counts are inconsistent.");
  if (!aggregate.taskClassCounts || typeof aggregate.taskClassCounts !== "object" || Array.isArray(aggregate.taskClassCounts)) throw new Error("Coding benchmark task-class counts are malformed.");
  exactKeys(aggregate.taskClassCounts, TASK_CLASSES, "Coding benchmark task-class counts");
  for (const taskClass of TASK_CLASSES) assertNonNegativeInteger(aggregate.taskClassCounts[taskClass], `Coding benchmark ${taskClass} count`);
  if (TASK_CLASSES.reduce((total, taskClass) => total + aggregate.taskClassCounts[taskClass], 0) !== aggregate.comparablePairs) throw new Error("Coding benchmark task-class counts are inconsistent.");
  if (!EVIDENCE_LEVELS.has(aggregate.evidenceLevel)) throw new Error("Coding benchmark evidence level is malformed.");
  assertArmAggregate(aggregate.baseline);
  assertArmAggregate(aggregate.reparodynamic);
  for (const value of [aggregate.reparodynamicVerifiedWins, aggregate.baselineVerifiedWins, aggregate.verifiedTies]) assertNonNegativeInteger(value, "Coding benchmark paired outcome count");
  if (aggregate.reparodynamicVerifiedWins + aggregate.baselineVerifiedWins + aggregate.verifiedTies !== aggregate.comparablePairs) throw new Error("Coding benchmark paired outcomes are inconsistent.");
  assertFiniteRange(aggregate.successRateGain, -1, 1, "Coding benchmark success-rate gain");
  assertFiniteRange(aggregate.meanScoreGain, -1, 1, "Coding benchmark mean score gain");
  if (aggregate.meanCostReduction !== null) assertFiniteRange(aggregate.meanCostReduction, -Number.MAX_SAFE_INTEGER, 1, "Coding benchmark mean cost reduction");
  assertFiniteRange(aggregate.meanActiveTimeReduction, -Number.MAX_SAFE_INTEGER, 1, "Coding benchmark mean active-time reduction");
  assertFiniteRange(aggregate.meanVerifiedTasksPerActiveSecondGain, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Coding benchmark verified-work-rate gain");
  if (!aggregate.confidenceIntervals || typeof aggregate.confidenceIntervals !== "object" || Array.isArray(aggregate.confidenceIntervals)) throw new Error("Coding benchmark confidence intervals are malformed.");
  exactKeys(aggregate.confidenceIntervals, CIS_KEYS, "Coding benchmark confidence intervals");
  assertConfidenceInterval(aggregate.confidenceIntervals.successRateGain, "Coding benchmark success-rate confidence interval");
  assertConfidenceInterval(aggregate.confidenceIntervals.activeTimeReduction, "Coding benchmark active-time confidence interval");
  assertConfidenceInterval(aggregate.confidenceIntervals.verifiedTasksPerActiveSecondGain, "Coding benchmark work-rate confidence interval");
  if (aggregate.confidenceIntervals.costReduction !== null) assertConfidenceInterval(aggregate.confidenceIntervals.costReduction, "Coding benchmark cost confidence interval");
  assertHexDigest(aggregate.aggregateDigest, "Coding benchmark aggregate digest");
  if (sha256(canonicalJson(unsignedAggregate(aggregate))) !== aggregate.aggregateDigest) throw new Error("Coding benchmark aggregate digest verification failed.");
}

export function aggregateCodingBenchmarkPairs(input: {
  receipts: readonly CodingBenchmarkPairReceipt[];
  protocolDigest: string;
  corpusVersion: string;
  corpusDigest: string;
  canaryPercent: number;
  currentIdentityDigest: string;
  bootstrapSamples?: number;
}): CodingBenchmarkAggregate {
  assertHexDigest(input.protocolDigest, "Coding benchmark protocol digest");
  assertSafeId(input.corpusVersion, "Coding benchmark corpus version");
  assertHexDigest(input.corpusDigest, "Coding benchmark corpus digest");
  assertHexDigest(input.currentIdentityDigest, "Coding benchmark current identity digest");
  if (!Number.isInteger(input.canaryPercent) || input.canaryPercent < 1 || input.canaryPercent > 100) throw new Error("Coding benchmark canary percent must be an integer from 1 through 100.");
  const bootstrapSamples = input.bootstrapSamples ?? 2_000;
  if (!Number.isInteger(bootstrapSamples) || bootstrapSamples < 200 || bootstrapSamples > 10_000) throw new Error("Coding benchmark bootstrap samples must be an integer from 200 through 10000.");
  if (!Array.isArray(input.receipts) || input.receipts.length === 0 || input.receipts.length > 1_000) throw new Error("Coding benchmark aggregation requires 1 through 1000 pair receipts.");

  const pairIds = new Set<string>();
  const trialKeys = new Set<string>();
  const taskIdentities = new Map<string, string>();
  let evidenceIdentityDigest = "";
  for (const receipt of input.receipts) {
    assertCodingBenchmarkPairReceipt(receipt);
    if (receipt.protocolDigest !== input.protocolDigest || receipt.corpusVersion !== input.corpusVersion || receipt.corpusDigest !== input.corpusDigest || receipt.canaryPercent !== input.canaryPercent) {
      throw new Error("Coding benchmark pair is outside the requested frozen evidence scope.");
    }
    if (!evidenceIdentityDigest) evidenceIdentityDigest = receipt.identityDigest;
    if (receipt.identityDigest !== evidenceIdentityDigest) throw new Error("Coding benchmark pairs use mixed method identities.");
    if (pairIds.has(receipt.pairId)) throw new Error("Coding benchmark pair ids must be unique.");
    pairIds.add(receipt.pairId);
    const trialKey = `${receipt.taskId}:${receipt.trialIndex}`;
    if (trialKeys.has(trialKey)) throw new Error("Coding benchmark task and trial identity must be unique.");
    trialKeys.add(trialKey);
    const taskIdentity = sha256(canonicalJson({
      taskDigest: receipt.taskDigest,
      taskClass: receipt.taskClass,
      caseDigest: receipt.caseDigest,
      startingArtifactDigest: receipt.startingArtifactDigest,
      licenseDigest: receipt.licenseDigest,
    }));
    const known = taskIdentities.get(receipt.taskId);
    if (known && known !== taskIdentity) throw new Error("Coding benchmark task identity changed within the frozen corpus.");
    taskIdentities.set(receipt.taskId, taskIdentity);
  }

  const receipts: CodingBenchmarkPairReceipt[] = [...input.receipts].sort((left, right) => left.taskId.localeCompare(right.taskId) || left.trialIndex - right.trialIndex || left.pairId.localeCompare(right.pairId));
  const baseline = armAggregate(receipts.map((receipt) => receipt.baseline));
  const reparodynamic = armAggregate(receipts.map((receipt) => receipt.reparodynamic));
  const successDifferences = receipts.map((receipt) => Number(receipt.reparodynamic.verified) - Number(receipt.baseline.verified));
  const scoreDifferences = receipts.map((receipt) => receipt.reparodynamic.score - receipt.baseline.score);
  const costReductions = receipts.filter((receipt) => receipt.baseline.accountedCostUsd > 0).map((receipt) => (receipt.baseline.accountedCostUsd - receipt.reparodynamic.accountedCostUsd) / receipt.baseline.accountedCostUsd);
  const activeTimeReductions = receipts.map((receipt) => (receipt.baseline.activeExecutionMilliseconds - receipt.reparodynamic.activeExecutionMilliseconds) / receipt.baseline.activeExecutionMilliseconds);
  const workRateDifferences = receipts.map((receipt) => {
    const baselineRate = Number(receipt.baseline.verified) / (receipt.baseline.activeExecutionMilliseconds / 1000);
    const reparodynamicRate = Number(receipt.reparodynamic.verified) / (receipt.reparodynamic.activeExecutionMilliseconds / 1000);
    return reparodynamicRate - baselineRate;
  });
  const taskClassCounts: Record<CodingBenchmarkTaskClass, number> = {
    synthetic_deterministic: 0,
    reconstructed_sara: 0,
    licensed_public_typescript: 0,
  };
  for (const receipt of receipts) taskClassCounts[receipt.taskClass] += 1;
  const realPairs = receipts.filter((receipt) => receipt.evidenceKind === "real").length;
  const simulatedPairs = receipts.length - realPairs;
  const seedBase = sha256(canonicalJson({
    protocolDigest: input.protocolDigest,
    corpusDigest: input.corpusDigest,
    evidenceIdentityDigest,
    pairDigests: receipts.map((receipt) => sha256(canonicalJson(receipt))),
  }));
  const confidenceIntervals: CodingBenchmarkConfidenceIntervals = {
    successRateGain: bootstrapInterval(successDifferences, bootstrapSamples, sha256(`${seedBase}:success`))!,
    costReduction: bootstrapInterval(costReductions, bootstrapSamples, sha256(`${seedBase}:cost`)),
    activeTimeReduction: bootstrapInterval(activeTimeReductions, bootstrapSamples, sha256(`${seedBase}:time`))!,
    verifiedTasksPerActiveSecondGain: bootstrapInterval(workRateDifferences, bootstrapSamples, sha256(`${seedBase}:work-rate`))!,
  };
  const unsigned = {
    schemaVersion: 2 as const,
    protocolDigest: input.protocolDigest,
    corpusVersion: input.corpusVersion,
    corpusDigest: input.corpusDigest,
    evidenceIdentityDigest,
    currentIdentityDigest: input.currentIdentityDigest,
    canaryPercent: input.canaryPercent,
    comparablePairs: receipts.length,
    uniqueTasks: taskIdentities.size,
    taskClassCounts,
    realPairs,
    simulatedPairs,
    evidenceLevel: evidenceLevel({ comparablePairs: receipts.length, simulatedPairs, taskClassCounts, evidenceIdentityDigest, currentIdentityDigest: input.currentIdentityDigest }),
    baseline,
    reparodynamic,
    reparodynamicVerifiedWins: receipts.filter((receipt) => !receipt.baseline.verified && receipt.reparodynamic.verified).length,
    baselineVerifiedWins: receipts.filter((receipt) => receipt.baseline.verified && !receipt.reparodynamic.verified).length,
    verifiedTies: receipts.filter((receipt) => receipt.baseline.verified === receipt.reparodynamic.verified).length,
    successRateGain: mean(successDifferences),
    meanScoreGain: mean(scoreDifferences),
    meanCostReduction: costReductions.length ? mean(costReductions) : null,
    costComparablePairs: costReductions.length,
    meanActiveTimeReduction: mean(activeTimeReductions),
    activeTimeComparablePairs: activeTimeReductions.length,
    meanVerifiedTasksPerActiveSecondGain: mean(workRateDifferences),
    confidenceIntervals,
    bootstrapSamples,
  };
  const aggregate = { ...unsigned, aggregateDigest: sha256(canonicalJson(unsigned)) };
  assertCodingBenchmarkAggregate(aggregate);
  return aggregate;
}

function assertControlCheck(check: CodingRolloutControlCheck, label: string): void {
  if (!check || typeof check !== "object" || Array.isArray(check)) throw new Error(`${label} control evidence is malformed.`);
  exactKeys(check, CONTROL_CHECK_KEYS, `${label} control evidence`);
  if (check.status !== "passed" && check.status !== "failed" && check.status !== "missing") throw new Error(`${label} control status is malformed.`);
  assertHexDigest(check.evidenceDigest, `${label} control evidence digest`);
}

function unsignedControls(controls: CodingRolloutControlEvidence): Omit<CodingRolloutControlEvidence, "evidenceDigest"> {
  const { evidenceDigest: _digest, ...unsigned } = controls;
  return unsigned;
}

export function assertCodingRolloutControlEvidence(controls: CodingRolloutControlEvidence): void {
  if (!controls || typeof controls !== "object" || Array.isArray(controls)) throw new Error("Coding rollout control evidence is malformed.");
  exactKeys(controls, CONTROL_KEYS, "Coding rollout control evidence");
  if (controls.schemaVersion !== 1) throw new Error("Coding rollout control evidence schema version is unsupported.");
  for (const key of ["digestBinding", "costEnforcement", "protectedPaths", "crashResume", "nicoAssessment", "ownerApproval", "rollbackDrill"] as const) {
    assertControlCheck(controls[key], `Coding rollout ${key}`);
  }
  assertHexDigest(controls.evidenceDigest, "Coding rollout controls digest");
  if (sha256(canonicalJson(unsignedControls(controls))) !== controls.evidenceDigest) throw new Error("Coding rollout controls digest verification failed.");
}

export function compileCodingRolloutControlEvidence(input: Omit<CodingRolloutControlEvidence, "schemaVersion" | "evidenceDigest">): CodingRolloutControlEvidence {
  const unsigned = { schemaVersion: 1 as const, ...input };
  const controls = { ...unsigned, evidenceDigest: sha256(canonicalJson(unsigned)) };
  assertCodingRolloutControlEvidence(controls);
  return controls;
}

function assertPolicy(policy: CodingRolloutPolicy): void {
  for (const value of [policy.minimumMatchedPairs, policy.minimumPerTaskClass, policy.minimumPairsForDefaultEligibility, policy.minimumPerTaskClassForDefaultEligibility]) assertPositiveInteger(value, "Coding rollout evidence threshold");
  if (policy.minimumPairsForDefaultEligibility < policy.minimumMatchedPairs || policy.minimumPerTaskClassForDefaultEligibility < policy.minimumPerTaskClass) throw new Error("Coding rollout default thresholds cannot be weaker than expansion thresholds.");
  assertFiniteRange(policy.minimumVerifiedSuccessGain, 0, 1, "Coding rollout minimum verified-success gain");
  assertFiniteRange(policy.minimumCostReduction, 0, 1, "Coding rollout minimum cost reduction");
  assertFiniteRange(policy.equivalentSuccessTolerance, 0, 1, "Coding rollout equivalent-success tolerance");
  assertFiniteRange(policy.maximumSuccessRateLoss, 0, 1, "Coding rollout maximum success loss");
  assertFiniteRange(policy.maximumRepairCostUsd, 0, Number.MAX_SAFE_INTEGER, "Coding rollout maximum repair cost");
  if (!Array.isArray(policy.stages) || policy.stages.length < 1 || !policy.stages.includes(100) || policy.stages.some((stage) => !Number.isInteger(stage) || stage < 1 || stage > 100)) throw new Error("Coding rollout stages must be bounded percentages and include 100.");
}

function nextStage(current: number, stages: readonly number[]): number {
  return [...new Set(stages)].sort((left, right) => left - right).find((stage) => stage > current) ?? current;
}

function unsignedDecision(decision: CodingRolloutDecision): Omit<CodingRolloutDecision, "evidenceDigest"> {
  const { evidenceDigest: _digest, ...unsigned } = decision;
  return unsigned;
}

export function assertCodingRolloutDecision(input: { aggregate: CodingBenchmarkAggregate; controls: CodingRolloutControlEvidence; decision: CodingRolloutDecision }): void {
  assertCodingBenchmarkAggregate(input.aggregate);
  assertCodingRolloutControlEvidence(input.controls);
  const decision = input.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("Coding rollout decision is malformed.");
  exactKeys(decision, DECISION_KEYS, "Coding rollout decision");
  if (!["hold", "expand", "rollback", "eligible_default"].includes(decision.decision)) throw new Error("Coding rollout decision value is malformed.");
  if (!Number.isInteger(decision.currentCanaryPercent) || decision.currentCanaryPercent !== input.aggregate.canaryPercent) throw new Error("Coding rollout decision current scope is malformed.");
  if (!Number.isInteger(decision.nextCanaryPercent) || decision.nextCanaryPercent < 0 || decision.nextCanaryPercent > 100) throw new Error("Coding rollout decision next scope is malformed.");
  if (decision.evidenceLevel !== input.aggregate.evidenceLevel) throw new Error("Coding rollout decision evidence level is inconsistent.");
  if (!["insufficient_evidence", "measured_directional", "sustained_verified_improvement"].includes(decision.claimStatus)) throw new Error("Coding rollout claim status is malformed.");
  if (!["none", "verified_success", "cost_reduction"].includes(decision.majorBenefit)) throw new Error("Coding rollout major-benefit value is malformed.");
  if (!Array.isArray(decision.reasonCodes) || decision.reasonCodes.length < 1 || new Set(decision.reasonCodes).size !== decision.reasonCodes.length) throw new Error("Coding rollout reason codes are malformed.");
  for (const reason of decision.reasonCodes) assertSafeId(reason, "Coding rollout reason code");
  if (decision.aggregateDigest !== input.aggregate.aggregateDigest || decision.controlsDigest !== input.controls.evidenceDigest) throw new Error("Coding rollout decision is bound to the wrong evidence.");
  assertHexDigest(decision.evidenceDigest, "Coding rollout decision digest");
  if (sha256(canonicalJson(unsignedDecision(decision))) !== decision.evidenceDigest) throw new Error("Coding rollout decision digest verification failed.");
}

export function evaluateCodingRollout(input: {
  aggregate: CodingBenchmarkAggregate;
  controls: CodingRolloutControlEvidence;
  policy?: CodingRolloutPolicy;
}): CodingRolloutDecision {
  const policy = input.policy ?? INITIAL_CODING_ROLLOUT_POLICY;
  assertPolicy(policy);
  assertCodingBenchmarkAggregate(input.aggregate);
  assertCodingRolloutControlEvidence(input.controls);
  const aggregate = input.aggregate;
  if (!policy.stages.includes(aggregate.canaryPercent)) throw new Error("Coding benchmark canary percent is not an approved rollout stage.");
  const reasons: string[] = [];
  const coreControls = [input.controls.digestBinding, input.controls.costEnforcement, input.controls.protectedPaths, input.controls.crashResume];
  const failedCoreControl = coreControls.some((check) => check.status === "failed");
  const missingCoreControl = coreControls.some((check) => check.status === "missing");
  const escapedRegression = aggregate.reparodynamic.escapedRegressionRate > 0;
  const criticalRegressionIncrease = aggregate.reparodynamic.criticalRegressionRate > aggregate.baseline.criticalRegressionRate;
  const successLoss = aggregate.successRateGain < -policy.maximumSuccessRateLoss;
  const repairCostExceeded = aggregate.reparodynamic.maximumRepairCostUsd > policy.maximumRepairCostUsd;
  let decision: CodingRolloutDecision["decision"] = "hold";
  let nextCanaryPercent = aggregate.canaryPercent;
  let majorBenefit: CodingRolloutDecision["majorBenefit"] = "none";
  let claimStatus: CodingRolloutDecision["claimStatus"] = "insufficient_evidence";

  if (failedCoreControl || escapedRegression || criticalRegressionIncrease || successLoss || repairCostExceeded) {
    decision = "rollback";
    nextCanaryPercent = 0;
    if (failedCoreControl) reasons.push("core_control_failed");
    if (escapedRegression) reasons.push("escaped_regression");
    if (criticalRegressionIncrease) reasons.push("critical_regression_increase");
    if (successLoss) reasons.push("verified_success_drop");
    if (repairCostExceeded) reasons.push("repair_cost_limit");
  } else {
    if (aggregate.evidenceLevel === "STALE") reasons.push("stale_evidence");
    if (aggregate.evidenceLevel === "SIMULATED") reasons.push("simulated_evidence");
    if (aggregate.comparablePairs < policy.minimumMatchedPairs) reasons.push("insufficient_matched_pairs");
    if (TASK_CLASSES.some((taskClass) => aggregate.taskClassCounts[taskClass] < policy.minimumPerTaskClass)) reasons.push("insufficient_task_class_coverage");
    if (missingCoreControl) reasons.push("core_controls_missing");

    const successBenefit = aggregate.successRateGain >= policy.minimumVerifiedSuccessGain
      && aggregate.confidenceIntervals.successRateGain.low > 0;
    const costBenefit = aggregate.meanCostReduction !== null
      && aggregate.meanCostReduction >= policy.minimumCostReduction
      && aggregate.confidenceIntervals.costReduction !== null
      && aggregate.confidenceIntervals.costReduction.low > 0
      && aggregate.costComparablePairs === aggregate.comparablePairs
      && aggregate.successRateGain >= -policy.equivalentSuccessTolerance
      && aggregate.confidenceIntervals.successRateGain.low >= -policy.equivalentSuccessTolerance;
    if (successBenefit) majorBenefit = "verified_success";
    else if (costBenefit) majorBenefit = "cost_reduction";

    const expansionEvidenceReady = (aggregate.evidenceLevel === "MEASURED" || aggregate.evidenceLevel === "REPLICATED")
      && aggregate.comparablePairs >= policy.minimumMatchedPairs
      && TASK_CLASSES.every((taskClass) => aggregate.taskClassCounts[taskClass] >= policy.minimumPerTaskClass)
      && !missingCoreControl
      && majorBenefit !== "none";
    if (majorBenefit === "none" && aggregate.comparablePairs >= policy.minimumMatchedPairs) reasons.push("no_proven_major_benefit");

    if (expansionEvidenceReady) {
      claimStatus = aggregate.evidenceLevel === "REPLICATED" ? "sustained_verified_improvement" : "measured_directional";
      if (aggregate.canaryPercent < 100) {
        decision = "expand";
        nextCanaryPercent = nextStage(aggregate.canaryPercent, policy.stages);
        reasons.push("promotion_evidence_gate_passed");
      } else {
        const defaultControls = [input.controls.nicoAssessment, input.controls.ownerApproval, input.controls.rollbackDrill];
        const defaultControlsPassed = defaultControls.every((check) => check.status === "passed");
        const defaultCoverage = aggregate.comparablePairs >= policy.minimumPairsForDefaultEligibility
          && TASK_CLASSES.every((taskClass) => aggregate.taskClassCounts[taskClass] >= policy.minimumPerTaskClassForDefaultEligibility)
          && aggregate.evidenceLevel === "REPLICATED";
        if (!defaultCoverage) reasons.push("default_replication_incomplete");
        if (!defaultControlsPassed) reasons.push("default_controls_missing");
        if (defaultCoverage && defaultControlsPassed) {
          decision = "eligible_default";
          claimStatus = "sustained_verified_improvement";
          reasons.push("default_evidence_gate_passed");
        }
      }
    }
  }
  if (!reasons.length) reasons.push("evidence_gate_held");
  const unsigned = {
    decision,
    currentCanaryPercent: aggregate.canaryPercent,
    nextCanaryPercent,
    evidenceLevel: aggregate.evidenceLevel,
    claimStatus,
    majorBenefit,
    reasonCodes: [...new Set(reasons)],
    aggregateDigest: aggregate.aggregateDigest,
    controlsDigest: input.controls.evidenceDigest,
  };
  const result = { ...unsigned, evidenceDigest: sha256(canonicalJson(unsigned)) };
  assertCodingRolloutDecision({ aggregate, controls: input.controls, decision: result });
  return result;
}
