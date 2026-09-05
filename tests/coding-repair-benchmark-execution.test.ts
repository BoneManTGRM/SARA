import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { initializeCodingBenchmarkStore, withCodingBenchmarkExecution, type CodingBenchmarkManifest } from "../src/coding-repair-benchmark-store.ts";
const manifest: CodingBenchmarkManifest = {
  schemaVersion: 1, benchmarkId: "11111111-1111-4111-8111-111111111111",
  bindings: { sourceCommit: "1".repeat(64), corpusDigest: "2".repeat(64), modelDigest: "3".repeat(64),
    controllerDigest: "4".repeat(64), policyDigest: "5".repeat(64), verifierDigest: "6".repeat(64),
    environmentDigest: "7".repeat(64), authorityDigest: "8".repeat(64) },
  maximumSpendUsd: 0.3, currentCanaryPercent: 5, caseIds: ["case-001"], createdAt: "2026-09-05T00:00:00Z",
};
async function setup() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-benchmark-claim-"));
  await initializeCodingBenchmarkStore({ stateDirectory, manifest });
  await writeFile(join(stateDirectory, "probe-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  const directory = join(stateDirectory, "coding-repair-benchmarks", manifest.benchmarkId);
  return { stateDirectory, directory, path: join(directory, "execution-claim.json") };
}
describe("single-use paid benchmark execution guard", () => {
  it("persists a private claim before invoking any external execution", async () => {
    const { stateDirectory, path } = await setup();
    try {
      const value = await withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => {
        const claim = JSON.parse(await readFile(path, "utf8"));
        assert.equal(claim.benchmarkId, manifest.benchmarkId);
        assert.equal(claim.authorityDigest, manifest.bindings.authorityDigest);
        assert.equal((await stat(path)).mode & 0o777, 0o600);
        return 42;
      } });
      assert.equal(value, 42);
    } finally { await rm(stateDirectory, { recursive: true, force: true }); }
  });
  it("admits exactly one of concurrent invocations", async () => {
    const { stateDirectory } = await setup();
    try {
      let calls = 0;
      const run = () => withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => ++calls });
      const outcomes = await Promise.allSettled([run(), run(), run(), run()]);
      assert.equal(calls, 1);
      assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    } finally { await rm(stateDirectory, { recursive: true, force: true }); }
  });
  it("never removes the claim after an interrupted execution without receipts", async () => {
    const { stateDirectory } = await setup();
    try {
      await assert.rejects(withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => { throw new Error("interrupted after request"); } }), /interrupted/);
      let retried = false;
      await assert.rejects(withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => { retried = true; } }), /claimed|consumed/iu);
      assert.equal(retried, false);
    } finally { await rm(stateDirectory, { recursive: true, force: true }); }
  });
  it("rejects successful replay and malformed preexisting claim rather than repairing it", async () => {
    for (const corrupt of [false, true]) {
      const { stateDirectory, path } = await setup();
      try {
        if (corrupt) await writeFile(path, "{interrupted", { mode: 0o600 });
        else await withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => undefined });
        await assert.rejects(withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => assert.fail("must not execute") }), /claimed|consumed/iu);
      } finally { await rm(stateDirectory, { recursive: true, force: true }); }
    }
  });
  it("rejects mismatched source and authorization before claiming or executing", async () => {
    const { stateDirectory, path } = await setup();
    try {
      const changed = structuredClone(manifest); changed.bindings.sourceCommit = "9".repeat(64);
      await assert.rejects(withCodingBenchmarkExecution({ stateDirectory, manifest: changed, execute: async () => assert.fail("must not execute") }), /manifest|bindings/iu);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    } finally { await rm(stateDirectory, { recursive: true, force: true }); }
  });
});

async function probe(stateDirectory: string, mode = "normal"): Promise<number | null> {
  const manifestPath = join(stateDirectory, "probe-manifest.json");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types",
      fileURLToPath(new URL("./fixtures/benchmark-execution-process.ts", import.meta.url)),
      stateDirectory, manifestPath, mode], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
it("enforces the single-use guard across independent processes", async () => {
  const { stateDirectory } = await setup();
  try {
    assert.deepEqual((await Promise.all([probe(stateDirectory), probe(stateDirectory)])).sort((a, b) => a! - b!), [0, 23]);
    assert.equal(await readFile(join(stateDirectory, "execution-marker.txt"), "utf8"), "executed\n");
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});
it("retains the claim after process termination before any arm receipt", async () => {
  const { stateDirectory } = await setup();
  try {
    assert.equal(await probe(stateDirectory, "crash"), 57);
    assert.equal(await probe(stateDirectory), 23);
    assert.equal(await readFile(join(stateDirectory, "execution-marker.txt"), "utf8"), "executed\n");
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});
