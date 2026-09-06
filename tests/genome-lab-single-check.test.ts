import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperimentalCompilerCache } from "../src/experimental-compiler-cache.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

function candidate(source: string): ProgramCandidateProposal {
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: "Single check fixture", summary: "fixture", limitations: [],
    files: [{ path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
      { path: "src/value.ts", content: source },
      { path: "tests/value.test.ts", content: 'import { value } from "../src/value.ts";\nif (value !== 42) throw new Error("protected acceptance mismatch");\n' }] };
}
function verify(source: string, cache: ExperimentalCompilerCache) {
  return verifyGenomeLabProgramCandidate({ candidate: candidate(source), objective: "Return the accepted value.",
    acceptanceCriteria: ["The value is 42."], constitutionDigest: "c".repeat(64), experimentalCompilerCache: cache });
}
function countedCache() {
  const cache = new ExperimentalCompilerCache();
  let hosts = 0;
  const original = cache.createHost.bind(cache);
  cache.createHost = options => { hosts++; return original(options); };
  return { cache, hosts: () => hosts };
}

test("one fresh compiler and full isolated behavior are required for each eligible candidate", async () => {
  const state = countedCache();
  const first = await verify("export const value: number = 42;\n", state.cache);
  assert.equal(first.passed, true);
  assert.equal(state.hosts(), 1);
  assert.deepEqual(first.completedChecks, ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"]);
  const wrong = await verify("export const value: number = 41;\n", state.cache);
  assert.equal(wrong.passed, false);
  assert.equal(wrong.failures[0]?.code, "GENOME_LAB_RUNTIME_FAILURE");
  assert.equal(state.hosts(), 2);
  const again = await verify("export const value: number = 42;\n", state.cache);
  assert.equal(again.passed, true);
  assert.equal(again.artifactDigest, first.artifactDigest);
  assert.equal(state.hosts(), 3);
});

test("actual builder type errors retain stable source-only structured locations", async () => {
  const state = countedCache();
  const one = await verify('export const value: number = "wrong";\n', state.cache);
  const two = await verify('export const value: number = "wrong";\n', state.cache);
  assert.equal(state.hosts(), 2);
  assert.equal(one.passed, false);
  assert.equal(one.score, 0.6);
  const failure = one.failures.find(f => f.code === "TS2322");
  assert.equal(failure?.file, "src/value.ts");
  assert.equal(failure?.line, 1);
  assert.equal(failure?.fingerprint, two.failures.find(f => f.code === "TS2322")?.fingerprint);
  assert.equal(one.completedChecks.includes("behavior_tests"), false);
  assert.doesNotMatch(JSON.stringify(one), /\/tmp\/|wrong|protected acceptance mismatch/);
});

test("compiler infrastructure failure cannot be described as a behavioral test result", async () => {
  const cache = new ExperimentalCompilerCache();
  cache.createHost = () => { throw new Error("PRIVATE_COMPILER_FAILURE_SENTINEL"); };
  const result = await verify("export const value: number = 42;\n", cache);
  assert.equal(result.passed, false);
  assert.equal(result.failures[0]?.kind, "unknown");
  assert.equal(result.failures[0]?.code, "GENOME_LAB_VERIFICATION_INFRASTRUCTURE_FAILURE");
  assert.equal(result.completedChecks.includes("typecheck"), false);
  assert.equal(result.completedChecks.includes("behavior_tests"), false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_COMPILER_FAILURE_SENTINEL/);
});
