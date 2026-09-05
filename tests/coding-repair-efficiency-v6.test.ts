import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runMatchedCodingRepairBenchmark } from "../src/coding-repair-matched-benchmark.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { WorkerModelClient } from "../src/model-router.ts";

const context = { objective: "Return a nonnegative bounded count.", acceptanceCriteria: ["Preserve values from zero through ten; clamp outside that range."], constitutionDigest: "a".repeat(64), missingCapabilities: [], memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
const source = "export function count(n: number): number {\n  return Math.max(0, n);\n}\n";
const repaired = source.replace("Math.max(0, n)", "Math.min(10, Math.max(0, n))");
const hidden = 'import { count } from "../src/count.ts";\nif (count(-1)!==0 || count(5)!==5 || count(20)!==10) throw new Error("HIDDEN_ORACLE_MARKER");\n';
function candidate(withIndex = true): ProgramCandidateProposal {
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: "Efficiency fixture", summary: "owned deterministic fixture", limitations: [], files: [...(withIndex ? [{ path: "src/index.ts", content: 'export { count } from "./count.ts";\n' }] : []), { path: "src/count.ts", content: source }, { path: "tests/count.test.ts", content: hidden }] };
}

describe("V6 actual controller efficiency", () => {
  it("rejects an unrepairable two-file scaffold before any model call", async () => {
    let calls = 0;
    const baseline = candidate(false);
    const result = await runCodingRepairController({
      baseline,
      verify: (value) => verifyGenomeLabProgramCandidate({ ...context, candidate: value }),
      model: { async propose(request) {
        calls++;
        return { proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest, failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy, changes: [{ path: "src/count.ts", expectedContentDigest: sha256(request.candidate.files.find(f=>f.path === "src/count.ts")!.content), replacementText: repaired }], limitations: [] }, inputTokens: 10, outputTokens: 10, accountedCostUsd: 0.001 };
      } },
    });
    assert.equal(calls, 0, "Invalid scaffold is not a repairable behavior failure and must not spend three attempts.");
    assert.equal(result.state, "STOPPED");
    assert.equal(result.accountedCostUsd, 0);
    assert.equal(result.verification.failures[0].code, "GENOME_LAB_INVALID_STRUCTURE");
    assert(!result.verification.completedChecks.includes("behavior_tests"));
    assert(!JSON.stringify(result.verification).includes("HIDDEN_ORACLE_MARKER"));
  });

  it("materializes opt-in continuation edits into the exact verified full proposal", async () => {
    const baseline = candidate();
    const verification = await verifyGenomeLabProgramCandidate({ ...context, candidate: baseline });
    let prompt = "";
    const patch = { schemaVersion: 1, baseArtifactDigest: verification.artifactDigest, failureFingerprint: verification.failures[0].fingerprint, strategy: "deep", changes: [{ path: "src/count.ts", expectedContentDigest: sha256(source), edits: [{ find: "Math.max(0, n)", replace: "Math.min(10, Math.max(0, n))" }] }], limitations: [] };
    const client: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
      async countInputTokens(value) { prompt = value; return 100; },
      async execute(input) { assert.equal(input.reasoningLevel, "medium"); return { outputText: JSON.stringify(patch), inputTokens: 100, billableOutputTokens: 50 }; },
    };
    const model = createLunaCodingRepairModel({ client, context, compactRepairContinuations: true } as Parameters<typeof createLunaCodingRepairModel>[0]);
    const result = await model.propose({ candidate: baseline, verification, strategy: "surgical", cycle: 2, remainingCostUsd: 0.15, attemptLessons: [] });
    assert.deepEqual(result.proposal.changes, [{ path: "src/count.ts", expectedContentDigest: sha256(source), replacementText: repaired }], "Sparse transport must produce the unchanged canonical full-proposal boundary.");
    assert.equal(result.proposal.strategy, "surgical");
    assert(prompt.startsWith("OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1"));
    assert(!prompt.includes("HIDDEN_ORACLE_MARKER"));
    const final = candidate();
    final.files.find(f=>f.path === "src/count.ts")!.content = result.proposal.changes[0].replacementText;
    assert.equal((await verifyGenomeLabProgramCandidate({ ...context, candidate: final })).passed, true);
  });
  it("rejects an invalid matched baseline before either arm calls a model", async () => {
    let calls = 0;
    await assert.rejects(() => runMatchedCodingRepairBenchmark({
      caseId: "invalid-scaffold-v6", sourceCommit: "c".repeat(40),
      modelRouteKey: "openai:gpt-5.6-luna:paid", environment: { node: process.version },
      objective: context.objective, acceptanceCriteria: context.acceptanceCriteria,
      constitutionDigest: context.constitutionDigest, memoryContextDigest: context.memoryContext.contextDigest,
      baseline: candidate(false),
      verify: value => verifyGenomeLabProgramCandidate({ ...context, candidate: value }),
      model: { async propose() { calls++; throw new Error("MODEL_WAS_CALLED"); } },
    }), /invalid candidate structure/u);
    assert.equal(calls, 0);
  });

});
