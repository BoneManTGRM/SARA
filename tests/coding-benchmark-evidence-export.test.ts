import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, link, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { readCodingBenchmarkEvidence } from "../src/coding-benchmark-evidence.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { ADDITIONAL_CODING_BENCHMARK_GRANT } from "../src/coding-benchmark-readiness.ts";

const id = ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId;
async function fixture(run: (state: string, root: string) => Promise<void>) {
  const state = await mkdtemp(join(tmpdir(), "sara-evidence-export-"));
  const root = join(state, "coding-repair-benchmarks", id);
  try { await run(state, root); } finally { await rm(state, { recursive: true, force: true }); }
}
it("unclaimed evidence inspection is read-only and rejects unregistered IDs", async () => fixture(async (state) => {
  assert.deepEqual(await readCodingBenchmarkEvidence(state, id), { schemaVersion: 1, status: "not_started", replayAllowed: false, files: [] });
  assert.deepEqual(await readdir(state), []);
  for (const value of ["../outside", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "", id.toUpperCase()]) {
    await assert.rejects(readCodingBenchmarkEvidence(state, value));
  }
}));
it("exports byte-exact private receipts and marks completed execution unavailable for replay", async () => fixture(async (state, root) => {
  await writeBenchmarkAudit(join(root, "trace"), "owner-launch-claim.json", { reservedUsd: 0.15, benchmarkId: id });
  let snapshot = await readCodingBenchmarkEvidence(state, id);
  assert.equal(snapshot.status, "claimed");
  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.files[0]!.sha256, sha256(snapshot.files[0]!.content));
  assert.equal(snapshot.files[0]!.content, await readFile(join(root, snapshot.files[0]!.path), "utf8"));
  await writeBenchmarkAudit(join(root, "trace"), "owner-launch-exit.json", { code: 0 });
  snapshot = await readCodingBenchmarkEvidence(state, id);
  assert.equal(snapshot.status, "terminal");
  assert.equal(snapshot.replayAllowed, false);
}));
it("an incomplete claim remains visible and consumed instead of becoming permission to rerun", async () => fixture(async (state, root) => {
  await mkdir(join(root, "trace"), { recursive: true });
  await writeFile(join(root, "trace", "owner-launch-claim.json"), "{partial");
  const value = await readCodingBenchmarkEvidence(state, id);
  assert.equal(value.status, "claimed");
  assert.equal(value.files[0]!.content, "{partial");
}));
for (const kind of ["symlink-file", "hardlink-file", "symlink-directory", "symlink-parent"]) {
  it(`rejects ${kind} rather than reading outside the benchmark boundary`, async () => fixture(async (state, root) => {
    const secret = join(state, "private.json"); await writeFile(secret, "DO_NOT_EXPORT_PRIVATE_DATA");
    await mkdir(join(root, "trace"), { recursive: true });
    if (kind === "symlink-file") await symlink(secret, join(root, "trace", "owner-launch-claim.json"));
    if (kind === "hardlink-file") await link(secret, join(root, "trace", "owner-launch-claim.json"));
    if (kind === "symlink-directory") { await rm(join(root, "trace"), { recursive: true }); await symlink(state, join(root, "trace")); }
    if (kind === "symlink-parent") { await rm(root, { recursive: true }); await symlink(state, root); }
    await assert.rejects(readCodingBenchmarkEvidence(state, id));
  }));
}
it("does not traverse unrelated files or directories", async () => fixture(async (state, root) => {
  await mkdir(join(root, "private"), { recursive: true });
  await writeFile(join(root, "private.json"), "DO_NOT_EXPORT_PRIVATE_DATA");
  await writeFile(join(root, "private", "manifest.json"), "DO_NOT_EXPORT_PRIVATE_DATA");
  const value = await readCodingBenchmarkEvidence(state, id);
  assert.ok(!JSON.stringify(value).includes("DO_NOT_EXPORT_PRIVATE_DATA"));
  assert.equal(value.files.length, 0);
}));
it("rejects oversized evidence without a partial success response", async () => fixture(async (state, root) => {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "execution-claim.json"), "x".repeat(1_048_577));
  await assert.rejects(readCodingBenchmarkEvidence(state, id), /FILE_REJECTED/);
}));
it("rejects invalid UTF-8 instead of silently changing evidence bytes", async () => fixture(async (state, root) => {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "execution-claim.json"), Buffer.from([255, 254]));
  await assert.rejects(readCodingBenchmarkEvidence(state, id));
}));
