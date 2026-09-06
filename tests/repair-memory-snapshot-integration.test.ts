import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod, stat, utimes, symlink, link, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { candidate, check, training, scope } from "./helpers/repair-memory-fixture.ts";

const lookup = (memory: DurableCodingRepairMemory) => memory.lookup(candidate(), check(candidate()), scope, "surgical");
async function fixture(fn: (memory: DurableCodingRepairMemory, root: string, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-snapshot-integration-"));
  const memory = new DurableCodingRepairMemory(root);
  try { await memory.learn(training()); assert(await lookup(memory)); await fn(memory, root, join(memory.directory, "memory.json")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("cached records do not hide quarantine written by another real process", () => fixture(async (memory, root) => {
  const hit = await lookup(memory); assert(hit);
  const code = `import { DurableCodingRepairMemory } from './src/coding-repair-memory.ts';
    await new DurableCodingRepairMemory(process.argv[1]).quarantine(process.argv[2], process.argv[3]);`;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code, root, hit.key, sha256("child revocation")],
    { cwd: process.cwd(), env: { PATH: process.env.PATH }, timeout: 15_000 });
  assert.equal(await lookup(memory), null);
  await assert.rejects(memory.assertReusable(hit), /REVOKED/);
  assert.equal(await lookup(new DurableCodingRepairMemory(root)), null);
}));

test("equal-size tampering with restored mtime is revalidated, not a metadata hit", () => fixture(async (memory, _root, path) => {
  const before = await stat(path), raw = await readFile(path, "utf8"), state = JSON.parse(raw);
  state.records[0].id = "e".repeat(64); state.digest = sha256(canonicalJson(state.records));
  const altered = canonicalJson(state); assert.equal(Buffer.byteLength(raw), Buffer.byteLength(altered));
  await writeFile(path, altered); await utimes(path, before.atime, before.mtime);
  await assert.rejects(lookup(memory), /IDENTITY/);
  await writeFile(path, raw); assert(await lookup(memory));
}));

test("disabled markers and crash locks are checked before any cached records", () => fixture(async (memory, _root, path) => {
  const dir = memory.directory;
  await writeFile(join(dir, "disabled"), "", { mode: 0o600 });
  await assert.rejects(lookup(memory), /DISABLED/); await rm(join(dir, "disabled"));
  await mkdir(join(dir, "transaction.lock")); await assert.rejects(lookup(memory), { code: "EEXIST" });
  await rm(join(dir, "transaction.lock"), { recursive: true }); assert(await lookup(memory));
  assert((await stat(path)).isFile());
}));

test("fresh permission and link checks cannot be bypassed by a matching cached snapshot", () => fixture(async (memory, root, path) => {
  await chmod(path, 0o644); await assert.rejects(lookup(memory), /BOUNDARY/); await chmod(path, 0o600);
  await chmod(memory.directory, 0o755); await assert.rejects(lookup(memory), /PERMISSIONS/); await chmod(memory.directory, 0o700);
  const other = join(root, "hardlink"); await link(path, other); await assert.rejects(lookup(memory), /BOUNDARY/); await rm(other);
  const target = join(root, "real"); await rename(path, target); await symlink(target, path);
  await assert.rejects(lookup(memory)); await rm(path); await rename(target, path); assert(await lookup(memory));
}));

test("deletion, corruption and oversize never return a previous cached hit", () => fixture(async (memory, _root, path) => {
  const original = await readFile(path);
  await rm(path); assert.equal(await lookup(memory), null);
  await writeFile(path, "{broken", { mode: 0o600 }); await assert.rejects(lookup(memory));
  await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1)); await assert.rejects(lookup(memory), /BOUNDARY/);
  await writeFile(path, original); assert(await lookup(memory));
}));

test("failed conflicting writes cannot mutate a retained parsed snapshot", () => fixture(async (memory, _root, path) => {
  const original = await readFile(path); const i = training(); i.after.files[1].content += "// other\n"; i.verification = check(i.after, true);
  await assert.rejects(memory.learn(i), /CONFLICT/);
  assert.deepEqual(await readFile(path), original); assert(await lookup(memory));
  const hit = await lookup(memory); assert(hit); hit.proposal.changes[0].replacementText = "poison";
  assert.equal((await lookup(memory))?.proposal.changes[0].replacementText, candidate(true).files[1].content);
}));
