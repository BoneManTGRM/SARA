import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/canonical.ts";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator } from "../src/reusable-coding-candidate-generator.ts";
import { RepairLearningCoordinator } from "../src/coding-repair-singleflight.ts";
import { candidate, check, training, scope, context, model } from "./helpers/repair-memory-fixture.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-exact-safety-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function options(root: string) {
  const counter = { calls: 0 };
  return { counter, base: { id: "exact-safety", external: false, maximumCostUsd: 0, generate: async () => candidate() },
    mode: "canary" as const, memory: new DurableCodingRepairMemory(root), scope: async () => scope,
    model: model(counter), verify: async (c: ReturnType<typeof candidate>) => check(c), onReuse: async () => {} };
}

test("exact source reuse binds candidate metadata as well as all file bytes", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training());
  for (const alter of [
    (c: ReturnType<typeof candidate>) => { c.summary = "A different declared purpose"; },
    (c: ReturnType<typeof candidate>) => { c.programName = "Changed identity"; },
    (c: ReturnType<typeof candidate>) => { c.limitations = ["A new limitation"]; },
  ]) {
    const changed = candidate(); alter(changed);
    assert.equal(await memory.lookupExactSource(changed, scope, "surgical"), null);
  }
}));

test("exact reuse waits for a cold leader's mandatory last receipt and rejects its failure", () => fixture(async root => {
  let entered!: () => void, release!: () => void, waited!: () => void;
  const receiptEntered = new Promise<void>(resolve => { entered = resolve; });
  const receiptRelease = new Promise<void>(resolve => { release = resolve; });
  const followerWaiting = new Promise<"waiting">(resolve => { waited = () => resolve("waiting"); });
  class ObservedCoordinator extends RepairLearningCoordinator {
    override follow(key: string) {
      const follower = super.follow(key);
      return follower && { ...follower, wait: async () => { waited(); return follower.wait(); } };
    }
  }
  const coordinator = new ObservedCoordinator(); const o = options(root);
  const make = () => createReusableCodingCandidateGenerator({ ...o, memory: new DurableCodingRepairMemory(root),
    learningCoordinator: coordinator, onReuse: async summary => {
      if (summary.learnedRecipeId) { entered(); await receiptRelease; throw new Error("mandatory leader receipt failed"); }
    } });
  const first = make().generate(context).then(value => ({ value }), error => ({ error }));
  await receiptEntered;
  const follower = make().generate(context).then(value => ({ value }), error => ({ error }));
  try {
    assert.equal(await Promise.race([followerWaiting, follower.then(() => "returned")]), "waiting");
  } finally { release(); }
  const results = await Promise.all([first, follower]);
  assert(results.every(result => "error" in result)); assert.equal(o.counter.calls, 1);
  assert.equal(await o.memory.lookupExactSource(candidate(), scope, "surgical"), null);
}));

for (const failure of ["failed", "wrong_artifact", "thrown"] as const) {
  test(`exact authoritative final ${failure} rejects without dispatching a model`, () => fixture(async root => {
    const o = options(root); await o.memory.learn(training()); let finalCalls = 0, receipts = 0;
    const generator = createReusableCodingCandidateGenerator({ ...o, verifyFinal: async c => {
      finalCalls++;
      if (failure === "thrown") throw new Error("authoritative final threw");
      const result = check(c, failure !== "failed");
      if (failure === "wrong_artifact") result.artifactDigest = sha256("different candidate");
      return result;
    }, onReceipt: () => { receipts++; } });
    await assert.rejects(generator.generate(context));
    assert.equal(finalCalls, 1); assert.equal(o.counter.calls, 0); assert.equal(receipts, 0);
    assert.equal(await o.memory.lookupExactSource(candidate(), scope, "surgical"), null);
  }));
}

for (const boundary of ["onReceipt", "onRun", "onReuse"] as const) {
  test(`exact reuse ${boundary} persistence failure rejects and quarantines`, () => fixture(async root => {
    const o = options(root); await o.memory.learn(training()); let called = false;
    const generator = createReusableCodingCandidateGenerator({ ...o, [boundary]: () => {
      called = true; throw new Error(`mandatory ${boundary} failed`);
    } });
    await assert.rejects(generator.generate(context), /mandatory .* failed/);
    assert(called); assert.equal(o.counter.calls, 0);
    assert.equal(await o.memory.lookupExactSource(candidate(), scope, "surgical"), null);
  }));
}

test("exact repaired candidate is detached from base-provider objects during final verification", () => fixture(async root => {
  const o = options(root); await o.memory.learn(training()); const retained = candidate();
  const generator = createReusableCodingCandidateGenerator({ ...o,
    base: { ...o.base, generate: async () => retained }, verifyFinal: async c => {
      retained.files[0].content = "export const injected = true;\n";
      retained.limitations.push("provider changed its retained object");
      return check(c);
    } });
  assert.deepEqual(await generator.generate(context), candidate(true)); assert.equal(o.counter.calls, 0);
}));

test("exact reuse receipts report actual edits and explicitly historical baseline verification", () => fixture(async root => {
  const o = options(root); await o.memory.learn(training()); let receiptSeen = false, runSeen = false;
  await createReusableCodingCandidateGenerator({ ...o, onReceipt: receipt => {
    receiptSeen = true; assert.equal(receipt.changedFiles, 1); assert.equal(receipt.changedLines, 1);
    assert.equal(receipt.accountedCostUsd, 0);
  }, onRun: run => {
    runSeen = true; assert.equal((run as typeof run & { baselineVerificationFresh?: boolean }).baselineVerificationFresh, false);
    assert.equal(run.baselineVerification.passed, false); assert.equal(run.verification.passed, true);
  } }).generate(context);
  assert(receiptSeen && runSeen);
}));
