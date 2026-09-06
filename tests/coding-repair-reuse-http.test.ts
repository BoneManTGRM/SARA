import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

test("owner HTTP self-build learns across restart, avoids a model call, and still passes kernel verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-reuse-http-"));
  const token = "local-owner-reuse-test", ownerTokenSha256 = sha256(token);
  let modelCalls = 0; const mutationDigests: string[] = [];
  const proposal: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "HTTP reuse fixture", summary: "One bounded repair", limitations: [], files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: 'export const value: number = 41;\n' },
    { path: "tests/value.test.ts", content: 'import { value } from "../src/value.ts";\nif (value !== 42) throw new Error("acceptance failed");\n' },
  ] };
  const client: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
    countInputTokens: async () => 100,
    execute: async input => {
      modelCalls++;
      const contract = JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
      const source = contract.files.find((f: { path: string }) => f.path === "src/value.ts");
      return { inputTokens: 100, billableOutputTokens: 50, outputText: JSON.stringify({ schemaVersion: 1,
        baseArtifactDigest: contract.currentArtifactDigest, failureFingerprint: contract.failures[0].fingerprint,
        strategy: "surgical", changes: [{ path: "src/value.ts", expectedContentDigest: source.contentDigest,
          replacementText: "export const value: number = 42;\n" }], limitations: [] }) };
    },
  };
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256 });
      if (cycle === 0) await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(token), { kind: "revenue", source: "customer", amountUsd: 100,
        realized: true, recurringMonthly: false, description: "Local test-only budget fixture", occurredAt: "2026-09-04T00:00:00.000Z" });
      const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Return 42", expectedOwnerValue: 1,
        requiredCapabilities: [], acceptanceCriteria: ["42 is returned"], maximumBudgetUsd: 0.15 });
      const server = createSaraServer(kernel, { ownerTokenSha256, stateDirectory: root,
        reparodynamicCoding: { mode: "canary", modelClient: client, stateDirectory: root } });
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs/${job.id}/self-build`;
        const denied = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposal }) });
        assert.equal(denied.status, 401); assert.equal(modelCalls, cycle);
        const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ proposal }) });
        const body = await response.json() as { error?: string; mutation: { stage: string; candidateDigest: string }; evidence: { attestation: string } };
        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(body.mutation.stage, "SHADOW"); assert.equal(body.evidence.attestation, "kernel_executed");
        mutationDigests.push(body.mutation.candidateDigest);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    assert.equal(modelCalls, 1);
    const receipts = join(root, "coding-repair-receipts");
    const names = await readdir(receipts, { recursive: true });
    const events = await Promise.all(names.filter(n => /reuse-\d+\.json$/u.test(n)).map(async n => JSON.parse(await readFile(join(receipts, n), "utf8"))));
    assert.equal(events.filter(e => e.event === "recipe_hit").length, 1);
    assert.equal(events.filter(e => e.event === "recipe_miss_model_fallback").length, 1);
    assert.equal(events.filter(e => e.event === "fresh_final_pass").length, 2);
    assert(events.filter(e => e.event === "run_finished").every(e => e.verificationCalls === 3));
    // Kernel artifacts include job identities; verify both, do not demand equal job-bound digests.
    assert(mutationDigests.every(d => /^[a-f0-9]{64}$/u.test(d)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
