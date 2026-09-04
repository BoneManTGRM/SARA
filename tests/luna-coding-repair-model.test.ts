import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

describe("Luna coding repair adapter", () => {
  it("uses the bounded Luna router and keeps repair strategy controller-owned", async () => {
    const candidate: ProgramCandidateProposal = {
      schemaVersion: 1, candidateKind: "typescript_program", programName: "Fixture", summary: "fixture", limitations: [],
      files: [{ path: "src/index.ts", content: "export const value = 1;\n" }, { path: "src/more.ts", content: "export const more = true;\n" }, { path: "tests/index.test.ts", content: "// immutable\n" }],
    };
    const artifactDigest = sha256(JSON.stringify(candidate.files));
    const fingerprint = "f".repeat(64);
    let observedPrompt = "";
    const client: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens(prompt) { observedPrompt = prompt; return 100; },
      async execute() {
        return {
          outputText: JSON.stringify({ schemaVersion: 1, baseArtifactDigest: artifactDigest, failureFingerprint: fingerprint, strategy: "deep", changes: [{ path: "src/index.ts", expectedContentDigest: sha256(candidate.files[0].content), replacementText: "export const value = 42;\n" }], limitations: [] }),
          inputTokens: 100,
          billableOutputTokens: 50,
        };
      },
    };
    const model = createLunaCodingRepairModel({
      client,
      context: { objective: "repair", acceptanceCriteria: ["value 42"], missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } },
    });
    const result = await model.propose({
      candidate,
      verification: { passed: false, score: 0.8, artifactDigest, failures: [{ kind: "behavior", code: "FAILED", file: "src/index.ts", line: 1, column: 1, evidenceDigest: "e".repeat(64), fingerprint, severity: "medium", existedBeforeRepair: true }], completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: ["e".repeat(64)] },
      strategy: "surgical",
      cycle: 1,
      remainingCostUsd: 0.15,
    });
    assert.equal(result.proposal.changes[0].replacementText, "export const value = 42;\n");
    assert.equal(result.proposal.strategy, "surgical");
    assert(observedPrompt.includes("OUTPUT CONTRACT: SARA_CODING_REPAIR_V1"));
    assert(observedPrompt.includes('"requiredStrategy":"surgical"'));
    assert.equal(observedPrompt.includes("// immutable"), false);
    assert(result.accountedCostUsd > 0);
  });
});
