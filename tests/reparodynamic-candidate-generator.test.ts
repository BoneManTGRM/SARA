import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReparodynamicCandidateGenerator, parseReparodynamicCodingMode } from "../src/reparodynamic-candidate-generator.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "../src/types.ts";
import { sha256 } from "../src/canonical.ts";

const baseline: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "Fixture", summary: "fixture", limitations: [], files: [{ path: "src/index.ts", content: "export const ok = true;\n" }, { path: "src/value.ts", content: "export const value = 1;\n" }, { path: "tests/value.test.ts", content: "// frozen\n" }] };
const base: CandidateGenerator = { id: "fixture-generator", external: false, maximumCostUsd: 0, generate: async () => structuredClone(baseline) };
const context = { objective: "repair", acceptanceCriteria: ["verified"], missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };

describe("Reparodynamic CandidateGenerator wrapper", () => {
  it("defaults off and rejects unknown modes", () => {
    assert.equal(parseReparodynamicCodingMode(undefined), "off");
    assert.throws(() => parseReparodynamicCodingMode("production"), /off, shadow, or canary/);
  });

  it("keeps SHADOW observational and returns the original proposal", async () => {
    let observed = false;
    const wrapped = createReparodynamicCandidateGenerator({
      base, mode: "shadow",
      verify: async (candidate) => ({ passed: true, score: 1, artifactDigest: "c".repeat(64), failures: [], completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: ["d".repeat(64)] }),
      model: { propose: async () => { throw new Error("clean candidate must not call model"); } },
      onRun: () => { observed = true; },
    });
    assert.deepEqual(await wrapped.generate(context), baseline);
    assert.equal(observed, true);
  });

  it("lets CANARY replace the baseline only with a verified repaired candidate", async () => {
    let receipts = 0;
    const wrapped = createReparodynamicCandidateGenerator({
      base,
      mode: "canary",
      verify: async (candidate) => {
        const fixed = candidate.files[1].content.includes("42");
        return {
          passed: fixed,
          score: fixed ? 1 : 0.8,
          artifactDigest: sha256(JSON.stringify(candidate.files)),
          failures: fixed ? [] : [{ kind: "behavior", code: "FAILED", file: "src/value.ts", line: 1, column: 1, evidenceDigest: "e".repeat(64), fingerprint: "f".repeat(64), severity: "medium", existedBeforeRepair: true }],
          completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
          evidenceDigests: ["d".repeat(64)],
        };
      },
      model: () => ({
        propose: async ({ candidate, verification }) => ({
          proposal: {
            schemaVersion: 1,
            baseArtifactDigest: verification.artifactDigest,
            failureFingerprint: verification.failures[0].fingerprint,
            strategy: "surgical",
            changes: [{ path: "src/value.ts", expectedContentDigest: sha256(candidate.files[1].content), replacementText: "export const value = 42;\n" }],
            limitations: [],
          },
          inputTokens: 20,
          outputTokens: 10,
          accountedCostUsd: 0.01,
        }),
      }),
      onReceipt: () => { receipts += 1; },
    });
    const repaired = await wrapped.generate(context) as ProgramCandidateProposal;
    assert.equal(repaired.files[1].content, "export const value = 42;\n");
    assert.equal(receipts, 1);
  });

  it("falls back to the original proposal when CANARY cannot verify a repair", async () => {
    const wrapped = createReparodynamicCandidateGenerator({
      base,
      mode: "canary",
      verify: async (candidate) => ({
        passed: false,
        score: 0.8,
        artifactDigest: sha256(JSON.stringify(candidate.files)),
        failures: [{ kind: "behavior", code: "FAILED", file: "src/value.ts", line: 1, column: 1, evidenceDigest: "e".repeat(64), fingerprint: "f".repeat(64), severity: "medium", existedBeforeRepair: true }],
        completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
        evidenceDigests: ["d".repeat(64)],
      }),
      model: {
        propose: async ({ candidate, verification }) => ({
          proposal: {
            schemaVersion: 1,
            baseArtifactDigest: verification.artifactDigest,
            failureFingerprint: verification.failures[0].fingerprint,
            strategy: "surgical",
            changes: [{ path: "src/value.ts", expectedContentDigest: sha256(candidate.files[1].content), replacementText: "export const value = 2;\n" }],
            limitations: [],
          },
          inputTokens: 20,
          outputTokens: 10,
          accountedCostUsd: 0.01,
        }),
      },
    });
    assert.deepEqual(await wrapped.generate(context), baseline);
  });
});
