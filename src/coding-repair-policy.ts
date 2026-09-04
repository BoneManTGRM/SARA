import type { CodingFailureSignal, CodingRepairDecision, CodingRepairLimits } from "./coding-repair-types.ts";

export const INITIAL_CODING_REPAIR_LIMITS: CodingRepairLimits = Object.freeze({
  maximumCycles: 3,
  surgicalFiles: 2,
  surgicalChangedLines: 80,
  deepFiles: 6,
  deepChangedLines: 240,
  maximumModelSpendUsd: 0.15,
  protectedPaths: ["constitution/", ".github/", "tests/", "src/policy.ts", "src/kernel.ts", "src/store.ts"],
});

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function chooseCodingRepairStrategy(input: {
  failures: CodingFailureSignal[];
  cycle: number;
  spentUsd: number;
  recurrence: number;
  limits?: CodingRepairLimits;
}): CodingRepairDecision {
  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;
  const remainingCycles = Math.max(0, limits.maximumCycles - input.cycle);
  const remainingCostUsd = Math.max(0, limits.maximumModelSpendUsd - input.spentUsd);
  const files = new Set(input.failures.map((failure) => failure.file).filter(Boolean));
  const critical = input.failures.some((failure) => failure.severity === "critical" || failure.kind === "security");
  const protectedFailure = [...files].some((path) => limits.protectedPaths.some((prefix) => path === prefix || path.startsWith(prefix)));
  const locality = bounded(input.failures.length ? 1 / Math.max(input.failures.length, files.size || 1) : 1);
  const risk = bounded((critical ? 0.6 : 0) + (protectedFailure ? 0.6 : 0) + (files.size > 2 ? 0.25 : 0));

  if (!input.failures.length) return { strategy: "stop", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "clean" };
  if (!remainingCycles) return { strategy: "stop", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "cycle_limit" };
  if (remainingCostUsd <= 0) return { strategy: "stop", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "cost_limit" };
  if (protectedFailure || critical) return { strategy: "stop", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "protected_or_critical" };
  if (input.recurrence >= 3) return { strategy: "stop", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "reparodynamic_debt" };
  if (input.recurrence >= 2 || files.size > limits.surgicalFiles || locality < 0.4) {
    return { strategy: "luna_deep", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "local_repair_exhausted" };
  }
  return { strategy: "luna_surgical", locality, risk, remainingCycles, remainingCostUsd, reasonCode: "localized_failure" };
}

export function repairYieldPerEnergy(input: {
  verificationGain: number;
  costUsd: number;
  changedLines: number;
  verificationMilliseconds: number;
}): number {
  const energy = Math.max(0.000001, input.costUsd + input.changedLines / 10_000 + input.verificationMilliseconds / 10_000_000);
  return Math.max(0, input.verificationGain) / energy;
}
