import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runCodingBenchmarkArm, runMatchedCodingBenchmarkCase, type CodingBenchmarkCase } from "../src/coding-repair-benchmark-runner.ts";
import type { CodingBenchmarkBindings, CodingBenchmarkMethod } from "../src/coding-repair-benchmark.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (value: string) => sha256(value);
const methods: CodingBenchmarkMethod[] = ["luna", "luna_reparodynamic"];
function fixture() {
  const benchmarkCase: CodingBenchmarkCase = {
    schemaVersion: 1, caseId: "fair-retry-001", taskClass: "synthetic", taskFamily: "bounded-retry-memory",
    objective: "Repair value to equal 42.", acceptanceCriteria: ["The exported value equals 42."],
    baseline: {
      schemaVersion: 1, candidateKind: "typescript_program", programName: "Fair retry fixture",
      summary: "One bounded visible defect.", limitations: [],
      files: [
        { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
        { path: "src/value.ts", content: "export const value = 1;\n" },
        { path: "tests/value.test.ts", content: "// immutable acceptance\n" },
      ],
    },
  };
  const context = {
    objective: benchmarkCase.objective, acceptanceCriteria: [...benchmarkCase.acceptanceCriteria], missingCapabilities: [],
    constitutionDigest: digest("constitution"), memoryContext: { contextDigest: digest("shared-memory"), memories: [] },
  };
  return { benchmarkCase, context };
}
function verify(candidate: ProgramCandidateProposal): ProgramVerificationResult {
  const passed = candidate.files.find(file => file.path === "src/value.ts")!.content === "export const value = 42;\n";
  return {
    passed, score: passed ? 1 : 0.8, artifactDigest: sha256(canonicalJson(candidate.files)),
    failures: passed ? [] : [{ kind: "behavior", code: "EXPECTED_42", file: "src/value.ts", line: 1, column: 1,
      evidenceDigest: digest("failure evidence"), fingerprint: digest("failure"), severity: "medium", existedBeforeRepair: true }],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [digest(passed ? "pass evidence" : "failure evidence")],
  };
}
function model(values: number[], requests: Parameters<CodingRepairModel["propose"]>[0][] = []): CodingRepairModel {
  return { propose: async request => {
    requests.push(structuredClone(request));
    const value = values[Math.min(requests.length - 1, values.length - 1)]!;
    const file = request.candidate.files.find(item => item.path === "src/value.ts")!;
    return {
      proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
        failureFingerprint: request.verification.failures[0]!.fingerprint, strategy: request.strategy,
        changes: [{ path: file.path, expectedContentDigest: sha256(file.content), replacementText: `export const value = ${value};\n` }], limitations: [] },
      inputTokens: 20, outputTokens: 10, accountedCostUsd: 0.01,
    };
  } };
}
const bindings: CodingBenchmarkBindings = {
  sourceCommit: digest("source"), corpusDigest: digest("corpus"), modelDigest: digest("model"), controllerDigest: digest("controller"),
  policyDigest: digest("policy"), verifierDigest: digest("verifier"), environmentDigest: digest("environment"), authorityDigest: digest("authority"),
};

