import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import {
  decidePriorEvidenceReuse,
  type EvidenceInvalidation,
  type EvidenceInvalidationType,
  type ProcedureApplicabilityIdentity,
} from "./memory-fabric.ts";

export type KnowledgeTrustState = "DRAFT" | "CANDIDATE" | "QUALIFIED" | "VERIFIED" | "SUPERSEDED" | "INVALIDATED";
export type KnowledgeClass =
  | "PROCEDURAL"
  | "FAILURE_NEGATIVE"
  | "TOOL_ROUTING"
  | "DOMAIN"
  | "REPOSITORY_SYSTEM"
  | "EVIDENCE"
  | "AUTHORITY";
export type LessonNature = "POSITIVE" | "NEGATIVE";
export type MaterialIdentity = ProcedureApplicabilityIdentity;
type StringKeyedObject = { [key: string]: unknown };

export interface ProceduralPlaybook {
  id: string;
  version: number;
  knowledgeClass: KnowledgeClass;
  taskFamily: string;
  status: KnowledgeTrustState;
  triggers: string[];
  nonTriggers: string[];
  purpose: string;
  requiredInputs: string[];
  preconditions: string[];
  authorityRequired: string[];
  prohibitedActions: string[];
  costCeilingUsd: number | null;
  tools: string[];
  preferredToolOrder: string[];
  fallbackToolOrder: string[];
  procedure: string[];
  decisionBranches: string[];
  expectedFailureModes: string[];
  negativeLessons: string[];
  verificationSteps: string[];
  acceptanceCriteria: string[];
  evidenceRequired: string[];
  rollback: string[];
  sideEffects: string[];
  provenance: { producerIdentity: string; source: string };
  sourceEvidence: string[];
  qualificationStatus: string;
  qualificationDigest: string;
  evaluatorIdentity: string;
  procedureApplicabilityIdentity: MaterialIdentity;
  evidenceReuseIdentity: MaterialIdentity;
  environmentAssumptions: string[];
  dependencyAssumptions: string[];
  invalidationConditions: EvidenceInvalidationType[];
  lastVerifiedRevision: string;
  supersedes: string[];
  supersededBy: string | null;
  createdAt: string;
  verifiedAt: string | null;
  qualificationStrength?: number;
}

export interface ReusableLesson {
  id: string;
  version: number;
  knowledgeClass: KnowledgeClass;
  taskFamily: string;
  status: KnowledgeTrustState;
  nature: LessonNature;
  observation: string;
  inference: string;
  confidence: number;
  sourceEvidence: string[];
  producerIdentity: string;
  evaluatorIdentity: string;
  qualificationDigest: string;
  applicabilityIdentity: MaterialIdentity;
  invalidationConditions: EvidenceInvalidationType[];
  createdAt: string;
  verifiedAt: string | null;
  claimKey?: string;
  qualificationStrength?: number;
}

export interface ReuseTask {
  taskId: string;
  description: string;
  taskFamily: string;
  identity: MaterialIdentity;
  requestedActions: string[];
}

export interface ProcedureSelection {
  playbook: ProceduralPlaybook;
  procedureApplicable: true;
  applicabilityReason: string;
  selectionDigest: string;
  playbookDigest: string;
}

export interface KnowledgeInvalidationRecord {
  targetKind: "PLAYBOOK" | "LESSON";
  targetId: string;
  targetVersion: number;
  type: EvidenceInvalidationType;
  reason: string;
  createdAt: string;
}

export interface ReuseOutcomeRecord {
  taskFamily: string;
  taskReferenceDigest: string;
  playbookId: string;
  playbookVersion: number;
  selectionDigest: string;
  applicabilityReason: string;
  priorEvidenceReusable: boolean;
  invalidations: EvidenceInvalidation[];
  freshVerificationEvidence: string[];
  outcome: "VERIFIED" | "FAILED";
  operations: string[];
  operationsAvoided: string[];
  createdAt: string;
}

interface QualificationFailureRecord {
  kind: "PLAYBOOK" | "LESSON";
  id: string;
  version: number;
  evidenceDigest: string;
  reason: string;
  createdAt: string;
}

export interface ProceduralKnowledgeSnapshot {
  schemaVersion: 1;
  generation: number;
  playbooks: ProceduralPlaybook[];
  lessons: ReusableLesson[];
  invalidations: KnowledgeInvalidationRecord[];
  outcomes: ReuseOutcomeRecord[];
  qualificationFailures: QualificationFailureRecord[];
}

type KnowledgeState = ProceduralKnowledgeSnapshot;
interface KnowledgeEnvelope { schemaVersion: 1; state: KnowledgeState; digest: string }

const DIRECTORY_NAME = "procedural-intelligence-v1";
const STATE_FILE = "knowledge.json";
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_PLAYBOOKS = 128;
const MAX_LESSONS = 1024;
const MAX_AUDIT_RECORDS = 10_000;
const BASELINE_REVISION = "96b1f83e0c5e7756696789688552a7028b432cb8";
const TRUST_STATES = new Set<KnowledgeTrustState>(["DRAFT", "CANDIDATE", "QUALIFIED", "VERIFIED", "SUPERSEDED", "INVALIDATED"]);
const KNOWLEDGE_CLASSES = new Set<KnowledgeClass>(["PROCEDURAL", "FAILURE_NEGATIVE", "TOOL_ROUTING", "DOMAIN", "REPOSITORY_SYSTEM", "EVIDENCE", "AUTHORITY"]);
const INVALIDATION_TYPES = new Set<EvidenceInvalidationType>([
  "SOURCE_CHANGED",
  "DEPENDENCY_CHANGED",
  "CONFIGURATION_CHANGED",
  "ENVIRONMENT_CHANGED",
  "REQUIREMENT_CHANGED",
  "EVALUATOR_CHANGED",
  "POLICY_CHANGED",
  "AUTHORITY_CHANGED",
  "EVIDENCE_CORRUPT",
  "PROCEDURE_SUPERSEDED",
]);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SAFE_IDENTITY_FIELD = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const RAW_SECRET = /\b(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|signing[_-]?key|session[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{6,}/iu;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/u;

function nowIso(): string { return new Date().toISOString(); }
function clone<T>(value: T): T { return structuredClone(value); }
function isRecord(value: unknown): value is StringKeyedObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertDigest(value: string, code: string): void { if (!DIGEST.test(value)) throw new Error(code); }
function assertFiniteNonnegative(value: number, code: string): void { if (!Number.isFinite(value) || value < 0) throw new Error(code); }
function assertTimestamp(value: unknown, code: string): void { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(code); }
function identityMatches(expected: MaterialIdentity, current: MaterialIdentity): boolean {
  return Object.entries(expected).every(([field, value]) => value === undefined || current[field] === value);
}
function identitySpecificity(identity: MaterialIdentity): number {
  return Object.values(identity).filter((value) => value !== undefined).length;
}
function playbookKey(playbook: Pick<ProceduralPlaybook, "id" | "version">): string { return `${playbook.id}@${playbook.version}`; }
function lessonKey(lesson: Pick<ReusableLesson, "id" | "version">): string { return `${lesson.id}@${lesson.version}`; }
function redactIncidentalIdentifiers(value: string): string { return value.replace(UUID, "[identifier]"); }
function assertNoRawSecrets(value: unknown): void {
  const text = canonicalJson(value);
  if (RAW_SECRET.test(text) || BEARER_SECRET.test(text)) throw new Error("RAW_SECRET_IN_REUSABLE_KNOWLEDGE");
}
function assertStringArray(value: unknown, code: string, allowEmpty = true): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((entry) => typeof entry !== "string" || !entry.trim())) throw new Error(code);
}
function validateIdentity(identity: MaterialIdentity, code: string): void {
  if (!isRecord(identity)) throw new Error(code);
  for (const [key, value] of Object.entries(identity)) {
    if (!SAFE_IDENTITY_FIELD.test(key) ||
        (value !== undefined && value !== null && !["string", "number", "boolean"].includes(typeof value)) ||
        (typeof value === "number" && !Number.isFinite(value))) throw new Error(code);
  }
}

