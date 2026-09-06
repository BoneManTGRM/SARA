import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator, type CodingRepairReuseSummary } from "../src/reusable-coding-candidate-generator.ts";
import { candidate, check, scope, context, model } from "./helpers/repair-memory-fixture.ts";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-cold-wave-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function setup(root: string) {
  const counter = { calls: 0 }, summaries: CodingRepairReuseSummary[] = [];
  return { counter, summaries, mode: "canary" as const,
    base: { id: "cold-fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() },
    model: model(counter), memory: new DurableCodingRepairMemory(root), scope: async () => scope,
    verify: async (c: ReturnType<typeof candidate>) => check(c), onReuse: (s: CodingRepairReuseSummary) => { summaries.push(s); } };
}

for (const failure of [false, true]) {
  test(`four simultaneous cold jobs ${failure ? "do not repeat an unknown leader failure" : "share learning, not verification"}`, () => fixture(async root => {
    const started = deferred(), released = deferred(); let initialReads = 0, checks = 0;
    const o = setup(root);
    class WaveMemory extends DurableCodingRepairMemory {
      first = true;
      override async lookup(...args: Parameters<DurableCodingRepairMemory["lookup"]>) {
        if (this.first) { this.first = false; if (++initialReads === 4) started.resolve(); await started.promise; }
        const value = await super.lookup(...args);
        if (initialReads === 4) released.resolve();
        return value;
      }
    }
    const generate = o.model.propose;
    o.model = { async propose(r) { await released.promise;
      if (failure) { o.counter.calls++; throw new Error("unknown model accounting"); }
      return generate(r);
    } };
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => createReusableCodingCandidateGenerator({ ...o,
      memory: new WaveMemory(root), verify: async c => { checks++; return check(c); },
    }).generate(context)));
    assert.equal(o.counter.calls, 1, "only the leader may generate for this simultaneous cold identity");
    if (failure) assert(results.every(r => r.status === "rejected"));
    else {
      assert(results.every(r => r.status === "fulfilled" && JSON.stringify(r.value) === JSON.stringify(candidate(true))));
      assert.equal(checks, 12, "every job must independently verify baseline, repair, and final source");
      assert.equal(o.summaries.reduce((n, s) => n + s.hits, 0), 3);
    }
  }));
}

test("failed mandatory reuse receipt revokes the newly learned recipe", () => fixture(async root => {
  const o = setup(root);
  await assert.rejects(createReusableCodingCandidateGenerator({ ...o,
    onReuse: () => { throw new Error("mandatory reuse receipt failed"); },
  }).generate(context), /mandatory reuse receipt failed/);
  assert.equal(o.counter.calls, 1);
  assert.equal(await o.memory.lookup(candidate(), check(candidate()), scope, "surgical"), null,
    "a failed mandatory provenance write must not leave a reusable learned recipe");
}));

import { RepairLearningCoordinator } from "../src/coding-repair-singleflight.ts";
for (const succeed of [true, false]) {
  test(`followers wait for the final required receipt ${succeed ? "commit" : "failure"}`, () => fixture(async root => {
    const atReceipt = deferred(), release = deferred(), followerEntered = deferred();
    class ObservedCoordinator extends RepairLearningCoordinator {
      override follow(key: string) { const ticket = super.follow(key); if (ticket) followerEntered.resolve(); return ticket; }
    }
    const learningCoordinator = new ObservedCoordinator(); const o = setup(root);
    const first = createReusableCodingCandidateGenerator({ ...o, learningCoordinator, onReuse: async () => {
      atReceipt.resolve(); await release.promise; if (!succeed) throw new Error("receipt rollback");
    } }).generate(context);
    const firstResult = first.then(value => ({ value, error: null }), error => ({ value: null, error }));
    await atReceipt.promise;
    let returned = false;
    const next = createReusableCodingCandidateGenerator({ ...o, memory: new DurableCodingRepairMemory(root), learningCoordinator }).generate(context);
    const nextResult = next.then(value => { returned = true; return { value, error: null }; }, error => ({ value: null, error }));
    await followerEntered.promise; assert.equal(returned, false); assert.equal(o.counter.calls, 1);
    release.resolve(); const results = await Promise.all([firstResult, nextResult]);
    if (succeed) assert(results.every(r => r.error === null && JSON.stringify(r.value) === JSON.stringify(candidate(true))));
    else {
      assert(results.every(r => r.error !== null));
      assert.equal(await new DurableCodingRepairMemory(root).lookup(candidate(), check(candidate()), scope, "surgical"), null);
    }
    assert.equal(o.counter.calls, 1);
  }));
}

