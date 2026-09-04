import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReparodynamicCandidateGenerator, parseReparodynamicCodingMode } from "../src/reparodynamic-candidate-generator.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "../src/types.ts";

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
});
