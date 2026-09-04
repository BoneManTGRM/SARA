import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { persistRevenueNicoPackage, persistRevenueNicoRun, readRevenueNicoArtifact, readRevenueNicoPackage } from "../src/revenue-nico-artifacts.ts";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("revenue-bound authorized NICO packages", () => {
  it("persists an exact-target package and rejects later tampering", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-nico-revenue-"));
    directories.push(stateDirectory);
    const jobId = "job-nico-artifact";
    const runId = "comprun_0123456789abcdef0123456789abcdef";
    const running = await persistRevenueNicoRun({ stateDirectory, jobId, runId, repository: "example/project", commitSha: "a".repeat(40), updatedAt: "2026-09-04T00:00:00.000Z" });
    const body = new TextEncoder().encode("authorized package");
    const ready = await persistRevenueNicoPackage({ stateDirectory, artifact: running, artifactIdentity: { schema: "nico.review-artifact-identity.v1", run_id: runId, revision: 1, report_artifact_digest: "b".repeat(64), artifact_digests: { pdf: "c".repeat(64) } }, body, contentType: "application/zip", providerDigest: sha256(Buffer.from(body)), updatedAt: "2026-09-04T00:01:00.000Z" });
    assert.equal((await readRevenueNicoArtifact(stateDirectory, jobId))?.packageDigest, ready.packageDigest);
    assert.deepEqual((await readRevenueNicoPackage(stateDirectory, jobId)).body, body);
    await writeFile(join(stateDirectory, "revenue-nico", `${jobId}.package`), "tampered");
    await assert.rejects(readRevenueNicoPackage(stateDirectory, jobId), /integrity/);
  });
});
