import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import type { NicoArtifactIdentity, NicoOperator } from "../src/nico-operator.ts";
import { createSaraServer } from "../src/server.ts";

const RUN_ID = "comprun_0123456789abcdef0123456789abcdef";
const identity: NicoArtifactIdentity = {
  schema: "nico.review-artifact-identity.v1",
  run_id: RUN_ID,
  revision: 1,
  report_artifact_digest: "a".repeat(64),
  artifact_digests: { pdf: "b".repeat(64) },
};

describe("SARA owner-only NICO operator HTTP boundary", () => {
  const ownerToken = "owner-token-for-nico-tests";
  const bridgeToken = "bridge-token-for-nico-tests";
  const ownerTokenSha256 = createHash("sha256").update(ownerToken).digest("hex");
  const bridgeTokenSha256 = createHash("sha256").update(bridgeToken).digest("hex");
  const calls: Array<{ action: string; password?: string }> = [];
  let directory: string;
  let kernel: SaraKernel;
  let server: ReturnType<typeof createSaraServer>;
  let baseUrl: string;

  const nicoOperator: NicoOperator = {
    async createRun() { calls.push({ action: "create" }); return { run_id: RUN_ID, status: "pending" }; },
    async getRun() { calls.push({ action: "status" }); return { run_id: RUN_ID, status: "owner_review", review_artifact_identity: identity }; },
    async continueRun() { calls.push({ action: "continue" }); return { run_id: RUN_ID, status: "running" }; },
    async getReport() { calls.push({ action: "report" }); return { contentType: "application/pdf", body: new TextEncoder().encode("pdf") }; },
    async getReviewQueue(_runId, password) { calls.push({ action: "queue", password }); return { findings: [] }; },
    async finalizeExactDraft(_runId, password) { calls.push({ action: "finalize", password }); return { approval_status: "approved" }; },
    async authorizeDelivery(_runId, password) { calls.push({ action: "delivery", password }); return { delivery_status: "authorized" }; },
    async getApprovedDeliveryPackage(_runId, password) { calls.push({ action: "package", password }); return { contentType: "application/zip", body: new TextEncoder().encode("zip"), digest: "c".repeat(64) }; },
    async getAutomatedDeliveryPackage(_runId, password, input) {
      calls.push({ action: "automated-package", password });
      assert.equal(input.confirmExactArtifact, true);
      assert.equal(input.confirmAutomatedDisclosure, true);
      assert.deepEqual(input.expectedArtifactIdentity, identity);
      return { contentType: "application/zip", body: new Uint8Array([80, 75, 3, 4]), digest: "e".repeat(64) };
    },
  };

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-nico-http-"));
    kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256 });
    server = createSaraServer(kernel, { ownerTokenSha256, readOnlyBridgeTokenSha256: bridgeTokenSha256, nicoOperator });
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

  it("keeps every NICO action owner-only", async () => {
    assert.equal((await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}`, { headers: { authorization: `Bearer ${bridgeToken}` } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}`, { headers: { authorization: `Bearer ${ownerToken}` } })).status, 200);
  });

  it("finalizes only an explicitly confirmed exact draft without echoing the password", async () => {
    const password = "one-time-nico-password";
    const response = await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}/finalize`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        nicoPassword: password,
        reviewer: "Cody Ryan Jenkins",
        reviewerRole: "Security reviewer",
        decisionReason: "Reviewed and approved the exact draft.",
        expectedArtifactIdentity: identity,
        confirmExactReport: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text().then((value) => value.includes(password)), false);
    assert.equal(calls.at(-1)?.password, password);

    const unconfirmed = await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}/finalize`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ nicoPassword: password, confirmExactReport: false }),
    });
    assert.equal(unconfirmed.status, 400);
  });

  it("keeps approval and client-delivery authorization separate", async () => {
    const response = await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}/authorize-delivery`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        nicoPassword: "one-time-nico-password",
        authorizer: "Cody Ryan Jenkins",
        authorizerRole: "Owner/operator",
        authorizationReason: "Approved for controlled client delivery.",
        expectedArtifactIdentity: identity,
        confirmDelivery: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { delivery_status: string }).delivery_status, "authorized");
  });

  it("authorizes an automated package without collecting a specialist identity", async () => {
    const response = await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}/authorize-automated-delivery`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        expectedArtifactIdentity: identity,
        confirmExactArtifact: true,
        confirmAutomatedDisclosure: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-nico-certified-package-sha256"), "e".repeat(64));
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [80, 75, 3, 4]);
    assert.equal(calls.at(-1)?.action, "automated-package");
  });

  it("freezes NICO network actions under emergency stop", async () => {
    await fetch(`${baseUrl}/api/emergency-stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    const response = await fetch(`${baseUrl}/api/nico/runs/${RUN_ID}`, { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(response.status, 423);
  });
});
