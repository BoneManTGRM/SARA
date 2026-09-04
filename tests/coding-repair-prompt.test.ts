import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { validateCodingRepairProposal } from "../src/coding-repair-prompt.ts";
import type { CodingRepairProposal } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const candidate: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "Fixture", summary: "fixture", limitations: [], files: [{ path: "src/index.ts", content: "export const ok = true;\n" }, { path: "src/value.ts", content: "export const value = 1;\n" }, { path: "tests/value.test.ts", content: "// frozen\n" }] };

function proposal(path = "src/value.ts"): CodingRepairProposal {
  const content = candidate.files.find((file) => file.path === path)?.content ?? "";
  return { schemaVersion: 1, baseArtifactDigest: "a".repeat(64), failureFingerprint: "b".repeat(64), strategy: "surgical", changes: [{ path, expectedContentDigest: sha256(content), replacementText: "export const value = 2;\n" }], limitations: [] };
}

describe("strict coding repair proposal", () => {
  it("rejects stale artifacts, unknown files, and model-authored test changes", () => {
    const validate = (candidateProposal: CodingRepairProposal) => validateCodingRepairProposal({ proposal: candidateProposal, candidate, artifactDigest: "a".repeat(64), failureFingerprints: new Set(["b".repeat(64)]), limits: INITIAL_CODING_REPAIR_LIMITS });
    assert.throws(() => validate({ ...proposal(), baseArtifactDigest: "c".repeat(64) }), /stale artifact/);
    assert.throws(() => validate({ ...proposal(), changes: [{ path: "src/missing.ts", expectedContentDigest: sha256(""), replacementText: "x" }] }), /unknown or duplicate/);
    assert.throws(() => validate(proposal("tests/value.test.ts")), /protected path/);
  });
});
