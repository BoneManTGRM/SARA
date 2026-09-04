import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  runCodingBenchmarkArm,
  runMatchedCodingBenchmarkCase,
  type CodingBenchmarkCase,
} from "../src/coding-repair-benchmark-runner.ts";
import type { CodingBenchmarkBindings } from "../src/coding-repair-benchmark.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const digest = (character: string): string => character.repeat(64);
const bindings: CodingBenchmarkBindings = {
  sourceCommit: digest("1"),
  corpusDigest: digest("2"),
  modelDigest: digest("3"),
  controllerDigest: digest("4"),
  policyDigest: digest("5"),
  verifierDigest: digest("6"),
  environmentDigest: digest("7"),
  authorityDigest: digest("8"),
};
const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Matched repair fixture",
  summary: "A bounded program with one behavioral defect.",
  limitations: [],
  files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: "export const value = 1;\n" },
    { path: "tests/value.test.ts", content: "// immutable hidden behavior\n" },
  ],
};
const failure: CodingFailureSignal = {
  kind: "behavior",
  code: "EXPECTED_42",
  file: "src/value.ts",
  line: 1,
  column: 1,
  evidenceDigest: digest("a"),
  fingerprint: digest("b"),
  severity: "medium",
  existedBeforeRepair: true,
};
const benchmarkCase: CodingBenchmarkCase = {
  schemaVersion: 1,
  caseId: "case-001",
  taskClass: "synthetic",
  taskFamily: "bounded-typescript",
  objective: "Repair the program so value is 42.",
  acceptanceCriteria: ["The exported value is 42."],
  baseline,
};

function verification(candidate: ProgramCandidateProposal): ProgramVerificationResult {
  const fixed = candidate.files[1].content.includes("42");
  return {
    passed: fixed,
    score: fixed ? 1 : 0.8,
    artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures: fixed ? [] : [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: fixed ? [digest("c")] : [failure.evidenceDigest],
  };
}

function replacementModel(values: number[]): CodingRepairModel {
  let call = 0;
  return {
    propose: async ({ candidate, verification: observed, strategy }) => {
      const value = values[Math.min(call, values.length - 1)];
      call += 1;
      return {
        proposal: {
          schemaVersion: 1,
          baseArtifactDigest: observed.artifactDigest,
          failureFingerprint: observed.failures[0].fingerprint,
          strategy,
          changes: [{
            path: "src/value.ts",
            expectedContentDigest: sha256(candidate.files[1].content),
            replacementText: `export const value = ${value};\n`,
          }],
          limitations: [],
        },
        inputTokens: 20,
        outputTokens: 10,
        accountedCostUsd: 0.01,
      };
    },
  };
}

const context = {
  objective: benchmarkCase.objective,
  acceptanceCriteria: benchmarkCase.acceptanceCriteria,
  missingCapabilities: [],
  constitutionDigest: digest("d"),
  memoryContext: { contextDigest: digest("e"), memories: [] },
};

describe("matched identical-Luna coding benchmark runner", () => {
  it("records a one-pass normal arm and a bounded Reparodynamic arm independently", async () => {
    const normal = await runCodingBenchmarkArm({
      method: "luna",
      benchmarkCase,
      context,
      verify: async (candidate) => verification(candidate),
      model: replacementModel([42]),
    });
    const reparodynamic = await runCodingBenchmarkArm({
      method: "luna_reparodynamic",
      benchmarkCase,
      context,
      verify: async (candidate) => verification(candidate),
      model: replacementModel([42]),
    });
    assert.equal(normal.verifiedComplete, true);
    assert.equal(normal.cycles, 1);
    assert.equal(reparodynamic.verifiedComplete, true);
    assert.equal(reparodynamic.cycles, 1);
    assert.equal(normal.accountedCostUsd, 0.01);
    assert.equal(reparodynamic.accountedCostUsd, 0.01);
  });

  it("preserves the failed normal arm while Reparodynamics retries and verifies improvement", async () => {
    const observedMethods: string[] = [];
    const pair = await runMatchedCodingBenchmarkCase({
      benchmarkId: "11111111-1111-4111-8111-111111111111",
      pairIndex: 1,
      benchmarkCase,
      bindings,
      context,
      verify: async (candidate) => verification(candidate),
      modelFor: (method) => method === "luna" ? replacementModel([2]) : replacementModel([2, 42]),
      onArm: (receipt) => { observedMethods.push(receipt.result.method); },
      completedAt: () => "2026-09-04T00:00:00.000Z",
    });
    assert.deepEqual(pair.order, ["luna_reparodynamic", "luna"]);
    assert.deepEqual(observedMethods, pair.order);
    assert.equal(pair.normal.verifiedComplete, false);
    assert.equal(pair.normal.cycles, 1);
    assert.equal(pair.reparodynamic.verifiedComplete, true);
    assert.equal(pair.reparodynamic.cycles, 2);
    assert.equal(pair.reparodynamic.rollbacks, 1);
  });

  it("alternates arm order to reduce temporal ordering bias", async () => {
    const observedMethods: string[] = [];
    const pair = await runMatchedCodingBenchmarkCase({
      benchmarkId: "11111111-1111-4111-8111-111111111111",
      pairIndex: 2,
      benchmarkCase: { ...benchmarkCase, caseId: "case-002" },
      bindings,
      context,
      verify: async (candidate) => verification(candidate),
      modelFor: () => replacementModel([42]),
      onArm: (receipt) => { observedMethods.push(receipt.result.method); },
      completedAt: () => "2026-09-04T00:00:00.000Z",
    });
    assert.deepEqual(pair.order, ["luna", "luna_reparodynamic"]);
    assert.deepEqual(observedMethods, pair.order);
  });

  it("records an execution failure instead of selectively dropping or rerunning the arm", async () => {
    const result = await runCodingBenchmarkArm({
      method: "luna",
      benchmarkCase,
      context,
      verify: async (candidate) => verification(candidate),
      model: { propose: async () => { throw new Error("provider failed after request"); } },
    });
    assert.equal(result.verifiedComplete, false);
    assert.equal(result.failureCode, "arm_execution_failed");
    assert.equal(result.accountedCostUsd, null);
    assert.equal(result.finalArtifactDigest, verification(baseline).artifactDigest);
  });
});
