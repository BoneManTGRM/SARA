import { canonicalJson, sha256 } from "./canonical.ts";
import type {
  CodingBehavioralCheckSummary,
  CodingRepairBehavioralProgress,
  CodingRepairLimits,
  CodingRepairPerformanceGauge,
  CodingRepairReceipt,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";

const HEX_DIGEST = /^[a-f0-9]{64}$/u;

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function aggregateBehavioralChecks(value: unknown): CodingBehavioralCheckSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.disclosure !== "aggregate_only" ||
    !Number.isSafeInteger(candidate.passed) ||
    !Number.isSafeInteger(candidate.total) ||
    (candidate.passed as number) < 0 ||
    (candidate.total as number) <= 0 ||
    (candidate.passed as number) > (candidate.total as number) ||
    typeof candidate.suiteDigest !== "string" ||
    !HEX_DIGEST.test(candidate.suiteDigest) ||
    typeof candidate.evidenceDigest !== "string" ||
    !HEX_DIGEST.test(candidate.evidenceDigest)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    passed: candidate.passed as number,
    total: candidate.total as number,
    suiteDigest: candidate.suiteDigest,
    evidenceDigest: candidate.evidenceDigest,
    disclosure: "aggregate_only",
  };
}

function knownBehavioralChecks(
  verification: ProgramVerificationResult,
): CodingBehavioralCheckSummary | undefined {
  return aggregateBehavioralChecks(verification.behavioralChecks);
}

export function sanitizeCodingRepairVerification(
  verification: ProgramVerificationResult,
): ProgramVerificationResult {
  const behavioralChecks = knownBehavioralChecks(verification);
  return {
    passed: verification.passed,
    score: verification.score,
    artifactDigest: verification.artifactDigest,
    failures: verification.failures.map((failure) => ({
      kind: failure.kind,
      code: failure.code,
      file: failure.file,
      line: failure.line,
      column: failure.column,
      evidenceDigest: failure.evidenceDigest,
      fingerprint: failure.fingerprint,
      severity: failure.severity,
      existedBeforeRepair: failure.existedBeforeRepair,
    })),
    completedChecks: [...verification.completedChecks],
    evidenceDigests: [...verification.evidenceDigests],
    ...(behavioralChecks ? { behavioralChecks } : {}),
  };
}

function projectBehavioralChecks(summary: CodingBehavioralCheckSummary) {
  return {
    passed: summary.passed,
    total: summary.total,
    suiteDigest: summary.suiteDigest,
    evidenceDigest: summary.evidenceDigest,
  };
}

function buildBehavioralProgress(
  baselineVerification: ProgramVerificationResult,
  finalVerification: ProgramVerificationResult,
): CodingRepairBehavioralProgress | null {
  const baseline = knownBehavioralChecks(baselineVerification);
  const final = knownBehavioralChecks(finalVerification);
  if (!baseline || !final) return null;
  const comparable = baseline.total === final.total && baseline.suiteDigest === final.suiteDigest;
  return {
    disclosure: "aggregate_only",
    comparable,
    baseline: projectBehavioralChecks(baseline),
    final: projectBehavioralChecks(final),
    passedDelta: comparable ? final.passed - baseline.passed : null,
    completionRatioDelta: comparable
      ? rounded((final.passed / final.total) - (baseline.passed / baseline.total))
      : null,
  };
}

export function buildCodingRepairPerformanceGauge(input: {
  baselineVerification: ProgramVerificationResult;
  finalVerification: ProgramVerificationResult;
  receipts: readonly CodingRepairReceipt[];
  limits: CodingRepairLimits;
  verifierExecutions: number;
}): CodingRepairPerformanceGauge {
  const semanticRepeatRejections = input.receipts.filter((receipt) => (
    receipt.outcome === "duplicate_rejected" && receipt.reasonCode === "semantic_tactic_repeat"
  )).length;
  const modelCalls = input.receipts.filter((receipt) => receipt.strategy !== "stop").length;
  const accountedCostUsd = rounded(input.receipts.reduce(
    (total, receipt) => total + receipt.accountedCostUsd,
    0,
  ));
  const limitsDigest = sha256(canonicalJson({
    maximumCycles: input.limits.maximumCycles,
    surgicalFiles: input.limits.surgicalFiles,
    surgicalChangedLines: input.limits.surgicalChangedLines,
    deepFiles: input.limits.deepFiles,
    deepChangedLines: input.limits.deepChangedLines,
    maximumModelSpendUsd: input.limits.maximumModelSpendUsd,
    protectedPaths: [...input.limits.protectedPaths].sort(),
  }));
  const evidence = {
    schemaVersion: 1 as const,
    evidenceLevel: "DETERMINISTIC_SINGLE_RUN" as const,
    verifierExecutions: input.verifierExecutions,
    advisoryOnlyCounterfactualVerifierExecutions: input.verifierExecutions + semanticRepeatRejections,
    semanticRepeatRejections,
    verifierExecutionsAvoided: semanticRepeatRejections,
    modelCalls,
    accountedCostUsd,
    completionGain: Number(input.finalVerification.passed) - Number(input.baselineVerification.passed),
    scoreGain: rounded(input.finalVerification.score - input.baselineVerification.score),
    behavioralProgress: buildBehavioralProgress(input.baselineVerification, input.finalVerification),
    counterfactualBasis: "semantic_tactic_repeat_rejections_only" as const,
    limitsDigest,
    generalClaimSupported: false as const,
  };
  return {
    ...evidence,
    evidenceDigest: sha256(canonicalJson(evidence)),
  };
}
