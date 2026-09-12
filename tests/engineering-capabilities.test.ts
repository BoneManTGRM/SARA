import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { capabilityDefinition } from "../src/digital-capabilities/registry.ts";
import type { Json } from "../src/digital-capabilities/schema.ts";

const revision = "a".repeat(40);
const previousRevision = "b".repeat(40);
const object = (v: Json): Record<string, Json> => {
  assert.ok(v !== null && typeof v === "object" && !Array.isArray(v)); return v;
};
const graph = {
  nodes: [{ id: "api", path: "src/api.ts", kind: "API" }, { id: "auth", path: "src/auth.ts", kind: "AUTHORIZATION" },
    { id: "test", path: "tests/api.test.ts", kind: "TEST" }, { id: "doc", path: "docs/a.md", kind: "DOCUMENTATION" }],
  edges: [{ from: "api", to: "auth", relation: "CALLS" }, { from: "test", to: "api", relation: "COVERS" }],
};
const scenarios: { id: string; input: Json; check: (out: Record<string, Json>) => void }[] = [
  { id: "ci-failure-triage", input: { revision, changedFiles: ["package-lock.json"], steps: [
    { id: "install", status: "FAILED", logs: "npm ERR! code ERESOLVE\nCould not resolve dependency\nProcess completed with exit code 1" },
    { id: "test", status: "SKIPPED", logs: "Tests not run" },
  ] }, check: o => { assert.equal(o.category, "DEPENDENCY"); assert.equal(object(o.primary!).stepId, "install"); assert.equal(object(o.retry!).worthwhile, false); } },
  { id: "pull-request-risk-review", input: { revision, changes: [{ path: "src/auth.ts", diff: "- requireOwner(req);\n+ return true;", declaredAreas: ["AUTHORIZATION"] }] },
    check: o => { assert.equal(o.behaviorProven, false); assert.ok((o.requiredVerification as string[]).includes("authorization-denial")); } },
  { id: "test-gap-mapper", input: { revision, behaviors: [{ id: "write", requiredKinds: ["POSITIVE", "AUTHORIZATION", "RESTART"] }],
    tests: [{ id: "happy", behaviorId: "write", kind: "POSITIVE", revision, status: "PASSED" }, { id: "old", behaviorId: "write", kind: "RESTART", revision: previousRevision, status: "PASSED" }] },
    check: o => { assert.deepEqual(object((o.gaps as Json[])[0]!).missingKinds, ["AUTHORIZATION", "RESTART"]); assert.deepEqual(o.staleTests, ["old"]); } },
  { id: "release-readiness-gate", input: { revision, blockers: ["owner-review-missing"], requirements: [], proofIds: [], artifacts: [] },
    check: o => { assert.equal(o.status, "BLOCKED"); assert.equal(o.deploymentAuthorized, false); } },
  { id: "incident-log-triage", input: { events: [
    { id: "cascade", at: "2026-09-12T05:00:02Z", source: "api", level: "ERROR", correlationId: "one", message: "upstream dependency failed" },
    { id: "root", at: "2026-09-12T00:00:01-05:00", source: "database", level: "ERROR", correlationId: "one", message: "ECONNREFUSED" },
  ] }, check: o => { assert.equal(o.primaryEventId, "root"); assert.equal(object((o.chronology as Json[])[0]!).normalizedAt, "2026-09-12T05:00:01.000Z"); } },
  { id: "repository-change-impact-analyzer", input: { changedFiles: ["src/auth.ts"], graph },
    check: o => { assert.deepEqual((o.impacted as Json[]).map(x => object(x).id), ["auth", "api", "test"]); assert.equal(o.completeGraphKnown, false); } },
  { id: "dependency-change-risk-triage", input: { revision, changes: [{ name: "example", fromVersion: "1.9.0", toVersion: "2.0.0", direct: true, scope: "RUNTIME", runtimeCompatibility: "UNKNOWN" }], audit: [] },
    check: o => { assert.equal(object((o.dependencies as Json[])[0]!).majorChange, true); assert.deepEqual(o.reportedAdvisories, []); assert.equal(o.vulnerabilityEstablished, false); } },
  { id: "bug-reproduction-planner", input: { report: "Report button returns a blank file", expected: "Nonempty approved report", observed: "zero-byte file", steps: ["Open review", "Press report"], target: "PRODUCTION", environment: "Chromium" },
    check: o => { assert.equal(o.executionAllowed, false); assert.equal(o.reproductionTarget, "ISOLATED_COPY"); } },
  { id: "root-cause-analyzer", input: { symptom: "Export failed", observations: [
    { id: "trigger", role: "TRIGGER", statement: "Clicked report", evidenceRefs: [] }, { id: "missing", role: "DEFECT", statement: "Missing authorization guard", evidenceRefs: [] }],
    hypotheses: [{ id: "h1", cause: "Wrong report identity", supporting: ["missing"], contradicting: [] }] },
    check: o => { assert.equal(o.rootCauseEstablished, false); assert.equal(object((o.hypotheses as Json[])[0]!).id, "h1"); } },
  { id: "minimal-fix-selector", input: { requiredCriteria: ["bind-revision", "deny-stale"], candidates: [
    { id: "tiny-but-wrong", paths: ["src/api.ts"], addressesRootCause: false, criteria: ["bind-revision"], risk: "LOW", estimatedCashMicroUsd: 0 },
    { id: "correct", paths: ["src/api.ts", "tests/a.test.ts"], addressesRootCause: true, criteria: ["bind-revision", "deny-stale"], risk: "LOW", estimatedCashMicroUsd: 0 }] },
    check: o => { assert.equal(o.selectedId, "correct"); assert.equal(o.verifiedFix, false); } },
  { id: "regression-surface-mapper", input: { changedFiles: ["src/auth.ts"], graph, behaviors: [{ id: "approved-export", nodeId: "api", description: "Export exact approved revision" }, { id: "read-doc", nodeId: "doc", description: "Read documentation" }] },
    check: o => { assert.deepEqual((o.behaviorsAtRisk as Json[]).map(x => object(x).id), ["approved-export"]); } },
  { id: "configuration-drift-detector", input: { intended: [{ name: "OWNER_TOKEN", present: true, fingerprint: "a".repeat(64), version: null, secret: true }],
    observed: [{ name: "OWNER_TOKEN", present: true, fingerprint: "b".repeat(64), version: null, secret: true }] },
    check: o => { assert.equal(object((o.differences as Json[])[0]!).kind, "FINGERPRINT_MISMATCH"); assert.equal(o.secretValuesExposed, false); } },
  { id: "database-migration-risk-review", input: { operations: [{ id: "drop", kind: "DROP_TABLE", statement: "DROP TABLE reports", reversible: false, compatibleReaders: false, compatibleWriters: false, concurrent: null }], backupProofId: null, rollbackProofId: null },
    check: o => { assert.equal(o.status, "BLOCKED"); assert.equal(o.executionAuthorized, false); assert.ok((o.risks as Json[]).some(x => object(x).category === "DESTRUCTIVE")); } },
  { id: "rollback-plan-generator", input: { revision, previousRevision, target: "service:fixture", dataChanged: true, backupId: null, proofIds: [] },
    check: o => { assert.equal(o.status, "INCOMPLETE_EVIDENCE"); assert.equal(o.rollbackVerified, false); assert.ok((o.prerequisites as string[]).includes("verified-pre-migration-backup")); } },
  { id: "production-proof-validator", input: { deploymentSha: revision, deploymentId: "deployment-fixture", behavior: "approved-report-visible", proofIds: [] },
    check: o => { assert.equal(o.status, "INCOMPLETE_EVIDENCE"); assert.equal(o.productionBehaviorProven, false); } },
  { id: "stale-evidence-detector", input: { currentIdentity: [{ key: "sourceRevision", value: revision }], proofIds: ["unavailable-proof"] },
    check: o => { assert.equal(o.status, "INCOMPLETE_EVIDENCE"); assert.equal(object((o.evidence as Json[])[0]!).status, "MISSING"); } },
  { id: "cross-repository-change-coordinator", input: { repositories: [{ id: "provider", revision }, { id: "consumer", revision: previousRevision }],
    dependencies: [{ consumer: "consumer", provider: "provider", contractId: "report-v2", compatible: true }] },
    check: o => { assert.deepEqual(o.rolloutOrder, ["provider", "consumer"]); assert.deepEqual(o.rollbackOrder, ["consumer", "provider"]); assert.equal(o.externalMutations, 0); } },
];
for (const scenario of scenarios) test(`engineering contract: ${scenario.id} produces bounded meaningful analysis`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-engineering-test-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256("synthetic-owner") });
    const result = await kernel.invokeCapability(SARA_PRINCIPAL, { requestId: "first", capabilityId: scenario.id, input: scenario.input });
    assert.notEqual(object(result.output).code, "UNREGISTERED_CAPABILITY", `${scenario.id} must have an executable implementation`);
    assert.ok(["SUCCEEDED", "BLOCKED", "INCOMPLETE_EVIDENCE"].includes(result.status), JSON.stringify(result));
    scenario.check(object(result.output));
    assert.equal(result.authority.authorizationTokenIssued, false);
    assert.equal(result.cost.modelApiMicroUsd, 0);
    assert.equal(result.cost.actualCashMicroUsd, 0);
    assert.match(result.resultDigest, /^[a-f0-9]{64}$/u);
    assert.ok(capabilityDefinition(scenario.id));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
