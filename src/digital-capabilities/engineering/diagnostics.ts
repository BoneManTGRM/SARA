import { CapabilityInputError, type Json } from "../schema.ts";
import type { ExecutionOutput } from "../types.ts";
import { data, digest, logReference, requireUnique, rows, strings, suppliedAnalysis, unique, type Data } from "./common.ts";

type FailureRule = { category: string; code: string; match: RegExp; diagnostic: string; retry: boolean; classification: string };
// These bounded signatures propose hypotheses. They do not establish a root cause.
const rules: readonly FailureRule[] = [
  { category: "AUTHORIZATION", code: "ACCESS_DENIED", match: /(?:(?:HTTP(?:\/[0-9.]+)?\s+|status(?: code)?\s*[:=]?\s*)(?:401|403)\b|permission denied|unauthorized|forbidden|authentication failed)/iu, diagnostic: "Inspect the failing target's existing credential scope and authorization decision without printing secrets.", retry: false, classification: "AUTHORIZATION" },
  { category: "BUDGET", code: "BUDGET_EXHAUSTED", match: /(?:budget.*(?:exhausted|exceeded)|quota exceeded|insufficient funds)/iu, diagnostic: "Inspect the current bounded allowance and recorded reservations; do not increase a limit.", retry: false, classification: "BUDGET" },
  { category: "RATE_LIMIT", code: "RATE_LIMIT", match: /(?:(?:HTTP(?:\/[0-9.]+)?\s+|status(?: code)?\s*[:=]?\s*)429\b|too many requests|rate limit)/iu, diagnostic: "Read the provider retry-after metadata and current allowed request budget before a bounded retry.", retry: true, classification: "RATE_LIMIT" },
  { category: "DEPENDENCY", code: "DEPENDENCY_RESOLUTION", match: /(?:ERESOLVE|ELOCKVERIFY|lockfile.*(?:mismatch|out.of.date)|could not resolve dependency|cannot find (?:module|package))/iu, diagnostic: "Compare the failing dependency resolution with the exact manifest, lockfile, and installed runtime.", retry: false, classification: "DETERMINISTIC" },
  { category: "CONFIGURATION", code: "RUNTIME_CONFIGURATION", match: /(?:EBADENGINE|unsupported (?:node|runtime|engine)|missing (?:environment|configuration)|environment variable.*(?:required|missing))/iu, diagnostic: "Compare required runtime and safe configuration fingerprints with the observed environment.", retry: false, classification: "DETERMINISTIC" },
  { category: "CODE", code: "COMPILE_ERROR", match: /(?:\berror TS\d+\b|SyntaxError|TypeError|ReferenceError|compilation failed)/u, diagnostic: "Inspect the earliest referenced source location at the failing revision and reproduce only that compiler or runtime check.", retry: false, classification: "DETERMINISTIC" },
  { category: "TEST", code: "ASSERTION_FAILED", match: /(?:AssertionError|ERR_ASSERTION|\bnot ok\b|expected.+received|test.+failed)/iu, diagnostic: "Reproduce the first failing assertion against its expected behavior; inspect setup errors before changing production code.", retry: false, classification: "DETERMINISTIC" },
  { category: "SECURITY", code: "SECURITY_CHECK_REPORTED", match: /(?:security check failed|audit.+(?:vulnerabilities|failed)|secret scan.+failed)/iu, diagnostic: "Read the exact scanner finding, affected artifact identity, and applicability before asserting a vulnerability.", retry: false, classification: "SECURITY" },
  { category: "ENVIRONMENT", code: "RESOURCE_OR_FILE_FAILURE", match: /(?:ENOENT|ENOSPC|ENOMEM|out of memory|no space left|killed process)/iu, diagnostic: "Inspect the named fixture, file, memory or disk precondition in isolation before blaming application code.", retry: false, classification: "ENVIRONMENT" },
  { category: "UPSTREAM", code: "UPSTREAM_UNAVAILABLE", match: /(?:(?:HTTP(?:\/[0-9.]+)?\s+|status(?: code)?\s*[:=]?\s*)(?:500|502|503|504)\b|ECONNRESET|ECONNREFUSED|service unavailable)/iu, diagnostic: "Check one read-only provider health or connection observation; a retry is eligible only after objective changed conditions.", retry: true, classification: "LIKELY_TRANSIENT" },
  { category: "TIMEOUT", code: "TIMEOUT", match: /(?:ETIMEDOUT|timed? ?out|timeout)/iu, diagnostic: "Locate the elapsed timeout and last completed step; distinguish a slow dependency from deterministic nontermination.", retry: true, classification: "TIMEOUT" },
];
const genericCascade = /(?:process completed with exit code|command failed with exit|upstream dependency failed|subsequent step|cancelled due to|canceled due to)/iu;

