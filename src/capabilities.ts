import { randomUUID } from "node:crypto";
import type { Capability, WorkCard } from "./types.ts";

export function compileWorkCard(input: {
  objective: string;
  expectedOwnerValue: number;
  requiredCapabilities: string[];
  acceptanceCriteria: string[];
  maximumBudgetUsd: number;
  availableCapabilities: Capability[];
  prohibitedActions: WorkCard["prohibitedActions"];
  now?: Date;
}): WorkCard {
  if (!input.objective.trim()) throw new Error("A self-development objective is required.");
  if (!Number.isFinite(input.expectedOwnerValue) || input.expectedOwnerValue < 0) {
    throw new RangeError("Expected owner value must be finite and non-negative.");
  }
  if (!Number.isFinite(input.maximumBudgetUsd) || input.maximumBudgetUsd < 0) {
    throw new RangeError("Maximum budget must be finite and non-negative.");
  }
  if (input.acceptanceCriteria.length === 0 || input.acceptanceCriteria.some((criterion) => !criterion.trim())) {
    throw new Error("At least one falsifiable acceptance criterion is required.");
  }
  const available = new Set(
    input.availableCapabilities.filter((capability) => capability.status === "available").map((capability) => capability.id),
  );
  const requiredCapabilities = [...new Set(input.requiredCapabilities.map((id) => id.trim()).filter(Boolean))];
  return {
    id: randomUUID(),
    objective: input.objective.trim(),
    expectedOwnerValue: input.expectedOwnerValue,
    requiredCapabilities,
    missingCapabilities: requiredCapabilities.filter((id) => !available.has(id)),
    acceptanceCriteria: input.acceptanceCriteria.map((criterion) => criterion.trim()),
    maximumBudgetUsd: input.maximumBudgetUsd,
    prohibitedActions: [...input.prohibitedActions],
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}
