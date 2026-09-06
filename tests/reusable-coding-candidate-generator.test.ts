import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator, type CodingRepairReuseSummary } from "../src/reusable-coding-candidate-generator.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { candidate, check, training, scope, context, model } from "./helpers/repair-memory-fixture.ts";

async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-reuse-wrapper-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function options(root: string) {
  const counter = { calls: 0 }; const summaries: CodingRepairReuseSummary[] = [];
  return { counter, summaries, base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary" as const,
    memory: new DurableCodingRepairMemory(root), scope: async () => scope, model: model(counter),
    verify: async (c: ReturnType<typeof candidate>) => check(c), onReuse: async (s: CodingRepairReuseSummary) => { summaries.push(s); } };
}

test("cold learns, restarted warm lookup avoids the model and still performs three fresh verifications", () => fixture(async root => {
  let calls = 0; const first = options(root); first.verify = async c => { calls++; return check(c); };
  assert.deepEqual(await createReusableCodingCandidateGenerator(first).generate(context), candidate(true));
  assert.equal(first.counter.calls, 1); assert.equal(calls, 3); assert(first.summaries[0].learnedRecipeId);
  const next = options(root); calls = 0; next.verify = async c => { calls++; return check(c); };
  assert.deepEqual(await createReusableCodingCandidateGenerator(next).generate(context), candidate(true));
  assert.equal(next.counter.calls, 0); assert.equal(calls, 3); assert.equal(next.summaries[0].hits, 1);
  assert.equal(next.summaries[0].modelRequests, 0); assert(next.summaries[0].finalFreshVerification);
}));

test("actual isolated compiler and behavioral verifier pass cold and warm without a provider", () => fixture(async root => {
  const first = options(root);
  first.verify = c => verifyGenomeLabProgramCandidate({ candidate: c, ...context });
  assert.deepEqual(await createReusableCodingCandidateGenerator(first).generate(context), candidate(true));
  assert.equal(first.counter.calls, 1); assert(first.summaries[0].learnedRecipeId);
  const warm = options(root); warm.verify = first.verify;
  assert.deepEqual(await createReusableCodingCandidateGenerator(warm).generate(context), candidate(true));
  assert.equal(warm.counter.calls, 0); assert.equal(warm.summaries[0].hits, 1);
}));

test("rejected cached proposal is quarantined and the existing next cycle falls back to the model", () => fixture(async root => {
  await new DurableCodingRepairMemory(root).learn(training()); const o = options(root); let verifies = 0;
  o.verify = async c => { verifies++; return check(c, verifies > 2); };
  assert.deepEqual(await createReusableCodingCandidateGenerator(o).generate(context), candidate(true));
  assert.equal(o.counter.calls, 1); assert.equal(o.summaries[0].hits, 1); assert.equal(o.summaries[0].quarantines, 1);
  assert.equal(await new DurableCodingRepairMemory(root).lookup(candidate(), check(candidate()), scope, "surgical"), null);
}));

test("a failed independent final verification is never learned or returned as successful", () => fixture(async root => {
  const o = options(root); let verifies = 0; o.verify = async c => check(c, ++verifies === 2);
  await assert.rejects(createReusableCodingCandidateGenerator(o).generate(context), /FINAL_VERIFICATION/);
  assert.equal(await o.memory.lookup(candidate(), check(candidate()), scope, "surgical"), null);
}));

test("final failure of a warm repair permanently quarantines it", () => fixture(async root => {
  const o = options(root); await o.memory.learn(training()); let n = 0; o.verify = async c => check(c, ++n === 2);
  await assert.rejects(createReusableCodingCandidateGenerator(o).generate(context), /FINAL_VERIFICATION/);
  assert.equal(o.counter.calls, 0); assert.equal(await o.memory.lookup(candidate(), check(candidate()), scope, "surgical"), null);
}));

test("store lock failure falls back without clearing the lock or weakening verification", () => fixture(async root => {
  const o = options(root); await mkdir(o.memory.directory, { mode: 0o700 }); await mkdir(join(o.memory.directory, "transaction.lock"));
  assert.deepEqual(await createReusableCodingCandidateGenerator(o).generate(context), candidate(true));
  assert.equal(o.counter.calls, 1); assert.equal(o.summaries[0].memoryUnavailable, true);
}));

test("off and shadow modes do not look up, learn or use repair memory", () => fixture(async root => {
  for (const mode of ["off", "shadow"] as const) {
    const o = options(root); o.scope = async () => { throw new Error("must not be called"); };
    assert.deepEqual(await createReusableCodingCandidateGenerator({ ...o, mode }).generate(context), candidate());
    assert.equal(o.summaries.length, 0);
  }
}));

test("unknown model failure is propagated exactly once, not retried by the memory layer", () => fixture(async root => {
  const o = options(root); let calls = 0; o.model = { async propose() { calls++; throw new Error("uncertain paid usage"); } };
  await assert.rejects(createReusableCodingCandidateGenerator(o).generate(context), /uncertain paid usage/);
  assert.equal(calls, 1); assert.equal(await o.memory.lookup(candidate(), check(candidate()), scope, "surgical"), null);
}));

test("mandatory receipt persistence failure remains fatal and prevents learning", () => fixture(async root => {
  const o = options(root);
  await assert.rejects(createReusableCodingCandidateGenerator({ ...o, onReceipt: () => { throw new Error("receipt failed"); } }).generate(context), /receipt failed/);
  assert.equal(await o.memory.lookup(candidate(), check(candidate()), scope, "surgical"), null);
}));

test("mandatory run persistence failure remains fatal and prevents learning", () => fixture(async root => {
  const o = options(root);
  await assert.rejects(createReusableCodingCandidateGenerator({ ...o, onRun: () => { throw new Error("run failed"); } }).generate(context), /run failed/);
  assert.equal(await o.memory.lookup(candidate(), check(candidate()), scope, "surgical"), null);
}));