export function triageCi(input: Data): ExecutionOutput {
  const steps = rows(input.steps!); requireUnique(steps, "id");
  const failures = steps.filter(step => step.status === "FAILED" || step.status === "TIMED_OUT");
  const matches: { step: Data; line: string; index: number; rule: FailureRule }[] = [];
  for (const step of failures) for (const [index, line] of String(step.logs).split(/\r?\n/u).entries()) {
    if (genericCascade.test(line)) continue;
    const rule = rules.find(item => item.match.test(line));
    if (rule) matches.push({ step, line, index, rule });
  }
  const first = matches[0];
  const primary = first ? { ...logReference(String(first.step.id), first.index, first.line), signature: first.rule.code } : null;
  const hypotheses = matches.slice(0, 12).map(match => ({ category: match.rule.category, code: match.rule.code,
    evidence: logReference(String(match.step.id), match.index, match.line), confidence: "UNASSESSED" }));
  const unknowns = failures.length && !first ? ["No supported diagnostic signature matched the failed steps."] : [];
  if (!failures.length) unknowns.push("No failed or timed-out step was supplied; this does not prove CI passed.");
  return suppliedAnalysis({ revision: input.revision!, category: first?.rule.category ?? "UNKNOWN", primary, hypotheses,
    affectedSubsystem: first?.rule.category ?? "UNKNOWN", diagnosis: "HYPOTHESIS_NOT_CONFIRMED",
    diagnostic: first?.rule.diagnostic ?? "Obtain the earliest failed step and its complete bounded logs, including setup context.",
    retry: { worthwhile: first?.rule.retry ?? false, classification: first?.rule.classification ?? "UNKNOWN",
      automaticRetryAuthorized: false, requiresChangedEvidence: true },
    failedStepIds: failures.map(step => step.id!), skippedStepIds: steps.filter(step => step.status === "SKIPPED").map(step => step.id!),
    changedFiles: input.changedFiles! }, unknowns, [{ rootCauseEstablished: false }]);
}

/** Date.parse normalizes impossible dates; validate calendar components before parsing. */
function explicitEpoch(value: Json | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  if (match[7] !== "Z" && (Number(match[7]!.slice(1, 3)) > 23 || Number(match[7]!.slice(4)) > 59)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}
export function triageIncident(input: Data): ExecutionOutput {
  const events = rows(input.events!); requireUnique(events, "id");
  const parsed = events.map((event, index) => {
    return { event, index, epoch: explicitEpoch(event.at) };
  }).sort((a, b) => (a.epoch === null ? 1 : 0) - (b.epoch === null ? 1 : 0) || (a.epoch ?? 0) - (b.epoch ?? 0) || a.index - b.index);
  const primary = parsed.find(item => item.event.level === "ERROR" && !genericCascade.test(String(item.event.message)))
    ?? parsed.find(item => item.event.level === "ERROR");
  const groups = new Map<string, string[]>();
  for (const { event } of parsed) {
    const key = event.correlationId === null ? `source:${event.source}` : `correlation:${event.correlationId}`;
    const group = groups.get(key) ?? []; group.push(String(event.id)); groups.set(key, group);
  }
  const primaryRule = primary ? rules.find(rule => rule.match.test(String(primary.event.message))) : undefined;
  return suppliedAnalysis({ chronology: parsed.map(({ event, epoch }) => ({ id: event.id!, source: event.source!, level: event.level!,
      normalizedAt: epoch === null ? null : new Date(epoch).toISOString(), timestampKnown: epoch !== null, messageDigest: digest(event.message) })),
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, eventIds]) => ({ key, eventIds, causalRelationshipProven: false })),
    primaryEventId: primary?.event.id ?? null, primaryFaultDomain: primary?.event.source ?? null,
    cascadeEventIds: parsed.filter(item => genericCascade.test(String(item.event.message))).map(item => item.event.id!),
    hypothesis: primaryRule?.code ?? "UNKNOWN", diagnostic: primaryRule?.diagnostic ?? "Collect timestamped failure context and dependency observations from the first affected fault domain.",
    causalOrderEstablished: false }, parsed.some(item => item.epoch === null) ? ["Missing, invalid, or timezone-free timestamps cannot establish global chronology."] : []);
}