function validatePlaybook(playbook: ProceduralPlaybook): void {
  if (!isRecord(playbook) || !SAFE_ID.test(playbook.id) || !Number.isSafeInteger(playbook.version) || playbook.version < 1 ||
      !KNOWLEDGE_CLASSES.has(playbook.knowledgeClass) || !SAFE_ID.test(playbook.taskFamily) || !TRUST_STATES.has(playbook.status)) throw new Error("PROCEDURAL_INVALID_PLAYBOOK");
  const arrays: unknown[] = [
    playbook.triggers, playbook.nonTriggers, playbook.requiredInputs, playbook.preconditions, playbook.authorityRequired,
    playbook.prohibitedActions, playbook.tools, playbook.preferredToolOrder, playbook.fallbackToolOrder, playbook.procedure,
    playbook.decisionBranches, playbook.expectedFailureModes, playbook.negativeLessons, playbook.verificationSteps,
    playbook.acceptanceCriteria, playbook.evidenceRequired, playbook.rollback, playbook.sideEffects, playbook.sourceEvidence,
    playbook.environmentAssumptions, playbook.dependencyAssumptions, playbook.supersedes,
  ];
  arrays.forEach((array) => assertStringArray(array, "PROCEDURAL_INVALID_PLAYBOOK_ARRAY"));
  if (!playbook.purpose.trim() || !playbook.provenance?.producerIdentity || !playbook.provenance.source || !playbook.evaluatorIdentity || !playbook.qualificationStatus) throw new Error("PROCEDURAL_INVALID_PLAYBOOK_METADATA");
  if (playbook.costCeilingUsd !== null) assertFiniteNonnegative(playbook.costCeilingUsd, "PROCEDURAL_INVALID_COST_CEILING");
  validateIdentity(playbook.procedureApplicabilityIdentity, "PROCEDURAL_INVALID_APPLICABILITY_IDENTITY");
  validateIdentity(playbook.evidenceReuseIdentity, "PROCEDURAL_INVALID_EVIDENCE_IDENTITY");
  if (!playbook.invalidationConditions.every((type) => INVALIDATION_TYPES.has(type))) throw new Error("PROCEDURAL_INVALID_INVALIDATION_TYPE");
  if (playbook.status === "QUALIFIED" || playbook.status === "VERIFIED") {
    if (!playbook.sourceEvidence.length) throw new Error("PROCEDURAL_QUALIFICATION_EVIDENCE_REQUIRED");
    assertDigest(playbook.qualificationDigest, "PROCEDURAL_INVALID_QUALIFICATION_DIGEST");
    if (playbook.provenance.producerIdentity === playbook.evaluatorIdentity) throw new Error("INDEPENDENT_EVALUATOR_REQUIRED");
  }
  if (playbook.status === "VERIFIED") {
    if (playbook.qualificationStatus !== "independently_qualified") throw new Error("PROCEDURAL_VERIFIED_REQUIRES_INDEPENDENT_QUALIFICATION");
    if (!playbook.verifiedAt) throw new Error("PROCEDURAL_VERIFIED_AT_REQUIRED");
  }
  if (playbook.qualificationStrength !== undefined) assertFiniteNonnegative(playbook.qualificationStrength, "PROCEDURAL_INVALID_QUALIFICATION_STRENGTH");
  assertNoRawSecrets(playbook);
}

function validateLesson(lesson: ReusableLesson): void {
  if (!isRecord(lesson) || !SAFE_ID.test(lesson.id) || !Number.isSafeInteger(lesson.version) || lesson.version < 1 ||
      !KNOWLEDGE_CLASSES.has(lesson.knowledgeClass) || !SAFE_ID.test(lesson.taskFamily) || !TRUST_STATES.has(lesson.status) ||
      !["POSITIVE", "NEGATIVE"].includes(lesson.nature) || !lesson.observation.trim() || !lesson.inference.trim() ||
      !Number.isFinite(lesson.confidence) || lesson.confidence < 0 || lesson.confidence > 1) throw new Error("PROCEDURAL_INVALID_LESSON");
  assertStringArray(lesson.sourceEvidence, "PROCEDURAL_INVALID_LESSON_EVIDENCE");
  if (!lesson.producerIdentity || !lesson.evaluatorIdentity) throw new Error("PROCEDURAL_INVALID_LESSON_IDENTITY");
  validateIdentity(lesson.applicabilityIdentity, "PROCEDURAL_INVALID_LESSON_APPLICABILITY");
  if (!lesson.invalidationConditions.every((type) => INVALIDATION_TYPES.has(type))) throw new Error("PROCEDURAL_INVALID_INVALIDATION_TYPE");
  if (lesson.status === "QUALIFIED" || lesson.status === "VERIFIED") {
    if (!lesson.sourceEvidence.length) throw new Error("PROCEDURAL_QUALIFICATION_EVIDENCE_REQUIRED");
    assertDigest(lesson.qualificationDigest, "PROCEDURAL_INVALID_QUALIFICATION_DIGEST");
    if (lesson.producerIdentity === lesson.evaluatorIdentity) throw new Error("INDEPENDENT_EVALUATOR_REQUIRED");
  }
  if (lesson.status === "VERIFIED" && !lesson.verifiedAt) throw new Error("PROCEDURAL_VERIFIED_AT_REQUIRED");
  if (lesson.qualificationStrength !== undefined) assertFiniteNonnegative(lesson.qualificationStrength, "PROCEDURAL_INVALID_QUALIFICATION_STRENGTH");
  assertNoRawSecrets(lesson);
}

