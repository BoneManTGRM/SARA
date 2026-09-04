import { canonicalJson, sha256 } from "./canonical.ts";
import type {
  CodingFailureKind,
  CodingRepairAttemptLesson,
  CodingRepairAttemptOutcome,
  CodingVerificationCheck,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";

export const MAX_CODING_REPAIR_ATTEMPT_LESSONS = 2;
const MAX_CHANGED_PATHS = 6;
const MAX_FAILURE_FINGERPRINTS = 8;
const MAX_REASON_CODE_LENGTH = 80;
const DIGEST = /^[a-f0-9]{64}$/u;
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,239}$/u;

const CHECK_ORDER: readonly CodingVerificationCheck[] = [
  "source_policy",
  "syntax",
  "typecheck",
  "behavior_tests",
  "artifact_integrity",
];

const FAILURE_KINDS_BY_CHECK: Record<CodingVerificationCheck, readonly CodingFailureKind[]> = {
  source_policy: ["policy", "security"],
  syntax: ["syntax"],
  typecheck: ["type"],
  behavior_tests: ["test", "behavior"],
  artifact_integrity: ["integrity"],
};

const ATTEMPT_OUTCOMES = new Set<CodingRepairAttemptOutcome>([
  "accepted_improvement",
  "rolled_back",
  "duplicate_rejected",
  "advanced_latest_state",
]);

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("Coding repair lesson metrics must be finite.");
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertDigest(value: string, label: string): string {
  if (!DIGEST.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside its bounded integer range.`);
  }
  return value;
}

function boundedScore(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }
  return rounded(value);
}

function orderedChecks(values: readonly CodingVerificationCheck[]): CodingVerificationCheck[] {
  const present = new Set(values);
  return CHECK_ORDER.filter((check) => present.has(check));
}

function boundedFingerprints(values: readonly string[]): string[] {
  return [...new Set(values)]
    .map((value) => assertDigest(value, "failure fingerprint"))
    .sort()
    .slice(0, MAX_FAILURE_FINGERPRINTS);
}

function boundedPaths(values: readonly string[]): string[] {
  const paths = [...new Set(values)].sort().slice(0, MAX_CHANGED_PATHS);
  if (paths.some((path) => !SAFE_PATH.test(path) || path.includes(".."))) {
    throw new Error("Coding repair lesson contains an unsafe changed path.");
  }
  return paths;
}

function normalizeLesson(lesson: CodingRepairAttemptLesson): CodingRepairAttemptLesson {
  if (lesson.requestedStrategy !== "surgical" && lesson.requestedStrategy !== "deep") {
    throw new Error("Coding repair lesson strategy is unsupported.");
  }
  if (!ATTEMPT_OUTCOMES.has(lesson.outcome)) {
    throw new Error("Coding repair lesson outcome is unsupported.");
  }
  if (
    typeof lesson.reasonCode !== "string" ||
    !lesson.reasonCode.trim() ||
    lesson.reasonCode.length > MAX_REASON_CODE_LENGTH
  ) {
    throw new Error("Coding repair lesson reason code is malformed.");
  }
  const proposedArtifactDigest = lesson.proposedArtifactDigest === null
    ? null
    : assertDigest(lesson.proposedArtifactDigest, "proposedArtifactDigest");
  const rye = rounded(lesson.rye);
  if (rye < 0) throw new RangeError("Coding repair lesson RYE cannot be negative.");
  return {
    schemaVersion: 1,
    cycle: boundedInteger(lesson.cycle, 1, 3, "cycle"),
    requestedStrategy: lesson.requestedStrategy,
    proposalDigest: assertDigest(lesson.proposalDigest, "proposalDigest"),
    championArtifactDigest: assertDigest(lesson.championArtifactDigest, "championArtifactDigest"),
    proposedArtifactDigest,
    changedPaths: boundedPaths(lesson.changedPaths),
    changedFiles: boundedInteger(lesson.changedFiles, 0, 6, "changedFiles"),
    changedLines: boundedInteger(lesson.changedLines, 0, 240, "changedLines"),
    beforeScore: boundedScore(lesson.beforeScore, "beforeScore"),
    afterScore: boundedScore(lesson.afterScore, "afterScore"),
    scoreDelta: rounded(lesson.scoreDelta),
    beforeFailureFingerprints: boundedFingerprints(lesson.beforeFailureFingerprints),
    afterFailureFingerprints: boundedFingerprints(lesson.afterFailureFingerprints),
    beforeCompletedChecks: orderedChecks(lesson.beforeCompletedChecks),
    afterCompletedChecks: orderedChecks(lesson.afterCompletedChecks),
    preservedChecks: orderedChecks(lesson.preservedChecks),
    lostChecks: orderedChecks(lesson.lostChecks),
    newlyReachedChecks: orderedChecks(lesson.newlyReachedChecks),
    outcome: lesson.outcome,
    reasonCode: lesson.reasonCode,
    rye,
  };
}

export function passingVerificationChecks(
  verification: ProgramVerificationResult,
): CodingVerificationCheck[] {
  return orderedChecks(verification.completedChecks).filter((check) => (
    !verification.failures.some((failure) => FAILURE_KINDS_BY_CHECK[check].includes(failure.kind))
  ));
}

export function buildCodingRepairAttemptLesson(input: {
  cycle: number;
  requestedStrategy: "surgical" | "deep";
  proposalDigest: string;
  championArtifactDigest: string;
  proposedArtifactDigest: string | null;
  changedPaths: readonly string[];
  changedFiles: number;
  changedLines: number;
  before: ProgramVerificationResult;
  after: ProgramVerificationResult;
  outcome: CodingRepairAttemptOutcome;
  reasonCode: string;
  rye: number;
}): CodingRepairAttemptLesson {
  const beforePassing = passingVerificationChecks(input.before);
  const afterPassing = passingVerificationChecks(input.after);
  const beforeSet = new Set(beforePassing);
  const afterSet = new Set(afterPassing);
  return normalizeLesson({
    schemaVersion: 1,
    cycle: input.cycle,
    requestedStrategy: input.requestedStrategy,
    proposalDigest: input.proposalDigest,
    championArtifactDigest: input.championArtifactDigest,
    proposedArtifactDigest: input.proposedArtifactDigest,
    changedPaths: [...input.changedPaths],
    changedFiles: input.changedFiles,
    changedLines: input.changedLines,
    beforeScore: input.before.score,
    afterScore: input.after.score,
    scoreDelta: input.after.score - input.before.score,
    beforeFailureFingerprints: input.before.failures.map((failure) => failure.fingerprint),
    afterFailureFingerprints: input.after.failures.map((failure) => failure.fingerprint),
    beforeCompletedChecks: input.before.completedChecks,
    afterCompletedChecks: input.after.completedChecks,
    preservedChecks: beforePassing.filter((check) => afterSet.has(check)),
    lostChecks: beforePassing.filter((check) => !afterSet.has(check)),
    newlyReachedChecks: afterPassing.filter((check) => !beforeSet.has(check)),
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    rye: input.rye,
  });
}

export function boundCodingRepairAttemptLessons(
  lessons: readonly CodingRepairAttemptLesson[],
): CodingRepairAttemptLesson[] {
  return lessons
    .slice(-MAX_CODING_REPAIR_ATTEMPT_LESSONS)
    .map((lesson) => normalizeLesson(structuredClone(lesson)));
}

export function digestCodingRepairAttemptLessons(
  lessons: readonly CodingRepairAttemptLesson[],
): string {
  return sha256(canonicalJson(boundCodingRepairAttemptLessons(lessons)));
}

export type CodingRepairHypothesis =
  | "input_validation"
  | "exact_sum_invariant"
  | "deterministic_ordering"
  | "state_cleanup"
  | "retry_safety"
  | "cross_module_consistency"
  | "type_contract"
  | "syntax_integrity"
  | "security_boundary"
  | "behavioral_invariant";

export function deriveCodingRepairHypotheses(input: {
  acceptanceCriteria: readonly string[];
  failures: ProgramVerificationResult["failures"];
  attemptLessons: readonly CodingRepairAttemptLesson[];
}): CodingRepairHypothesis[] {
  const criteria = input.acceptanceCriteria.join("\n").toLowerCase();
  const failureCodes = input.failures.map((failure) => failure.code.toLowerCase()).join("\n");
  const failureKinds = new Set(input.failures.map((failure) => failure.kind));
  const hypotheses: CodingRepairHypothesis[] = [];
  const add = (hypothesis: CodingRepairHypothesis): void => {
    if (!hypotheses.includes(hypothesis) && hypotheses.length < 6) hypotheses.push(hypothesis);
  };

  if (/(?:reject|invalid|non-?negative|finite|integer|empty|rangeerror)/u.test(criteria)) {
    add("input_validation");
  }
  if (/(?:exact|sum|total|allocation)/u.test(criteria)) add("exact_sum_invariant");
  if (/(?:deterministic|stable|tie|order|largest remainder)/u.test(criteria)) {
    add("deterministic_ordering");
  }
  if (/(?:cleanup|timer|abort|cancel|resource)/u.test(criteria)) add("state_cleanup");
  if (/(?:retry|idempotent|unsafe post|request replay)/u.test(criteria)) add("retry_safety");

  const visibleSourceFiles = new Set(
    input.failures.map((failure) => failure.file).filter((path) => path.startsWith("src/")),
  );
  if (
    visibleSourceFiles.size > 1 ||
    /(?:cross[_ -]?module|multi[_ -]?file|integration)/u.test(failureCodes)
  ) {
    add("cross_module_consistency");
  }
  if (failureKinds.has("type")) add("type_contract");
  if (failureKinds.has("syntax")) add("syntax_integrity");
  if (failureKinds.has("security") || failureKinds.has("policy")) add("security_boundary");
  if (failureKinds.has("behavior") || failureKinds.has("test")) add("behavioral_invariant");

  if (!hypotheses.length && input.attemptLessons.some((lesson) => lesson.scoreDelta <= 0)) {
    add("behavioral_invariant");
  }
  return hypotheses;
}

export function digestCodingRepairHypotheses(
  hypotheses: readonly CodingRepairHypothesis[],
): string {
  return sha256(canonicalJson([...hypotheses]));
}
