import { canonicalJson, sha256 } from "./canonical.ts";
import type { MemoryRecord, SkillCandidateProposal } from "./types.ts";

export type LearningFailureClass =
  | "provider_transient"
  | "provider_terminal"
  | "schema_failure"
  | "source_policy_failure"
  | "typescript_failure"
  | "behavioral_failure"
  | "independent_acceptance_failure"
  | "policy_failure"
  | "unknown";

export type LearningNextAction = "retry_same_reservation" | "targeted_repair" | "stop" | "escalate";

export type LearningFailureTriage = {
  failureClass: LearningFailureClass;
  nextAction: LearningNextAction;
  evidenceCode: string;
};

function observedFailureText(evidence: unknown): string {
  if (evidence instanceof Error) return `${evidence.name}: ${evidence.message}`.slice(0, 8_192);
  if (typeof evidence === "string") return evidence.slice(0, 8_192);
  if (!evidence || typeof evidence !== "object") return String(evidence).slice(0, 8_192);
  const record = evidence as Record<string, unknown>;
  const bounded = [record.name, record.code, record.status, record.message, record.reason]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String)
    .join(" ");
  return bounded.slice(0, 8_192);
}

/** Deterministic classification only. This function grants no authority. */
export function learningFailureTriage(evidence: unknown): LearningFailureTriage {
  const text = observedFailureText(evidence);
  const lower = text.toLowerCase();
  const statusMatch = /(?:http|status)[^0-9]{0,12}([1-5][0-9]{2})/iu.exec(text);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;

  if (
    status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500 && status <= 504) ||
    /\b(?:etimedout|econnreset|eai_again|und_err_connect_timeout|temporary connection|temporarily unavailable|connection interruption|request timeout|timed out)\b/iu.test(text)
  ) return { failureClass: "provider_transient", nextAction: "retry_same_reservation", evidenceCode: `provider_transient:${status ?? "transport"}` };

  if (
    status !== undefined && status >= 400 && status < 500 ||
    /provider.+(?:rejected|invalid request|authentication|authorization|unsupported|permanent)/iu.test(text)
  ) return { failureClass: "provider_terminal", nextAction: "stop", evidenceCode: `provider_terminal:${status ?? "provider"}` };

  if (/independent acceptance failed|learning qualification rejected/iu.test(text)) {
    return { failureClass: "independent_acceptance_failure", nextAction: "targeted_repair", evidenceCode: "independent_acceptance" };
  }
  if (/typescript|generated skill failed typescript verification|\bts\d{3,5}\b/iu.test(text)) {
    return { failureClass: "typescript_failure", nextAction: "targeted_repair", evidenceCode: "typescript" };
  }
  if (/behavioral verification mismatches|behavioral mismatch/iu.test(text)) {
    return { failureClass: "behavioral_failure", nextAction: "targeted_repair", evidenceCode: "behavioral" };
  }
  if (/pure isolated candidate|imports and module loading|computed property access|prototype|constructor access|source policy/iu.test(text)) {
    return { failureClass: "source_policy_failure", nextAction: "targeted_repair", evidenceCode: "source_policy" };
  }
  if (/schema version|structurally incomplete|unsupported fields|not valid json|ambiguous|proposal.+(?:schema|json)|skill name must be|skill candidate summary must be|skill limitations must contain|behavioral test names must be unique/iu.test(text)) {
    return { failureClass: "schema_failure", nextAction: "targeted_repair", evidenceCode: "schema" };
  }
  if (/learning mandate changed|active_learning_mandate_required|learning_authority|emergency stop|policy denied|owner approval|authority changed/iu.test(lower)) {
    return { failureClass: "policy_failure", nextAction: "stop", evidenceCode: "policy" };
  }
  return { failureClass: "unknown", nextAction: "escalate", evidenceCode: "unknown" };
}

export type TargetedRepairInput = {
  contractDigest: string;
  candidateDigest: string;
  publicCriteria: string[];
  failureClass: LearningFailureClass;
  measuredFeedback: string;
  measuredMemory?: string;
};

export type TargetedRepairPlan = {
  outcome: "TARGETED_REPAIR" | "STOP_OR_REGENERATE_BY_POLICY";
  directive: string | null;
  evidenceDigest: string;
};