describe("conservative matched retry-and-memory benchmark", () => {
  for (const method of methods) {
    it(`${method}: permits the same second and third repair opportunities with bounded memory`, async () => {
      for (const values of [[2, 42], [2, 3, 42]]) {
        const requests: Parameters<CodingRepairModel["propose"]>[0][] = [];
        const result = await runCodingBenchmarkArm({ method, ...fixture(), verify: async candidate => verify(candidate), model: model(values, requests) });
        assert.equal(result.verifiedComplete, true);
        assert.equal(result.cycles, values.length);
        assert.equal(result.accountedCostUsd, values.length * 0.01);
        assert.equal(requests.length, values.length);
        assert.deepEqual(requests.map(request => request.attemptLessons?.length ?? 0), values.map((_, index) => index));
        assert.ok(requests.slice(1).every(request => request.candidate.files[1]!.content === "export const value = 1;\n"));
      }
    });
    it(`${method}: rechecks the final artifact independently before declaring completion`, async () => {
      let verifications = 0;
      const result = await runCodingBenchmarkArm({ method, ...fixture(), model: model([42]), verify: async candidate => { verifications++; return verify(candidate); } });
      assert.equal(result.verifiedComplete, true);
      assert.equal(verifications, 3, "initial, proposed candidate, independently retained artifact");
    });
    it(`${method}: does not promote an unstable final verification`, async () => {
      let repairedChecks = 0;
      const result = await runCodingBenchmarkArm({ method, ...fixture(), model: model([42]), verify: async candidate => {
        const observed = verify(candidate);
        if (observed.passed && ++repairedChecks > 1) return { ...observed, passed: false, score: 0.8, failures: verify(fixture().benchmarkCase.baseline).failures };
        return observed;
      } });
      assert.equal(result.verifiedComplete, false);
      assert.equal(result.failureCode, "post_verification_failed");
      assert.equal(result.accountedCostUsd, 0.01);
    });
    it(`${method}: keeps three repair opportunities inside the same lower arm ceiling`, async () => {
      const requests: Parameters<CodingRepairModel["propose"]>[0][] = [];
      const underlying = model([2, 3, 42], requests);
      const result = await runCodingBenchmarkArm({ method, ...fixture(),
        limits: { ...INITIAL_CODING_REPAIR_LIMITS, maximumModelSpendUsd: 0.075 },
        verify: async candidate => verify(candidate), model: { propose: async request => ({
          ...await underlying.propose(request), accountedCostUsd: 0.02,
        }) } });
      assert.equal(result.verifiedComplete, true);
      assert.equal(result.cycles, 3);
      assert.equal(result.accountedCostUsd, 0.06);
      assert.equal(requests.length, 3);
      for (const [index, request] of requests.entries()) {
        assert.ok(Math.abs(request.remainingCostUsd - (0.075 - index * 0.02)) < 1e-12);
      }
    });
    it(`${method}: stops an incorrect lower-budget arm without spending its sibling allocation`, async () => {
      const requests: Parameters<CodingRepairModel["propose"]>[0][] = [];
      const underlying = model([2, 42], requests);
      let verifications = 0;
      const result = await runCodingBenchmarkArm({ method, ...fixture(),
        limits: { ...INITIAL_CODING_REPAIR_LIMITS, maximumModelSpendUsd: 0.075 },
        verify: async candidate => { verifications++; return verify(candidate); },
        model: { propose: async request => ({
          ...await underlying.propose(request), accountedCostUsd: 0.075,
        }) } });
      assert.equal(result.verifiedComplete, false);
      assert.equal(result.accountedCostUsd, 0.075);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.remainingCostUsd, 0.075);
      assert.equal(verifications, 3, "baseline, failed proposal, fresh retained artifact");
      assert.ok(result.verifierEvidenceDigests.length > 0);
    });
    it(`${method}: rejects larger budgets and cycle limits before any callback`, async () => {
      for (const limits of [
        { ...INITIAL_CODING_REPAIR_LIMITS, maximumCycles: 4 },
        { ...INITIAL_CODING_REPAIR_LIMITS, maximumModelSpendUsd: 0.16 },
        { ...INITIAL_CODING_REPAIR_LIMITS, protectedPaths: [] },
        { ...INITIAL_CODING_REPAIR_LIMITS, maximumCycles: 1.5 },
      ]) {
        let callbacks = 0;
        await assert.rejects(runCodingBenchmarkArm({ method, ...fixture(), limits,
          model: { propose: async () => { callbacks++; throw new Error("must not run"); } },
          verify: async candidate => { callbacks++; return verify(candidate); } }), /limit|protected|expand/iu);
        assert.equal(callbacks, 0);
      }
    });
    it(`${method}: freezes admitted limits across asynchronous model callbacks`, async () => {
      const limits = { ...INITIAL_CODING_REPAIR_LIMITS, protectedPaths: [...INITIAL_CODING_REPAIR_LIMITS.protectedPaths] };
      const requests: Parameters<CodingRepairModel["propose"]>[0][] = [];
      const underlying = model([2, 3, 4], requests);
      const result = await runCodingBenchmarkArm({ method, ...fixture(), limits, verify: async candidate => verify(candidate), model: { propose: async request => {
        limits.maximumCycles = 99; limits.maximumModelSpendUsd = 20; limits.protectedPaths.length = 0;
        return underlying.propose(request);
      } } });
      assert.equal(result.cycles, 3);
      assert.equal(result.verifiedComplete, false);
      assert.equal(result.accountedCostUsd, 0.03);
      assert.deepEqual(requests.map(request => request.remainingCostUsd), [0.15, 0.13999999999999999, 0.13]);
    });
    it(`${method}: rejects invalid token accounting before verifying a proposal`, async () => {
      let verifications = 0;
      const underlying = model([42]);
      const result = await runCodingBenchmarkArm({ method, ...fixture(), verify: async candidate => { verifications++; return verify(candidate); }, model: { propose: async request => ({ ...await underlying.propose(request), inputTokens: Infinity }) } });
      assert.equal(result.verifiedComplete, false);
      assert.equal(verifications, 1);
    });
  }
  it("rejects an unknown method instead of silently selecting treatment", async () => {
    await assert.rejects(runCodingBenchmarkArm({ method: "unknown" as CodingBenchmarkMethod, ...fixture(), verify: async candidate => verify(candidate), model: model([42]) }), /method/iu);
  });
  it("freezes the matched case, limits and bindings before arm-persistence callbacks", async () => {
    const input = fixture(); const originalBindings = structuredClone(bindings);
    const pair = await runMatchedCodingBenchmarkCase({ ...input, bindings: originalBindings, benchmarkId: "11111111-1111-4111-8111-111111111111", pairIndex: 2,
      verify: async candidate => verify(candidate), modelFor: () => model([2, 42]), onArm: () => {
        input.benchmarkCase.baseline.files[1]!.content = "export const value = 42;\n";
        originalBindings.environmentDigest = digest("changed environment");
      } });
    assert.equal(pair.normal.cycles, 2); assert.equal(pair.reparodynamic.cycles, 2);
    assert.deepEqual(pair.bindings, bindings);
  });
  it("does not label unspecified scripted execution as live evidence", async () => {
    const pair = await runMatchedCodingBenchmarkCase({ ...fixture(), bindings, benchmarkId: "11111111-1111-4111-8111-111111111111", pairIndex: 2,
      verify: async candidate => verify(candidate), modelFor: () => model([42]) });
    assert.equal(pair.executionKind, "simulated");
  });
});
