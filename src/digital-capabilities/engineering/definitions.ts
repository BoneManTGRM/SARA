import type { CapabilityDefinition } from "../types.ts";
import { engineeringSchemas } from "./contracts.ts";
import { engineeringCases } from "./qualification.ts";
import { analyzeRootCause, planReproduction, triageCi, triageIncident } from "./diagnostics.ts";
import { analyzeImpact, coordinateRepositories, detectDrift, mapRegressions, mapTestGaps, reviewMigration, reviewPrRisk, triageDependency } from "./impact.ts";
import { detectStaleEvidence, gateRelease, planRollback, selectMinimalFix, validateProductionProof } from "./gates.ts";
const implementations: Record<string, { description: string; execute: CapabilityDefinition["execute"]; draft?: boolean }> = {
  "ci-failure-triage": { description: "Triage bounded supplied CI steps from the earliest diagnostic evidence, with explicit hypotheses and conditional retry classification.", execute: triageCi },
  "incident-log-triage": { description: "Normalize explicit-timezone events, group correlation evidence and distinguish primary failure hypotheses from downstream cascades.", execute: triageIncident },
  "bug-reproduction-planner": { description: "Draft an isolated minimal reproduction and identify missing behavior or environment facts without mutating production.", execute: planReproduction, draft: true },
  "root-cause-analyzer": { description: "Separate supplied symptoms, triggers, defects and cascades, retaining competing hypotheses and counterexamples without inventing causal proof.", execute: analyzeRootCause },
  "repository-change-impact-analyzer": { description: "Traverse a supplied dependency graph backwards from exact changed paths to affected callers and systems.", execute: analyzeImpact },
  "regression-surface-mapper": { description: "Map previously functioning behaviors to the transitive dependency surface of a proposed change.", execute: mapRegressions },
  "test-gap-mapper": { description: "Compare required behavior/test classes with supplied exact-revision test mappings, retaining stale and missing coverage.", execute: mapTestGaps },
  "pull-request-risk-review": { description: "Screen supplied diffs for material operational risk and required verification; screening is not a complete security review or proof of behavior.", execute: reviewPrRisk },
  "dependency-change-risk-triage": { description: "Distinguish dependency scope and exact-version major changes; require independent evidence before establishing an advisory.", execute: triageDependency },
  "configuration-drift-detector": { description: "Compare safe presence, fingerprint and version metadata without accepting or exposing configuration secret values.", execute: detectDrift },
  "database-migration-risk-review": { description: "Review supplied migration operations for destructive, compatibility, lock, backfill and recovery hazards without executing SQL.", execute: reviewMigration },
  "cross-repository-change-coordinator": { description: "Draft exact-revision dependency-ordered rollout and reverse rollback with cycle and compatibility gates; never modify any repository.", execute: coordinateRepositories, draft: true },
  "minimal-fix-selector": { description: "Rank supplied repair candidates by root-cause and acceptance coverage before risk and change size; selection is not verified repair.", execute: selectMinimalFix },
  "release-readiness-gate": { description: "Fail closed unless all required release categories, exact-subject proofs and artifact integrity pass; readiness never authorizes deployment.", execute: gateRelease },
  "production-proof-validator": { description: "Require authentic production provenance, an exact deployment identity and the claimed behavior; reject deployment-status-only evidence.", execute: validateProductionProof },
  "stale-evidence-detector": { description: "Reuse PR166 minimum-identity invalidation for trusted evidence references, without expiring unrelated or immutable historical facts.", execute: detectStaleEvidence },
  "rollback-plan-generator": { description: "Prepare exact-revision rollback prerequisites and steps, distinguishing a plan from matching isolated recovery proof.", execute: planRollback, draft: true },
};
export const engineeringDefinitions: readonly CapabilityDefinition[] = Object.entries(implementations).map(([id, entry]) => ({
  id, version: "1.0.0", description: entry.description,
  inputSchema: engineeringSchemas[id]!.input, outputSchema: engineeringSchemas[id]!.output,
  effect: entry.draft ? "DRAFT_ONLY" : "PURE", authorityClass: entry.draft ? "DRAFT_ONLY" : "READ_ONLY",
  resources: ["supplied-input", "actor-visible-kernel-evidence-receipts"],
  sourceFiles: ["engineering/common.ts", "engineering/contracts.ts", "engineering/definitions.ts", "engineering/diagnostics.ts", "engineering/impact.ts", "engineering/gates.ts", "engineering/qualification.ts"],
  qualificationRequirements: ["frozen-contract", "malformed-input", "negative-and-boundary-cases", "no-external-effect", "evidence-provenance", "determinism", "kernel-replay-and-recovery"],
  execute: entry.execute, cases: engineeringCases[id]!,
}));
