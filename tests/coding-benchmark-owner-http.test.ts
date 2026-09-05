import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";

it("owner benchmark HTTP readiness cannot dispatch while exposure is unresolved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-benchmark-http-"));
  const token = "owner-http-fixture";
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(token) });
  const server = createSaraServer(kernel, { ownerTokenSha256: sha256(token), stateDirectory: directory });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const path of ["/api/coding-benchmark/readiness", "/api/coding-benchmark/run"]) {
      assert.equal((await fetch(base + path)).status, 401);
      assert.equal((await fetch(base + path, { headers: { authorization: "Bearer wrong" } })).status, 401);
    }
    const readiness = await fetch(base + "/api/coding-benchmark/readiness", { headers });
    assert.equal(readiness.status, 200);
    const value = await readiness.json() as { ready: boolean; unresolvedExposureUsd: number; authenticatedLaunchPath: string; benchmarkId: string; sourceRevision: string | null; authorityDigest: string | null };
    assert.equal(value.ready, false);
    assert.equal(value.unresolvedExposureUsd, 0.15);
    assert.equal(value.authenticatedLaunchPath, "/api/coding-benchmark/run");
    const before = await readdir(directory, { recursive: true });
    const result = await fetch(base + "/api/coding-benchmark/run", { method: "POST", headers, body: JSON.stringify({ benchmarkId: value.benchmarkId, sourceRevision: value.sourceRevision, authorityDigest: value.authorityDigest }) });
    assert.equal(result.status, 423);
    const denied = await result.json() as { code: string };
    assert.match(denied.code, /UNRECONCILED_MODEL_EXPOSURE/);
    assert.deepEqual(await readdir(directory, { recursive: true }), before);
    assert.ok(!JSON.stringify(value).includes(token));
    assert.equal((await fetch(base + "/api/coding-benchmark/run", { method: "POST", headers, body: JSON.stringify({ benchmarkId: value.benchmarkId, maximumSpendUsd: 1 }) })).status, 423);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
