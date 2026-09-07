import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  GMAIL_OAUTH_SCOPES,
  GMAIL_REPORT_SENDER,
  GmailOAuthActivation,
  RailwayRefreshTokenSecretWriter,
} from "../src/gmail-oauth-activation.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "sara-gmail-oauth-"));
  temporaryDirectories.push(value);
  return value;
}

describe("Gmail OAuth activation", () => {
  it("requests only OIDC email identity plus gmail.send and stores the refresh token through the secret boundary", async () => {
    const stateDirectory = await directory();
    const written: string[] = [];
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const activation = new GmailOAuthActivation({
      stateDirectory,
      clientId: "client-id-123456",
      clientSecret: "client-secret-123456",
      redirectUri: "https://sara.example/api/gmail/oauth/callback",
      secretWriter: { write: async (value) => { written.push(value); } },
      now: () => new Date("2026-09-04T12:00:00.000Z"),
      fetchImpl: async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.includes("oauth2.googleapis.com/token")) {
          return Response.json({
            access_token: "access-token-value",
            refresh_token: "refresh-token-value",
            token_type: "Bearer",
            scope: GMAIL_OAUTH_SCOPES.join(" "),
          });
        }
        return Response.json({ email: GMAIL_REPORT_SENDER, email_verified: true });
      },
    });
    const started = await activation.start();
    const authorization = new URL(started.authorizationUrl);
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.deepEqual(new Set((authorization.searchParams.get("scope") ?? "").split(" ")), new Set(GMAIL_OAUTH_SCOPES));
    assert.equal(authorization.searchParams.get("login_hint"), GMAIL_REPORT_SENDER);
    assert.equal(authorization.searchParams.get("access_type"), "offline");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    const state = authorization.searchParams.get("state")!;
    const receipt = await activation.complete({ state, code: "authorization-code-123" });
    assert.deepEqual(receipt, {
      status: "activated",
      authenticatedSender: GMAIL_REPORT_SENDER,
      permission: "gmail.send",
      authenticatedAt: "2026-09-04T12:00:00.000Z",
    });
    assert.deepEqual(written, ["refresh-token-value"]);
    assert.equal(requests.length, 2);
    const remaining = await readdir(join(stateDirectory, "gmail-oauth-activation"));
    assert.deepEqual(remaining, []);
    await assert.rejects(() => activation.complete({ state, code: "authorization-code-123" }), /already used/);
  });

  it("rejects every authenticated Gmail identity except SARA's exact account", async () => {
    const stateDirectory = await directory();
    let writes = 0;
    const activation = new GmailOAuthActivation({
      stateDirectory,
      clientId: "client-id-123456",
      clientSecret: "client-secret-123456",
      redirectUri: "https://sara.example/api/gmail/oauth/callback",
      secretWriter: { write: async () => { writes += 1; } },
      fetchImpl: async (input) => String(input).includes("token")
        ? Response.json({ access_token: "access-token-value", refresh_token: "refresh-token-value", token_type: "Bearer", scope: GMAIL_OAUTH_SCOPES.join(" ") })
        : Response.json({ email: "reparodynamics@gmail.com", email_verified: true }),
    });
    const state = new URL((await activation.start()).authorizationUrl).searchParams.get("state")!;
    await assert.rejects(() => activation.complete({ state, code: "authorization-code-123" }), /requires exactly sara\.reparodynamics@gmail\.com/);
    assert.equal(writes, 0);
  });

  it("writes only the refresh-token variable through a Railway project token without echoing it", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const writer = new RailwayRefreshTokenSecretWriter({
      projectToken: "railway-project-token",
      projectId: "railway-project-id",
      serviceId: "railway-service-id",
      environmentId: "railway-environment-id",
      fetchImpl: async (input, init) => {
        request = { url: String(input), init };
        return Response.json({ data: { variableCollectionUpsert: true } });
      },
    });
    assert.equal(await writer.write("refresh-token-value"), undefined);
    assert.equal(request?.url, "https://backboard.railway.com/graphql/v2");
    assert.equal(new Headers(request?.init?.headers).get("Project-Access-Token"), "railway-project-token");
    const body = JSON.parse(String(request?.init?.body)) as { variables: { input: { variables: Record<string, string>; skipDeploys: boolean } } };
    assert.deepEqual(body.variables.input.variables, { SARA_GMAIL_REFRESH_TOKEN: "refresh-token-value" });
    assert.equal(body.variables.input.skipDeploys, false);
  });
});