function validateEvidenceInvalidation(invalidation: unknown): void {
  if (!isRecord(invalidation) || !INVALIDATION_TYPES.has(invalidation.type as EvidenceInvalidationType) ||
      typeof invalidation.field !== "string" || !SAFE_IDENTITY_FIELD.test(invalidation.field)) throw new Error("PROCEDURAL_INVALID_EVIDENCE_INVALIDATION");
  assertStringArray(invalidation.invalidates, "PROCEDURAL_INVALID_EVIDENCE_INVALIDATION", false);
  for (const field of ["previous", "current"] as const) {
    const value = invalidation[field];
    if (value !== undefined && value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error("PROCEDURAL_INVALID_EVIDENCE_INVALIDATION");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("PROCEDURAL_INVALID_EVIDENCE_INVALIDATION");
  }
}

function validateInvalidationRecord(record: unknown): void {
  if (!isRecord(record) || !["PLAYBOOK", "LESSON"].includes(record.targetKind as string) ||
      typeof record.targetId !== "string" || !SAFE_ID.test(record.targetId) || !Number.isSafeInteger(record.targetVersion) || Number(record.targetVersion) < 1 ||
      !INVALIDATION_TYPES.has(record.type as EvidenceInvalidationType) || typeof record.reason !== "string" || !record.reason.trim()) throw new Error("PROCEDURAL_INVALID_INVALIDATION_RECORD");
  assertTimestamp(record.createdAt, "PROCEDURAL_INVALID_INVALIDATION_RECORD");
}

function validateOutcomeRecord(record: unknown): void {
  if (!isRecord(record) || typeof record.taskFamily !== "string" || !SAFE_ID.test(record.taskFamily) ||
      typeof record.playbookId !== "string" || !SAFE_ID.test(record.playbookId) || !Number.isSafeInteger(record.playbookVersion) || Number(record.playbookVersion) < 1 ||
      typeof record.applicabilityReason !== "string" || !record.applicabilityReason.trim() || typeof record.priorEvidenceReusable !== "boolean" ||
      !["VERIFIED", "FAILED"].includes(record.outcome as string) || !Array.isArray(record.invalidations)) throw new Error("PROCEDURAL_INVALID_OUTCOME_RECORD");
  assertDigest(String(record.taskReferenceDigest), "PROCEDURAL_INVALID_OUTCOME_RECORD");
  assertDigest(String(record.selectionDigest), "PROCEDURAL_INVALID_OUTCOME_RECORD");
  record.invalidations.forEach(validateEvidenceInvalidation);
  assertStringArray(record.freshVerificationEvidence, "PROCEDURAL_INVALID_OUTCOME_RECORD", false);
  assertStringArray(record.operations, "PROCEDURAL_INVALID_OUTCOME_RECORD", false);
  assertStringArray(record.operationsAvoided, "PROCEDURAL_INVALID_OUTCOME_RECORD");
  assertTimestamp(record.createdAt, "PROCEDURAL_INVALID_OUTCOME_RECORD");
}

function validateQualificationFailureRecord(record: unknown): void {
  if (!isRecord(record) || !["PLAYBOOK", "LESSON"].includes(record.kind as string) || typeof record.id !== "string" || !SAFE_ID.test(record.id) ||
      !Number.isSafeInteger(record.version) || Number(record.version) < 1 || typeof record.reason !== "string" || !record.reason.trim()) throw new Error("PROCEDURAL_INVALID_QUALIFICATION_FAILURE_RECORD");
  assertDigest(String(record.evidenceDigest), "PROCEDURAL_INVALID_QUALIFICATION_FAILURE_RECORD");
  assertTimestamp(record.createdAt, "PROCEDURAL_INVALID_QUALIFICATION_FAILURE_RECORD");
}

function validateState(state: KnowledgeState): void {
  if (!isRecord(state) || state.schemaVersion !== 1 || !Number.isSafeInteger(state.generation) || state.generation < 1 ||
      !Array.isArray(state.playbooks) || state.playbooks.length > MAX_PLAYBOOKS || !Array.isArray(state.lessons) || state.lessons.length > MAX_LESSONS ||
      !Array.isArray(state.invalidations) || !Array.isArray(state.outcomes) || !Array.isArray(state.qualificationFailures) ||
      state.invalidations.length > MAX_AUDIT_RECORDS || state.outcomes.length > MAX_AUDIT_RECORDS || state.qualificationFailures.length > MAX_AUDIT_RECORDS) throw new Error("PROCEDURAL_STATE_CORRUPT");
  const playbookKeys = new Set<string>();
  for (const playbook of state.playbooks) {
    validatePlaybook(playbook);
    const key = playbookKey(playbook);
    if (playbookKeys.has(key)) throw new Error("PROCEDURAL_DUPLICATE_PLAYBOOK");
    playbookKeys.add(key);
  }
  const lessonKeys = new Set<string>();
  for (const lesson of state.lessons) {
    validateLesson(lesson);
    const key = lessonKey(lesson);
    if (lessonKeys.has(key)) throw new Error("PROCEDURAL_DUPLICATE_LESSON");
    lessonKeys.add(key);
  }
  state.invalidations.forEach(validateInvalidationRecord);
  state.outcomes.forEach(validateOutcomeRecord);
  state.qualificationFailures.forEach(validateQualificationFailureRecord);
  assertNoRawSecrets(state);
}

function stateDigest(state: KnowledgeState): string { return sha256(canonicalJson(state)); }
function encodeState(state: KnowledgeState): string {
  validateState(state);
  const envelope: KnowledgeEnvelope = { schemaVersion: 1, state, digest: stateDigest(state) };
  return canonicalJson(envelope);
}
function decodeState(text: string): KnowledgeState {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.state) || typeof parsed.digest !== "string") throw new Error("shape");
    const state = parsed.state as unknown as KnowledgeState;
    validateState(state);
    if (stateDigest(state) !== parsed.digest) throw new Error("digest");
    return state;
  } catch {
    throw new Error("PROCEDURAL_STATE_CORRUPT");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readCommittedState(path: string): Promise<KnowledgeState> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_STATE_BYTES || (stat.mode & 0o077) !== 0) throw new Error("PROCEDURAL_STATE_FILE_BOUNDARY");
    return decodeState(await handle.readFile("utf8"));
  } finally { await handle?.close(); }
}
async function writeStateAtomic(directory: string, path: string, state: KnowledgeState): Promise<void> {
  const bytes = encodeState(state);
  if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) throw new Error("PROCEDURAL_STATE_CAPACITY");
  const temporary = join(directory, `pending-${randomUUID()}.json`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}
async function withFilesystemLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const lock = join(directory, "transaction.lock");
  await mkdir(lock, { mode: 0o700 });
  await syncDirectory(directory);
  try { return await action(); }
  finally { await rmdir(lock); await syncDirectory(directory); }
}
function emptyState(playbooks: readonly ProceduralPlaybook[] = []): KnowledgeState {
  return { schemaVersion: 1, generation: 1, playbooks: clone([...playbooks]), lessons: [], invalidations: [], outcomes: [], qualificationFailures: [] };
}

export function transitionTrustState(current: KnowledgeTrustState, next: KnowledgeTrustState, evidence: {
  producerIdentity: string;
  evaluatorIdentity: string;
  sourceEvidence: string[];
  qualificationDigest: string;
}): KnowledgeTrustState {
  const allowed: { [K in KnowledgeTrustState]: KnowledgeTrustState[] } = {
    DRAFT: ["CANDIDATE", "INVALIDATED"],
    CANDIDATE: ["QUALIFIED", "INVALIDATED"],
    QUALIFIED: ["VERIFIED", "INVALIDATED"],
    VERIFIED: ["SUPERSEDED", "INVALIDATED"],
    SUPERSEDED: [],
    INVALIDATED: [],
  };
  if (!allowed[current].includes(next)) throw new Error("ILLEGAL_TRUST_TRANSITION");
  if (next === "QUALIFIED" || next === "VERIFIED") {
    if (!evidence.producerIdentity || !evidence.evaluatorIdentity || evidence.producerIdentity === evidence.evaluatorIdentity) throw new Error("INDEPENDENT_EVALUATOR_REQUIRED");
    if (!evidence.sourceEvidence.length) throw new Error("QUALIFICATION_EVIDENCE_REQUIRED");
    assertDigest(evidence.qualificationDigest, "INVALID_QUALIFICATION_DIGEST");
  }
  return next;
}

