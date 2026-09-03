import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NicoOperatorClient,
  type NicoArtifactIdentity,
} from "../src/nico-operator.ts";

const RUN_ID = "comprun_0123456789abcdef0123456789abcdef";
const SHA = "c14f5113c34271abd69e0a9fbcbd29d4dcf4f750";
const IDENTITY: NicoArtifactIdentity = {
  schema: "nico.review-artifact-identity.v1",
  run_id: RUN_ID,
  revision: 3,
  report_artifact_digest: "a".repeat(64),
  artifact_digests: {
    markdown: "b".repeat(64),
    html: "c".repeat(64),
    pdf: "d".repeat(64),
    json: "e".repeat(64),
    evidence_manifest: "f".repeat(64),
  },
};

describe("NICO operator client", () => {
  it("accepts only the fixed production HTTPS API boundary", () => {
    assert.throws(() => new NicoOperatorClient({ baseUrl: "http://app.nicoaudit.com/api/nico/" }), /HTTPS/);
    assert.throws(() => new NicoOperatorClient({ baseUrl: "https://evil.example/api/nico/" }), /app\.nicoaudit\.com/);
    assert.throws(() => new NicoOperatorClient({ baseUrl: "https://app.nicoaudit.com/" }), /\/api\/nico\//);
    assert.doesNotThrow(() => new NicoOperatorClient({ baseUrl: "https://app.nicoaudit.com/api/nico/" }));
  });

  it("creates an authorized, immutable public-repository intake without a privileged credential", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = new NicoOperatorClient({
      baseUrl: "https://app.nicoaudit.com/api/nico/",
      fetchImpl: async (input, init) => {
        captured = { url: String(input), init };
        return Response.json({ run_id: RUN_ID, status: "pending" }, { status: 202 });
      },
    });
    const result = await client.createRun({
      runId: RUN_ID,
      repository: "BoneManTGRM/SARA",
      commitSha: SHA,
      clientName: "SARA / BoneManTGRM",
      projectName: "SARA — Controlled NICO review",
      authorizedBy: "Cody Ryan Jenkins",
      authorizationScope: "Public repository and exact SHA only.",
      primaryTechnicalContact: "Cody Ryan Jenkins / BoneManTGRM",
    });

    assert.equal(result.run_id, RUN_ID);
    assert.equal(captured?.url, "https://app.nicoaudit.com/api/nico/assessment/comprehensive-intake");
    assert.equal(captured?.init?.method, "POST");
    const headers = new Headers(captured?.init?.headers);
    assert.equal(headers.has("x-nico-admin-token"), false);
    const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    assert.equal(body.expected_commit_sha, SHA);
    assert.equal(body.authorized, true);
    assert.equal(body.authorization_confirmed, true);
    assert.equal(body.provider_access_mode, "anonymous_public");
  });

  it("uses the password once to approve the exact draft and never returns it", async () => {
    const password = "owner-only-finalization-password";
    let receivedPassword: string | null = null;
    let receivedBodyText = "{}";
    const client = new NicoOperatorClient({
      baseUrl: "https://app.nicoaudit.com/api/nico/",
      fetchImpl: async (_input, init) => {
        receivedPassword = new Headers(init?.headers).get("x-nico-admin-token");
        receivedBodyText = String(init?.body);
        return Response.json({ run_id: RUN_ID, approval_status: "approved" });
      },
    });
    const result = await client.finalizeExactDraft(RUN_ID, password, {
      reviewer: "Cody Ryan Jenkins",
      reviewerRole: "Security reviewer",
      decisionReason: "Reviewed the exact immutable draft and approve it.",
      expectedArtifactIdentity: IDENTITY,
      confirmExactReport: true,
    });

    assert.equal(receivedPassword, password);
    const receivedBody = JSON.parse(receivedBodyText) as Record<string, unknown>;
    assert.equal(receivedBody?.review_authorized, true);
    assert.equal(receivedBody?.authorization_confirmed, true);
    assert.equal(receivedBody?.decision, "approved");
    assert.deepEqual(receivedBody?.expected_artifact_identity, IDENTITY);
    assert.equal(JSON.stringify(result).includes(password), false);
  });

  it("uses SARA's configured service password without requiring owner re-entry", async () => {
    const servicePassword = "sara-dedicated-nico-operator-password";
    let receivedPassword: string | null = null;
    const client = new NicoOperatorClient({
      baseUrl: "https://app.nicoaudit.com/api/nico/",
      operatorPassword: servicePassword,
      fetchImpl: async (_input, init) => {
        receivedPassword = new Headers(init?.headers).get("x-nico-admin-token");
        return Response.json({ findings: [] });
      },
    });
    const result = await client.getReviewQueue(RUN_ID);
    assert.equal(receivedPassword, servicePassword);
    assert.equal(JSON.stringify(result).includes(servicePassword), false);
  });

  it("fails closed on blank passwords, missing confirmation, and stale run identity", async () => {
    const client = new NicoOperatorClient({
      baseUrl: "https://app.nicoaudit.com/api/nico/",
      fetchImpl: async () => { throw new Error("must not call NICO"); },
    });
    const input = {
      reviewer: "Cody Ryan Jenkins",
      reviewerRole: "Security reviewer",
      decisionReason: "Exact draft reviewed.",
      expectedArtifactIdentity: IDENTITY,
      confirmExactReport: true,
    };
    assert.throws(() => client.finalizeExactDraft(RUN_ID, "", input), /password/);
    assert.throws(() => client.finalizeExactDraft(RUN_ID, "valid-password", { ...input, confirmExactReport: false }), /confirmation/);
    assert.throws(() => client.finalizeExactDraft("comprun_ffffffffffffffffffffffffffffffff", "valid-password", input), /run identity/);
  });

  it("redacts the password even when NICO echoes it in an error", async () => {
    const password = "do-not-leak-this-password";
    const client = new NicoOperatorClient({
      baseUrl: "https://app.nicoaudit.com/api/nico/",
      fetchImpl: async () => Response.json({ detail: `invalid ${password}` }, { status: 401 }),
    });
    await assert.rejects(
      client.getReviewQueue(RUN_ID, password),
      (error: Error) => error.message.includes("401") && !error.message.includes(password),
    );
  });
});
