import { canonicalJson, sha256 } from "./canonical.ts";

export type CodingBenchmarkTaskClass = "synthetic" | "reconstructed_sara" | "licensed_public";
export type CodingBenchmarkMethod = "luna" | "luna_reparodynamic";
export type CodingBenchmarkExecutionKind = "simulated" | "live";
export type CodingBenchmarkEvidenceLevel = "SIMULATED" | "LAB" | "MEASURED" | "REPLICATED" | "STALE";

export type CodingBenchmarkBindings = {
  sourceCommit: string;
  corpusDigest: string;
  modelDigest: string;
  controllerDigest: string;
  policyDigest: string;
  verifierDigest: string;
  environmentDigest: string;
  authorityDigest: string;
};

export type CodingBenchmarkArmResult = {
  method: CodingBenchmarkMethod;
  verifiedComplete: boolean;
  finalScore: number;
  activeExecutionMilliseconds: number;
  accountedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cycles: number;
  rollbacks: number;
  changedFiles: number;
  changedLines: number;
  rye: number;
  regression: boolean;
  criticalRegression: boolean;
  failureCode: string | null;
  finalArtifactDigest: string;
  verifierEvidenceDigests: string[];
};

export type CodingBenchmarkPairReceipt = {
  schemaVersion: 1;
  benchmarkId: string;
  pairIndex: number;
  caseId: string;
  taskClass: CodingBenchmarkTaskClass;
  taskFamily: string;
  executionKind: CodingBenchmarkExecutionKind;
  order: [CodingBenchmarkMethod, CodingBenchmarkMethod];
  bindings: CodingBenchmarkBindings;
  normal: CodingBenchmarkArmResult;
  reparodynamic: CodingBenchmarkArmResult;
  completedAt: string;
};

export type CodingBenchmarkInterval = { lower: number; upper: number };

export type CodingBenchmarkArmSummary = {
  verifiedComplete: number;
  verifiedSuccessRate: number;
  meanFinalScore: number;
  totalActiveExecutionMilliseconds: number;
  verifiedCompletionsPerActiveSecond: number;
  totalAccountedCostUsd: number | null;
  knownCostPairs: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  meanCycles: number;
  totalRollbacks: number;
  totalChangedFiles: number;
  totalChangedLines: number;
  meanRye: number;
  regressions: number;
  criticalRegressions: number;
};

export type CodingBenchmarkSummary = {
  schemaVersion: 1;
  benchmarkId: string;
  pairCount: number;
  livePairCount: number;
  distinctTaskClasses: number;
  distinctTaskFamilies: number;
  evidenceLevel: CodingBenchmarkEvidenceLevel;
  staleReasons: string[];
  bindings: CodingBenchmarkBindings;
  normal: CodingBenchmarkArmSummary;
  reparodynamic: CodingBenchmarkArmSummary;
  paired: {
    verifiedSuccessDelta: number;
    verifiedSuccessDelta95: CodingBenchmarkInterval;
    finalScoreDelta: number;
    finalScoreDelta95: CodingBenchmarkInterval;
    verifiedThroughputDeltaPerSecond: number;
    verifiedThroughputDelta95: CodingBenchmarkInterval;
    relativeCostReduction: number | null;
    relativeCostReduction95: CodingBenchmarkInterval | null;
    costComparablePairs: number;
  };
  proofDigest: string;
};

export type CodingBenchmarkPromotionDecision = {
  action: "hold" | "expand_canary" | "promote_default" | "rollback_to_shadow";
  currentCanaryPercent: number;
  recommendedCanaryPercent: number;
  reasonCodes: string[];
  evidenceLevel: CodingBenchmarkEvidenceLevel;
  proofDigest: string;
};

