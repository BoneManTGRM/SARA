import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperimentalCompilerCache } from "../src/experimental-compiler-cache.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { buildCodingRepairPrompt } from "../src/coding-repair-prompt.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const allowed = "export function first(values: readonly number[]): number { return values.at(0) ?? 0; }\n";
function fixture(source: string, testSource?: string): ProgramCandidateProposal {
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: "Source Preflight",
    summary: "Independent source-policy and behavior controls.", limitations: [], files: [
      { path: "src/index.ts", content: 'export * from "./value.ts";\n' },
      { path: "src/value.ts", content: source },
      { path: "tests/value.test.ts", content: testSource ?? 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { first } from "../src/value.ts";\ntest("value", () => { assert.equal(first([7]), 7); assert.equal(first([]), 0); });\n' },
    ] };
}
function verify(candidate: ProgramCandidateProposal, cache?: ExperimentalCompilerCache) {
  return verifyGenomeLabProgramCandidate({ candidate, objective: "Return first or zero.",
    acceptanceCriteria: ["Return the first value or zero for an empty input."], constitutionDigest: "c".repeat(64),
    experimentalCompilerCache: cache });
}

for (const [name, source, code] of [
  ["computed index", "export function first(values: readonly number[]): number { return values[0] ?? 0; }", "GENOME_LAB_COMPUTED_ACCESS"],
  ["optional computed index", "export function first(values: readonly number[]): number { return values?.[0] ?? 0; }", "GENOME_LAB_COMPUTED_ACCESS"],
  ["any type", "export function first(values: any): number { return 0; }", "GENOME_LAB_ANY_TYPE"],
  ["blocked identifier", "export function first(values: readonly number[]): number { return Date.now(); }", "GENOME_LAB_BLOCKED_IDENTIFIER"],
  ["blocked property", "export function first(values: readonly number[]): number { return values.constructor ? 1 : 0; }", "GENOME_LAB_BLOCKED_PROPERTY"],
  ["external module", 'import fs from "node:fs"; export function first(values: readonly number[]): number { return 0; }', "GENOME_LAB_EXTERNAL_MODULE"],
  ["absent relative module", 'import { missing } from "./absent.ts"; export function first(values: readonly number[]): number { return missing; }', "GENOME_LAB_RELATIVE_MODULE"],
  ["source imports test", 'import "../tests/value.test.ts"; export function first(values: readonly number[]): number { return 0; }', "GENOME_LAB_TEST_IMPORT"],
  ["extensionless module", 'import "./index"; export function first(values: readonly number[]): number { return 0; }', "GENOME_LAB_IMPORT_EXTENSION"],
] as const) {
  test(`preflight rejects ${name} before a compiler host or runtime is created`, async () => {
    const cache = new ExperimentalCompilerCache();
    let hosts = 0;
    const original = cache.createHost.bind(cache);
    cache.createHost = options => { hosts++; return original(options); };
    const result = await verify(fixture(source), cache);
    assert.equal(result.passed, false);
    assert.equal(hosts, 0);
    assert.equal(result.score, 0.2);
    assert.deepEqual(result.completedChecks, ["source_policy", "artifact_integrity"]);
    assert.equal(result.failures[0]?.code, code);
    assert.equal(result.failures[0]?.file, "src/value.ts");
    assert.ok(result.failures[0]!.line > 0);
    assert.ok(result.failures[0]!.column > 0);
  });
}

test("protected policy failures expose neither test path, location, literals nor reason", async () => {
  const result = await verify(fixture(allowed, 'const privateSentinel = ["HIDDEN_SENTINEL_96420"]; privateSentinel[0];\n'));
  assert.equal(result.passed, false);
  assert.equal(result.failures[0]?.code, "GENOME_LAB_PROTECTED_SOURCE_REJECTED");
  assert.equal(result.failures[0]?.file, "");
  assert.equal(result.failures[0]?.line, 0);
  assert.equal(result.failures[0]?.column, 0);
  assert.doesNotMatch(JSON.stringify(result), /HIDDEN_SENTINEL_96420|tests\/value|COMPUTED_ACCESS/);
});

test("preflight syntax failures stay syntax failures without invoking a compiler host", async () => {
  const result = await verify(fixture("export function first( {"));
  assert.equal(result.passed, false);
  assert.equal(result.failures[0]?.kind, "syntax");
  assert.equal(result.failures[0]?.code, "GENOME_LAB_SOURCE_SYNTAX");
  assert.equal(result.completedChecks.includes("typecheck"), false);
});

test("valid source still needs fresh semantic and isolated behavioral verification", async () => {
  const cache = new ExperimentalCompilerCache();
  const valid = fixture(allowed);
  const good = await verify(valid, cache);
  assert.equal(good.passed, true);
  assert.equal(good.score, 1);
  assert.ok(good.completedChecks.includes("behavior_tests"));
  const wrongType = await verify(fixture('export function first(values: readonly number[]): number { return "wrong"; }'), cache);
  assert.equal(wrongType.passed, false);
  assert.ok(wrongType.failures.some(failure => failure.kind === "type"));
  const wrongBehavior = await verify(fixture("export function first(values: readonly number[]): number { return 0; }"), cache);
  assert.equal(wrongBehavior.passed, false);
  assert.ok(wrongBehavior.failures.some(failure => failure.kind === "behavior"));
  const goodAgain = await verify(valid, cache);
  assert.equal(goodAgain.passed, true);
  assert.equal(goodAgain.artifactDigest, good.artifactDigest);
});

test("the established critical security path remains critical", async () => {
  const result = await verify(fixture("export function first(values: readonly number[]): number { process.exit(); return 0; }"));
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(failure => failure.kind === "security" && failure.severity === "critical"));
});

test("specific source diagnosis reaches the repair prompt without protected-test text", async () => {
  const candidate = fixture("export function first(values: readonly number[]): number { return values[0] ?? 0; }");
  const result = await verify(candidate);
  const prompt = buildCodingRepairPrompt({ objective: "Return first or zero.", acceptanceCriteria: ["Return first or zero."],
    candidate, artifactDigest: result.artifactDigest, failures: result.failures, previouslyPassingChecks: [], remainingCycles: 3,
    remainingCostUsd: 0.075, verifiedLessons: [], constitutionDigest: "c".repeat(64), limits: INITIAL_CODING_REPAIR_LIMITS, strategy: "surgical" });
  assert.match(prompt, /GENOME_LAB_COMPUTED_ACCESS/);
  assert.match(prompt, /Computed property or element access is prohibited/);
  assert.doesNotMatch(prompt, /assert.equal\(first/);
});

test("caller mutation across awaits cannot substitute the admitted source", async () => {
  const candidate = fixture(allowed);
  const expected = await verify(candidate);
  const pending = verify(candidate);
  candidate.files[1]!.content = "export function first(values: readonly number[]): number { return values[0] ?? 0; }";
  const result = await pending;
  assert.equal(result.passed, true);
  assert.equal(result.artifactDigest, expected.artifactDigest);
});
