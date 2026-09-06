import { sha256 } from "../../src/canonical.ts";
import { codingRepairCandidateDigest } from "../../src/experimental-v5/coding-repair-verification.ts";
import type { CodingRepairModel } from "../../src/coding-repair-controller.ts";
import type { ProgramVerificationResult } from "../../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../../src/types.ts";
export const scope = sha256("memory-fixture-only-not-a-live-benchmark");
export const context = { objective: "Return the accepted value", acceptanceCriteria: ["Value equals 17"],
  missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
export function candidate(fixed = false): ProgramCandidateProposal {
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: "Memory fixture", summary: "Fixture only", limitations: [],
    files: [{ path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
      { path: "src/value.ts", content: `export const value: number = ${fixed ? 17 : 16};\n` },
      { path: "tests/value.test.ts", content: 'import { value } from "../src/value.ts";\nif (value !== 17) throw new Error("protected fixture");\n' }] };
}
export function check(c: ProgramCandidateProposal, passed = c.files.some(f => f.content === candidate(true).files[1].content)): ProgramVerificationResult {
  return { passed, score: passed ? 1 : 0.8, artifactDigest: codingRepairCandidateDigest(c),
    failures: passed ? [] : [{ kind: "behavior", code: "MEMORY_FIXTURE_FAILURE", file: "src/value.ts", line: 1, column: 1,
      severity: "medium", existedBeforeRepair: true, evidenceDigest: "c".repeat(64), fingerprint: "d".repeat(64) }],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: ["e".repeat(64)] };
}
export const training = () => ({ before: candidate(), beforeVerification: check(candidate()), after: candidate(true), verification: check(candidate(true)), scope });
export function model(counter: { calls: number }): CodingRepairModel {
  return { async propose(request) {
    counter.calls++;
    return { proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
      failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
      changes: [{ path: "src/value.ts", expectedContentDigest: sha256(request.candidate.files[1].content), replacementText: candidate(true).files[1].content }],
      limitations: [] }, inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
  } };
}
