import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";

describe("SARA digital job owner API", () => {
  const token = "digital-job-http-owner-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let directory: string;
  let baseUrl: string;
  let server: ReturnType<typeof createSaraServer>;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-digital-http-"));
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: tokenHash });
    server = createSaraServer(kernel, { ownerTokenSha256: tokenHash });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  async function action(jobId: string, name: string, body: unknown = {}): Promise<Response> {
    return fetch(`${baseUrl}/api/digital-jobs/${jobId}/${name}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body),
    });
  }

  it("keeps the complete external job lifecycle behind owner authentication and evidence gates", async () => {
    const payload = {
      kind: "documentation",
      objective: "Produce an owner-review documentation package.",
      sourceUrl: "https://github.com/example/project/issues/42",
      buyerReference: "public-bounty-42",
      authorizedScope: "Named public repository issue only.",
      expectedDeliverables: ["One verified documentation artifact"],
      acceptanceCriteria: ["Link verification exits successfully"],
      acceptanceCriteriaAutomatable: true,
      maximumBudgetUsd: 0,
      offeredCompensationUsd: 149,
      safety: {
        publicOrOwnerProvidedNonSensitiveInput: true,
        requiresCredentials: false,
        containsPrivateCustomerData: false,
        requiresHumanIdentity: false,
        requiresRegulatedJudgment: false,
        requiresSecurityExploitation: false,
        requiresExternalAccountCreation: false,
      },
    };
    assert.equal((await fetch(`${baseUrl}/api/digital-jobs`, { method: "POST", body: JSON.stringify(payload) })).status, 401);
    const createdResponse = await fetch(`${baseUrl}/api/digital-jobs`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: string; status: string };
    assert.equal(created.status, "qualified");
    assert.equal((await fetch(`${baseUrl}/api/digital-jobs/${created.id}/handoff`)).status, 401);
    assert.equal((await action(created.id, "authorize")).status, 200);
    const handoffResponse = await fetch(`${baseUrl}/api/digital-jobs/${created.id}/handoff`, { headers: auth });
    assert.equal(handoffResponse.status, 200);
    const handoff = await handoffResponse.json() as { role: string; maximumBudgetUsd: number; allowedTools: string[] };
    assert.equal(handoff.role, "bounded_digital_job_executor");
    assert.equal(handoff.maximumBudgetUsd, 0);
    assert.ok(handoff.allowedTools.includes("document_writer"));
    assert.equal((await action(created.id, "start", { executorId: "zero-cost-doc-executor", maximumCostUsd: 0 })).status, 200);
    const complete = await action(created.id, "complete", {
      result: {
        artifactDigest: "a".repeat(64),
        artifactReference: "draft://artifact/documentation-42",
        summary: "Documentation package passed its automated acceptance criteria.",
        verification: [{ command: "docs:verify", exitCode: 0, outputDigest: "b".repeat(64) }],
      },
    });
    assert.equal(complete.status, 200);
    assert.equal((await complete.json() as { status: string }).status, "review_ready");
    assert.equal((await action(created.id, "authorize-delivery")).status, 200);
    assert.equal((await action(created.id, "record-delivery", { evidenceDigest: "c".repeat(64) })).status, 200);
    const paid = await action(created.id, "record-payment", { amountUsd: 149, evidenceDigest: "d".repeat(64) });
    assert.equal(paid.status, 200);
    assert.equal((await paid.json() as { status: string }).status, "paid");
    const status = await (await fetch(`${baseUrl}/api/status`, { headers: auth })).json() as {
      digitalJobs: Array<{ id: string; status: string }>;
      realizedProfit: { collectedRevenueUsd: number };
    };
    assert.equal(status.digitalJobs.find((job) => job.id === created.id)?.status, "paid");
    assert.equal(status.realizedProfit.collectedRevenueUsd, 149);
  });
});