const REPAIR_RULES: Array<{ pattern: RegExp; directive: string }> = [
  { pattern: /alphabet|ordering|order mismatch|sorted/iu, directive: "Correct only the contract-required deterministic ordering; preserve all other behavior and output semantics." },
  { pattern: /duplicate|dedup/iu, directive: "Remove only contract-prohibited duplicate outputs using deterministic equality; preserve first-occurrence order unless the public contract requires another order." },
  { pattern: /object shape|output shape|missing (?:field|key)|extra (?:field|key)/iu, directive: "Correct only the demonstrated public output object shape; do not alter unrelated values or acceptance expectations." },
  { pattern: /ts18046|type unknown|narrowed before use/iu, directive: "Repair only the demonstrated unknown-value narrowing error with runtime-safe TypeScript narrowing before use." },
  { pattern: /ts18048|may be undefined/iu, directive: "Repair only the demonstrated possibly-undefined access by checking the value before accessing its fields." },
  { pattern: /computed property access/iu, directive: "Replace only the prohibited computed-property operation with source-policy-compatible iteration or explicit named-field access." },
  { pattern: /imports and module loading/iu, directive: "Remove only the demonstrated import/module dependency and implement the required behavior as isolated pure TypeScript." },
  { pattern: /capitalization|uppercase|lowercase|case normalization/iu, directive: "Correct only the capitalization behavior explicitly required by the public contract; preserve case elsewhere." },
  { pattern: /behavioral verification mismatches/iu, directive: "Correct the smallest behavior demonstrated by the measured producer mismatch, then rerun the same public producer vectors without changing correct expected results." },
  { pattern: /schema version|structurally incomplete|unsupported fields|valid json|ambiguous/iu, directive: "Correct only the demonstrated candidate JSON/schema defect and return one complete contract-shaped candidate object." },
];

/** Uses only public contract material and measured producer evidence. Hidden qualification answers are never accepted as repair input. */
export function targetedRepairPlanner(input: TargetedRepairInput): TargetedRepairPlan {
  if (!/^[a-f0-9]{64}$/iu.test(input.contractDigest) || !/^[a-f0-9]{64}$/iu.test(input.candidateDigest)) {
    return { outcome: "STOP_OR_REGENERATE_BY_POLICY", directive: null, evidenceDigest: sha256("invalid-repair-identity") };
  }
  const evidence = `${input.measuredFeedback}\n${input.measuredMemory ?? ""}`.slice(0, 6_000);
  const evidenceDigest = sha256(canonicalJson({
    contractDigest: input.contractDigest,
    candidateDigest: input.candidateDigest,
    failureClass: input.failureClass,
    publicCriteria: input.publicCriteria,
    evidence,
  }));
  if (input.failureClass === "provider_transient" || input.failureClass === "provider_terminal" ||
      input.failureClass === "policy_failure" || input.failureClass === "unknown") {
    return { outcome: "STOP_OR_REGENERATE_BY_POLICY", directive: null, evidenceDigest };
  }
  if (input.failureClass === "independent_acceptance_failure") {
    return {
      outcome: "TARGETED_REPAIR",
      directive: `TARGETED_REPAIR: Re-evaluate only the frozen public requirements from first principles and produce a materially different deterministic implementation where the public contract permits it. Do not infer, request, or encode hidden qualification answers. Frozen contract ${input.contractDigest}; independently rejected candidate ${input.candidateDigest}.`,
      evidenceDigest,
    };
  }
  const rule = REPAIR_RULES.find((candidate) => candidate.pattern.test(evidence));
  if (!rule) return { outcome: "STOP_OR_REGENERATE_BY_POLICY", directive: null, evidenceDigest };
  return {
    outcome: "TARGETED_REPAIR",
    directive: `TARGETED_REPAIR: ${rule.directive} Frozen contract ${input.contractDigest}; rejected candidate ${input.candidateDigest}.`,
    evidenceDigest,
  };
}

export type LearningAttemptBudgetInput = {
  objectiveLength: number;
  publicCriteriaCount: number;
  publicBehavioralTestCount: number;
  priorFailureClass?: LearningFailureClass;
  previousCandidateSourceBytes?: number;
  previousCompletionTokens?: number;
  providerMaximumCompletionTokens?: number;
};

export type LearningAttemptBudget = {
  relevantMemoryMaximum: number;
  relevantMemoryCharacterMaximum: number;
  behavioralTests: { minimum: number; maximum: number };
  completionTokenBudget: 2048 | 3072 | 4096;
  includePriorCandidateRepairContext: boolean;
  attemptMode: "fresh" | "repair";
};

