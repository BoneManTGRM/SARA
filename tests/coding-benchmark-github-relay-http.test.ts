import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { RELAY_AUDIENCE, RELAY_PERMIT_KEY, RELAY_REF, RELAY_WORKFLOW } from "../src/coding-benchmark-github-relay.ts";
import { CODING_BENCHMARK_CONTINUATION } from "../src/coding-benchmark-readiness.ts";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "http-test-key", alg: "RS256", use: "sig" };
const owner = "offline-existing-owner-credential";
function signedToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "http-test-key" };
  const payload = { iss: "https://token.actions.githubusercontent.com", aud: RELAY_AUDIENCE,
    sub: `repo:BoneManTGRM@235159333/SARA@1313793559:ref:${RELAY_REF}`,
    repository: "BoneManTGRM/SARA", repository_id: "1313793559", repository_owner: "BoneManTGRM",
    repository_owner_id: "235159333", actor_id: "235159333", ref: RELAY_REF, ref_type: "branch",
    workflow_ref: RELAY_WORKFLOW, workflow_sha: "b".repeat(40), sha: "b".repeat(40),
    event_name: "push", run_attempt: "1", runner_environment: "github-hosted", run_id: "12345",
    head_ref: "", base_ref: "", iat: now, nbf: now - 300, exp: now + 300 };
  const data = [header, payload].map(x => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".");
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
async function fixture(run: (context: { base: string; headers: Record<string, string>; directory: string; kernel: SaraKernel }) => Promise<void>, kernelOwner = owner) {
  const directory = await mkdtemp(join(tmpdir(), "sara-benchmark-relay-http-"));
  const settings = { SARA_OWNER_TOKEN: owner, SARA_OWNER_TOKEN_SHA256: sha256(owner),
    OPENAI_API_KEY: "offline-not-a-provider-key", RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
    [RELAY_PERMIT_KEY]: JSON.stringify({ schemaVersion: 1, benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
      runtimeRevision: "a".repeat(40), workflowRevision: "b".repeat(40),
      notBefore: Math.floor(Date.now() / 1000) - 10, expiresAt: Math.floor(Date.now() / 1000) + 900 }) };
  const previous = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]]));
  Object.assign(process.env, settings);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://token.actions.githubusercontent.com/.well-known/jwks") return Response.json({ keys: [jwk] });
    if (!String(url).startsWith("http://127.0.0.1:")) throw new Error("Unexpected outbound request");
    return originalFetch(url, init);
  };
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(kernelOwner) });
  const server = createSaraServer(kernel, { ownerTokenSha256: sha256(owner), stateDirectory: directory });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    await run({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      headers: { authorization: `Bearer ${signedToken()}`, "content-type": "application/json" }, directory, kernel });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
}
it("a signed scoped relay reaches real owner readiness but cannot spend or clear the old hold", async () => fixture(async ({ base, headers, directory }) => {
  const before = await readdir(directory, { recursive: true });
  const response = await fetch(base + "/api/coding-benchmark/readiness", { headers });
  assert.equal(response.status, 200);
  const value = await response.json() as Record<string, any>;
  assert.equal(value.launcher.authentication, "github_oidc_scoped");
  assert.equal(value.launcher.runId, "12345");
  assert.equal(value.ready, false); assert.equal(value.unresolvedExposureUsd, 0.15);
  assert.equal(value.availableAuthorizationUsd, 0);
  assert.ok(!JSON.stringify(value).includes(owner)); assert.ok(!JSON.stringify(value).includes("offline-not-a-provider-key"));
  const attempt = await fetch(base + "/api/coding-benchmark/run", { method: "POST", headers,
    body: JSON.stringify({ benchmarkId: value.benchmarkId, sourceRevision: value.sourceRevision, authorityDigest: value.authorityDigest }) });
  assert.equal(attempt.status, 423);
  assert.match((await attempt.json() as { code: string }).code, /UNRECONCILED_MODEL_EXPOSURE/u);
  assert.deepEqual(await readdir(directory, { recursive: true }), before);
}));
it("a benchmark relay token has no ordinary owner, stop, tool, bridge or wrong-method authority", async () => fixture(async ({ base, headers }) => {
  for (const path of ["/api/status", "/api/tools", "/api/bridge/actions/anything", "/api/stop", "/api/coding-benchmark/readiness?other=1"]) {
    assert.equal((await fetch(base + path, { headers })).status, 401);
  }
  assert.equal((await fetch(base + "/api/coding-benchmark/readiness", { method: "POST", headers, body: "{}" })).status, 401);
  assert.equal((await fetch(base + "/api/coding-benchmark/run", { headers })).status, 401);
  assert.equal((await fetch(base + "/api/coding-benchmark/readiness")).status, 401);
  assert.equal((await fetch(base + "/api/coding-benchmark/readiness", { headers: { authorization: "Bearer invalid" } })).status, 401);
}));
it("relay admission still requires matching configured and kernel owner credentials", async () => fixture(async ({ base, headers }) => {
  const response = await fetch(base + "/api/coding-benchmark/readiness", { headers });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as { code: string }).code, "OWNER_AUTHENTICATION_FAILED");
}, "different-kernel-owner"));
it("revoking the permit or removing the owner credential disables the relay immediately", async () => fixture(async ({ base, headers }) => {
  const ownerValue = process.env.SARA_OWNER_TOKEN;
  delete process.env.SARA_OWNER_TOKEN;
  assert.equal((await fetch(base + "/api/coding-benchmark/readiness", { headers })).status, 401);
  process.env.SARA_OWNER_TOKEN = "wrong-owner";
  assert.equal((await fetch(base + "/api/coding-benchmark/readiness", { headers })).status, 401);
  process.env.SARA_OWNER_TOKEN = ownerValue;
  delete process.env[RELAY_PERMIT_KEY];
  assert.equal((await fetch(base + "/api/coding-benchmark/readiness", { headers })).status, 401);
}));
