import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableCodingRepairMemory, codingRepairMemoryKey } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator } from "../src/reusable-coding-candidate-generator.ts";
import { RepairLearningCoordinator } from "../src/coding-repair-singleflight.ts";
import { sha256 } from "../src/canonical.ts";
import { candidate, check, context, model, scope, training } from "./helpers/repair-memory-fixture.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-reuse-hardening-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const lookup = (memory: DurableCodingRepairMemory) => memory.lookup(candidate(), check(candidate()), scope, "surgical");

for (const action of ["quarantine", "disable", "delete"] as const) {
  test(`newly learned repair is not returned when ${action} occurs during the last receipt`, () => fixture(async root => {
    const memory = new DurableCodingRepairMemory(root), count = { calls: 0 };
    let receiptReached = false;
    const generator = createReusableCodingCandidateGenerator({
      base: { id: "hardening-fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() },
      mode: "canary", model: model(count), memory, scope: async () => scope, verify: async c => check(c),
      onReuse: async summary => {
        assert(summary.learnedRecipeId); receiptReached = true;
        const other = new DurableCodingRepairMemory(root);
        if (action === "quarantine") await other.quarantine(codingRepairMemoryKey(candidate(), check(candidate()), scope), sha256("revoked-before-return"));
        else if (action === "disable") await writeFile(join(memory.directory, "disabled"), "", { flag: "wx", mode: 0o600 });
        else await rm(join(memory.directory, "memory.json")); // Explicit test fault, never production recovery.
      },
    });
    await assert.rejects(generator.generate(context), /REPAIR_MEMORY_(?:REVOKED_DURING_RUN|DISABLED|UNKNOWN_RECORD)/);
    assert(receiptReached); assert.equal(count.calls, 1);
  }));
}

test("failed last receipt revocation cannot release waiting cold jobs as committed", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root), count = { calls: 0 }, coordinator = new RepairLearningCoordinator();
  let receiptStarted!: () => void, releaseReceipt!: () => void;
  const started = new Promise<void>(resolve => { receiptStarted = resolve; });
  const release = new Promise<void>(resolve => { releaseReceipt = resolve; });
  const make = () => createReusableCodingCandidateGenerator({
    base: { id: "hardening-shared", external: false, maximumCostUsd: 0, generate: async () => candidate() },
    mode: "canary", model: model(count), memory: new DurableCodingRepairMemory(root),
    scope: async () => scope, verify: async c => check(c), learningCoordinator: coordinator,
    onReuse: async summary => {
      if (summary.learnedRecipeId) {
        receiptStarted(); await release;
        await memory.quarantine(codingRepairMemoryKey(candidate(), check(candidate()), scope), sha256("leader-revoked"));
      }
    },
  });
  // Attach rejection handlers immediately; delayed jobs must not create unhandled rejections.
  const first = make().generate(context).then(value => ({ value }), error => ({ error }));
  await started;
  const followers = Array.from({ length: 3 }, () => make().generate(context).then(value => ({ value }), error => ({ error })));
  releaseReceipt();
  const results = await Promise.all([first, ...followers]);
  assert(results.every(result => "error" in result)); assert.equal(count.calls, 1);
  assert.equal(await lookup(memory), null);
}));

async function assertNoRewrite(memory: DurableCodingRepairMemory, operation: () => Promise<unknown>) {
  // Pin the original inode while observing the path, so inode recycling cannot create a false pass.
  const path = join(memory.directory, "memory.json"), original = await open(path, "r");
  try {
    const before = await original.stat(), bytes = await readFile(path);
    await operation();
    const current = await open(path, "r");
    try {
      const after = await current.stat(); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
    } finally { await current.close(); }
    assert.deepEqual(await readFile(path), bytes);
  } finally { await original.close(); }
}

test("learning an identical committed recipe does not rewrite the durable file", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root), id = await memory.learn(training());
  await assertNoRewrite(memory, async () => assert.equal(await new DurableCodingRepairMemory(root).learn(training()), id));
  assert.equal((await lookup(memory))?.id, id);
}));

