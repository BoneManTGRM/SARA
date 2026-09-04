import * as ts from "typescript";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runMatchedCodingRepairBenchmark } from "../src/coding-repair-matched-benchmark.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { loadConstitution } from "../src/constitution.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const SPEND_FLAG = "--acknowledge-max-spend-usd=0.15";
if (!process.argv.includes("--live")) throw new Error("The matched benchmark requires an explicit --live flag.");
if (!process.argv.includes(SPEND_FLAG)) {
  throw new Error(`The matched benchmark requires ${SPEND_FLAG}.`);
}
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
const sourceCommit = (
  process.env.SARA_BENCHMARK_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  ""
).trim().toLowerCase();
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) {
  throw new Error("Set SARA_BENCHMARK_COMMIT_SHA to the exact 40-character benchmark commit.");
}

const objective = "Repair allocateCents so every independently verified allocation is exact and deterministic.";
const acceptanceCriteria = [
  "Reject a negative or non-integer total with RangeError.",
  "Reject non-finite or negative weights and reject an all-zero weight vector.",
  "Return non-negative integer allocations whose sum equals totalCents.",
  "Use proportional largest remainders with the lowest index winning exact ties.",
];
const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Frozen allocation benchmark v1",
  summary: "Synthetic public TypeScript fixture with one type defect and hidden allocation regressions.",
  limitations: ["Synthetic benchmark only. No repository, customer, deployment, or authority mutation."],
  files: [
    {
      path: "src/allocate.ts",
      content: [
        "export function allocateCents(totalCents: number, weights: readonly number[]): number[] {",
        '  const marker: number = "broken";',
        "  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);",
        "  return weights.map((weight) => Math.round(totalCents * weight / weightTotal));",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: "tests/allocate.test.ts",
      content: [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { allocateCents } from "../src/allocate.ts";',
        'test("uses stable largest remainders", () => assert.deepEqual(allocateCents(10, [1, 1, 1]), [4, 3, 3]));',
        'test("preserves zeros", () => assert.deepEqual(allocateCents(5, [0, 2]), [0, 5]));',
        'test("rejects invalid totals", () => assert.throws(() => allocateCents(1.5, [1]), RangeError));',
        'test("rejects invalid weights", () => {',
        '  assert.throws(() => allocateCents(5, [0, 0]), RangeError);',
        '  assert.throws(() => allocateCents(5, [-1, 2]), RangeError);',
        "});",
        "",
      ].join("\n"),
    },
  ],
};
const { digest: constitutionDigest } = await loadConstitution();
const memoryContext = { contextDigest: sha256(canonicalJson([])), memories: [] };
const client = new OpenAIResponsesClient({ apiKey, timeoutMs: 120_000 });
const context = {
  objective,
  acceptanceCriteria,
  missingCapabilities: [],
  constitutionDigest,
  memoryContext,
};
const result = await runMatchedCodingRepairBenchmark({
  caseId: "allocate-cents-staged-v1",
  sourceCommit,
  modelRouteKey: client.routeKey,
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    typescript: ts.version,
  },
  objective,
  acceptanceCriteria,
  constitutionDigest,
  memoryContextDigest: memoryContext.contextDigest,
  baseline,
  verify: async (candidate) => verifyGenomeLabProgramCandidate({
    candidate,
    objective,
    acceptanceCriteria,
    constitutionDigest,
    maximumBudgetUsd: INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd,
  }),
  model: createLunaCodingRepairModel({ client, context }),
  limits: INITIAL_CODING_REPAIR_LIMITS,
});
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
