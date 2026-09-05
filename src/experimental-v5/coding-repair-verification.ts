import { canonicalJson, sha256 } from "../canonical.ts";
import type { ProgramCandidateProposal } from "../types.ts";
import type { ProgramVerificationResult } from "./coding-repair-types.ts";

const CHECKS = new Set(["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"]);
const KINDS = new Set(["syntax", "type", "test", "behavior", "policy", "security", "integrity", "timeout", "unknown"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
export function isEvidenceDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function denseArray(value: unknown, maximum: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maximum &&
    Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
}

/** Matches the repository verifier's source identity, independently of its reported result. */
export function codingRepairCandidateDigest(candidate: ProgramCandidateProposal): string {
  if (!denseArray(candidate.files, 24) || candidate.files.length === 0) {
    throw new Error("Invalid coding repair candidate artifact.");
  }
  const seen = new Set<string>();
  const files = candidate.files.map(file => {
    if (!isRecord(file) || typeof file.path !== "string" || !file.path ||
        typeof file.content !== "string" || seen.has(file.path)) {
      throw new Error("Invalid coding repair candidate artifact.");
    }
    seen.add(file.path);
    return { path: file.path, contentDigest: sha256(file.content) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return sha256(canonicalJson({ schemaVersion: 1, files }));
}

/** Structural evidence admission, not a replacement for an independently trusted verifier. */
export function assertCodingRepairVerification(value: unknown): asserts value is ProgramVerificationResult {
  if (!isRecord(value) || typeof value.passed !== "boolean" || typeof value.score !== "number" ||
      !Number.isFinite(value.score) || value.score < 0 || value.score > 1 ||
      !isEvidenceDigest(value.artifactDigest) || !denseArray(value.failures, 256) ||
      !denseArray(value.completedChecks, CHECKS.size) ||
      !value.completedChecks.every(check => typeof check === "string" && CHECKS.has(check)) ||
      new Set(value.completedChecks).size !== value.completedChecks.length ||
      !denseArray(value.evidenceDigests, 256) || value.evidenceDigests.length === 0 ||
      !value.evidenceDigests.every(isEvidenceDigest)) {
    throw new Error("Invalid coding repair verification result.");
  }
  if (value.passed && (value.score !== 1 || value.failures.length !== 0 ||
      value.completedChecks.length !== CHECKS.size)) {
    throw new Error("Invalid coding repair verification result.");
  }
  for (const failure of value.failures) {
    if (!isRecord(failure) || typeof failure.kind !== "string" || !KINDS.has(failure.kind) ||
        typeof failure.severity !== "string" || !SEVERITIES.has(failure.severity) ||
        typeof failure.code !== "string" || !/^[A-Z][A-Z0-9_]{0,95}$/u.test(failure.code) ||
        typeof failure.file !== "string" || failure.file.length > 512 || /[\x00-\x1f\x7f]/u.test(failure.file) ||
        !Number.isSafeInteger(failure.line) || (failure.line as number) < 0 ||
        !Number.isSafeInteger(failure.column) || (failure.column as number) < 0 ||
        !isEvidenceDigest(failure.evidenceDigest) || !isEvidenceDigest(failure.fingerprint) ||
        typeof failure.existedBeforeRepair !== "boolean") {
      throw new Error("Invalid coding repair verification result.");
    }
  }
}