test("concurrent duplicate learning is read-only after the first durable commit", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root), id = await memory.learn(training());
  await assertNoRewrite(memory, async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => new DurableCodingRepairMemory(root).learn(training())));
    assert(ids.every(value => value === id));
  });
}));

test("repeated quarantine keeps the first revocation and does not rewrite the file", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training()); const hit = (await lookup(memory))!;
  await memory.quarantine(hit.key, sha256("first revocation"));
  await assertNoRewrite(memory, () => memory.quarantine(hit.key, sha256("later revocation")));
  const saved = JSON.parse(await readFile(join(memory.directory, "memory.json"), "utf8"));
  assert.equal(saved.records[0].quarantineDigest, sha256("first revocation")); assert.equal(await lookup(memory), null);
}));

test("a duplicate cannot bypass fresh corruption and permission checks", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training());
  const path = join(memory.directory, "memory.json"), saved = await readFile(path);
  await writeFile(path, "{corrupt"); await assert.rejects(memory.learn(training()));
  await writeFile(path, saved);
  const file = await open(path, "r"); try { await file.chmod(0o644); } finally { await file.close(); }
  await assert.rejects(memory.learn(training()), /BOUNDARY/);
}));

test("a genuinely new recipe still replaces and durably extends the file", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training());
  const path = join(memory.directory, "memory.json"), original = await open(path, "r");
  try {
    const before = await original.stat(); const next = training(); next.scope = sha256("separate-authorized-scope");
    await memory.learn(next);
    const current = await open(path, "r");
    try { assert.notEqual((await current.stat()).ino, before.ino); } finally { await current.close(); }
    assert.equal(JSON.parse(await readFile(path, "utf8")).records.length, 2);
    assert(await new DurableCodingRepairMemory(root).lookup(next.before, next.beforeVerification, next.scope, "surgical"));
  } finally { await original.close(); }
}));

test("actual compiler and protected behavior checks still run before a revoked cold return is denied", () => fixture(async root => {
  const { verifyGenomeLabProgramCandidate } = await import("../src/genome-lab-verifier.ts");
  const memory = new DurableCodingRepairMemory(root), count = { calls: 0 }; let checks = 0;
  const generator = createReusableCodingCandidateGenerator({
    base: { id: "hardening-real-verifier", external: false, maximumCostUsd: 0, generate: async () => candidate() },
    mode: "canary", memory, scope: async () => scope, model: model(count),
    verify: c => { checks++; return verifyGenomeLabProgramCandidate({ candidate: c, ...context }); },
    onReuse: async summary => {
      assert(summary.finalFreshVerification); assert(summary.learnedRecipeId);
      // Use the actual observed failure fingerprint, not the fixture's mock fingerprint.
      const state = JSON.parse(await readFile(join(memory.directory, "memory.json"), "utf8"));
      await new DurableCodingRepairMemory(root).quarantine(state.records[0].key, sha256("real-verified-but-revoked"));
    },
  });
  await assert.rejects(generator.generate(context), /REPAIR_MEMORY_REVOKED_DURING_RUN/);
  assert.equal(checks, 3); assert.equal(count.calls, 1);
}));

test("successful cold return and fresh-store warm return retain independent verification", () => fixture(async root => {
  let checks = 0; const count = { calls: 0 };
  for (let turn = 0; turn < 2; turn++) {
    const generator = createReusableCodingCandidateGenerator({
      base: { id: "hardening-control", external: false, maximumCostUsd: 0, generate: async () => candidate() },
      mode: "canary", memory: new DurableCodingRepairMemory(root), scope: async () => scope, model: model(count),
      verify: async c => { checks++; return check(c); }, onReuse: summary => {
        assert(summary.finalFreshVerification); assert.equal(summary.hits, turn);
      },
    });
    assert.deepEqual(await generator.generate(context), candidate(true));
  }
  assert.equal(count.calls, 1); assert.equal(checks, 6);
}));
