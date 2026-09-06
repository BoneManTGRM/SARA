import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableCodingRepairMemory, codingRepairMemoryScope } from "../src/coding-repair-memory.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { candidate, check, training, scope, context } from "./helpers/repair-memory-fixture.ts";

async function fixture(fn: (memory: DurableCodingRepairMemory, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-memory-test-"));
  try { await fn(new DurableCodingRepairMemory(root), root); } finally { await rm(root, { recursive: true, force: true }); }
}
const lookup = (memory: DurableCodingRepairMemory) => memory.lookup(candidate(), check(candidate()), scope, "surgical");

test("an empty store misses; verified repairs survive a fresh store instance", () => fixture(async (memory, root) => {
  assert.equal(await lookup(memory), null);
  const id = await memory.learn(training());
  const hit = await lookup(new DurableCodingRepairMemory(root));
  assert.equal(hit?.id, id); assert.equal(hit?.proposal.changes[0].replacementText, candidate(true).files[1].content);
  const saved = await readFile(join(memory.directory, "memory.json"), "utf8");
  assert(!saved.includes("protected fixture")); assert(!saved.includes("tests/value.test.ts"));
  hit!.proposal.changes[0].replacementText = "mutated return";
  assert.equal((await lookup(memory))?.proposal.changes[0].replacementText, candidate(true).files[1].content);
}));

test("source, protected tests, metadata, failure fingerprint and scope changes each invalidate reuse", () => fixture(async memory => {
  await memory.learn(training());
  for (const alter of [
    (c: ReturnType<typeof candidate>) => { c.files[1].content += "// changed\n"; },
    (c: ReturnType<typeof candidate>) => { c.files[2].content += "// protected update\n"; },
    (c: ReturnType<typeof candidate>) => { c.summary += " changed"; },
  ]) { const c = candidate(); alter(c); assert.equal(await memory.lookup(c, check(c), scope, "surgical"), null); }
  const v = check(candidate()); v.failures[0].fingerprint = "f".repeat(64);
  assert.equal(await memory.lookup(candidate(), v, scope, "surgical"), null);
  assert.equal(await memory.lookup(candidate(), check(candidate()), sha256("other"), "surgical"), null);
}));

test("scope binds owner, contract, constitution and toolchain while remaining stable for equal jobs", async () => {
  const first = await codingRepairMemoryScope("owner-a", context);
  assert.equal(first, await codingRepairMemoryScope("owner-a", structuredClone(context)));
  for (const [owner, c] of [["owner-b", context], ["owner-a", { ...context, objective: "other" }],
    ["owner-a", { ...context, acceptanceCriteria: ["different"] }], ["owner-a", { ...context, constitutionDigest: "f".repeat(64) }]] as const) {
    assert.notEqual(first, await codingRepairMemoryScope(owner, { ...c, acceptanceCriteria: [...c.acceptanceCriteria] }));
  }
});

test("rejects unverified, clean, stale or malformed evidence instead of learning claims", () => fixture(async memory => {
  for (const edit of [
    (i: ReturnType<typeof training>) => { i.verification.passed = false; },
    (i: ReturnType<typeof training>) => { i.verification.artifactDigest = "f".repeat(64); },
    (i: ReturnType<typeof training>) => { i.verification.completedChecks.pop(); },
    (i: ReturnType<typeof training>) => { i.beforeVerification = check(i.before, true); },
    (i: ReturnType<typeof training>) => { i.beforeVerification.artifactDigest = "f".repeat(64); },
    (i: ReturnType<typeof training>) => { i.scope = "bad-scope"; },
  ]) { const i = training(); edit(i); await assert.rejects(memory.learn(i)); }
  assert.equal(await lookup(memory), null);
}));

test("protected edits, changed file sets, empty changes and large repairs cannot be stored", () => fixture(async memory => {
  for (const edit of [
    (i: ReturnType<typeof training>) => { i.after.files[2].content += "// tamper"; },
    (i: ReturnType<typeof training>) => { i.after.files.pop(); },
    (i: ReturnType<typeof training>) => { i.after = candidate(); },
    (i: ReturnType<typeof training>) => { i.after.files[1].content = " "; },
    (i: ReturnType<typeof training>) => { i.after.files[1].content += "x".repeat(16384); },
  ]) { const i = training(); edit(i); i.verification = check(i.after, true); await assert.rejects(memory.learn(i)); }
}));

test("surgical limit is checked on lookup, not inferred from a previously deep repair", () => fixture(async memory => {
  const i = training(); i.after.files[1].content += "// repeated fixture\n".repeat(100); i.verification = check(i.after, true);
  await memory.learn(i);
  assert.equal(await lookup(memory), null);
  assert(await memory.lookup(i.before, i.beforeVerification, scope, "deep"));
}));

test("durable quarantine survives restart and cannot be cleared by relearning new evidence", () => fixture(async (memory, root) => {
  await memory.learn(training()); const hit = await lookup(memory); assert(hit);
  await memory.quarantine(hit.key, sha256("rejected"));
  const restarted = new DurableCodingRepairMemory(root);
  assert.equal(await lookup(restarted), null);
  const i = training(); i.verification.evidenceDigests = ["a".repeat(64)];
  await assert.rejects(restarted.learn(i), /QUARANTINED/);
  assert.equal(await lookup(restarted), null);
}));

test("a conflicting recipe cannot overwrite a verified one", () => fixture(async memory => {
  const id = await memory.learn(training()); const i = training(); i.after.files[1].content += "// alternate\n"; i.verification = check(i.after, true);
  await assert.rejects(memory.learn(i), /CONFLICT/);
  assert.equal((await lookup(memory))?.id, id);
}));

test("truncation or a changed digest disables reuse instead of accepting partial records", () => fixture(async memory => {
  await memory.learn(training()); const path = join(memory.directory, "memory.json"); const original = await readFile(path, "utf8");
  for (const broken of ["{broken", original.replace('"digest":"', '"digest":"f')]) {
    await writeFile(path, broken); await assert.rejects(lookup(memory));
  }
}));

test("record tampering is rejected even when its outer checksum is recomputed", () => fixture(async memory => {
  await memory.learn(training()); const path = join(memory.directory, "memory.json"); const state = JSON.parse(await readFile(path, "utf8"));
  state.records[0].changes[0].replacementText = "unsafe replacement";
  state.digest = sha256(canonicalJson(state.records)); await writeFile(path, JSON.stringify(state));
  await assert.rejects(lookup(memory), /IDENTITY/);
}));

test("symlinked files and non-private files are rejected", () => fixture(async memory => {
  await memory.learn(training()); const path = join(memory.directory, "memory.json"); const old = await readFile(path, "utf8");
  await chmod(path, 0o644); await assert.rejects(lookup(memory), /BOUNDARY/);
  await rm(path); await writeFile(join(memory.directory, "other.json"), old, { mode: 0o600 });
  await symlink(join(memory.directory, "other.json"), path); await assert.rejects(lookup(memory));
}));

test("symlinked store directories and unreconciled crash locks disable the optimization", () => fixture(async (memory, root) => {
  const target = join(root, "other"); await mkdir(target, { mode: 0o700 }); await symlink(target, memory.directory);
  await assert.rejects(lookup(memory), /SYMLINK/); await unlinkForTest(memory.directory);
  await lookup(memory); await mkdir(join(memory.directory, "transaction.lock"));
  await assert.rejects(lookup(memory), { code: "EEXIST" }); await assert.rejects(memory.learn(training()), { code: "EEXIST" });
}));
async function unlinkForTest(path: string) { await import("node:fs/promises").then(fs => fs.unlink(path)); }

test("concurrent stores never lose quarantine or overwrite an existing record", () => fixture(async (memory, root) => {
  const outcomes = await Promise.allSettled([memory.learn(training()), new DurableCodingRepairMemory(root).learn(training())]);
  assert(outcomes.some(r => r.status === "fulfilled"));
  const hit = await lookup(memory); assert(hit);
  const writes = await Promise.allSettled([memory.quarantine(hit.key, sha256("bad")), new DurableCodingRepairMemory(root).learn(training())]);
  if (writes[0].status === "rejected") await assert.rejects(lookup(new DurableCodingRepairMemory(root)), /DISABLED/);
  else assert.equal(await lookup(new DurableCodingRepairMemory(root)), null);
}));

test("capacity is bounded and never evicts quarantined identities", () => fixture(async memory => {
  for (let n = 0; n < 128; n++) { const i = training(); i.scope = sha256(`slot-${n}`); await memory.learn(i); }
  await assert.rejects(memory.learn(training()), /CAPACITY/);
  const hit = await memory.lookup(candidate(), check(candidate()), sha256("slot-0"), "surgical"); assert(hit);
  await memory.quarantine(hit.key, sha256("revoked"));
  await assert.rejects(memory.learn(training()), /CAPACITY/);
  assert.equal(await memory.lookup(candidate(), check(candidate()), sha256("slot-0"), "surgical"), null);
}));


test("quarantine contention disables the whole store durably rather than reviving a failed recipe", () => fixture(async (memory, root) => {
  await memory.learn(training()); const hit = await lookup(memory); assert(hit);
  await mkdir(join(memory.directory, "transaction.lock"));
  await assert.rejects(memory.quarantine(hit.key, sha256("failed under contention")));
  await rm(join(memory.directory, "transaction.lock"), { recursive: true });
  await assert.rejects(lookup(new DurableCodingRepairMemory(root)), /DISABLED/);
}));
