import { canonicalJson, sha256 } from "./canonical.ts";
import { assertMoney } from "./economics.ts";
import type {
  CompoundMandateInput,
  CompoundingDecision,
  CompoundingOpportunity,
} from "./types.ts";

const PROVIDER_OR_OPERATION = /^[a-z0-9][a-z0-9._:-]{0,79}$/u;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const MAX_MANDATE_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;

function boundedUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function decideCompoundingRate(
  opportunity: CompoundingOpportunity,
  options: { id: string; decidedAt: string },
): CompoundingDecision {
  if (!opportunity.objective.trim() || opportunity.objective.length > 1_000) {
    throw new Error("Compounding objective must contain 1–1,000 characters.");
  }
  assertMoney(opportunity.expectedOwnerValueUsd, "Expected owner value");
  assertMoney(opportunity.maximumCostUsd, "Maximum opportunity cost");
  boundedUnit(opportunity.confidence, "Confidence");
  boundedUnit(opportunity.riskScore, "Risk score");
  if (!Number.isFinite(opportunity.reserveCoverageMonths) || opportunity.reserveCoverageMonths < 0) {
    throw new RangeError("Reserve coverage months must be finite and non-negative.");
  }
  if (
    opportunity.evidence.length < 1 ||
    opportunity.evidence.length > 20 ||
    opportunity.evidence.some((item) => !item.trim() || item.length > 500)
  ) {
    throw new Error("A bounded, non-empty evidence set is required for compounding.");
  }
  if (!options.id.trim() || !Number.isFinite(Date.parse(options.decidedAt))) {
    throw new Error("Compounding decision identity and timestamp are required.");
  }

  const riskAdjustedOwnerValueUsd = roundMoney(
    opportunity.expectedOwnerValueUsd * opportunity.confidence * (1 - opportunity.riskScore),
  );
  const valueMultiple = opportunity.maximumCostUsd === 0
    ? 0
    : Math.round((riskAdjustedOwnerValueUsd / opportunity.maximumCostUsd) * 100) / 100;

  // Zero-cost opportunities do not justify reserving a larger share of profit.
  // Paid opportunities must earn a higher rate through evidence, value, and reserves.
  const valueScore = opportunity.maximumCostUsd === 0
    ? 0
    : Math.min(1, Math.max(0, (valueMultiple - 1) / 4));
  const reserveScore = Math.min(1, opportunity.reserveCoverageMonths / 6);
  const evidenceScore = Math.min(1, opportunity.evidence.length / 5);
  const composite =
    valueScore * 0.5 +
    opportunity.confidence * (1 - opportunity.riskScore) * 0.25 +
    reserveScore * 0.15 +
    evidenceScore * 0.1;
  const reinvestmentRate = opportunity.maximumCostUsd === 0
    ? 0.25
    : composite >= 0.95
      ? 0.5
      : Math.min(0.5, Math.max(0.25, Math.round((0.25 + composite * 0.25) * 100) / 100));

  return {
    ...structuredClone(opportunity),
    id: options.id,
    riskAdjustedOwnerValueUsd,
    valueMultiple,
    reinvestmentRate,
    reasons: [
      `Risk-adjusted expected owner value: $${riskAdjustedOwnerValueUsd.toFixed(2)}.`,
      opportunity.maximumCostUsd === 0
        ? "The opportunity is zero-cost, so the protected 25% default remains sufficient."
        : `Risk-adjusted value multiple: ${valueMultiple.toFixed(2)}x.`,
      `Reserve coverage: ${opportunity.reserveCoverageMonths.toFixed(2)} months.`,
      `The rate remains inside the protected 25–50% band and preserves at least 50% for the owner.`,
    ],
    decidedAt: options.decidedAt,
  };
}

export function validateCompoundMandateInput(
  input: CompoundMandateInput,
  now = new Date(),
): CompoundMandateInput {
  if (!PROVIDER_OR_OPERATION.test(input.providerId)) throw new Error("Mandate provider id is malformed.");
  if (!PROVIDER_OR_OPERATION.test(input.operation)) throw new Error("Mandate operation is malformed.");
  if (!TARGET_ID.test(input.targetId)) throw new Error("Mandate target id is malformed.");
  assertMoney(input.maximumTotalUsd, "Mandate total");
  assertMoney(input.maximumPerActionUsd, "Mandate per-action limit");
  if (input.maximumTotalUsd <= 0 || input.maximumPerActionUsd <= 0) {
    throw new RangeError("Mandate limits must be greater than zero.");
  }
  if (input.maximumPerActionUsd > input.maximumTotalUsd) {
    throw new RangeError("Mandate per-action limit cannot exceed its total limit.");
  }
  if (!input.purpose.trim() || input.purpose.length > 500) {
    throw new Error("Mandate purpose must contain 1–500 characters.");
  }
  const expiration = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiration) || expiration <= now.getTime()) {
    throw new Error("Mandate expiration must be a future timestamp.");
  }
  if (expiration - now.getTime() > MAX_MANDATE_LIFETIME_MS) {
    throw new Error("Mandate lifetime cannot exceed 366 days.");
  }
  return {
    ...input,
    purpose: input.purpose.trim(),
    expiresAt: new Date(expiration).toISOString(),
  };
}

export function compoundMandateApprovalTarget(input: CompoundMandateInput): string {
  return `compound-mandate:${sha256(canonicalJson(input))}`;
}
