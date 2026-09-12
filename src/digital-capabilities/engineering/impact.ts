import { CapabilityInputError, type Json } from "../schema.ts";
import type { ExecutionContext, ExecutionOutput } from "../types.ts";
import { data, digest, requireUnique, rows, strings, suppliedAnalysis, unique, verifyEvidence, type Data } from "./common.ts";

/** Supplied edges point from a dependent/caller to its dependency. Walk backwards to find consumers. */
export function graphImpact(input: Data): { impacted: Data[]; unknownPaths: string[] } {
  const graph = data(input.graph!), nodes = rows(graph.nodes!), edges = rows(graph.edges!);
  requireUnique(nodes, "id");
  const byId = new Map(nodes.map(node => [String(node.id), node]));
  const dependents = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = String(edge.from), to = String(edge.to);
    if (!byId.has(from) || !byId.has(to)) throw new CapabilityInputError("UNKNOWN_GRAPH_NODE");
    const incoming = dependents.get(to) ?? new Set<string>(); incoming.add(from); dependents.set(to, incoming);
  }
  const paths = new Set(strings(input.changedFiles!));
  const roots = nodes.filter(node => paths.has(String(node.path))).map(node => String(node.id)).sort();
  const distance = new Map<string, number>(roots.map(id => [id, 0]));
  const queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    for (const next of [...dependents.get(current) ?? []].sort()) if (!distance.has(next)) {
      distance.set(next, distance.get(current)! + 1); queue.push(next);
    }
  }
  return { impacted: [...distance].sort(([a, da], [b, db]) => da - db || a.localeCompare(b)).map(([id, depth]) => ({ ...byId.get(id)!, distance: depth })),
    unknownPaths: [...paths].filter(path => !nodes.some(node => node.path === path)).sort() };
}
export function analyzeImpact(input: Data): ExecutionOutput {
  const result = graphImpact(input);
  return suppliedAnalysis({ ...result, impactedKinds: unique(result.impacted.map(node => String(node.kind))),
    completeGraphKnown: false, externalChangesAuthorized: false }, ["A supplied graph may omit dynamic callers, runtime configuration and downstream repositories."]);
}
export function mapRegressions(input: Data): ExecutionOutput {
  const result = graphImpact(input), behaviors = rows(input.behaviors!); requireUnique(behaviors, "id");
  const nodes = new Set(rows(data(input.graph!).nodes!).map(node => String(node.id)));
  if (behaviors.some(behavior => !nodes.has(String(behavior.nodeId)))) throw new CapabilityInputError("UNKNOWN_BEHAVIOR_NODE");
  const impacted = new Set(result.impacted.map(node => String(node.id)));
  return suppliedAnalysis({ behaviorsAtRisk: behaviors.filter(behavior => impacted.has(String(behavior.nodeId))).map(behavior => ({
      id: behavior.id!, nodeId: behavior.nodeId!, descriptionDigest: digest(behavior.description), verification: "REVERIFY_AFFECTED_BEHAVIOR" })),
    unknownPaths: result.unknownPaths, graphBound: true, regressionProven: false }, ["Potential regression surface is not evidence that a regression occurred."]);
}
export function mapTestGaps(input: Data): ExecutionOutput {
  const behaviors = rows(input.behaviors!), tests = rows(input.tests!); requireUnique(behaviors, "id"); requireUnique(tests, "id");
  const known = new Set(behaviors.map(behavior => String(behavior.id)));
  if (tests.some(item => !known.has(String(item.behaviorId)))) throw new CapabilityInputError("UNKNOWN_TEST_BEHAVIOR");
  const gaps = behaviors.map(behavior => {
    const fresh = tests.filter(item => item.behaviorId === behavior.id && item.revision === input.revision && item.status === "PASSED");
    const kinds = new Set(fresh.map(item => String(item.kind)));
    return { behaviorId: behavior.id!, missingKinds: unique(strings(behavior.requiredKinds!).filter(kind => !kinds.has(kind))),
      suppliedPassingTestIds: fresh.map(item => item.id!) };
  }).filter(item => item.missingKinds.length > 0);
  return suppliedAnalysis({ revision: input.revision!, gaps, staleTests: tests.filter(item => item.revision !== input.revision).map(item => item.id!),
    failedOrUnrunTests: tests.filter(item => item.status !== "PASSED").map(item => item.id!),
    observedCoverageVerified: false, status: !behaviors.length || behaviors.some(behavior => !strings(behavior.requiredKinds!).length) ? "INCOMPLETE_EVIDENCE" : gaps.length ? "BLOCKED" : "READY" },
    ["Test-to-behavior mappings and passing labels are supplied claims, not independently executed coverage."]);
}
const riskRules: readonly { category: string; pattern: RegExp; tests: string[] }[] = [
  { category: "AUTHENTICATION", pattern: /(?:authenticat|login|password|session|token|cookie)/iu, tests: ["authentication-denial", "secret-redaction"] },
  { category: "AUTHORIZATION", pattern: /(?:authoriz|requireOwner|permission|role|scope|\bdeny\b|approval)/iu, tests: ["authorization-denial", "exact-target-approval", "prompt-injection-boundary"] },
  { category: "PERSISTENCE", pattern: /(?:persist|database|\bstore\b|ledger|audit|migration|writeFile|appendFile)/iu, tests: ["restart-restore", "audit-integrity", "interrupted-write"] },
  { category: "CONCURRENCY", pattern: /(?:concurr|Promise\.all|lock|mutex|queue|reservation|idempot)/iu, tests: ["concurrent-replay", "partial-completion-recovery"] },
  { category: "API", pattern: /(?:route|endpoint|interface|schema|request|response|export)/iu, tests: ["api-compatibility", "malformed-input", "caller-integration"] },
  { category: "DEPENDENCY", pattern: /(?:package-lock|lockfile|package\.json|dependencies|requirements\.txt)/iu, tests: ["locked-install", "runtime-compatibility", "security-audit"] },
  { category: "DEPLOYMENT", pattern: /(?:deploy|railway|vercel|docker|workflow|\.github|environment|config)/iu, tests: ["exact-sha-ci", "configuration-presence", "production-proof", "rollback"] },
  { category: "CUSTOMER", pattern: /(?:customer|payment|invoice|revenue|deliver|report|email|publish)/iu, tests: ["customer-acceptance", "financial-truth", "external-action-denial"] },
];
export function reviewPrRisk(input: Data): ExecutionOutput {
  const changes = rows(input.changes!); requireUnique(changes, "path");
  const risks: Data[] = []; const verification = new Set<string>(); let riskCount = 0;
  for (const change of changes) {
    const searchable = `${change.path}\n${change.diff}\n${strings(change.declaredAreas!).join("\n")}`;
    for (const rule of riskRules) if (rule.pattern.test(searchable)) {
      riskCount++;
      if (risks.length < 256) risks.push({ path: change.path!, category: rule.category, confidence: "UNASSESSED", findingType: "REVIEW_REQUIRED", diffDigest: digest(change.diff) });
      rule.tests.forEach(check => verification.add(check));
    }
  }
  if (changes.length) { verification.add("changed-behavior-regression"); verification.add("exact-head-ci"); }
  return suppliedAnalysis({ revision: input.revision!, risks, risksTruncated: riskCount > risks.length, requiredVerification: [...verification].sort(), behaviorProven: false,
    mergeAuthorized: false, status: changes.length ? "REVIEW_REQUIRED" : "INCOMPLETE_EVIDENCE" },
    ["Pattern-based risk screening is not a complete code review; supplied diffs cannot prove absence of security defects."]);
}
function major(version: string): number | null {
  const parsed = /^(?:v)?(0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version);
  if (!parsed || !Number.isSafeInteger(Number(parsed[1]))) return null;
  return Number(parsed[1]);
}
export function triageDependency(input: Data, context: ExecutionContext): ExecutionOutput {
  const changes = rows(input.changes!), audit = rows(input.audit!); requireUnique(changes, "name"); requireUnique(audit, "id");
  const dependencies = changes.map(change => {
    const before = major(String(change.fromVersion)), after = major(String(change.toVersion));
    const majorChange = before === null || after === null ? null : before !== after;
    const required = ["locked-install", "affected-behavior-regression"];
    if (majorChange !== false) required.push("breaking-change-review");
    if (change.runtimeCompatibility !== "COMPATIBLE") required.push("runtime-compatibility-proof");
    if (change.scope === "RUNTIME") required.push("production-safe-runtime-proof");
    return { name: change.name!, direct: change.direct!, scope: change.scope!, majorChange,
      runtimeCompatibilityReported: change.runtimeCompatibility!, requiredVerification: required,
      versionComparison: majorChange === null ? "UNSUPPORTED_OR_UNKNOWN_VERSION" : "EXACT_SUPPLIED_SEMVER_MAJOR" };
  });
  const reportedAdvisories = audit.map(item => {
    const verification = verifyEvidence(context, [String(item.evidenceId)], { provenance: "CI", claim: `advisory:${item.id}:${item.package}:${item.version}`,
      identity: { sourceRevision: String(input.revision) } });
    return { id: item.id!, package: item.package!, version: item.version!, evidenceId: item.evidenceId!, independentlyVerified: verification.passed };
  });
  return suppliedAnalysis({ revision: input.revision!, dependencies, reportedAdvisories,
    vulnerabilityEstablished: reportedAdvisories.some(item => item.independentlyVerified),
    status: dependencies.some(item => item.runtimeCompatibilityReported === "INCOMPATIBLE") ? "BLOCKED" : !changes.length ? "INCOMPLETE_EVIDENCE" : "REVIEW_REQUIRED" },
    ["A major version change suggests compatibility review, not a proven break. No absent audit finding is invented."]);
}
export function detectDrift(input: Data): ExecutionOutput {
  const intended = rows(input.intended!), observed = rows(input.observed!); requireUnique(intended, "name"); requireUnique(observed, "name");
  const before = new Map(intended.map(item => [String(item.name), item])), after = new Map(observed.map(item => [String(item.name), item]));
  const differences: Data[] = [], unknowns: string[] = [];
  for (const name of unique([...before.keys(), ...after.keys()])) {
    const expected = before.get(name), actual = after.get(name);
    if (!expected || !actual) { differences.push({ name, kind: !expected ? "UNEXPECTED_CONFIGURATION" : "OBSERVATION_MISSING", secret: (expected?.secret ?? actual?.secret) === true }); continue; }
    const secret = expected.secret === true || actual.secret === true;
    if (expected.present !== actual.present) differences.push({ name, kind: "PRESENCE_MISMATCH", secret });
    else if (expected.present) {
      if (expected.fingerprint !== null && actual.fingerprint !== null && expected.fingerprint !== actual.fingerprint) differences.push({ name, kind: "FINGERPRINT_MISMATCH", secret });
      if (expected.version !== null && actual.version !== null && expected.version !== actual.version) differences.push({ name, kind: "VERSION_MISMATCH", secret });
      if (expected.fingerprint === null || actual.fingerprint === null) unknowns.push(`Fingerprint comparison unavailable for ${name}.`);
    }
  }
  return suppliedAnalysis({ differences, secretValuesExposed: false, valuesRead: false,
    status: differences.length ? "DRIFT_DETECTED" : !intended.length || unknowns.length ? "INCOMPLETE_EVIDENCE" : "MATCHES_SUPPLIED_METADATA" }, unknowns);
}
export function reviewMigration(input: Data): ExecutionOutput {
  const operations = rows(input.operations!); requireUnique(operations, "id"); const risks: Data[] = [];
  const add = (id: Json, category: string, requirement: string) => risks.push({ operationId: id, category, requiredVerification: requirement });
  for (const operation of operations) {
    const sql = String(operation.statement), destructive = ["DROP_TABLE", "DROP_COLUMN", "TRUNCATE", "ALTER_TYPE"].includes(String(operation.kind)) || /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/iu.test(sql);
    if (destructive) add(operation.id!, "DESTRUCTIVE", "Isolated copy, data-loss assessment and verified pre-migration backup.");
    if (destructive && operation.reversible !== true) add(operation.id!, "IRREVERSIBLE", "Safe forward recovery or independently verified restoration before approval.");
    if (operation.compatibleReaders !== true) add(operation.id!, "READER_COMPATIBILITY", "Prove old and new readers across the migration window.");
    if (operation.compatibleWriters !== true) add(operation.id!, "WRITER_COMPATIBILITY", "Prove old and new writers and backfill ordering.");
    if (["ALTER_TYPE", "BACKFILL", "CREATE_INDEX", "RAW_SQL"].includes(String(operation.kind)) && operation.concurrent !== true) add(operation.id!, "LOCK_OR_BACKFILL", "Measure lock duration and backfill behavior on a representative isolated copy.");
    if (operation.kind === "RAW_SQL") add(operation.id!, "UNPARSED_SQL", "A database-aware reviewer must inspect the full statement; token scanning is not semantic SQL analysis.");
  }
  if (operations.length && input.backupProofId === null) add("migration", "BACKUP_UNPROVEN", "Supply a subject-bound backup/restore proof.");
  if (operations.length && input.rollbackProofId === null) add("migration", "ROLLBACK_UNPROVEN", "Prove rollback or safe forward recovery in isolation.");
  return suppliedAnalysis({ status: risks.some(item => ["DESTRUCTIVE", "IRREVERSIBLE"].includes(String(item.category))) ? "BLOCKED" : risks.length || !operations.length ? "INCOMPLETE_EVIDENCE" : "REVIEW_REQUIRED",
    risks, operationOrder: operations.map(item => item.id!), executionAuthorized: false, rollbackVerified: false },
    ["Supplied backup and rollback identifiers alone do not establish verified recovery."]);
}
export function coordinateRepositories(input: Data): ExecutionOutput {
  const repositories = rows(input.repositories!), dependencies = rows(input.dependencies!); requireUnique(repositories, "id");
  const ids = new Set(repositories.map(item => String(item.id)));
  const remaining = new Map([...ids].map(id => [id, new Set<string>()]));
  for (const dependency of dependencies) {
    if (!ids.has(String(dependency.consumer)) || !ids.has(String(dependency.provider))) throw new CapabilityInputError("UNKNOWN_REPOSITORY");
    remaining.get(String(dependency.consumer))!.add(String(dependency.provider));
  }
  const order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, prerequisites]) => !prerequisites.size).map(([id]) => id).sort();
    if (!ready.length) break;
    for (const id of ready) { remaining.delete(id); order.push(id); for (const prerequisites of remaining.values()) prerequisites.delete(id); }
  }
  const cycle = remaining.size > 0, incompatible = dependencies.some(item => item.compatible === false);
  return suppliedAnalysis({ status: cycle || incompatible ? "BLOCKED" : dependencies.some(item => item.compatible === null) || !repositories.length ? "INCOMPLETE_EVIDENCE" : "READY",
    repositories: repositories.map(item => ({ id: item.id!, revision: item.revision! })),
    rolloutOrder: cycle ? [] : order, rollbackOrder: cycle ? [] : [...order].reverse(),
    unresolvedDependencies: [...remaining.keys()].sort(), compatibilityWindows: dependencies.map(item => ({
      consumer: item.consumer!, provider: item.provider!, contractId: item.contractId!, compatibleReported: item.compatible!,
      requiredVerification: "Exact-revision integration proof during the overlap window; rollout order is a proposal, not authority." })), externalMutations: 0 });
}