test("waiting timeout never promotes a second caller to a still-running leader", () => fixture(async root => {
  const atModel = deferred(), release = deferred(), o = setup(root), learningCoordinator = new RepairLearningCoordinator(1);
  const original = o.model.propose;
  o.model = { async propose(r) { atModel.resolve(); await release.promise; return original(r); } };
  const first = createReusableCodingCandidateGenerator({ ...o, learningCoordinator }).generate(context);
  await atModel.promise;
  for (let n = 0; n < 2; n++) {
    await assert.rejects(createReusableCodingCandidateGenerator({ ...o, memory: new DurableCodingRepairMemory(root), learningCoordinator }).generate(context), /WAIT_TIMEOUT/);
  }
  release.resolve(); assert.deepEqual(await first, candidate(true)); assert.equal(o.counter.calls, 1);
  const warm = setup(root); assert.deepEqual(await createReusableCodingCandidateGenerator(warm).generate(context), candidate(true));
  assert.equal(warm.counter.calls, 0);
}));

for (const difference of ["scope", "source", "tests", "generator", "directory"] as const) {
  test(`different ${difference} does not join another cold learning flight`, () => fixture(async root => {
    const atModel = deferred(), release = deferred(), o = setup(root), learningCoordinator = new RepairLearningCoordinator(10);
    const generate = o.model.propose; o.model = { async propose(r) { atModel.resolve(); await release.promise; return generate(r); } };
    const first = createReusableCodingCandidateGenerator({ ...o, learningCoordinator }).generate(context); await atModel.promise;
    const next = setup(difference === "directory" ? join(root, "another-owner") : root);
    const changed = candidate();
    if (difference === "source") changed.files[1].content = changed.files[1].content.replace("16", "15");
    if (difference === "tests") changed.files[2].content += "// different protected-test bytes\n";
    next.base.generate = async () => changed;
    if (difference === "scope") next.scope = async () => "f".repeat(64);
    if (difference === "generator") next.base.id = "different-generator";
    try {
      const result = await createReusableCodingCandidateGenerator({ ...next, learningCoordinator }).generate(context);
      assert.equal(result.candidateKind, "typescript_program"); assert.equal(next.counter.calls, 1);
      assert.equal(next.summaries[0].coalescedWaits, 0);
    } finally { release.resolve(); await first; }
  }));
}

test("an invalid optional memory scope falls back to the unchanged bounded model path", () => fixture(async root => {
  const o = setup(root); o.scope = async () => "not-a-digest";
  assert.deepEqual(await createReusableCodingCandidateGenerator(o).generate(context), candidate(true));
  assert.equal(o.counter.calls, 1); assert.equal(o.summaries[0].memoryUnavailable, true);
}));

test("a lookup that began before election cannot bypass a later uncommitted leader", () => fixture(async root => {
  const firstRead = deferred(), atReceipt = deferred(), readComplete = deferred(); let receiptCommitted = false;
  const o = setup(root), learningCoordinator = new RepairLearningCoordinator();
  class DelayedRead extends DurableCodingRepairMemory {
    first = true;
    override async lookup(...args: Parameters<DurableCodingRepairMemory["lookup"]>) {
      if (this.first) {
        this.first = false; firstRead.resolve(); await atReceipt.promise;
        const result = await super.lookup(...args); readComplete.resolve(); return result;
      }
      return super.lookup(...args);
    }
  }
  const following = createReusableCodingCandidateGenerator({ ...o, memory: new DelayedRead(root), learningCoordinator,
    verify: async c => {
      if (check(c).passed && !receiptCommitted) throw new Error("used uncommitted learning");
      return check(c);
    },
  }).generate(context);
  const observedFollowing = following.then(value => ({ value, error: null }), error => ({ value: null, error }));
  await firstRead.promise;
  const leading = createReusableCodingCandidateGenerator({ ...o, learningCoordinator,
    onReuse: async () => {
      atReceipt.resolve(); await readComplete.promise;
      await new Promise<void>(resolve => setImmediate(resolve)); // Explicit event ordering, not simulated provider latency.
      receiptCommitted = true;
    },
  }).generate(context);
  const result = await observedFollowing; await leading;
  assert.equal(result.error, null); assert.deepEqual(result.value, candidate(true)); assert.equal(o.counter.calls, 1);
}));

test("an ambiguous learning commit is quarantined if the required receipt then fails", () => fixture(async root => {
  class AmbiguousCommit extends DurableCodingRepairMemory {
    override async learn(input: Parameters<DurableCodingRepairMemory["learn"]>[0]): Promise<string> {
      await super.learn(input);
      throw new Error("simulated post-commit acknowledgement failure");
    }
  }
  const o = setup(root);
  await assert.rejects(createReusableCodingCandidateGenerator({ ...o, memory: new AmbiguousCommit(root),
    onReuse: () => { throw new Error("mandatory reuse receipt failed"); },
  }).generate(context), /mandatory reuse receipt failed/);
  assert.equal(o.counter.calls, 1);
  assert.equal(await new DurableCodingRepairMemory(root).lookup(candidate(), check(candidate()), scope, "surgical"), null,
    "a committed entry cannot outlive a fatal receipt failure merely because learning acknowledgement failed");
}));