const HEX_DIGEST = /^[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BINDING_KEYS: Array<keyof CodingBenchmarkBindings> = [
  "sourceCommit",
  "corpusDigest",
  "modelDigest",
  "controllerDigest",
  "policyDigest",
  "verifierDigest",
  "environmentDigest",
  "authorityDigest",
];

type CodingBenchmarkSummaryWithoutDigest = Omit<CodingBenchmarkSummary, "proofDigest">;

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function assertCount(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
}

function assertArm(arm: CodingBenchmarkArmResult, method: CodingBenchmarkMethod): void {
  if (arm.method !== method) throw new Error(`Benchmark arm method must be ${method}.`);
  if (!Number.isFinite(arm.finalScore) || arm.finalScore < 0 || arm.finalScore > 1) {
    throw new Error("Benchmark final score must be within 0 and 1.");
  }
  if (!Number.isFinite(arm.activeExecutionMilliseconds) || arm.activeExecutionMilliseconds <= 0) {
    throw new Error("Benchmark active execution time must be positive.");
  }
  if (arm.accountedCostUsd !== null && (!Number.isFinite(arm.accountedCostUsd) || arm.accountedCostUsd < 0)) {
    throw new Error("Benchmark cost must be null or a non-negative finite amount.");
  }
  for (const [field, value] of [["inputTokens", arm.inputTokens], ["outputTokens", arm.outputTokens]] as const) {
    if (value !== null) assertCount(value, field);
  }
  for (const [field, value] of [
    ["cycles", arm.cycles],
    ["rollbacks", arm.rollbacks],
    ["changedFiles", arm.changedFiles],
    ["changedLines", arm.changedLines],
  ] as const) assertCount(value, field);
  if (!Number.isFinite(arm.rye) || arm.rye < 0) throw new Error("Benchmark RYE must be non-negative and finite.");
  if (!HEX_DIGEST.test(arm.finalArtifactDigest)) throw new Error("Benchmark final artifact digest is malformed.");
  if (!arm.verifierEvidenceDigests.length || arm.verifierEvidenceDigests.some((digest) => !HEX_DIGEST.test(digest))) {
    throw new Error("Benchmark verifier evidence digests are missing or malformed.");
  }
  if (arm.failureCode !== null && (!arm.failureCode.trim() || arm.failureCode.length > 128)) {
    throw new Error("Benchmark failure code must be null or a bounded non-empty string.");
  }
}

function assertPair(pair: CodingBenchmarkPairReceipt): void {
  if (pair.schemaVersion !== 1) throw new Error("Benchmark pair schema version is unsupported.");
  if (!UUID_V4.test(pair.benchmarkId)) throw new Error("Benchmark id must be a UUID v4.");
  if (!Number.isInteger(pair.pairIndex) || pair.pairIndex < 1) {
    throw new Error("Benchmark pair index must be positive.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(pair.caseId)) {
    throw new Error("Benchmark case id is malformed.");
  }
  if (!pair.taskFamily.trim() || pair.taskFamily.length > 128) {
    throw new Error("Benchmark task family is malformed.");
  }
  if (
    pair.order.length !== 2
    || new Set(pair.order).size !== 2
    || !pair.order.includes("luna")
    || !pair.order.includes("luna_reparodynamic")
  ) throw new Error("Benchmark pair order must contain each method exactly once.");
  for (const key of BINDING_KEYS) {
    if (!HEX_DIGEST.test(pair.bindings[key])) throw new Error(`Benchmark ${snakeCase(key)} is malformed.`);
  }
  if (!Number.isFinite(Date.parse(pair.completedAt))) {
    throw new Error("Benchmark completion timestamp is malformed.");
  }
  assertArm(pair.normal, "luna");
  assertArm(pair.reparodynamic, "luna_reparodynamic");
}

function sumNullable(values: readonly (number | null)[]): { total: number | null; known: number } {
  const known = values.filter((value): value is number => value !== null);
  return {
    total: known.length === values.length
      ? rounded(known.reduce((total, value) => total + value, 0))
      : null,
    known: known.length,
  };
}

function summarizeArm(arms: readonly CodingBenchmarkArmResult[]): CodingBenchmarkArmSummary {
  const verifiedComplete = arms.filter((arm) => arm.verifiedComplete).length;
  const totalActiveExecutionMilliseconds = arms.reduce(
    (total, arm) => total + arm.activeExecutionMilliseconds,
    0,
  );
  const costs = sumNullable(arms.map((arm) => arm.accountedCostUsd));
  const inputTokens = sumNullable(arms.map((arm) => arm.inputTokens));
  const outputTokens = sumNullable(arms.map((arm) => arm.outputTokens));
  return {
    verifiedComplete,
    verifiedSuccessRate: rounded(verifiedComplete / arms.length),
    meanFinalScore: rounded(mean(arms.map((arm) => arm.finalScore))),
    totalActiveExecutionMilliseconds: rounded(totalActiveExecutionMilliseconds),
    verifiedCompletionsPerActiveSecond: rounded(
      verifiedComplete / (totalActiveExecutionMilliseconds / 1_000),
    ),
    totalAccountedCostUsd: costs.total,
    knownCostPairs: costs.known,
    totalInputTokens: inputTokens.total,
    totalOutputTokens: outputTokens.total,
    meanCycles: rounded(mean(arms.map((arm) => arm.cycles))),
    totalRollbacks: arms.reduce((total, arm) => total + arm.rollbacks, 0),
    totalChangedFiles: arms.reduce((total, arm) => total + arm.changedFiles, 0),
    totalChangedLines: arms.reduce((total, arm) => total + arm.changedLines, 0),
    meanRye: rounded(mean(arms.map((arm) => arm.rye))),
    regressions: arms.filter((arm) => arm.regression).length,
    criticalRegressions: arms.filter((arm) => arm.criticalRegression).length,
  };
}

function deterministicRandom(seedMaterial: unknown): () => number {
  let state = Number.parseInt(sha256(canonicalJson(seedMaterial)).slice(0, 8), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function bootstrapInterval(
  values: readonly number[],
  samples: number,
  seedMaterial: unknown,
): CodingBenchmarkInterval {
  if (!values.length) throw new Error("Cannot bootstrap an empty matched metric.");
  if (values.every((value) => value === values[0])) {
    const exact = rounded(values[0]!);
    return { lower: exact, upper: exact };
  }
  const random = deterministicRandom(seedMaterial);
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)]!;
    }
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  const lowerIndex = Math.floor((means.length - 1) * 0.025);
  const upperIndex = Math.ceil((means.length - 1) * 0.975);
  return { lower: rounded(means[lowerIndex]!), upper: rounded(means[upperIndex]!) };
}

function mixedBindingReasons(
  pairs: readonly CodingBenchmarkPairReceipt[],
  expectedBindings: Partial<CodingBenchmarkBindings> | undefined,
): string[] {
  const reasons: string[] = [];
  if (new Set(pairs.map((pair) => pair.benchmarkId)).size > 1) reasons.push("mixed_benchmark_id");
  for (const key of BINDING_KEYS) {
    const values = new Set(pairs.map((pair) => pair.bindings[key]));
    const snake = snakeCase(key);
    if (values.size > 1) reasons.push(`mixed_${snake}`);
    const expected = expectedBindings?.[key];
    if (expected !== undefined) {
      if (!HEX_DIGEST.test(expected)) throw new Error(`Expected benchmark ${snake} is malformed.`);
      if ([...values].some((value) => value !== expected)) reasons.push(`expected_${snake}_mismatch`);
    }
  }
  return [...new Set(reasons)].sort();
}

export function codingBenchmarkPairDigest(pair: CodingBenchmarkPairReceipt): string {
  assertPair(pair);
  return sha256(canonicalJson(pair));
}

export function codingBenchmarkSummaryProofDigest(
  summary: CodingBenchmarkSummaryWithoutDigest,
  pairs: readonly CodingBenchmarkPairReceipt[],
): string {
  const sorted = [...pairs].sort(
    (left, right) => left.pairIndex - right.pairIndex || left.caseId.localeCompare(right.caseId),
  );
  return sha256(canonicalJson({
    summary,
    pairDigests: sorted.map(codingBenchmarkPairDigest),
  }));
}

export function assertCodingBenchmarkSummaryProof(
  summary: CodingBenchmarkSummary,
  pairs: readonly CodingBenchmarkPairReceipt[],
): void {
  const { proofDigest, ...withoutDigest } = summary;
  if (!HEX_DIGEST.test(proofDigest)) throw new Error("Coding benchmark summary proof digest is malformed.");
  if (pairs.length !== summary.pairCount) {
    throw new Error("Coding benchmark summary proof does not match its persisted pair count.");
  }
  const expected = codingBenchmarkSummaryProofDigest(withoutDigest, pairs);
  if (proofDigest !== expected) {
    throw new Error("Coding benchmark summary proof does not match persisted pair evidence.");
  }
}

export function summarizeCodingBenchmark(input: {
  pairs: CodingBenchmarkPairReceipt[];
  expectedBindings?: Partial<CodingBenchmarkBindings>;
  bootstrapSamples?: number;
}): CodingBenchmarkSummary {
  if (!input.pairs.length) throw new Error("At least one matched coding benchmark pair is required.");
  const bootstrapSamples = input.bootstrapSamples ?? 10_000;
  if (!Number.isInteger(bootstrapSamples) || bootstrapSamples < 500 || bootstrapSamples > 100_000) {
    throw new Error("bootstrapSamples must be an integer from 500 through 100000.");
  }
  const pairs = input.pairs.map((pair) => structuredClone(pair));
  for (const pair of pairs) assertPair(pair);
  const pairIndexes = new Set<number>();
  const caseIds = new Set<string>();
  for (const pair of pairs) {
    if (pairIndexes.has(pair.pairIndex)) throw new Error("Benchmark pair indexes must be unique.");
    if (caseIds.has(pair.caseId)) throw new Error("Benchmark case ids must be unique.");
    pairIndexes.add(pair.pairIndex);
    caseIds.add(pair.caseId);
  }
  pairs.sort((left, right) => left.pairIndex - right.pairIndex || left.caseId.localeCompare(right.caseId));
  const staleReasons = mixedBindingReasons(pairs, input.expectedBindings);
  const livePairCount = pairs.filter((pair) => pair.executionKind === "live").length;
  const distinctTaskClasses = new Set(pairs.map((pair) => pair.taskClass)).size;
  const distinctTaskFamilies = new Set(pairs.map((pair) => pair.taskFamily)).size;
  let evidenceLevel: CodingBenchmarkEvidenceLevel;
  if (staleReasons.length) evidenceLevel = "STALE";
  else if (livePairCount !== pairs.length) evidenceLevel = "SIMULATED";
  else if (pairs.length >= 100 && distinctTaskClasses >= 3 && distinctTaskFamilies >= 3) {
    evidenceLevel = "REPLICATED";
  } else if (pairs.length >= 30 && distinctTaskClasses >= 3 && distinctTaskFamilies >= 3) {
    evidenceLevel = "MEASURED";
  } else evidenceLevel = "LAB";

  const verifiedSuccessDeltas = pairs.map((pair) => (
    Number(pair.reparodynamic.verifiedComplete) - Number(pair.normal.verifiedComplete)
  ));
  const scoreDeltas = pairs.map(
    (pair) => pair.reparodynamic.finalScore - pair.normal.finalScore,
  );
  const throughputDeltas = pairs.map((pair) => (
    Number(pair.reparodynamic.verifiedComplete)
      / (pair.reparodynamic.activeExecutionMilliseconds / 1_000)
    - Number(pair.normal.verifiedComplete)
      / (pair.normal.activeExecutionMilliseconds / 1_000)
  ));
  const costReductions = pairs.flatMap((pair) => {
    const normal = pair.normal.accountedCostUsd;
    const reparodynamic = pair.reparodynamic.accountedCostUsd;
    if (normal === null || reparodynamic === null || normal <= 0) return [];
    return [1 - reparodynamic / normal];
  });
  const seed = pairs.map((pair) => ({
    pairIndex: pair.pairIndex,
    caseId: pair.caseId,
    bindings: pair.bindings,
    normal: pair.normal,
    reparodynamic: pair.reparodynamic,
  }));
  const paired = {
    verifiedSuccessDelta: rounded(mean(verifiedSuccessDeltas)),
    verifiedSuccessDelta95: bootstrapInterval(
      verifiedSuccessDeltas,
      bootstrapSamples,
      { seed, metric: "verified_success" },
    ),
    finalScoreDelta: rounded(mean(scoreDeltas)),
    finalScoreDelta95: bootstrapInterval(
      scoreDeltas,
      bootstrapSamples,
      { seed, metric: "final_score" },
    ),
    verifiedThroughputDeltaPerSecond: rounded(mean(throughputDeltas)),
    verifiedThroughputDelta95: bootstrapInterval(
      throughputDeltas,
      bootstrapSamples,
      { seed, metric: "verified_throughput" },
    ),
    relativeCostReduction: costReductions.length ? rounded(mean(costReductions)) : null,
    relativeCostReduction95: costReductions.length
      ? bootstrapInterval(
        costReductions,
        bootstrapSamples,
        { seed, metric: "relative_cost_reduction" },
      )
      : null,
    costComparablePairs: costReductions.length,
  };
  const summaryWithoutDigest: CodingBenchmarkSummaryWithoutDigest = {
    schemaVersion: 1,
    benchmarkId: pairs[0]!.benchmarkId,
    pairCount: pairs.length,
    livePairCount,
    distinctTaskClasses,
    distinctTaskFamilies,
    evidenceLevel,
    staleReasons,
    bindings: structuredClone(pairs[0]!.bindings),
    normal: summarizeArm(pairs.map((pair) => pair.normal)),
    reparodynamic: summarizeArm(pairs.map((pair) => pair.reparodynamic)),
    paired,
  };
  return {
    ...summaryWithoutDigest,
    proofDigest: codingBenchmarkSummaryProofDigest(summaryWithoutDigest, pairs),
  };
}

export function evaluateCodingBenchmarkPromotion(input: {
  summary: CodingBenchmarkSummary;
  currentCanaryPercent: number;
}): CodingBenchmarkPromotionDecision {
  if (
    !Number.isInteger(input.currentCanaryPercent)
    || input.currentCanaryPercent < 0
    || input.currentCanaryPercent > 100
  ) throw new Error("currentCanaryPercent must be an integer from 0 through 100.");
  const summary = input.summary;
  const base = {
    currentCanaryPercent: input.currentCanaryPercent,
    evidenceLevel: summary.evidenceLevel,
    proofDigest: summary.proofDigest,
  };
  if (summary.reparodynamic.criticalRegressions > summary.normal.criticalRegressions) {
    return {
      ...base,
      action: "rollback_to_shadow",
      recommendedCanaryPercent: 0,
      reasonCodes: ["critical_regression_increase"],
    };
  }
  if (summary.paired.verifiedSuccessDelta95.upper < 0) {
    return {
      ...base,
      action: "rollback_to_shadow",
      recommendedCanaryPercent: 0,
      reasonCodes: ["verified_success_decrease_supported"],
    };
  }
  if (summary.evidenceLevel === "STALE") {
    return {
      ...base,
      action: "hold",
      recommendedCanaryPercent: input.currentCanaryPercent,
      reasonCodes: ["stale_evidence", ...summary.staleReasons],
    };
  }
  if (summary.evidenceLevel === "SIMULATED" || summary.evidenceLevel === "LAB") {
    return {
      ...base,
      action: "hold",
      recommendedCanaryPercent: input.currentCanaryPercent,
      reasonCodes: ["insufficient_matched_live_evidence"],
    };
  }

  const verifiedSuccessGainSupported = summary.paired.verifiedSuccessDelta >= 0.15
    && summary.paired.verifiedSuccessDelta95.lower > 0;
  const equivalentSuccess = summary.paired.verifiedSuccessDelta >= 0
    && summary.paired.verifiedSuccessDelta95.lower >= 0;
  const costReductionSupported = equivalentSuccess
    && summary.paired.relativeCostReduction !== null
    && summary.paired.relativeCostReduction >= 0.25
    && summary.paired.relativeCostReduction95 !== null
    && summary.paired.relativeCostReduction95.lower >= 0.25;
  if (!verifiedSuccessGainSupported && !costReductionSupported) {
    return {
      ...base,
      action: "hold",
      recommendedCanaryPercent: input.currentCanaryPercent,
      reasonCodes: ["no_supported_major_benefit"],
    };
  }
  const benefitReasons = [
    ...(verifiedSuccessGainSupported ? ["verified_success_gain_supported"] : []),
    ...(costReductionSupported ? ["equivalent_success_cost_reduction_supported"] : []),
  ];

  let recommended = input.currentCanaryPercent;
  if (input.currentCanaryPercent === 0) recommended = 5;
  else if (input.currentCanaryPercent < 20 && summary.pairCount >= 30) recommended = 20;
  else if (input.currentCanaryPercent < 50 && summary.pairCount >= 60) recommended = 50;
  else if (input.currentCanaryPercent < 100 && summary.evidenceLevel === "REPLICATED") {
    recommended = 100;
  }
  if (recommended > input.currentCanaryPercent) {
    return {
      ...base,
      action: "expand_canary",
      recommendedCanaryPercent: recommended,
      reasonCodes: [...benefitReasons, "staged_canary_expansion"],
    };
  }
  if (
    input.currentCanaryPercent === 100
    && summary.evidenceLevel === "REPLICATED"
    && summary.pairCount >= 150
  ) {
    return {
      ...base,
      action: "promote_default",
      recommendedCanaryPercent: 100,
      reasonCodes: [...benefitReasons, "sustained_replicated_benefit"],
    };
  }
  return {
    ...base,
    action: "hold",
    recommendedCanaryPercent: input.currentCanaryPercent,
    reasonCodes: [...benefitReasons, "next_stage_evidence_not_yet_met"],
  };
}
