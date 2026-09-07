import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import { CodingDispatchJournal } from "../src/coding-dispatch-journal.ts";
import { sha256 } from "../src/canonical.ts";
import { candidate } from "./helpers/repair-memory-fixture.ts";

test("new actual HTTP coding path preserves learning across restart and times kernel acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "kernel-lifecycle-")), token = "local-lifecycle";
  const journals: CodingDispatchJournal[] = []; let calls = 0, counts = 0;
  await mkdir(join(root, "coding-dispatch"));
  try {
    let expectedDigest = "";
    for (let turn = 0; turn < 2; turn++) {
      const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256: sha256(token), selfBuildVerificationWorkers: 2 });
      const nativeVerifier = await NativeCodingVerifier.create(); assert(nativeVerifier);
      if (!turn) await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(token), { kind: "revenue", source: "customer",
        amountUsd: 100, realized: true, recurringMonthly: false, description: "Synthetic fixture only", occurredAt: "2026-09-06T00:00:00.000Z" });
      const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Repair the value to 17", acceptanceCriteria: ["Protected test reads 17"],
        requiredCapabilities: [], expectedOwnerValue: 1, maximumBudgetUsd: .15 });
      const fallback = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
        countInputTokens: async () => { throw Error("must use scoped factory"); }, execute: async () => { throw Error("must use scoped factory"); } };
      const server = createSaraServer(kernel, { ownerTokenSha256: sha256(token), stateDirectory: root,
        reparodynamicCoding: { mode: "canary", modelClient: fallback, stateDirectory: root, nativeVerifier,
          modelClientForRun: runId => {
            const journal = new CodingDispatchJournal({ directory: join(root, "coding-dispatch", runId), beforeDispatch: async () => {
              assert.equal((await kernel.getStatus()).emergencyStopped, false);
            }, fetchImpl: async (url, init) => {
              if (String(url).endsWith("/input_tokens")) { counts++; return new Response('{"input_tokens":100}'); }
              calls++; const body = JSON.parse(String(init?.body)), p = JSON.parse(body.input.split("\n").slice(2).join("\n"));
              assert.doesNotMatch(body.input, /protected fixture/);
              const file = p.files.find((x: { path: string }) => x.path === "src/value.ts");
              const proposal = { schemaVersion: 1, baseArtifactDigest: p.currentArtifactDigest, failureFingerprint: p.failures[0].fingerprint,
                strategy: p.requiredStrategy, changes: [{ path: file.path, expectedContentDigest: file.contentDigest, replacementText: candidate(true).files[1].content }], limitations: [] };
              return new Response(JSON.stringify({ id: "scripted-local-only", model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 100, output_tokens: 50 },
                output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(proposal) }] }] }));
            } }); journals.push(journal);
            return new OpenAIResponsesClient({ apiKey: "SCRIPTED_NOT_A_PROVIDER_KEY", fetchImpl: journal.fetch });
          } } });
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
      try {
        const start = performance.now();
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs/${job.id}/self-build`, {
          method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ proposal: candidate() }) });
        const text = await response.text(); assert.equal(response.status, 201, text); const result = JSON.parse(text);
        const elapsed = performance.now() - start;
        assert(result.timing.totalMilliseconds <= elapsed); assert(result.timing.pooled);
        assert.equal(result.evidence.attestation, "kernel_executed"); assert.equal(result.job.status, "verified"); assert.equal(result.mutation.stage, "SHADOW");
        if (!turn) expectedDigest = result.mutation.candidateDigest; else assert.equal(result.mutation.candidateDigest, expectedDigest);
        assert.equal(calls, 1); assert.equal(counts, 1); assert.equal(kernel.verificationWorkerStatus()?.completed, 1);
      } finally { await new Promise<void>(r => server.close(() => r())); await kernel.closeVerificationWorkers(); }
    }
    assert.equal(journals.reduce((s, j) => s + j.snapshot().generationAttempts, 0), 1);
    const runs = await readdir(join(root, "coding-dispatch")); assert.equal(runs.length, 1, "warm hit writes no phantom dispatch");
    const names = await readdir(join(root, "coding-dispatch", runs[0])); assert.equal(names.length, 4);
    for (const name of names) assert.doesNotMatch(await readFile(join(root, "coding-dispatch", runs[0], name), "utf8"), /SCRIPTED_NOT_A_PROVIDER_KEY|protected fixture/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("stop then resume during generation retires the already-admitted job before kernel verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "kernel-generation-stop-")), token = "scripted-local-owner";
  const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256: sha256(token) });
  let reached!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { reached = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  try {
    const owner = kernel.authenticateOwnerToken(token);
    await kernel.recordLedgerEntry(owner, { kind: "revenue", source: "customer", amountUsd: 100,
      realized: true, recurringMonthly: false, description: "Synthetic local test only", occurredAt: "2026-09-06T00:00:00.000Z" });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Test stop epoch", acceptanceCriteria: ["No pre-stop job accepted after resume"],
      requiredCapabilities: [], expectedOwnerValue: 1, maximumBudgetUsd: .15 });
    const result = kernel.runSelfBuildCycle(owner, job.id, { id: "scripted-stop-fixture", external: false, maximumCostUsd: 0,
      async generate() { reached(); await wait; return candidate(true); } });
    const rejected = assert.rejects(result, /SELF_BUILD_AUTHORITY_CHANGED_DURING_GENERATION/);
    await started; await kernel.setEmergencyStop(owner, true); await kernel.setEmergencyStop(owner, false); release(); await rejected;
    const state = await kernel.getStatus(); assert.equal(state.mutations.length, 0);
    assert.equal(state.jobs.find(j => j.id === job.id)?.status, "failed");
  } finally { release?.(); await kernel.closeVerificationWorkers(); await rm(root, { recursive: true, force: true }); }
});
