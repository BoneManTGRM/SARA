import assert from "node:assert/strict";
import { it } from "node:test";
import { buildCodingRepairPrompt } from "../src/coding-repair-prompt.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const candidate: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Bounded Language Fixture",
  summary: "Exercises the bounded TypeScript source contract.",
  limitations: [],
  files: [
    { path: "src/index.ts", content: 'export * from "./value.ts";\n' },
    {
      path: "src/value.ts",
      content: "export function first(values: readonly number[]): number { return values[0] ?? 0; }\n",
    },
    {
      path: "tests/value.test.ts",
      content: 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { first } from "../src/value.ts";\ntest("first", () => assert.equal(first([7]), 7));\n',
    },
  ],
};

it("surfaces computed element access as a source-policy rejection instead of a runtime failure", async () => {
  const result = await verifyGenomeLabProgramCandidate({
    candidate,
    objective: "Return the first value.",
    acceptanceCriteria: ["Return the first value, or zero for an empty input."],
    constitutionDigest: "c".repeat(64),
  });

  assert.equal(result.passed, false);
  assert.equal(result.score, 0.6);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.kind, "policy");
  assert.equal(result.failures[0]?.code, "GENOME_LAB_SOURCE_POLICY_REJECTED");
  assert.equal(result.failures[0]?.file, "src/value.ts");
  assert.match(result.failures[0]?.note ?? "", /computed property access is prohibited/i);
  assert.equal(result.failures.some((failure) => failure.code === "GENOME_LAB_RUNTIME_FAILURE"), false);
  assert.equal(result.completedChecks.includes("behavior_tests"), false);
});

it("tells the repair model the bounded source language before it proposes code", () => {
  const prompt = buildCodingRepairPrompt({
    objective: "Repair the source without violating the sandbox.",
    acceptanceCriteria: ["Return the correct value."],
    candidate,
    artifactDigest: "a".repeat(64),
    failures: [{
      kind: "behavior",
      code: "VISIBLE_FAILURE",
      file: "",
      line: 0,
      column: 0,
      evidenceDigest: "e".repeat(64),
      fingerprint: "f".repeat(64),
      severity: "medium",
      existedBeforeRepair: true,
    }],
    previouslyPassingChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"],
    remainingCycles: 3,
    remainingCostUsd: 0.075,
    verifiedLessons: [],
    constitutionDigest: "c".repeat(64),
    limits: INITIAL_CODING_REPAIR_LIMITS,
    strategy: "surgical",
  });

  const payload = JSON.parse(prompt.split("\n").at(-1)!) as {
    boundedSourceLanguageContract?: string[];
    forbidden?: string[];
    files?: Array<{ path: string; content?: string; immutableTest?: boolean }>;
  };
  assert.ok(payload.boundedSourceLanguageContract?.some((rule) => /computed property or element access is prohibited/i.test(rule)));
  assert.ok(payload.boundedSourceLanguageContract?.some((rule) => /values\[values\.length - 1\]/u.test(rule)));
  assert.ok(payload.forbidden?.includes("computed property or element access"));
  assert.equal(payload.files?.find((file) => file.path === "tests/value.test.ts")?.content, undefined);
  assert.equal(payload.files?.find((file) => file.path === "tests/value.test.ts")?.immutableTest, true);
});
