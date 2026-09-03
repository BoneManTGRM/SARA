import { canonicalJson, sha256 } from "./canonical.ts";
import type { MemoryRecord } from "./types.ts";

export const REPARODYNAMICS_SOURCE = "sara://reparodynamics/v1";
export const REPARODYNAMICS_VERSION = 1;

type Seed = Pick<MemoryRecord, "category" | "statement" | "tags">;

const DOCTRINE: readonly Seed[] = [
  {
    category: "procedural",
    statement: "Reparodynamics is the disciplined improvement cycle: test a bounded target, detect constraint failures, make the smallest safe repair, verify independently, select by evidence, and retain only demonstrated improvements.",
    tags: ["reparodynamics", "tgrm", "verification", "anchor"],
  },
  {
    category: "strategic",
    statement: "Repair Yield per Energy compares verified constraint improvement with total bounded cost; a high score never grants authority or permits weaker safety, truth, privacy, or owner control.",
    tags: ["reparodynamics", "rye", "cost", "authority"],
  },
  {
    category: "failure",
    statement: "A failure becomes reusable learning only when its scope, immutable evidence, confidence, timestamp, and invalidation or revalidation condition are preserved.",
    tags: ["reparodynamics", "failure", "evidence", "provenance"],
  },
  {
    category: "evolutionary",
    statement: "One successful case is local evidence, not a universal rule; broaden a lesson only after independent recurrence without material contradiction.",
    tags: ["reparodynamics", "promotion", "recurrence", "scope"],
  },
  {
    category: "failure",
    statement: "Reparodynamic debt rises when the same failure recurs without a stronger detector, repair, or memory: the second occurrence escalates and the third indicates a learning-system defect.",
    tags: ["reparodynamics", "debt", "recurrence", "anchor"],
  },
  {
    category: "constitutional",
    statement: "A model must never verify its own claim of success; use an independent verifier or deterministic gate, and preserve disagreement or uncertainty rather than laundering it into memory.",
    tags: ["reparodynamics", "independence", "verification", "anchor"],
  },
];

export const REPARODYNAMICS_MEMORY_SEEDS: readonly MemoryRecord[] = Object.freeze(
  DOCTRINE.map((seed, index) => Object.freeze({
    id: `reparodynamics-v1-${String(index + 1).padStart(2, "0")}`,
    category: seed.category,
    statement: seed.statement,
    source: REPARODYNAMICS_SOURCE,
    observedAt: "2026-09-03T00:00:00.000Z",
    confidence: 1,
    verification: "measured" as const,
    scope: "global",
    dependencies: [],
    lastValidatedAt: "2026-09-03T00:00:00.000Z",
    importance: seed.tags?.includes("anchor") ? 5 as const : 4 as const,
    tags: Object.freeze([...(seed.tags ?? [])]) as unknown as string[],
    status: "active" as const,
    supersedes: [],
  })),
);

export const REPARODYNAMICS_DOCTRINE_DIGEST = sha256(canonicalJson({
  version: REPARODYNAMICS_VERSION,
  source: REPARODYNAMICS_SOURCE,
  memories: REPARODYNAMICS_MEMORY_SEEDS,
}));

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export type VerifiedLearningOutcome = {
  serviceId: string;
  cycleId: string;
  outcome: "verified_success" | "verified_failure";
  stage: "independent_verification" | "deterministic_compilation" | "model_execution" | "artifact_persistence";
  evidenceDigests: string[];
  verificationBasis: "independent_verifier" | "deterministic_gate" | "independent_verifier_and_deterministic_gate";
  costUsd: number;
  observedAt: string;
};

export function compileVerifiedLearningMemory(input: VerifiedLearningOutcome): Omit<MemoryRecord, "id"> {
  if (!SAFE_ID.test(input.serviceId)) throw new Error("Learning service id must be a safe identifier.");
  if (!SAFE_ID.test(input.cycleId)) throw new Error("Learning cycle id must be a safe identifier.");
  if (input.evidenceDigests.length < 1 || input.evidenceDigests.some((digest) => !SHA256_HEX.test(digest) || /^0{64}$/.test(digest))) {
    throw new Error("Verified learning requires one or more non-zero SHA-256 evidence digests.");
  }
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0 || input.costUsd > 3) {
    throw new RangeError("Learning cost must be within the paid job's $3 execution ceiling.");
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("Learning observation time must be a valid ISO timestamp.");
  if (input.outcome === "verified_success" && input.verificationBasis !== "independent_verifier_and_deterministic_gate") {
    throw new Error("A successful revenue lesson requires both independent verification and a deterministic gate.");
  }
  const evidence = [...new Set(input.evidenceDigests.map((digest) => digest.toLowerCase()))].sort();
  const result = input.outcome === "verified_success"
    ? "passed independent verification and deterministic compilation"
    : `failed at the measured ${input.stage.replaceAll("_", " ")} boundary`;
  return {
    category: input.outcome === "verified_success" ? "repair" : "failure",
    statement: `A ${input.serviceId} cycle ${result}. Treat this as scoped outcome evidence, not a universal rule; compare future cycles before promotion.`,
    source: `sara://learning/${input.serviceId}/${sha256(input.cycleId).slice(0, 24)}`,
    observedAt: input.observedAt,
    confidence: 1,
    verification: "measured",
    scope: `service.${input.serviceId}`,
    dependencies: evidence,
    lastValidatedAt: input.observedAt,
    revalidateAfter: new Date(Date.parse(input.observedAt) + 180 * 24 * 60 * 60 * 1_000).toISOString(),
    importance: input.outcome === "verified_success" ? 3 : 4,
    tags: ["reparodynamics", "verified-outcome", input.outcome, input.stage, input.verificationBasis],
    status: "active",
    supersedes: [],
  };
}