/** A caller-reported absence is never upgraded to an independent passing test. */
export function observationStatus(observed:string):'NO_FAILURE_REPORTED'|'UNCONFIRMED_OBSERVATION' {
  // Only the leading attributed observation can state absence. Quoted commands
  // or a later “no defect” phrase cannot suppress a reported symptom.
  return /^(?:No (?:defect|failure|bug) (?:was |has been )?(?:reproduced|observed|reported)|(?:The )?(?:bounded )?(?:test|path|walkthrough) passed)\b/iu.test(observed.trim())
    && !/\b(?:but|however|crash(?:ed|es)?|failed|AssertionError|ERR_ASSERTION)\b/iu.test(observed)
    ? 'NO_FAILURE_REPORTED':'UNCONFIRMED_OBSERVATION';
}
export function planReproduction(input: Data): ExecutionOutput {
  const missing: string[] = [];
  for (const field of ["expected", "observed", "environment"] as const) if (!String(input[field] ?? "").trim()) missing.push(field);
  if (!strings(input.steps!).length) missing.push("reproduction-steps");
  const observation=observationStatus(String(input.observed??'')),noFailure=observation==='NO_FAILURE_REPORTED';
  const nextDiagnostic=noFailure?'Ask for a specific failing symptom and its page, action, expected result and observed result before investigating a repair. The supplied passing path does not cover untested paths.':'Run a bounded isolated fixture for the reported behavior, preserving the exact source revision, input and actual outcome before asserting a cause.';
  const target = input.target === "PRODUCTION" ? "ISOLATED_COPY" : input.target;
  const steps = noFailure?[{order:1,action:nextDiagnostic}]:[
    { order: 1, action: "Create an isolated fixture with no production credentials or customer side effects." },
    { order: 2, action: "Pin the supplied environment and record expected versus observed behavior." },
    ...strings(input.steps!).map((step, index) => ({ order: index + 3, action: `Reproduce supplied step ${index + 1} in the isolated fixture; source digest ${digest(step)}.` })),
    { order: strings(input.steps!).length + 3, action: "Capture the smallest failing assertion, input digest and revision; remove unrelated setup only while the failure remains." },
  ];
  return suppliedAnalysis({ status: missing.length ? "INCOMPLETE_EVIDENCE" : "READY", reproductionTarget: target!,
    executionAllowed: false, observationStatus:observation, nextDiagnostic, summary:noFailure?'No defect was reported in the supplied bounded path. This is supplied evidence; SARA has not independently retested the site.':'Analyzed the supplied behavior report. Reproduction and root cause remain unverified.', reportDigest: digest(input.report), missing, steps, acceptance: noFailure?["Preserve the supplied passing path and untested scope without inventing a defect or repair."]:[
      "Original symptom fails in isolation before a fix.", "The same assertion passes after the fix.", "Previously working adjacent behavior remains verified.",
    ], productionMutationRequired: false }, missing.map(field => `Missing ${field}.`));
}

export function analyzeRootCause(input: Data): ExecutionOutput {
  const observations = rows(input.observations!); const hypotheses = rows(input.hypotheses!);
  requireUnique(observations, "id"); requireUnique(hypotheses, "id");
  const byId = new Map(observations.map(item => [String(item.id), item]));
  for (const hypothesis of hypotheses) for (const id of [...strings(hypothesis.supporting!), ...strings(hypothesis.contradicting!)]) {
    if (!byId.has(id)) throw new CapabilityInputError("UNKNOWN_OBSERVATION_REFERENCE");
  }
  const ranked = hypotheses.map(hypothesis => {
    const supporting = unique(strings(hypothesis.supporting!)), contradicting = unique(strings(hypothesis.contradicting!));
    return { id: hypothesis.id!, causeDigest: digest(hypothesis.cause), supporting, contradicting,
      score: supporting.length - 2 * contradicting.length, conclusion: contradicting.length ? "CONTESTED" : "UNCONFIRMED" };
  }).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return suppliedAnalysis({ symptomDigest: digest(input.symptom), rootCauseEstablished: false,
    roles: observations.map(item => ({ id: item.id!, role: item.role!, statementDigest: digest(item.statement), evidenceRefs: item.evidenceRefs! })),
    hypotheses: ranked, nextDiagnostic: ranked.length
      ? `Test a falsifiable prediction that distinguishes hypothesis ${ranked[0]!.id} from its strongest alternative using an isolated fixture.`
      : "Obtain observations that separate the trigger, underlying defect, contributing conditions and downstream cascade." },
    ["Observation labels and hypothesis support supplied by a caller do not prove causality."]);
}
