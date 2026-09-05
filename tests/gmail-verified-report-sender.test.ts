import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { GMAIL_REPORT_SENDER } from "../src/gmail-oauth-activation.ts";
import {
  GMAIL_REPORT_RECIPIENT,
  GmailVerifiedReportSender,
  type GmailVerifiedReportInput,
} from "../src/gmail-verified-report-sender.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "sara-gmail-send-"));
  temporaryDirectories.push(value);
  return value;
}

function report(): GmailVerifiedReportInput {
  const reportBytes = new Uint8Array(Buffer.from("%PDF-1.7\nverified automated report bytes\n", "utf8"));
  return {
    requestId: "email:request-00000001",
    sender: GMAIL_REPORT_SENDER,
    recipient: GMAIL_REPORT_RECIPIENT,
    repository: "sindresorhus/p-map",
    commitSha: "22dda61ea29037ba85af25e84bc5efba77e62f44",
    reportDigest: createHash("sha256").update(reportBytes).digest("hex"),
    contentType: "application/pdf",
    reportBytes,
  };
}

describe("verified Gmail report sender", () => {
  it("verifies exact sender immediately before sending and preserves the verified attachment bytes", async () => {
    const stateDirectory = await directory();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const sender = new GmailVerifiedReportSender({
      stateDirectory,
      clientId: "client-id-123456",
      clientSecret: "client-secret-123456",
      refreshToken: "refresh-token-123456",
      now: () => new Date("2026-09-04T13:00:00.000Z"),
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "access-token-value", token_type: "Bearer" });
        if (url.includes("openidconnect.googleapis.com")) return Response.json({ email: GMAIL_REPORT_SENDER, email_verified: true });
        return Response.json({ id: "gmail-provider-message-1" });
      },
    });
    const input = report();
    const receipt = await sender.send(input);
    assert.equal(receipt.status, "provider_accepted");
    assert.equal(receipt.sender, GMAIL_REPORT_SENDER);
    assert.equal(receipt.recipient, GMAIL_REPORT_RECIPIENT);
    assert.equal(receipt.providerDeliveryId, "gmail-provider-message-1");
    assert.equal(calls.length, 3);
    const sendBody = JSON.parse(String(calls[2]?.init?.body)) as { raw: string };
    const mime = Buffer.from(sendBody.raw, "base64url").toString("utf8");
    assert.match(mime, /From: SARA <sara\.reparodynamics@gmail\.com>/u);
    assert.match(mime, /To: reparodynamics@gmail\.com/u);
    assert.match(mime, /not human reviewed/u);
    assert.match(mime, /not a certification, warranty, or security guarantee/u);
    assert.ok(mime.includes(Buffer.from(input.reportBytes).toString("base64")));
    assert.deepEqual(await sender.send(input), receipt);
    assert.equal(calls.length, 3, "idempotent replay must not send a second message");
  });

  it("rejects altered bytes, Cody's sender identity, and an unauthorized recipient before network access", async () => {
    const stateDirectory = await directory();
    let calls = 0;
    const sender = new GmailVerifiedReportSender({
      stateDirectory,
      clientId: "client-id-123456",
      clientSecret: "client-secret-123456",
      refreshToken: "refresh-token-123456",
      fetchImpl: async () => { calls += 1; return Response.json({}); },
    });
    const original = report();
    await assert.rejects(() => sender.send({ ...original, reportBytes: new Uint8Array(Buffer.from("changed")) }), /no longer match/);
    await assert.rejects(() => sender.send({ ...original, requestId: "email:request-00000002", sender: "reparodynamics@gmail.com" }), /sender must be exactly/);
    await assert.rejects(() => sender.send({ ...original, requestId: "email:request-00000003", recipient: "owner@example.com" }), /recipient must be exactly/);
    assert.equal(calls, 0);
  });

  it("rejects a non-SARA authenticated account and never calls Gmail send", async () => {
    const stateDirectory = await directory();
    const urls: string[] = [];
    const sender = new GmailVerifiedReportSender({
      stateDirectory,
      clientId: "client-id-123456",
      clientSecret: "client-secret-123456",
      refreshToken: "refresh-token-123456",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        return url.includes("oauth2.googleapis.com")
          ? Response.json({ access_token: "access-token-value", token_type: "Bearer" })
          : Response.json({ email: "reparodynamics@gmail.com", email_verified: true });
      },
    });
    await assert.rejects(() => sender.send(report()), /must be exactly sara\.reparodynamics@gmail\.com/);
    assert.equal(urls.some((url) => url.includes("gmail.googleapis.com")), false);
  });

  it("does not record provider rejection as successful delivery", async () => {
    const stateDirectory = await directory();
    const sender = new GmailVerifiedReportSender({
      stateDirectory,
      clientId: "client-id-123456",
      clientSecret: "client-secret-123456",
      refreshToken: "refresh-token-123456",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "access-token-value", token_type: "Bearer" });
        if (url.includes("openidconnect.googleapis.com")) return Response.json({ email: GMAIL_REPORT_SENDER, email_verified: true });
        return new Response(JSON.stringify({ error: "rejected" }), { status: 403 });
      },
    });
    await assert.rejects(() => sender.send(report()), /did not accept/);
    await assert.rejects(() => sender.send(report()), /original Gmail delivery attempt failed/);
  });
});