export function classifyTaskFamily(description: string, playbooks: readonly ProceduralPlaybook[]): { taskFamily: string; score: number; matchedPlaybookIds: string[] } {
  const normalized = description.trim().toLowerCase();
  if (!normalized) throw new Error("TASK_DESCRIPTION_REQUIRED");
  const byFamily = new Map<string, { score: number; ids: string[] }>();
  for (const playbook of playbooks) {
    if (playbook.status !== "VERIFIED") continue;
    if (playbook.nonTriggers.some((trigger) => normalized.includes(trigger.toLowerCase()))) continue;
    const score = playbook.triggers.reduce((count, trigger) => count + (normalized.includes(trigger.toLowerCase()) ? 1 : 0), 0);
    if (!score) continue;
    const current = byFamily.get(playbook.taskFamily) ?? { score: 0, ids: [] };
    current.score = Math.max(current.score, score);
    current.ids.push(playbook.id);
    byFamily.set(playbook.taskFamily, current);
  }
  const ranked = [...byFamily.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]));
  if (!ranked.length) throw new Error("UNKNOWN_TASK_FAMILY");
  const winner = ranked[0];
  const runner = ranked[1];
  if (!winner) throw new Error("UNKNOWN_TASK_FAMILY");
  if (runner && runner[1].score === winner[1].score) throw new Error("TASK_FAMILY_CONFLICT");
  return { taskFamily: winner[0], score: winner[1].score, matchedPlaybookIds: winner[1].ids.sort() };
}

export function extractCandidateLesson(input: {
  id: string;
  version?: number;
  taskFamily: string;
  nature: LessonNature;
  observation: string;
  inference: string;
  confidence: number;
  sourceEvidence: string[];
  producerIdentity: string;
  applicabilityIdentity: MaterialIdentity;
  invalidationConditions: EvidenceInvalidationType[];
  claimKey?: string;
}): ReusableLesson {
  assertNoRawSecrets(input);
  assertStringArray(input.sourceEvidence, "CANDIDATE_LESSON_SOURCE_EVIDENCE_REQUIRED", false);
  if (!input.observation.trim() || !input.inference.trim()) throw new Error("CANDIDATE_LESSON_CONTENT_REQUIRED");
  const lesson: ReusableLesson = {
    id: input.id,
    version: input.version ?? 1,
    knowledgeClass: input.nature === "NEGATIVE" ? "FAILURE_NEGATIVE" : "PROCEDURAL",
    taskFamily: input.taskFamily,
    status: "CANDIDATE",
    nature: input.nature,
    observation: redactIncidentalIdentifiers(input.observation.trim()),
    inference: redactIncidentalIdentifiers(input.inference.trim()),
    confidence: input.confidence,
    sourceEvidence: clone(input.sourceEvidence),
    producerIdentity: input.producerIdentity,
    evaluatorIdentity: "unassigned",
    qualificationDigest: "",
    applicabilityIdentity: clone(input.applicabilityIdentity),
    invalidationConditions: clone(input.invalidationConditions),
    createdAt: nowIso(),
    verifiedAt: null,
    ...(input.claimKey ? { claimKey: input.claimKey } : {}),
  };
  validateLesson(lesson);
  return lesson;
}

export function retrieveVerifiedLessons(lessons: readonly ReusableLesson[], taskFamily: string, identity: MaterialIdentity): ReusableLesson[] {
  const candidates = lessons.filter((lesson) => lesson.status === "VERIFIED" && lesson.taskFamily === taskFamily && identityMatches(lesson.applicabilityIdentity, identity)).map((lesson) => clone(lesson));
  const grouped = new Map<string, ReusableLesson[]>();
  for (const lesson of candidates) {
    const key = lesson.claimKey ?? lesson.id;
    grouped.set(key, [...(grouped.get(key) ?? []), lesson]);
  }
  const selected: ReusableLesson[] = [];
  for (const group of grouped.values()) {
    group.sort((left, right) =>
      (right.qualificationStrength ?? Math.round(right.confidence * 100)) - (left.qualificationStrength ?? Math.round(left.confidence * 100)) ||
      right.version - left.version || left.id.localeCompare(right.id));
    const winner = group[0];
    if (!winner) continue;
    const runner = group[1];
    if (runner) {
      const winnerStrength = winner.qualificationStrength ?? Math.round(winner.confidence * 100);
      const runnerStrength = runner.qualificationStrength ?? Math.round(runner.confidence * 100);
      if (winnerStrength === runnerStrength && winner.version === runner.version && (winner.inference !== runner.inference || winner.nature !== runner.nature)) throw new Error("VERIFIED_LESSON_CONFLICT");
    }
    selected.push(winner);
  }
  return selected.sort((left, right) => left.id.localeCompare(right.id));
}

function rankPlaybooks(task: ReuseTask, playbooks: readonly ProceduralPlaybook[]): ProceduralPlaybook[] {
  return playbooks
    .filter((playbook) => playbook.status === "VERIFIED" && playbook.qualificationStatus === "independently_qualified" && playbook.taskFamily === task.taskFamily && identityMatches(playbook.procedureApplicabilityIdentity, task.identity))
    .sort((left, right) =>
      identitySpecificity(right.procedureApplicabilityIdentity) - identitySpecificity(left.procedureApplicabilityIdentity) ||
      (right.qualificationStrength ?? 0) - (left.qualificationStrength ?? 0) ||
      right.sourceEvidence.length - left.sourceEvidence.length ||
      right.version - left.version || left.id.localeCompare(right.id));
}
function selectionFor(task: ReuseTask, playbooks: readonly ProceduralPlaybook[]): ProcedureSelection {
  const ranked = rankPlaybooks(task, playbooks);
  const winner = ranked[0];
  if (!winner) throw new Error("NO_APPLICABLE_VERIFIED_PLAYBOOK");
  const runner = ranked[1];
  if (runner) {
    const winnerTuple = [identitySpecificity(winner.procedureApplicabilityIdentity), winner.qualificationStrength ?? 0, winner.sourceEvidence.length, winner.version];
    const runnerTuple = [identitySpecificity(runner.procedureApplicabilityIdentity), runner.qualificationStrength ?? 0, runner.sourceEvidence.length, runner.version];
    if (winner.id !== runner.id && canonicalJson(winnerTuple) === canonicalJson(runnerTuple)) throw new Error("PROCEDURAL_KNOWLEDGE_CONFLICT");
  }
  const material = { taskFamily: task.taskFamily, taskIdentity: task.identity, playbookId: winner.id, playbookVersion: winner.version };
  return {
    playbook: clone(winner),
    procedureApplicable: true,
    applicabilityReason: "verified task-family and material applicability identity matched",
    selectionDigest: sha256(canonicalJson(material)),
    playbookDigest: sha256(canonicalJson(winner)),
  };
}

export class ProceduralKnowledgeStore {
  readonly statePath: string;
  readonly directory: string;
  #state: KnowledgeState;
  #persistent: boolean;
  #loadedDigest: string;

  private constructor(directory: string, statePath: string, state: KnowledgeState, persistent: boolean) {
    validateState(state);
    this.directory = directory;
    this.statePath = statePath;
    this.#state = clone(state);
    this.#persistent = persistent;
    this.#loadedDigest = stateDigest(state);
  }