/** Bounded guidance only. It cannot spend, alter campaign requests, or change provider quotas. */
export function learningAttemptBudgeter(input: LearningAttemptBudgetInput): LearningAttemptBudget {
  const objectiveLength = Math.max(0, Math.min(1_000, Math.floor(input.objectiveLength)));
  const criteria = Math.max(0, Math.min(16, Math.floor(input.publicCriteriaCount)));
  const publicTests = Math.max(0, Math.min(64, Math.floor(input.publicBehavioralTestCount)));
  const repair = input.priorFailureClass !== undefined && [
    "schema_failure", "source_policy_failure", "typescript_failure", "behavioral_failure", "independent_acceptance_failure",
  ].includes(input.priorFailureClass);
  const complexity = objectiveLength + criteria * 140 + publicTests * 90 + Math.min(16_384, input.previousCandidateSourceBytes ?? 0) / 8;
  const requested = complexity <= 2_200 ? 2048 : complexity <= 4_800 ? 3072 : 4096;
  const providerMaximum = Math.max(2_048, Math.min(4_096, Math.floor(input.providerMaximumCompletionTokens ?? 4_096)));
  const completionTokenBudget = Math.min(requested, providerMaximum) as 2048 | 3072 | 4096;
  const relevantMemoryMaximum = repair ? 4 : criteria > 8 ? 3 : 2;
  return {
    relevantMemoryMaximum,
    relevantMemoryCharacterMaximum: relevantMemoryMaximum * 1_200,
    behavioralTests: { minimum: 2, maximum: Math.max(2, Math.min(8, publicTests || (criteria > 6 ? 6 : 4))) },
    completionTokenBudget,
    includePriorCandidateRepairContext: repair,
    attemptMode: repair ? "repair" : "fresh",
  };
}

export type FailureMemorySelectionInput = {
  memories: MemoryRecord[];
  capabilityId: string;
  objective: string;
  contractDigest: string;
  failureClass?: LearningFailureClass;
  maximumCount?: number;
  maximumCharacters?: number;
};

function failureClassForMemory(memory: MemoryRecord): LearningFailureClass {
  const tagged = memory.tags?.find((tag) => tag.startsWith("failure-class:"))?.slice("failure-class:".length);
  if (tagged && new Set<LearningFailureClass>([
    "provider_transient", "provider_terminal", "schema_failure", "source_policy_failure", "typescript_failure",
    "behavioral_failure", "independent_acceptance_failure", "policy_failure", "unknown",
  ]).has(tagged as LearningFailureClass)) return tagged as LearningFailureClass;
  return learningFailureTriage(memory.statement).failureClass;
}

/** Selects context only; durable memory is never deleted or mutated. */
export function skillFailureMemorySelector(input: FailureMemorySelectionInput): MemoryRecord[] {
  const maximumCount = Math.max(0, Math.min(6, Math.floor(input.maximumCount ?? 4)));
  const maximumCharacters = Math.max(0, Math.min(8_000, Math.floor(input.maximumCharacters ?? 4_800)));
  const objectiveDigest = sha256(input.objective);
  const ranked = input.memories
    .filter((memory) => (memory.status ?? "active") === "active")
    .filter((memory) => memory.verification === "measured")
    .filter((memory) => memory.category === "failure" || memory.category === "repair")
    .filter((memory) => !(memory.tags ?? []).some((tag) => /hidden-answer|secret|credential/iu.test(tag)))
    .map((memory) => {
      const exactObjective = memory.source.startsWith(`sara://learning-failure/${objectiveDigest}/`) ||
        memory.source.startsWith(`sara://learning-repair/${objectiveDigest}/`);
      const exactCapability = memory.tags?.includes(`capability:${input.capabilityId}`) || memory.dependencies.includes(`capability:${input.capabilityId}`);
      const exactContract = memory.dependencies.includes(`contract:${input.contractDigest}`);
      const exactFailure = input.failureClass !== undefined && failureClassForMemory(memory) === input.failureClass;
      const score = (exactCapability ? 100 : 0) + (exactObjective ? 80 : 0) + (exactContract ? 60 : 0) + (exactFailure ? 40 : 0) +
        (memory.category === "failure" ? 10 : 5);
      return { memory, score, exactObjective, exactCapability, exactContract };
    })
    .filter(({ exactObjective, exactCapability, exactContract }) => exactObjective || exactCapability || exactContract)
    .sort((a, b) => b.score - a.score || b.memory.observedAt.localeCompare(a.memory.observedAt) || a.memory.id.localeCompare(b.memory.id));
  const selected: MemoryRecord[] = [];
  const fingerprints = new Set<string>();
  let usedCharacters = 0;
  for (const { memory } of ranked) {
    if (selected.length >= maximumCount) break;
    const fingerprint = sha256(`${memory.source}\n${memory.statement}`);
    if (fingerprints.has(fingerprint)) continue;
    const remaining = maximumCharacters - usedCharacters;
    if (remaining <= 0) break;
    const statement = memory.statement.slice(0, Math.min(1_500, remaining));
    if (!statement) continue;
    const copy = structuredClone(memory);
    copy.statement = statement;
    selected.push(copy);
    fingerprints.add(fingerprint);
    usedCharacters += statement.length;
  }
  return selected;
}

