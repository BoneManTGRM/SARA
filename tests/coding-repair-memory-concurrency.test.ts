import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator } from "../src/reusable-coding-candidate-generator.ts";
import { sha256 } from "../src/canonical.ts";
import { candidate, check, training, scope, context, model } from "./helpers/repair-memory-fixture.ts";
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-memory-concurrent-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const lookup = (memory: DurableCodingRepairMemory) => memory.lookup(candidate(), check(candidate()), scope, "surgical");
test("simultaneous local warm lookups all reuse across independent store objects", () => fixture(async root => {
  await new DurableCodingRepairMemory(root).learn(training());
  const hits = await Promise.all(Array.from({ length: 12 }, () => lookup(new DurableCodingRepairMemory(root))));
  assert(hits.every(Boolean)); assert.equal(new Set(hits.map(h => h!.id)).size, 1);
}));
test("simultaneous local warm jobs avoid redundant generation without sharing verification", () => fixture(async root => {
  await new DurableCodingRepairMemory(root).learn(training()); const counter = { calls: 0 }; let checks = 0;
  const outputs = await Promise.all(Array.from({ length: 8 }, () => createReusableCodingCandidateGenerator({
    base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary",
    model: model(counter), verify: async c => { checks++; return check(c); }, memory: new DurableCodingRepairMemory(root),
    scope: async () => scope, onReuse: async () => {},
  }).generate(context)));
  assert.equal(counter.calls, 0); assert.equal(checks, 24); assert(outputs.every(o => JSON.stringify(o) === JSON.stringify(candidate(true))));
}));
test("concurrent learning serializes without losing writers or changing recipe identity", () => fixture(async root => {
  const ids = await Promise.all(Array.from({ length: 8 }, () => new DurableCodingRepairMemory(root).learn(training())));
  assert.equal(new Set(ids).size, 1); assert.equal((await lookup(new DurableCodingRepairMemory(root)))?.id, ids[0]);
}));
for (const boundary of ["run", "reuse_summary"] as const) {
  test(`revocation during required ${boundary} receipt rejects a reused return`, () => fixture(async root => {
    const memory = new DurableCodingRepairMemory(root); await memory.learn(training()); const hit = (await lookup(memory))!;
    const counter = { calls: 0 }, revoke = () => memory.quarantine(hit.key, sha256(`revoked during ${boundary}`));
    const generator = createReusableCodingCandidateGenerator({
      base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model(counter),
      verify: async c => check(c), memory, scope: async () => scope,
      onRun: async () => { if (boundary === "run") await revoke(); },
      onReuse: async () => { if (boundary === "reuse_summary") await revoke(); },
    });
    await assert.rejects(generator.generate(context), /REPAIR_MEMORY_REVOKED_DURING_RUN/); assert.equal(counter.calls, 0);
    assert.equal(await lookup(new DurableCodingRepairMemory(root)), null);
  }));
}

test("local queue saturation rejects excess work and releases capacity", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training());
  const results = await Promise.allSettled(Array.from({ length: 33 }, () => lookup(new DurableCodingRepairMemory(root))));
  assert.equal(results.filter(r => r.status === "fulfilled" && r.value).length, 32);
  const failed = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(failed.length, 1); assert.match(String(failed[0].reason), /REPAIR_MEMORY_QUEUE_FULL/);
  assert(await lookup(memory));
}));
test("failed transactions release the local queue without clearing a crash lock", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training());
  const lock = join(memory.directory, "transaction.lock"); await mkdir(lock);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => lookup(new DurableCodingRepairMemory(root))));
  assert(results.every(r => r.status === "rejected"));
  await assert.rejects(mkdir(lock), { code: "EEXIST" });
  await rm(lock, { recursive: true }); // Explicit test-operator recovery only.
  assert(await lookup(memory));
}));
test("corrupt state failure does not leak the local queue or accept corrupt data", () => fixture(async root => {
  const memory = new DurableCodingRepairMemory(root); await memory.learn(training());
  const path = join(memory.directory, "memory.json"), saved = await readFile(path);
  await writeFile(path, "{broken"); await assert.rejects(lookup(memory));
  await writeFile(path, saved); // Explicit restoration of exact test bytes.
  assert(await lookup(new DurableCodingRepairMemory(root)));
}));