  static inMemory(playbooks: readonly ProceduralPlaybook[] = [], lessons: readonly ReusableLesson[] = []): ProceduralKnowledgeStore {
    const state = emptyState(playbooks);
    state.lessons = clone([...lessons]);
    validateState(state);
    return new ProceduralKnowledgeStore(":memory:", ":memory:/knowledge.json", state, false);
  }

  static async open(stateDirectory: string, seeds: readonly ProceduralPlaybook[] = PROCEDURAL_SEED_PLAYBOOKS): Promise<ProceduralKnowledgeStore> {
    const directory = resolve(stateDirectory, DIRECTORY_NAME);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new Error("PROCEDURAL_STATE_DIRECTORY_SYMLINK");
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await directoryHandle.stat();
      if ((stat.mode & 0o077) !== 0) throw new Error("PROCEDURAL_STATE_DIRECTORY_PERMISSIONS");
    } finally { await directoryHandle.close(); }
    const statePath = join(directory, STATE_FILE);
    let state: KnowledgeState;
    try {
      state = await readCommittedState(statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const pending = (await readdir(directory)).filter((name) => name.startsWith("pending-") && name.endsWith(".json"));
      if (pending.length) throw new Error("PROCEDURAL_STATE_AMBIGUOUS_PENDING");
      state = emptyState(seeds);
      await withFilesystemLock(directory, async () => {
        try {
          state = await readCommittedState(statePath);
        } catch (inner) {
          if ((inner as NodeJS.ErrnoException).code !== "ENOENT") throw inner;
          await writeStateAtomic(directory, statePath, state);
        }
      });
    }
    const store = new ProceduralKnowledgeStore(directory, statePath, state, true);
    await store.#mergeReleaseSeeds(seeds);
    return store;
  }