export type QualificationReadinessInput = {
  candidateExists: boolean;
  candidateDigest: string | null;
  artifactIntegrityValid: boolean;
  sourcePolicyPassed: boolean;
  typeScriptVerificationPassed: boolean;
  producerBehavioralVerificationPassed: boolean;
  contractId: string | null;
  contractDigest: string | null;
  qualificationEnvironmentDigest: string | null;
  publicContractPresent: boolean;
  unresolvedPrerequisiteFailure?: boolean;
};

export type QualificationReadinessResult = {
  status: "READY_FOR_INDEPENDENT_QUALIFICATION" | "NOT_READY";
  prerequisiteFailures: string[];
};

/** Preflight only. It never executes or claims independent acceptance. */
export function qualificationReadinessCheck(input: QualificationReadinessInput): QualificationReadinessResult {
  const failures: string[] = [];
  if (!input.candidateExists) failures.push("candidate_missing");
  if (!input.candidateDigest || !/^[a-f0-9]{64}$/iu.test(input.candidateDigest)) failures.push("candidate_digest_not_fixed");
  if (!input.artifactIntegrityValid) failures.push("artifact_integrity_not_verified");
  if (!input.sourcePolicyPassed) failures.push("source_policy_not_passed");
  if (!input.typeScriptVerificationPassed) failures.push("typescript_verification_not_passed");
  if (!input.producerBehavioralVerificationPassed) failures.push("producer_behavioral_verification_not_passed");
  if (!input.contractId) failures.push("contract_id_missing");
  if (!input.contractDigest || !/^[a-f0-9]{64}$/iu.test(input.contractDigest)) failures.push("contract_digest_not_fixed");
  if (!input.qualificationEnvironmentDigest || !/^[a-f0-9]{64}$/iu.test(input.qualificationEnvironmentDigest)) failures.push("qualification_environment_not_fixed");
  if (!input.publicContractPresent) failures.push("public_contract_missing");
  if (input.unresolvedPrerequisiteFailure) failures.push("unresolved_prerequisite_failure");
  return { status: failures.length ? "NOT_READY" : "READY_FOR_INDEPENDENT_QUALIFICATION", prerequisiteFailures: failures };
}

export type DeterministicOutputContract = {
  ordering: "alphabetical" | "preserve_input";
  deduplicate?: boolean;
  caseNormalization?: "preserve" | "lower" | "upper";
  objectKeys?: string[];
};

function normalizeScalar(value: unknown, mode: DeterministicOutputContract["caseNormalization"]): unknown {
  if (typeof value !== "string") return value;
  if (mode === "lower") return value.toLowerCase();
  if (mode === "upper") return value.toUpperCase();
  return value;
}

function canonicalObject(value: unknown, contract: DeterministicOutputContract): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalObject(item, contract));
  if (!value || typeof value !== "object") return normalizeScalar(value, contract.caseNormalization ?? "preserve");
  const record = value as Record<string, unknown>;
  const keys = contract.objectKeys ? [...contract.objectKeys] : Object.keys(record).sort();
  const output: Record<string, unknown> = {};
  for (const key of keys) if (Object.hasOwn(record, key)) output[key] = canonicalObject(record[key], contract);
  return output;
}

/** Contract-controlled normalization only; the helper never rewrites or infers a contract. */
export function deterministicOutputNormalizer(value: unknown, contract: DeterministicOutputContract): unknown {
  const normalized = canonicalObject(value, contract);
  if (!Array.isArray(normalized)) return normalized;
  let array = normalized;
  if (contract.deduplicate) {
    const seen = new Set<string>();
    array = array.filter((item) => {
      const key = canonicalJson(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (contract.ordering === "alphabetical") {
    return [...array].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  }
  return array;
}

export function previousCandidateSourceBytes(proposal: SkillCandidateProposal | undefined): number {
  return proposal ? Buffer.byteLength(proposal.source, "utf8") : 0;
}
