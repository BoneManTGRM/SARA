import { arraySchema as a, enumSchema as e, idSchema as id, integerSchema as integer, objectSchema as o, textSchema as t, type Schema } from "../schema.ts";
import { bool, fileSchema, graphSchema, identitySchema, idsSchema, nullable as n, provenanceSchema, shaSchema, statusSchema, stringListSchema as texts } from "./common.ts";
const testKind = e("POSITIVE", "NEGATIVE", "STATEFUL", "RESTART", "FAILURE", "AUTHORIZATION", "INTEGRATION", "PRODUCTION", "CONCURRENCY", "MALFORMED");
const risk = e("LOW", "MEDIUM", "HIGH");
const diagnosticCategory = e("UNKNOWN", "AUTHORIZATION", "BUDGET", "RATE_LIMIT", "DEPENDENCY", "CONFIGURATION", "CODE", "TEST", "SECURITY", "ENVIRONMENT", "UPSTREAM", "TIMEOUT");
const logRef = { stepId: id, lineIndex: integer(1), contentDigest: { ...t(64, 64), pattern: "^[a-f0-9]{64}$" } };
const evidenceInspection = a(o({ id: t(256), status: e("VALID", "STALE", "MISSING", "INCOMPLETE_EVIDENCE"), reasons: texts }), 512);
const impacted = a(o({ id, path: fileSchema, kind: t(128), distance: integer() }), 512);
const config = a(o({ name: id, present: bool, fingerprint: n({ ...t(64, 64), pattern: "^[a-f0-9]{64}$" }), version: n(t(128)), secret: bool }), 256);
export const engineeringSchemas: Record<string, { input: Schema; output: Schema }> = {
  "ci-failure-triage": {
    input: o({ revision: shaSchema, changedFiles: a(fileSchema, 512), steps: a(o({ id, status: e("PASSED", "FAILED", "SKIPPED", "TIMED_OUT", "RUNNING"), logs: t(65536, 0) }), 128) }),
    output: o({ revision: shaSchema, category: diagnosticCategory, primary: n(o({ ...logRef, signature: id })),
      hypotheses: a(o({ category: diagnosticCategory, code: id, evidence: o(logRef), confidence: e("UNASSESSED") }), 12),
      affectedSubsystem: diagnosticCategory, diagnosis: e("HYPOTHESIS_NOT_CONFIRMED"), diagnostic: t(1024),
      retry: o({ worthwhile: bool, classification: e("AUTHORIZATION", "BUDGET", "RATE_LIMIT", "DETERMINISTIC", "SECURITY", "ENVIRONMENT", "LIKELY_TRANSIENT", "TIMEOUT", "UNKNOWN"), automaticRetryAuthorized: bool, requiresChangedEvidence: bool }),
      failedStepIds: idsSchema, skippedStepIds: idsSchema, changedFiles: a(fileSchema, 512) }),
  },
  "incident-log-triage": {
    input: o({ events: a(o({ id, at: n(t(128)), source: id, level: e("INFO", "WARNING", "ERROR"), correlationId: n(id), message: t(16384, 0) }), 512) }),
    output: o({ chronology: a(o({ id, source: id, level: t(128), normalizedAt: n(t(128)), timestampKnown: bool, messageDigest: t(64) }), 512),
      groups: a(o({ key: t(256), eventIds: idsSchema, causalRelationshipProven: bool }), 512), primaryEventId: n(id), primaryFaultDomain: n(id),
      cascadeEventIds: idsSchema, hypothesis: t(128), diagnostic: t(1024), causalOrderEstablished: bool }),
  },
  "bug-reproduction-planner": {
    input: o({ report: t(8192), expected: t(4096, 0), observed: t(4096, 0), steps: a(t(4096), 100), target: e("LOCAL", "SANDBOX", "STAGING", "PRODUCTION"), environment: t(2048, 0) }),
    output: o({ status: statusSchema, reproductionTarget: e("LOCAL", "SANDBOX", "STAGING", "ISOLATED_COPY"), executionAllowed: bool,
      reportDigest: t(64), missing: texts, steps: a(o({ order: integer(1), action: t(2048) }), 104), acceptance: texts, productionMutationRequired: bool }),
  },
  "root-cause-analyzer": {
    input: o({ symptom: t(8192), observations: a(o({ id, role: e("SYMPTOM", "TRIGGER", "DEFECT", "CONDITION", "CASCADE", "COUNTEREXAMPLE"), statement: t(8192), evidenceRefs: idsSchema }), 256),
      hypotheses: a(o({ id, cause: t(8192), supporting: idsSchema, contradicting: idsSchema }), 64) }),
    output: o({ symptomDigest: t(64), rootCauseEstablished: bool, roles: a(o({ id, role: t(128), statementDigest: t(64), evidenceRefs: idsSchema }), 256),
      hypotheses: a(o({ id, causeDigest: t(64), supporting: idsSchema, contradicting: idsSchema, score: integer(-1024, 1024), conclusion: e("CONTESTED", "UNCONFIRMED") }), 64), nextDiagnostic: t(1024) }),
  },
  "repository-change-impact-analyzer": {
    input: o({ changedFiles: a(fileSchema, 512), graph: graphSchema }),
    output: o({ impacted, unknownPaths: a(fileSchema, 512), impactedKinds: texts, completeGraphKnown: bool, externalChangesAuthorized: bool }),
  },
  "regression-surface-mapper": {
    input: o({ changedFiles: a(fileSchema, 512), graph: graphSchema, behaviors: a(o({ id, nodeId: id, description: t(4096) }), 512) }),
    output: o({ behaviorsAtRisk: a(o({ id, nodeId: id, descriptionDigest: t(64), verification: e("REVERIFY_AFFECTED_BEHAVIOR") }), 512), unknownPaths: a(fileSchema, 512), graphBound: bool, regressionProven: bool }),
  },
  "test-gap-mapper": {
    input: o({ revision: shaSchema, behaviors: a(o({ id, requiredKinds: a(testKind, 10) }), 256), tests: a(o({ id, behaviorId: id, kind: testKind, revision: shaSchema, status: e("PASSED", "FAILED", "NOT_RUN") }), 512) }),
    output: o({ revision: shaSchema, gaps: a(o({ behaviorId: id, missingKinds: a(testKind, 10), suppliedPassingTestIds: idsSchema }), 256), staleTests: idsSchema,
      failedOrUnrunTests: idsSchema, observedCoverageVerified: bool, status: statusSchema }),
  },
  "pull-request-risk-review": {
    input: o({ revision: shaSchema, changes: a(o({ path: fileSchema, diff: t(65536, 0), declaredAreas: a(t(128), 32) }), 256) }),
    output: o({ revision: shaSchema, risks: a(o({ path: fileSchema, category: t(128), confidence: e("UNASSESSED"), findingType: e("REVIEW_REQUIRED"), diffDigest: t(64) }), 2000),
      requiredVerification: texts, risksTruncated: bool, behaviorProven: bool, mergeAuthorized: bool, status: e("REVIEW_REQUIRED", "INCOMPLETE_EVIDENCE") }),
  },
  "dependency-change-risk-triage": {
    input: o({ revision: shaSchema, changes: a(o({ name: t(256), fromVersion: t(256), toVersion: t(256), direct: bool, scope: e("RUNTIME", "BUILD", "DEV"), runtimeCompatibility: e("COMPATIBLE", "INCOMPATIBLE", "UNKNOWN") }), 256),
      audit: a(o({ id, package: t(256), version: t(256), evidenceId: t(256) }), 256) }),
    output: o({ revision: shaSchema, dependencies: a(o({ name: t(256), direct: bool, scope: t(128), majorChange: n(bool), runtimeCompatibilityReported: t(128), requiredVerification: texts, versionComparison: t(128) }), 256),
      reportedAdvisories: a(o({ id, package: t(256), version: t(256), evidenceId: t(256), independentlyVerified: bool }), 256), vulnerabilityEstablished: bool, status: e("BLOCKED", "INCOMPLETE_EVIDENCE", "REVIEW_REQUIRED") }),
  },
  "configuration-drift-detector": {
    input: o({ intended: config, observed: config }),
    output: o({ differences: a(o({ name: id, kind: e("UNEXPECTED_CONFIGURATION", "OBSERVATION_MISSING", "PRESENCE_MISMATCH", "FINGERPRINT_MISMATCH", "VERSION_MISMATCH"), secret: bool }), 1024),
      secretValuesExposed: bool, valuesRead: bool, status: e("DRIFT_DETECTED", "INCOMPLETE_EVIDENCE", "MATCHES_SUPPLIED_METADATA") }),
  },
  "database-migration-risk-review": {
    input: o({ operations: a(o({ id, kind: e("ADD_COLUMN", "DROP_COLUMN", "ALTER_TYPE", "BACKFILL", "CREATE_INDEX", "DROP_TABLE", "RENAME_COLUMN", "TRUNCATE", "RAW_SQL"), statement: t(16384, 0), reversible: n(bool), compatibleReaders: n(bool), compatibleWriters: n(bool), concurrent: n(bool) }), 256),
      backupProofId: n(t(256)), rollbackProofId: n(t(256)) }),
    output: o({ status: e("BLOCKED", "INCOMPLETE_EVIDENCE", "REVIEW_REQUIRED"), risks: a(o({ operationId: id, category: t(128), requiredVerification: t(1024) }), 2000),
      operationOrder: idsSchema, executionAuthorized: bool, rollbackVerified: bool }),
  },
  "cross-repository-change-coordinator": {
    input: o({ repositories: a(o({ id, revision: shaSchema }), 128), dependencies: a(o({ consumer: id, provider: id, contractId: id, compatible: n(bool) }), 512) }),
    output: o({ status: statusSchema, repositories: a(o({ id, revision: shaSchema }), 128), rolloutOrder: idsSchema, rollbackOrder: idsSchema,
      unresolvedDependencies: idsSchema, compatibilityWindows: a(o({ consumer: id, provider: id, contractId: id, compatibleReported: n(bool), requiredVerification: t(1024) }), 512), externalMutations: integer(0, 0) }),
  },
  "minimal-fix-selector": {
    input: o({ requiredCriteria: idsSchema, candidates: a(o({ id, paths: a(fileSchema, 512), addressesRootCause: n(bool), criteria: idsSchema, risk, estimatedCashMicroUsd: integer() }), 128) }),
    output: o({ status: statusSchema, selectedId: n(id), candidates: a(o({ id, missingCriteria: idsSchema, rootCauseAddressedReported: n(bool), risk, pathCount: integer(), estimatedCashMicroUsd: integer() }), 128),
      verifiedFix: bool, selectionBasis: t(2048) }),
  },
  "release-readiness-gate": {
    input: o({ revision: shaSchema, blockers: idsSchema, requirements: a(o({ id, category: e("CI", "SECURITY", "QUALIFICATION", "CONFIGURATION", "MIGRATION", "DEPLOYMENT", "ARTIFACT", "ROLLBACK"), provenance: provenanceSchema, claim: t(256) }), 128),
      proofIds: a(t(256), 64), artifacts: a(o({ id, expectedDigest: { ...t(64, 64), pattern: "^[a-f0-9]{64}$" }, observedDigest: n({ ...t(64, 64), pattern: "^[a-f0-9]{64}$" }) }), 128) }),
    output: o({ status: statusSchema, revision: shaSchema, blockers: idsSchema, missingCategories: texts,
      checks: a(o({ id, category: t(128), passed: bool, reason: t(256), evidence: evidenceInspection }), 128), mismatchedArtifactIds: idsSchema,
      artifactComparisonBasis: t(128), deploymentAuthorized: bool }),
  },
  "production-proof-validator": {
    input: o({ deploymentSha: shaSchema, deploymentId: t(128, 8), behavior: t(256), proofIds: a(t(256), 64) }),
    output: o({ status: statusSchema, deploymentSha: shaSchema, deploymentId: t(128), behavior: t(256), productionBehaviorProven: bool,
      evidence: evidenceInspection, deploymentSuccessAloneSufficient: bool }),
  },
  "stale-evidence-detector": {
    input: o({ currentIdentity: identitySchema, proofIds: a(t(256), 64) }),
    output: o({ status: e("STALE", "INCOMPLETE_EVIDENCE", "CURRENT"), evidence: a(o({ id: t(256), status: e("VALID", "STALE", "MISSING", "INCOMPLETE_EVIDENCE"), reasons: texts, invalidations: a({ type: "json" }, 64) }), 64),
      reusableIds: a(t(256), 64), rule: t(1024) }),
  },
  "rollback-plan-generator": {
    input: o({ revision: shaSchema, previousRevision: shaSchema, target: t(512), dataChanged: bool, backupId: n(t(256)), proofIds: a(t(256), 64) }),
    output: o({ status: statusSchema, revision: shaSchema, previousRevision: shaSchema, target: t(512), prerequisites: texts,
      steps: a(o({ order: integer(1), action: t(2048), targetRevision: shaSchema }), 4), rollbackVerified: bool, executionAuthorized: bool, backupIdentityAvailable: bool }),
  },
};