  snapshot(): ProceduralKnowledgeSnapshot { return clone(this.#state); }
  classify(description: string): { taskFamily: string; score: number; matchedPlaybookIds: string[] } { return classifyTaskFamily(description, this.#state.playbooks); }
  select(task: ReuseTask): ProcedureSelection { return selectionFor(task, this.#state.playbooks); }
  retrieveLessons(task: ReuseTask): ReusableLesson[] { return retrieveVerifiedLessons(this.#state.lessons, task.taskFamily, task.identity); }

  async #mergeReleaseSeeds(seeds: readonly ProceduralPlaybook[]): Promise<void> {
    if (!seeds.length) return;
    const missing = seeds.filter((seed) => !this.#state.playbooks.some((existing) => existing.id === seed.id && existing.version === seed.version));
    if (!missing.length) return;
    await this.#commit((state) => {
      for (const seed of missing) {
        validatePlaybook(seed);
        if (state.playbooks.length >= MAX_PLAYBOOKS) throw new Error("PROCEDURAL_STATE_CAPACITY");
        state.playbooks.push(clone(seed));
      }
    });
  }

  async #commit(mutator: (state: KnowledgeState) => void): Promise<void> {
    if (!this.#persistent) {
      const next = clone(this.#state);
      mutator(next);
      next.generation += 1;
      validateState(next);
      this.#state = next;
      this.#loadedDigest = stateDigest(next);
      return;
    }
    await withFilesystemLock(this.directory, async () => {
      const current = await readCommittedState(this.statePath);
      const currentDigest = stateDigest(current);
      if (currentDigest !== this.#loadedDigest) throw new Error("PROCEDURAL_STATE_CONCURRENT_CHANGE");
      const next = clone(current);
      mutator(next);
      next.generation += 1;
      validateState(next);
      await writeStateAtomic(this.directory, this.statePath, next);
      this.#state = next;
      this.#loadedDigest = stateDigest(next);
    });
  }

  async #refresh(): Promise<void> {
    if (!this.#persistent) return;
    const current = await readCommittedState(this.statePath);
    this.#state = current;
    this.#loadedDigest = stateDigest(current);
  }

  async assertSelectionCurrent(selection: ProcedureSelection, task: ReuseTask): Promise<void> {
    await this.#refresh();
    const current = this.#state.playbooks.find((playbook) => playbook.id === selection.playbook.id && playbook.version === selection.playbook.version);
    if (!current || current.status !== "VERIFIED" || current.qualificationStatus !== "independently_qualified" || sha256(canonicalJson(current)) !== selection.playbookDigest || !identityMatches(current.procedureApplicabilityIdentity, task.identity)) throw new Error("KNOWLEDGE_CHANGED_BEFORE_EXECUTION");
  }

  async invalidate(id: string, version: number, type: EvidenceInvalidationType, reason: string): Promise<void> {
    if (!INVALIDATION_TYPES.has(type) || !reason.trim()) throw new Error("PROCEDURAL_INVALID_INVALIDATION");
    await this.#commit((state) => {
      const playbook = state.playbooks.find((item) => item.id === id && item.version === version);
      const lesson = state.lessons.find((item) => item.id === id && item.version === version);
      if (playbook) {
        if (playbook.status === "INVALIDATED") return;
        if (playbook.status === "SUPERSEDED") throw new Error("ILLEGAL_TRUST_TRANSITION");
        playbook.status = transitionTrustState(playbook.status, "INVALIDATED", { producerIdentity: "invalidation", evaluatorIdentity: "invalidation", sourceEvidence: [], qualificationDigest: "" });
      } else if (lesson) {
        if (lesson.status === "INVALIDATED") return;
        if (lesson.status === "SUPERSEDED") throw new Error("ILLEGAL_TRUST_TRANSITION");
        lesson.status = transitionTrustState(lesson.status, "INVALIDATED", { producerIdentity: "invalidation", evaluatorIdentity: "invalidation", sourceEvidence: [], qualificationDigest: "" });
      } else {
        throw new Error("PROCEDURAL_UNKNOWN_KNOWLEDGE");
      }
      state.invalidations.push({ targetKind: playbook ? "PLAYBOOK" : "LESSON", targetId: id, targetVersion: version, type, reason, createdAt: nowIso() });
    });
  }

  async supersedePlaybook(oldId: string, oldVersion: number, newId: string, newVersion: number, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error("PROCEDURAL_SUPERSESSION_REASON_REQUIRED");
    await this.#commit((state) => {
      const oldPlaybook = state.playbooks.find((item) => item.id === oldId && item.version === oldVersion);
      const replacement = state.playbooks.find((item) => item.id === newId && item.version === newVersion);
      if (!oldPlaybook || !replacement) throw new Error("PROCEDURAL_UNKNOWN_PLAYBOOK");
      const oldKey = playbookKey(oldPlaybook);
      const replacementKey = playbookKey(replacement);
      if (oldKey === replacementKey) throw new Error("PROCEDURAL_SELF_SUPERSESSION");
      if (oldPlaybook.taskFamily !== replacement.taskFamily) throw new Error("PROCEDURAL_SUPERSESSION_FAMILY_MISMATCH");
      if (replacement.status !== "VERIFIED" || replacement.qualificationStatus !== "independently_qualified") throw new Error("PROCEDURAL_SUPERSESSION_REPLACEMENT_NOT_VERIFIED");
      if (oldPlaybook.status === "SUPERSEDED" && oldPlaybook.supersededBy === replacementKey) return;
      if (oldPlaybook.status !== "VERIFIED") throw new Error("ILLEGAL_TRUST_TRANSITION");
      oldPlaybook.status = transitionTrustState(oldPlaybook.status, "SUPERSEDED", { producerIdentity: "supersession", evaluatorIdentity: "supersession", sourceEvidence: [], qualificationDigest: "" });
      oldPlaybook.supersededBy = replacementKey;
      if (!replacement.supersedes.includes(oldKey)) replacement.supersedes.push(oldKey);
      state.invalidations.push({ targetKind: "PLAYBOOK", targetId: oldPlaybook.id, targetVersion: oldPlaybook.version, type: "PROCEDURE_SUPERSEDED", reason, createdAt: nowIso() });
    });
  }

  async addCandidateLesson(lesson: ReusableLesson): Promise<void> {
    if (lesson.status !== "CANDIDATE") throw new Error("CANDIDATE_LESSON_REQUIRED");
    validateLesson(lesson);
    await this.#commit((state) => {
      if (state.lessons.some((item) => item.id === lesson.id && item.version === lesson.version)) throw new Error("PROCEDURAL_DUPLICATE_LESSON");
      if (state.lessons.length >= MAX_LESSONS) throw new Error("PROCEDURAL_STATE_CAPACITY");
      state.lessons.push(clone(lesson));
    });
  }

  async qualifyLesson(id: string, version: number, evidence: { evaluatorIdentity: string; sourceEvidence: string[]; qualificationDigest: string }): Promise<void> {
    await this.#commit((state) => {
      const lesson = state.lessons.find((item) => item.id === id && item.version === version);
      if (!lesson) throw new Error("PROCEDURAL_UNKNOWN_LESSON");
      lesson.status = transitionTrustState(lesson.status, "QUALIFIED", { producerIdentity: lesson.producerIdentity, evaluatorIdentity: evidence.evaluatorIdentity, sourceEvidence: evidence.sourceEvidence, qualificationDigest: evidence.qualificationDigest });
      lesson.evaluatorIdentity = evidence.evaluatorIdentity;
      lesson.sourceEvidence = [...new Set([...lesson.sourceEvidence, ...evidence.sourceEvidence])];
      lesson.qualificationDigest = evidence.qualificationDigest;
    });
  }

  async publishLesson(id: string, version: number, evidence: { evaluatorIdentity: string; sourceEvidence: string[]; qualificationDigest: string }): Promise<void> {
    await this.#commit((state) => {
      const lesson = state.lessons.find((item) => item.id === id && item.version === version);
      if (!lesson) throw new Error("PROCEDURAL_UNKNOWN_LESSON");
      lesson.status = transitionTrustState(lesson.status, "VERIFIED", { producerIdentity: lesson.producerIdentity, evaluatorIdentity: evidence.evaluatorIdentity, sourceEvidence: evidence.sourceEvidence, qualificationDigest: evidence.qualificationDigest });
      lesson.evaluatorIdentity = evidence.evaluatorIdentity;
      lesson.sourceEvidence = [...new Set([...lesson.sourceEvidence, ...evidence.sourceEvidence])];
      lesson.qualificationDigest = evidence.qualificationDigest;
      lesson.verifiedAt = nowIso();
    });
  }

  async recordLessonQualificationFailure(id: string, version: number, evidenceDigest: string, reason: string): Promise<void> {
    assertDigest(evidenceDigest, "INVALID_QUALIFICATION_DIGEST");
    if (!reason.trim()) throw new Error("QUALIFICATION_FAILURE_REASON_REQUIRED");
    assertNoRawSecrets(reason);
    await this.#commit((state) => {
      const lesson = state.lessons.find((item) => item.id === id && item.version === version);
      if (!lesson) throw new Error("PROCEDURAL_UNKNOWN_LESSON");
      if (lesson.status === "VERIFIED") throw new Error("QUALIFICATION_FAILURE_AFTER_VERIFICATION");
      state.qualificationFailures.push({ kind: "LESSON", id, version, evidenceDigest, reason, createdAt: nowIso() });
    });
  }

  async addCandidatePlaybook(playbook: ProceduralPlaybook): Promise<void> {
    if (playbook.status !== "CANDIDATE") throw new Error("CANDIDATE_PLAYBOOK_REQUIRED");
    validatePlaybook(playbook);
    await this.#commit((state) => {
      if (state.playbooks.some((item) => item.id === playbook.id && item.version === playbook.version)) throw new Error("PROCEDURAL_DUPLICATE_PLAYBOOK");
      if (state.playbooks.length >= MAX_PLAYBOOKS) throw new Error("PROCEDURAL_STATE_CAPACITY");
      state.playbooks.push(clone(playbook));
    });
  }

  async qualifyPlaybook(id: string, version: number, evidence: { evaluatorIdentity: string; sourceEvidence: string[]; qualificationDigest: string }): Promise<void> {
    await this.#commit((state) => {
      const playbook = state.playbooks.find((item) => item.id === id && item.version === version);
      if (!playbook) throw new Error("PROCEDURAL_UNKNOWN_PLAYBOOK");
      playbook.status = transitionTrustState(playbook.status, "QUALIFIED", { producerIdentity: playbook.provenance.producerIdentity, evaluatorIdentity: evidence.evaluatorIdentity, sourceEvidence: evidence.sourceEvidence, qualificationDigest: evidence.qualificationDigest });
      playbook.evaluatorIdentity = evidence.evaluatorIdentity;
      playbook.sourceEvidence = [...new Set([...playbook.sourceEvidence, ...evidence.sourceEvidence])];
      playbook.qualificationDigest = evidence.qualificationDigest;
      playbook.qualificationStatus = "independently_qualified";
    });
  }

  async publishPlaybook(id: string, version: number, evidence: { evaluatorIdentity: string; sourceEvidence: string[]; qualificationDigest: string }): Promise<void> {
    await this.#commit((state) => {
      const playbook = state.playbooks.find((item) => item.id === id && item.version === version);
      if (!playbook) throw new Error("PROCEDURAL_UNKNOWN_PLAYBOOK");
      playbook.status = transitionTrustState(playbook.status, "VERIFIED", { producerIdentity: playbook.provenance.producerIdentity, evaluatorIdentity: evidence.evaluatorIdentity, sourceEvidence: evidence.sourceEvidence, qualificationDigest: evidence.qualificationDigest });
      playbook.evaluatorIdentity = evidence.evaluatorIdentity;
      playbook.sourceEvidence = [...new Set([...playbook.sourceEvidence, ...evidence.sourceEvidence])];
      playbook.qualificationDigest = evidence.qualificationDigest;
      playbook.qualificationStatus = "independently_qualified";
      playbook.verifiedAt = nowIso();
    });
  }

  async recordOutcome(outcome: ReuseOutcomeRecord): Promise<void> {
    validateOutcomeRecord(outcome);
    assertNoRawSecrets(outcome);
    await this.#commit((state) => { state.outcomes.push(clone(outcome)); });
  }
}

export async function buildReuseContext(store: ProceduralKnowledgeStore, task: ReuseTask, order: "PLAYBOOK_FIRST" | "LESSONS_FIRST"): Promise<{ selection: ProcedureSelection; lessons: ReusableLesson[]; semanticDigest: string }> {
  let selection: ProcedureSelection;
  let lessons: ReusableLesson[];
  if (order === "PLAYBOOK_FIRST") {
    selection = store.select(task);
    lessons = store.retrieveLessons(task);
  } else {
    lessons = store.retrieveLessons(task);
    selection = store.select(task);
  }
  const semanticDigest = sha256(canonicalJson({ selectionDigest: selection.selectionDigest, lessonIds: lessons.map((lesson) => lessonKey(lesson)).sort() }));
  return { selection, lessons, semanticDigest };
}

