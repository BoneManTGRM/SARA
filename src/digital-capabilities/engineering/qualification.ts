import type { Json } from "../schema.ts";
import type { FrozenCase } from "../types.ts";
const sha = "a".repeat(40), prior = "b".repeat(40);
const emptyGraph = { nodes: [], edges: [] };
const output = (r: { output: Json }) => r.output as Record<string, Json>;
/** Frozen public smoke predicates; adversarial and cross-stage acceptance cases live in tests, not generation context. */
export const engineeringCases: Record<string, FrozenCase[]> = {
  "ci-failure-triage": [
    { name: "dependency-before-exit-cascade", input: { revision: sha, changedFiles: [], steps: [{ id: "install", status: "FAILED", logs: "ERESOLVE\nProcess completed with exit code 1" }] }, check: r => output(r).category === "DEPENDENCY" },
    { name: "no-failed-step-is-unknown", input: { revision: sha, changedFiles: [], steps: [] }, check: r => output(r).category === "UNKNOWN" },
    { name: "denial-is-not-retryable", input: { revision: sha, changedFiles: [], steps: [{ id: "private", status: "FAILED", logs: "HTTP 403 forbidden" }] }, check: r => (output(r).retry as Record<string, Json>).worthwhile === false },
  ],
  "incident-log-triage": [
    { name: "unknown-time-is-not-normalized", input: { events: [{ id: "one", at: "2026-09-12T01:00:00", source: "api", level: "ERROR", correlationId: null, message: "ECONNRESET" }] }, check: r => ((output(r).chronology as Json[])[0] as Record<string, Json>).normalizedAt === null },
    { name: "empty-is-not-an-incident", input: { events: [] }, check: r => output(r).primaryEventId === null },
  ],
  "bug-reproduction-planner": [
    { name: "production-reproduction-is-isolated", input: { report: "Blank report", expected: "nonempty", observed: "empty", steps: ["Press report"], target: "PRODUCTION", environment: "test browser" }, check: r => output(r).reproductionTarget === "ISOLATED_COPY" && output(r).executionAllowed === false },
    { name: "missing-facts-remain-missing", input: { report: "Something failed", expected: "", observed: "", steps: [], target: "LOCAL", environment: "" }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
  ],
  "root-cause-analyzer": [
    { name: "no-evidence-no-root-cause", input: { symptom: "Failed report", observations: [], hypotheses: [] }, check: r => output(r).rootCauseEstablished === false },
    { name: "counterexample-remains-visible", input: { symptom: "Failed report", observations: [{ id: "counter", role: "COUNTEREXAMPLE", statement: "A valid report also failed", evidenceRefs: [] }], hypotheses: [{ id: "h1", cause: "Only invalid reports fail", supporting: [], contradicting: ["counter"] }] }, check: r => ((output(r).hypotheses as Json[])[0] as Record<string, Json>).conclusion === "CONTESTED" },
  ],
  "repository-change-impact-analyzer": [
    { name: "unmapped-path-is-unknown", input: { changedFiles: ["unknown.ts"], graph: emptyGraph }, check: r => (output(r).unknownPaths as Json[]).includes("unknown.ts") },
    { name: "no-changes-no-invented-impact", input: { changedFiles: [], graph: emptyGraph }, check: r => (output(r).impacted as Json[]).length === 0 },
  ],
  "regression-surface-mapper": [
    { name: "empty-surface-is-not-proven-safe", input: { changedFiles: [], graph: emptyGraph, behaviors: [] }, check: r => output(r).regressionProven === false },
    { name: "unknown-file-remains-visible", input: { changedFiles: ["unmapped.ts"], graph: emptyGraph, behaviors: [] }, check: r => (output(r).unknownPaths as Json[]).includes("unmapped.ts") },
  ],
  "test-gap-mapper": [
    { name: "required-denial-test-is-a-gap", input: { revision: sha, behaviors: [{ id: "auth", requiredKinds: ["AUTHORIZATION"] }], tests: [] }, check: r => (output(r).gaps as Json[]).length === 1 },
    { name: "no-behavior-is-incomplete", input: { revision: sha, behaviors: [], tests: [] }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
  ],
  "pull-request-risk-review": [
    { name: "authorization-change-needs-negative-test", input: { revision: sha, changes: [{ path: "src/authorization.ts", diff: "- requireOwner(req)", declaredAreas: [] }] }, check: r => (output(r).requiredVerification as Json[]).includes("authorization-denial") },
    { name: "empty-diff-not-proof", input: { revision: sha, changes: [] }, check: r => output(r).behaviorProven === false },
  ],
  "dependency-change-risk-triage": [
    { name: "runtime-incompatible-blocks", input: { revision: sha, changes: [{ name: "fixture", fromVersion: "1.0.0", toVersion: "2.0.0", direct: true, scope: "RUNTIME", runtimeCompatibility: "INCOMPATIBLE" }], audit: [] }, check: r => output(r).status === "BLOCKED" && output(r).vulnerabilityEstablished === false },
    { name: "unknown-range-not-semver-exact", input: { revision: sha, changes: [{ name: "fixture", fromVersion: "^1.0", toVersion: "git:unknown", direct: false, scope: "DEV", runtimeCompatibility: "UNKNOWN" }], audit: [] }, check: r => ((output(r).dependencies as Json[])[0] as Record<string, Json>).majorChange === null },
  ],
  "configuration-drift-detector": [
    { name: "missing-observation-is-not-match", input: { intended: [{ name: "TOKEN", present: true, fingerprint: null, version: null, secret: true }], observed: [] }, check: r => output(r).status === "DRIFT_DETECTED" && output(r).secretValuesExposed === false },
    { name: "empty-config-is-incomplete", input: { intended: [], observed: [] }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
  ],
  "database-migration-risk-review": [
    { name: "destructive-declared-addition-is-still-flagged", input: { operations: [{ id: "drop", kind: "ADD_COLUMN", statement: "DROP TABLE audit", reversible: false, compatibleReaders: false, compatibleWriters: false, concurrent: false }], backupProofId: null, rollbackProofId: null }, check: r => output(r).status === "BLOCKED" && output(r).executionAuthorized === false },
    { name: "no-migration-proof-is-incomplete", input: { operations: [], backupProofId: null, rollbackProofId: null }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
  ],
  "cross-repository-change-coordinator": [
    { name: "cyclic-rollout-blocks", input: { repositories: [{ id: "one", revision: sha }, { id: "two", revision: prior }], dependencies: [{ consumer: "one", provider: "two", contractId: "a", compatible: true }, { consumer: "two", provider: "one", contractId: "b", compatible: true }] }, check: r => output(r).status === "BLOCKED" && (output(r).rolloutOrder as Json[]).length === 0 },
    { name: "single-repository-plan-does-not-mutate", input: { repositories: [{ id: "one", revision: sha }], dependencies: [] }, check: r => output(r).externalMutations === 0 && (output(r).rolloutOrder as Json[])[0] === "one" },
  ],
  "minimal-fix-selector": [
    { name: "small-wrong-fix-is-rejected", input: { requiredCriteria: ["root"], candidates: [{ id: "wrong", paths: ["one.ts"], addressesRootCause: false, criteria: ["root"], risk: "LOW", estimatedCashMicroUsd: 0 }] }, check: r => output(r).selectedId === null },
    { name: "declared-complete-fix-is-only-candidate", input: { requiredCriteria: ["root"], candidates: [{ id: "candidate", paths: ["one.ts"], addressesRootCause: true, criteria: ["root"], risk: "LOW", estimatedCashMicroUsd: 0 }] }, check: r => output(r).selectedId === "candidate" && output(r).verifiedFix === false },
  ],
  "release-readiness-gate": [
    { name: "missing-release-proof-cannot-be-ready", input: { revision: sha, blockers: [], requirements: [], proofIds: [], artifacts: [] }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
    { name: "explicit-blocker-wins", input: { revision: sha, blockers: ["security-failure"], requirements: [], proofIds: [], artifacts: [] }, check: r => output(r).status === "BLOCKED" },
  ],
  "production-proof-validator": [
    { name: "deployment-identity-is-not-behavior-proof", input: { deploymentSha: sha, deploymentId: "fixture-deploy", behavior: "report-visible", proofIds: [] }, check: r => output(r).productionBehaviorProven === false },
    { name: "unknown-proof-is-not-accepted", input: { deploymentSha: sha, deploymentId: "fixture-deploy", behavior: "report-visible", proofIds: ["invented"] }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
  ],
  "stale-evidence-detector": [
    { name: "no-proof-is-incomplete", input: { currentIdentity: [], proofIds: [] }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" },
    { name: "unknown-id-not-reusable", input: { currentIdentity: [{ key: "sourceRevision", value: sha }], proofIds: ["unknown"] }, check: r => (output(r).reusableIds as Json[]).length === 0 },
  ],
  "rollback-plan-generator": [
    { name: "data-change-requires-proven-backup", input: { revision: sha, previousRevision: prior, target: "service:fixture", dataChanged: true, backupId: null, proofIds: [] }, check: r => (output(r).prerequisites as Json[]).includes("verified-pre-migration-backup") && output(r).rollbackVerified === false },
    { name: "plan-is-not-rollback-proof", input: { revision: sha, previousRevision: prior, target: "service:fixture", dataChanged: false, backupId: null, proofIds: [] }, check: r => output(r).status === "INCOMPLETE_EVIDENCE" && output(r).executionAuthorized === false },
  ],
};
