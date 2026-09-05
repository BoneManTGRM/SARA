import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingBenchmarkArm, type CodingBenchmarkCase } from "../src/coding-repair-benchmark-runner.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";

const baseline: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "Observer fixture", summary: "Offline audit fixture, not live task output", limitations: [], files: [{ path: "src/index.ts", content: "export const value = 1;" }] };
const benchmarkCase: CodingBenchmarkCase = { schemaVersion: 1, caseId: "observer-fixture", taskClass: "synthetic", taskFamily: "observer", objective: "Repair offline value fixture", acceptanceCriteria: ["value equals 42"], baseline };
const context = { objective: benchmarkCase.objective, acceptanceCriteria: benchmarkCase.acceptanceCriteria, missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
function verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult> {
  const passed = candidate.files[0].content.includes("42");
  return Promise.resolve({ passed, score: passed ? 1 : 0.8, artifactDigest: sha256(JSON.stringify(candidate)), failures: passed ? [] : [{ kind: "behavior", code: "WRONG_VALUE", file: "src/index.ts", line: 1, column: 1, severity: "medium", existedBeforeRepair: true, fingerprint: "c".repeat(64), evidenceDigest: "d".repeat(64) }], completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: ["e".repeat(64)] });
}
function model(values = [42]): CodingRepairModel {
  let call = 0;
  return { async propose(input) { return { proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest, failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy, changes: [{ path: "src/index.ts", expectedContentDigest: sha256(input.candidate.files[0].content), replacementText: `export const value = ${values[Math.min(call++, values.length - 1)]};` }], limitations: [] }, inputTokens: 10, outputTokens: 10, accountedCostUsd: 0.001 }; } };
}

describe("existing matched runner artifact capture", () => {
  for (const method of ["luna", "luna_reparodynamic"] as const) {
    it(`${method}: captures solution and separate fresh final verification`, async () => {
      const evidence: { kind: string; payload: unknown }[] = [];
      const result = await runCodingBenchmarkArm({ method, benchmarkCase, context, verify, model: model(), onEvidence: async (kind, payload) => { evidence.push({ kind, payload }); } });
      assert.equal(result.verifiedComplete, true);
      const checks = evidence.filter(e => e.kind === "verification");
      assert.equal(checks.length, 3);
      assert.match(JSON.stringify(checks.at(-1)), /value = 42/);
      assert.equal(evidence.filter(e => e.kind === "model_request").length, 1);
      assert.equal(evidence.filter(e => e.kind === "model_response").length, 1);
    });
    it(`${method}: retains failed/rolled-back solution attempts`, async () => {
      const evidence: unknown[] = [];
      const result = await runCodingBenchmarkArm({ method, benchmarkCase, context, verify, model: model([2, 42]), onEvidence: async (_kind, payload) => { evidence.push(payload); } });
      assert.equal(result.verifiedComplete, true);
      assert.ok(JSON.stringify(evidence).includes("value = 2"));
      assert.ok(JSON.stringify(evidence).includes("value = 42"));
      assert.equal(result.rollbacks, 1);
    });
    it(`${method}: stops before dispatch when mandatory pre-call capture fails`, async () => {
      let calls = 0;
      const result = await runCodingBenchmarkArm({ method, benchmarkCase, context, verify, model: { async propose(request) { calls++; return model().propose(request); } }, onEvidence: async kind => { if (kind === "model_request") throw new Error("disk failed"); } });
      assert.equal(result.verifiedComplete, false);
      assert.equal(calls, 0);
    });
    it(`${method}: evidence observer cannot alter accepted source or verification`, async () => {
      const result = await runCodingBenchmarkArm({ method, benchmarkCase, context, verify, model: model(), onEvidence: async (kind, payload) => { if (kind === "verification") (payload as { candidate: ProgramCandidateProposal }).candidate.files[0].content = "bad"; } });
      assert.equal(result.verifiedComplete, true);
    });
    it(`${method}: failed final artifact persistence prevents success`, async () => {
      let checks = 0;
      const result = await runCodingBenchmarkArm({ method, benchmarkCase, context, verify, model: model(), onEvidence: async kind => { if (kind === "verification" && ++checks === 3) throw new Error("disk failed"); } });
      assert.equal(result.verifiedComplete, false);
      assert.equal(result.failureCode, "post_verification_failed");
    });
  }
});