function safeReuseFallback(): { mode: "EXISTING_AUTHORIZED_PATH_REQUIRED"; authoritativeReuse: false; reason: string } {
  return { mode: "EXISTING_AUTHORIZED_PATH_REQUIRED", authoritativeReuse: false, reason: "KNOWLEDGE_RETRIEVAL_UNAVAILABLE" };
}

export async function executeVerifiedProcedure<T>(input: {
  store: ProceduralKnowledgeStore | (() => Promise<ProceduralKnowledgeStore>);
  task: ReuseTask;
  grantedAuthorities: string[];
  authorizedCostCeilingUsd: number;
  estimatedCostUsd: number | undefined;
  baselineOperations?: string[];
  beforeExecute?: (selection: ProcedureSelection) => Promise<void> | void;
  variableWork: () => Promise<T>;
  freshVerify: (result: T) => Promise<{ passed: boolean; evidence: string[] }>;
}): Promise<any> {
  let store: ProceduralKnowledgeStore;
  let classification: { taskFamily: string; score: number; matchedPlaybookIds: string[] };
  let selection: ProcedureSelection;
  let lessons: ReusableLesson[];
  let priorEvidence: ReturnType<typeof decidePriorEvidenceReuse>;
  try {
    store = typeof input.store === "function" ? await input.store() : input.store;
    classification = store.classify(input.task.description);
    if (classification.taskFamily !== input.task.taskFamily) throw new Error("TASK_FAMILY_MISMATCH");
    selection = store.select(input.task);
    lessons = store.retrieveLessons(input.task);
    priorEvidence = decidePriorEvidenceReuse({ expectedIdentity: selection.playbook.evidenceReuseIdentity, currentIdentity: input.task.identity });
  } catch {
    return safeReuseFallback();
  }

  const prohibited = input.task.requestedActions.find((action) => selection.playbook.prohibitedActions.includes(action));
  if (prohibited) throw new Error(`PROHIBITED_ACTION:${prohibited}`);
  for (const authority of selection.playbook.authorityRequired) if (!input.grantedAuthorities.includes(authority)) throw new Error(`AUTHORITY_REQUIRED:${authority}`);
  assertFiniteNonnegative(input.authorizedCostCeilingUsd, "INVALID_AUTHORIZED_COST_CEILING");
  if (input.estimatedCostUsd === undefined) throw new Error("UNKNOWN_COST_NOT_ZERO");
  assertFiniteNonnegative(input.estimatedCostUsd, "INVALID_ESTIMATED_COST");
  if (input.estimatedCostUsd > input.authorizedCostCeilingUsd || (selection.playbook.costCeilingUsd !== null && input.estimatedCostUsd > selection.playbook.costCeilingUsd)) throw new Error("BUDGET_CEILING_EXCEEDED");

  await input.beforeExecute?.(selection);
  await store.assertSelectionCurrent(selection, input.task);

  const operations = ["classify_task", "retrieve_verified_knowledge", "check_authority_and_prior_evidence", "perform_variable_work", "fresh_verify"];
  const baselineOperations = input.baselineOperations ?? [];
  const operationsAvoided = baselineOperations.filter((operation) => !operations.includes(operation));
  const result = await input.variableWork();
  const verification = await input.freshVerify(result);
  assertStringArray(verification.evidence, "FRESH_VERIFICATION_EVIDENCE_REQUIRED", false);
  assertNoRawSecrets(verification.evidence);
  const outcome: "VERIFIED" | "FAILED" = verification.passed ? "VERIFIED" : "FAILED";
  const record: ReuseOutcomeRecord = {
    taskFamily: input.task.taskFamily,
    taskReferenceDigest: sha256(input.task.taskId),
    playbookId: selection.playbook.id,
    playbookVersion: selection.playbook.version,
    selectionDigest: selection.selectionDigest,
    applicabilityReason: selection.applicabilityReason,
    priorEvidenceReusable: priorEvidence.reusable,
    invalidations: clone(priorEvidence.invalidations),
    freshVerificationEvidence: clone(verification.evidence),
    outcome,
    operations: clone(operations),
    operationsAvoided: clone(operationsAvoided),
    createdAt: nowIso(),
  };
  await store.recordOutcome(record);
  if (!verification.passed) throw new Error("FRESH_VERIFICATION_FAILED");
  return {
    mode: "REUSE",
    authoritativeReuse: true,
    outcome,
    taskFamily: input.task.taskFamily,
    classification,
    playbook: { id: selection.playbook.id, version: selection.playbook.version },
    applicability: { applicable: true, reason: selection.applicabilityReason },
    priorEvidence,
    qualifiedLessons: lessons.map((lesson) => ({ id: lesson.id, version: lesson.version, nature: lesson.nature })),
    variableResultDigest: sha256(canonicalJson(result)),
    freshVerification: verification,
    operations,
    efficiency: {
      baselineOperations,
      reuseOperations: operations,
      operationsAvoided,
      baselineOperationCount: baselineOperations.length || null,
      reuseOperationCount: operations.length,
      verificationReduced: false,
      wallClockDurationMs: null,
      providerCostUsd: null,
    },
  };
}

const COMMON_PROHIBITED = ["bypass_required_checks", "weaken_authentication", "increase_budget", "promote_shadow_mutation", "erase_failure_history"];
function releaseSeed(input: {
  id: string;
  taskFamily: string;
  purpose: string;
  triggers: string[];
  procedure: string[];
  sourceEvidence: string[];
  authorityRequired?: string[];
  environment?: string;
  evaluator?: string;
}): ProceduralPlaybook {
  const evaluator = input.evaluator ?? "github-actions-release-gate";
  const applicability: MaterialIdentity = { repository: "BoneManTGRM/SARA", ...(input.environment ? { environment: input.environment } : {}) };
  const evidenceIdentity: MaterialIdentity = { ...applicability, sourceRevision: BASELINE_REVISION, evaluator };
  return {
    id: input.id,
    version: 1,
    knowledgeClass: "PROCEDURAL",
    taskFamily: input.taskFamily,
    status: "VERIFIED",
    triggers: input.triggers,
    nonTriggers: [],
    purpose: input.purpose,
    requiredInputs: ["repository"],
    preconditions: ["material task identity is known", "existing policy remains authoritative"],
    authorityRequired: input.authorityRequired ?? ["repository_read"],
    prohibitedActions: clone(COMMON_PROHIBITED),
    costCeilingUsd: 0,
    tools: ["github"],
    preferredToolOrder: ["github"],
    fallbackToolOrder: [],
    procedure: input.procedure,
    decisionBranches: ["fail safe when material identity or evidence is ambiguous"],
    expectedFailureModes: ["stale evidence", "authority missing", "verification failure"],
    negativeLessons: ["historical PASS is not current proof after a material identity change"],
    verificationSteps: ["verify changed claims freshly", "preserve independent acceptance evidence"],
    acceptanceCriteria: ["changed boundary has current independent evidence"],
    evidenceRequired: ["source identity", "verification receipt"],
    rollback: ["stop reuse and return to the existing authorized path"],
    sideEffects: ["none beyond separately authorized actions"],
    provenance: { producerIdentity: "sara-release-engineering", source: "repository-and-release-evidence" },
    sourceEvidence: input.sourceEvidence,
    qualificationStatus: "independently_qualified",
    qualificationDigest: sha256(canonicalJson({ id: input.id, taskFamily: input.taskFamily, sourceEvidence: input.sourceEvidence, baseline: BASELINE_REVISION })),
    evaluatorIdentity: evaluator,
    procedureApplicabilityIdentity: applicability,
    evidenceReuseIdentity: evidenceIdentity,
    environmentAssumptions: input.environment ? [input.environment] : [],
    dependencyAssumptions: [],
    invalidationConditions: ["REQUIREMENT_CHANGED", "POLICY_CHANGED", "ENVIRONMENT_CHANGED", "PROCEDURE_SUPERSEDED"],
    lastVerifiedRevision: BASELINE_REVISION,
    supersedes: [],
    supersededBy: null,
    createdAt: "2026-09-11T13:02:57.000Z",
    verifiedAt: "2026-09-11T13:02:57.000Z",
    qualificationStrength: 100,
  };
}

