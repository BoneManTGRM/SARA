import type { LedgerEntry } from "./types.ts";

export type ProfitWaterfall = {
  collectedRevenueUsd: number;
  trueCostsAndReservesUsd: number;
  realizedDistributableProfitUsd: number;
  reinvestmentUsd: number;
  ownerDistributionUsd: number;
  allocationRoundingCarryUsd: number;
  reinvestmentRate: number;
};

function money(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Financial total must remain finite.");
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError("Financial total exceeds safe whole-cent precision.");
  return cents / 100;
}

function sumMoney(entries: LedgerEntry[], predicate: (entry: LedgerEntry) => boolean): number {
  let total = 0;
  for (const entry of entries) {
    assertMoney(entry.amountUsd, "Ledger amount");
    if (!predicate(entry)) continue;
    total += entry.amountUsd;
    if (!Number.isFinite(total)) throw new RangeError("Financial total must remain finite.");
  }
  return money(total);
}

export function assertMoney(value: number, label: string): void {
  const cents = Math.round(value * 100);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(cents) ||
    Math.abs(value - cents / 100) > 1e-9
  ) {
    throw new RangeError(`${label} must be a finite non-negative amount in whole cents.`);
  }
}

export function ownerFundedRecurringMonthly(entries: LedgerEntry[]): number {
  return sumMoney(entries, (entry) => entry.source === "owner" && entry.recurringMonthly);
}

export function calculateProfitWaterfall(entries: LedgerEntry[], reinvestmentRate: number): ProfitWaterfall {
  if (!Number.isFinite(reinvestmentRate) || reinvestmentRate < 0.25 || reinvestmentRate > 0.5) {
    throw new RangeError("Reinvestment must remain inside the protected 25–50% band.");
  }
  const collectedRevenueUsd = sumMoney(
    entries,
    (entry) => entry.kind === "revenue" && entry.source === "customer" && entry.realized,
  );
  const deductible = new Set<LedgerEntry["kind"]>([
    "fulfillment_cost",
    "platform_fee",
    "required_liability",
    "core_operation",
    "reserve",
  ]);
  const trueCostsAndReservesUsd = sumMoney(
    entries,
    (entry) => entry.realized && deductible.has(entry.kind),
  );
  const realizedDistributableProfitUsd = money(Math.max(0, collectedRevenueUsd - trueCostsAndReservesUsd));
  const distributableCents = Math.round(realizedDistributableProfitUsd * 100);
  // Clamp whole-cent allocation to the protected global band. A lone cent
  // cannot be split inside both limits, so it remains an unspendable carry
  // until cumulative realized profit makes a compliant split possible.
  const minimumReinvestmentCents = Math.ceil(distributableCents * 0.25);
  const maximumReinvestmentCents = Math.floor(distributableCents * 0.5);
  const allocationPossible = minimumReinvestmentCents <= maximumReinvestmentCents;
  const requestedReinvestmentCents = Math.round(distributableCents * reinvestmentRate);
  const reinvestmentCents = allocationPossible
    ? Math.min(maximumReinvestmentCents, Math.max(minimumReinvestmentCents, requestedReinvestmentCents))
    : 0;
  const allocationRoundingCarryCents = allocationPossible ? 0 : distributableCents;
  const ownerDistributionCents = distributableCents - reinvestmentCents - allocationRoundingCarryCents;
  const reinvestmentUsd = reinvestmentCents / 100;
  const ownerDistributionUsd = ownerDistributionCents / 100;
  const allocationRoundingCarryUsd = allocationRoundingCarryCents / 100;
  return {
    collectedRevenueUsd,
    trueCostsAndReservesUsd,
    realizedDistributableProfitUsd,
    reinvestmentUsd,
    ownerDistributionUsd,
    allocationRoundingCarryUsd,
    reinvestmentRate,
  };
}
