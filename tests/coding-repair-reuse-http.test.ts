import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { sha256 } from "../src/canonical.ts";
import { FreshTypecheckCompilerHost } from "../src/verification-typecheck-host.ts";
import { candidate } from "./helpers/repair-memory-fixture.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { CodingRepairReuseSummary } from "../src/reusable-coding-candidate-generator.ts";

test("the real authenticated self-build route learns once and reuses after a complete kernel/server restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-reuse-http-"));
  const token = "local-reuse-fixture-only";
  const hash = sha256(token);
  let modelCalls = 0, countCalls = 0, freshTypecheckHosts = 0;
  const createHost = FreshTypecheckCompilerHost.prototype.createHost;
  FreshTypecheckCompilerHost.prototype.createHost = function(options) {
    freshTypecheckHosts++;
    return createHost.call(this, options);
  };
  const modelClient: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
    async countInputTokens() { countCalls++; return 100; },
    async execute(input) {
      modelCalls++;
      const p = JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
      const source = p.files.find((f: { path: string }) => f.path === "src/value.ts");
      return { outputText: JSON.stringify({ schemaVersion: 1, baseArtifactDigest: p.currentArtifactDigest,
        failureFingerprint: p.failures[0].fingerprint, strategy: "surgical",
        changes: [{ path: source.path, expectedContentDigest: source.contentDigest, replacementText: candidate(true).files[1].content }],
        limitations: [] }), inputTokens: 100, billableOutputTokens: 50 };
    } };
  try {
    let digest = "";
    for (let turn = 0; turn < 2; turn++) {
      const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256: hash });
      if (!turn) await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(token), { kind: "revenue", source: "customer", amountUsd: 100,
        realized: true, recurringMonthly: false, description: "Fixture funding only", occurredAt: "2026-09-06T00:00:00.000Z" });
      const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Repair the value to 17", expectedOwnerValue: 1,
        requiredCapabilities: [], acceptanceCriteria: ["Protected test reads 17"], maximumBudgetUsd: 0.15 });
      const server = createSaraServer(kernel, { ownerTokenSha256: hash, stateDirectory: root,
        reparodynamicCoding: { mode: "canary", modelClient, stateDirectory: root } });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs/${job.id}/self-build`;
        const data = JSON.stringify({ proposal: candidate() });
        assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: data })).status, 401);
        const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: data });
        const body = await response.text(); assert.equal(response.status, 201, body);
        const result = JSON.parse(body); assert.equal(result.mutation.stage, "SHADOW");
        assert.equal(result.evidence.attestation, "kernel_executed");
        if (!turn) digest = result.mutation.candidateDigest;
        else assert.equal(result.mutation.candidateDigest, digest);
        assert.equal(modelCalls, 1, "repeat must not invoke the model");
        assert.equal(countCalls, 1, "repeat must also skip token-count requests");
        assert.equal((await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: data })).status >= 400, true);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    const directory = join(root, "coding-repair-receipts");
    const summaries: CodingRepairReuseSummary[] = [];
    for (const id of await readdir(directory)) summaries.push(JSON.parse(await readFile(join(directory, id, "reuse.json"), "utf8")).summary);
    assert.equal(freshTypecheckHosts, 6, "each job runs three fresh canary compiler hosts; kernel is separate");
    assert.equal(summaries.length, 2);
    assert.equal(summaries.filter(s => s.hits === 1 && s.modelRequests === 0).length, 1);
    assert.equal(summaries.filter(s => s.learnedRecipeId !== null).length, 1);
    assert(summaries.every(s => s.finalFreshVerification));
    const warm = summaries.find(s => s.hits === 1)!;
    assert.equal(warm.reusedRecipes.length, 1); assert.equal(warm.reusedRecipes[0].outcome, "verified_complete");
  } finally {
    FreshTypecheckCompilerHost.prototype.createHost = createHost;
    await rm(root, { recursive: true, force: true });
  }
});