export const PROCEDURAL_SEED_PLAYBOOKS: readonly ProceduralPlaybook[] = Object.freeze([
  releaseSeed({ id: "ci-failure-diagnosis", taskFamily: "ci_failure_diagnosis", purpose: "Reduce a CI failure to the smallest failed claim before repair.", triggers: ["ci failure", "github actions failure"], procedure: ["identify failed claim", "preserve receipt", "reduce to minimal case", "repair only root cause", "rerun invalidated checks"], sourceEvidence: [".github/workflows/ci.yml", "src/coding-repair-memory.ts"] }),
  releaseSeed({ id: "regression-test-first-production-repair", taskFamily: "regression_test_first_production_repair", purpose: "Repair production defects from preserved failing evidence.", triggers: ["production repair", "regression test"], procedure: ["capture minimal RED", "apply smallest repair", "capture same-case GREEN", "run broader gate"], sourceEvidence: [".github/workflows/ci.yml", "tests/coding-repair-memory.test.ts"], authorityRequired: ["repository_write"] }),
  releaseSeed({ id: "github-pr-qualification", taskFamily: "github_pr_qualification", purpose: "Qualify an exact pull-request head before merge.", triggers: ["pull request", "github pr", "qualify exact head"], procedure: ["inspect exact head", "verify required checks", "review intended diff", "merge only exact verified head"], sourceEvidence: [".github/workflows/ci.yml"], authorityRequired: ["repository_read"] }),
  releaseSeed({ id: "railway-exact-sha-deployment-verification", taskFamily: "railway_exact_sha_deployment_verification", purpose: "Verify the existing Railway production service is serving the expected exact source revision.", triggers: ["railway deployment", "exact sha deployment"], procedure: ["read deployment identity", "compare exact source revision", "verify service/environment/volume identity", "verify runtime evidence"], sourceEvidence: [`production:deployment:84579581-1987-4d6e-8938-f19c168c4e27@${BASELINE_REVISION}`, "src/main.ts"], authorityRequired: ["runtime_read"], environment: "railway-production", evaluator: "runtime-identity-v1" }),
  releaseSeed({ id: "autonomous-learning-terminal-root-continuation", taskFamily: "autonomous_learning_terminal_root_continuation", purpose: "Continue only eligible terminal failed roots using a fresh bounded reservation under the frozen contract.", triggers: ["terminal root continuation", "fresh learning root"], procedure: ["confirm terminal failed root", "confirm no child repair sequence entered", "preserve frozen contract", "create one fresh bounded root"], sourceEvidence: ["tests/autonomous-learning-curriculum-continuation.test.ts"], authorityRequired: ["internal_learning"] }),
  releaseSeed({ id: "autonomous-learning-child-repair-continuation", taskFamily: "autonomous_learning_child_repair_continuation", purpose: "Continue an existing bounded child-repair chain without creating an unlimited root escape.", triggers: ["child repair continuation", "bounded repair chain"], procedure: ["confirm root entered child repair", "inspect remaining bounded attempts", "continue only within existing chain", "retain terminal failure when exhausted"], sourceEvidence: ["tests/autonomous-learning-curriculum-continuation.test.ts"], authorityRequired: ["internal_learning"] }),
  releaseSeed({ id: "stale-evidence-invalidation", taskFamily: "stale_evidence_invalidation", purpose: "Invalidate only proof affected by a material identity change while preserving reusable procedure knowledge.", triggers: ["stale evidence", "invalidate prior pass"], procedure: ["compare material identity", "type each change", "invalidate affected claims only", "retain procedure when still applicable", "freshly verify changed claims"], sourceEvidence: ["src/coding-repair-memory.ts", "tests/coding-repair-memory.test.ts"], authorityRequired: ["repository_read"] }),
  releaseSeed({ id: "evidence-bound-final-reporting", taskFamily: "evidence_bound_final_reporting", purpose: "Produce final status only from exact current evidence and explicitly mark unknown metrics unknown.", triggers: ["final evidence report", "evidence bound reporting"], procedure: ["bind claims to receipts", "separate measured from unknown", "preserve failed evidence", "state remaining boundary exactly"], sourceEvidence: [".github/workflows/ci.yml", "src/kernel.ts"], authorityRequired: ["runtime_read"] }),
]);
for (const seed of PROCEDURAL_SEED_PLAYBOOKS) validatePlaybook(seed);

export async function runProductionProceduralReuseProof(input: {
  stateDirectory: string;
  sourceRevision: string;
  deploymentId: string;
  grantedAuthorities: string[];
}): Promise<any> {
  const store = await ProceduralKnowledgeStore.open(input.stateDirectory);
  const description = "verify the Railway exact SHA deployment using the verified production procedure";
  const classification = store.classify(description);
  const task: ReuseTask = {
    taskId: `runtime-proof:${input.deploymentId}`,
    description,
    taskFamily: classification.taskFamily,
    identity: {
      repository: "BoneManTGRM/SARA",
      environment: "railway-production",
      sourceRevision: input.sourceRevision,
      evaluator: "runtime-identity-v1",
    },
    requestedActions: ["read_runtime_identity"],
  };
  const result = await executeVerifiedProcedure({
    store,
    task,
    grantedAuthorities: input.grantedAuthorities,
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    baselineOperations: ["classify_task", "inspect_source_for_procedure", "derive_procedure", "check_authority_and_prior_evidence", "perform_variable_work", "fresh_verify"],
    variableWork: async () => ({ sourceRevision: input.sourceRevision, deploymentId: input.deploymentId, service: "sara-operator", environment: "railway-production" }),
    freshVerify: async (runtime) => ({
      passed: /^[a-f0-9]{40}$/u.test(runtime.sourceRevision) && /^[a-zA-Z0-9-]{8,}$/u.test(runtime.deploymentId) && runtime.service === "sara-operator" && runtime.environment === "railway-production",
      evidence: [`runtime-source-revision:${runtime.sourceRevision}`, `runtime-deployment-id:${runtime.deploymentId}`, "runtime-service:sara-operator", "runtime-environment:railway-production"],
    }),
  });
  return { ...result, classification };
}
