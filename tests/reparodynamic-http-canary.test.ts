import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import { createSaraServer } from "../src/server.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

describe("owner-authenticated Reparodynamic CANARY path", () => {
  const ownerToken = "reparodynamic-owner-token";
  let directory = "";
  let baseUrl = "";
  let server: ReturnType<typeof createSaraServer>;
  let jobId = "";

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-reparodynamic-http-"));
    const kernel = await SaraKernel.boot({
      stateDirectory: directory,
      ownerTokenSha256: createHash("sha256").update(ownerToken).digest("hex"),
    });
    await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(ownerToken), {
      kind: "revenue",
      source: "customer",
      amountUsd: 100,
      realized: true,
      recurringMonthly: false,
      description: "Test-only realized revenue for the bounded repair budget.",
      occurredAt: "2026-09-04T00:00:00.000Z",
    });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Repair the program to return 42.",
      expectedOwnerValue: 1,
      requiredCapabilities: [],
      acceptanceCriteria: ["The immutable test observes value 42."],
      maximumBudgetUsd: 0.15,
    });
    jobId = job.id;
    const modelClient: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens() { return 100; },
      async execute(input) {
        const contract = JSON.parse(input.prompt.split("\n").slice(2).join("\n")) as {
          currentArtifactDigest: string;
          failures: Array<{ fingerprint: string }>;
          files: Array<{ path: string; contentDigest: string }>;
        };
        const source = contract.files.find((file) => file.path === "src/value.ts")!;
        return {
          outputText: JSON.stringify({
            schemaVersion: 1,
            baseArtifactDigest: contract.currentArtifactDigest,
            failureFingerprint: contract.failures[0].fingerprint,
            strategy: "surgical",
            changes: [{ path: source.path, expectedContentDigest: source.contentDigest, replacementText: "export const value: number = 42;\n" }],
            limitations: [],
          }),
          inputTokens: 100,
          billableOutputTokens: 50,
        };
      },
    };
    server = createSaraServer(kernel, {
      ownerTokenSha256: createHash("sha256").update(ownerToken).digest("hex"),
      stateDirectory: directory,
      reparodynamicCoding: { mode: "canary", modelClient, stateDirectory: directory },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("repairs, verifies, persists a receipt, and returns the verified candidate mutation", async () => {
    const proposal: ProgramCandidateProposal = {
      schemaVersion: 1,
      candidateKind: "typescript_program",
      programName: "Live canary fixture",
      summary: "A failing program that requires one bounded repair.",
      limitations: [],
      files: [
        { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
        { path: "src/value.ts", content: "export const value: number = 'wrong';\n" },
        { path: "tests/value.test.ts", content: 'import { value } from "../src/value.ts";\nif (value !== 42) throw new Error("acceptance failed");\n' },
      ],
    };
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/self-build`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ proposal }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 201, responseText);
    const body = JSON.parse(responseText) as { mutation: { candidateDigest: string; stage: string } };
    assert.equal(body.mutation.stage, "SHADOW");
    assert.match(body.mutation.candidateDigest, /^[a-f0-9]{64}$/u);
    const receiptRoot = join(directory, "coding-repair-receipts");
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(receiptRoot, { recursive: true }));
    const receiptPath = entries.find((entry) => String(entry).endsWith("01.json"));
    assert(receiptPath);
    const receipt = await readFile(join(receiptRoot, String(receiptPath)), "utf8");
    assert(receipt.includes('"outcome": "verified_complete"'));
    assert.equal(receipt.includes("wrong"), false);
    assert.equal(receipt.includes(sha256("export const value: number = 'wrong';\n")), false);
  });
});
