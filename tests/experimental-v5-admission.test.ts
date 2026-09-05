import assert from "node:assert/strict";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/experimental-v5/coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { ProgramVerificationResult } from "../src/experimental-v5/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
const baseline: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "admission", summary: "offline", limitations: [], files: [{ path: "src/value.ts", content: "export const value = 0;\n" }] };
const result = (c: ProgramCandidateProposal): ProgramVerificationResult => ({ passed: false, score: 0.5, artifactDigest: sha256(JSON.stringify(c.files)), completedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"], evidenceDigests: [sha256("fixture")], failures: [{ kind: "behavior", code: "WRONG", file: "src/value.ts", line: 1, column: 1, severity: "medium", existedBeforeRepair: true, evidenceDigest: sha256("evidence"), fingerprint: sha256("failure") }] });
for (const patch of [{ maximumCycles: 4 }, { protectedPaths: [] }]) it(`rejects authority expansion before verification: ${JSON.stringify(patch)}`, async () => {
  let calls = 0;
  await assert.rejects(runCodingRepairController({ baseline, limits: { ...INITIAL_CODING_REPAIR_LIMITS, ...patch }, verify: async c => { calls++; return result(c); }, model: { propose: async () => { throw Error("must not call"); } } }), /limit|protect/iu);
  assert.equal(calls, 0);
});
it("snapshots limits before asynchronous verifier callbacks", async () => {
  const limits = structuredClone(INITIAL_CODING_REPAIR_LIMITS); let calls = 0;
  const run = await runCodingRepairController({ baseline, limits, verify: async c => { limits.maximumCycles = 9; return result(c); }, model: { propose: async input => { calls++; return { inputTokens: 1, outputTokens: 1, accountedCostUsd: 0.001, proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest, failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy, limitations: [], changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content), replacementText: `export const value = ${calls};\n` }] } }; } } });
  assert.equal(calls, 3); assert.equal(run.state, "STOPPED");
});
it("rejects a truthy non-boolean verification result", async () => {
  await assert.rejects(runCodingRepairController({ baseline, verify: async c => ({ ...result(c), passed: "false" } as unknown as ProgramVerificationResult), model: { propose: async () => { throw Error("must not call"); } } }), /verification/iu);
});
it("rejects malformed model token accounting", async () => {
  await assert.rejects(runCodingRepairController({ baseline, verify: async c => result(c), model: { propose: async input => ({ inputTokens: -1, outputTokens: 1, accountedCostUsd: 0.001, proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest, failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy, limitations: [], changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content), replacementText: "export const value = 1;\n" }] } }) } }), /token/iu);
});
