import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type AddressInfo } from "node:http";
import { afterEach, describe, it } from "node:test";
import { TelegramNicoHttpBridge } from "../src/telegram-nico-http.ts";
import { GMAIL_REPORT_SENDER } from "../src/gmail-oauth-activation.ts";
import { GMAIL_REPORT_RECIPIENT } from "../src/gmail-verified-report-sender.ts";

const TOKEN = "telegram-bridge-token-value";
const TOKEN_DIGEST = createHash("sha256").update(TOKEN).digest("hex");
const USER = "paired-owner";
const USER_DIGEST = createHash("sha256").update(USER).digest("hex");
const COMMIT = "22dda61ea29037ba85af25e84bc5efba77e62f44";
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

async function serve(bridge: TelegramNicoHttpBridge): Promise<string> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (await bridge.handle(request, response, url)) return;
    response.writeHead(204, { "x-analysis-route": "untouched" });
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function bridge(input: { calls?: unknown[]; oauth?: boolean } = {}) {
  const calls = input.calls ?? [];
  return new TelegramNicoHttpBridge({
    bridgeTokenSha256: TOKEN_DIGEST,
    expectedTelegramUserIdSha256: USER_DIGEST,
    operator: {
      submit: async (command) => {
        calls.push(command);
        return {
          requestId: command.requestId,
          assessmentRequestId: command.requestId,
          action: command.action as "nico_assessment_start",
          state: "accepted",
          runId: "run-1",
          repository: "sindresorhus/p-map",
          repositoryUrl: "https://github.com/sindresorhus/p-map",
          commitSha: COMMIT,
          updatedAt: "2026-09-04T15:00:00.000Z",
        };
      },
    },
    gmailOAuthActivation: input.oauth ? {
      start: async () => ({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque", expiresAt: "2026-09-04T15:10:00.000Z" }),
      complete: async () => ({ status: "activated", authenticatedSender: GMAIL_REPORT_SENDER, permission: "gmail.send", authenticatedAt: "2026-09-04T15:00:00.000Z" }),
    } : undefined,
  });
}

describe("Telegram NICO HTTP bridge", () => {
  it("leaves the ordinary Telegram Luna route analysis-only", async () => {
    const base = await serve(bridge());
    const response = await fetch(`${base}/api/telegram/luna`, { method: "POST" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("x-analysis-route"), "untouched");
  });

  it("requires the existing bridge credential and Cody's paired Telegram identity", async () => {
    const calls: unknown[] = [];
    const base = await serve(bridge({ calls }));
    const body = JSON.stringify({ requestId: "request-00000001", telegramUserId: USER, action: "nico_assessment_status", assessmentRequestId: "assessment-0001" });
    assert.equal((await fetch(`${base}/api/telegram/actions`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
    const unpaired = await fetch(`${base}/api/telegram/actions`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ requestId: "request-00000001", telegramUserId: "unpaired", action: "nico_assessment_status", assessmentRequestId: "assessment-0001" }) });
    assert.equal(unpaired.status, 403);
    assert.equal(calls.length, 0);
  });

  it("delegates only a deterministic supported structured action", async () => {
    const calls: unknown[] = [];
    const base = await serve(bridge({ calls }));
    const response = await fetch(`${base}/api/telegram/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "request-00000001",
        telegramUserId: USER,
        action: "nico_assessment_start",
        repository: "https://github.com/sindresorhus/p-map",
        commitSha: COMMIT,
        emailVerifiedReport: false,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      requestId: "request-00000001",
      telegramUserId: USER,
      action: "nico_assessment_start",
      repository: "https://github.com/sindresorhus/p-map",
      commitSha: COMMIT,
      assessmentRequestId: undefined,
      reportDigest: undefined,
      sender: undefined,
      recipient: undefined,
      emailVerifiedReport: false,
    });
  });

  it("deterministically parses the authorized private p-map instruction without model tool authority", async () => {
    const calls: unknown[] = [];
    const base = await serve(bridge({ calls }));
    const instruction = `Run a private NICO automated assessment of https://github.com/sindresorhus/p-map locked to commit ${COMMIT}. Require exact commit identity, zero unresolved review workload, independent package verification, automated-delivery disclosure, and no human-review claim. Do not contact the repository owner or publish the report. Email the verified final report from ${GMAIL_REPORT_SENDER} to ${GMAIL_REPORT_RECIPIENT} and return the assessment and delivery receipts.`;
    const response = await fetch(`${base}/api/telegram/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: "request-00000002", telegramUserId: USER, instruction }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], {
      requestId: "request-00000002",
      telegramUserId: USER,
      action: "nico_assessment_start",
      repository: "https://github.com/sindresorhus/p-map",
      commitSha: COMMIT,
      emailVerifiedReport: true,
      sender: GMAIL_REPORT_SENDER,
      recipient: GMAIL_REPORT_RECIPIENT,
    });
  });

  it("starts OAuth only for the paired identity and returns a sanitized exact-account authorization step", async () => {
    const base = await serve(bridge({ oauth: true }));
    const response = await fetch(`${base}/api/telegram/gmail/oauth/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ telegramUserId: USER }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.authenticatedSenderRequired, GMAIL_REPORT_SENDER);
    assert.equal(typeof body.authorizationUrl, "string");
    const callback = await fetch(`${base}/api/gmail/oauth/callback?state=opaque&code=authorization-code-123`);
    assert.equal(callback.status, 200);
    const html = await callback.text();
    assert.match(html, /sara\.reparodynamics@gmail\.com/u);
    assert.doesNotMatch(html, /authorization-code-123|opaque/u);
  });
});
