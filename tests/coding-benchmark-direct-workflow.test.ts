import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { it } from "node:test";
import {
  createCodingBenchmarkRelayAuthenticator, RELAY_AUDIENCE, RELAY_PERMIT_KEY, RELAY_REF, RELAY_WORKFLOW,
} from "../src/coding-benchmark-github-relay.ts";
import { CODING_BENCHMARK_CONTINUATION } from "../src/coding-benchmark-readiness.ts";

const now = Date.parse("2026-09-05T22:30:00Z");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
function permit(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
    runtimeRevision: "a".repeat(40), workflowRevision: "b".repeat(40),
    notBefore: now / 1000 - 10, expiresAt: now / 1000 + 1800, ...overrides };
}
function environment(p = permit()) {
  return { RAILWAY_GIT_COMMIT_SHA: "a".repeat(40), [RELAY_PERMIT_KEY]: JSON.stringify(p) };
}
function claims(overrides: Record<string, unknown> = {}) {
  return { iss: "https://token.actions.githubusercontent.com", aud: RELAY_AUDIENCE,
    sub: `repo:BoneManTGRM@235159333/SARA@1313793559:ref:${RELAY_REF}`,
    repository: "BoneManTGRM/SARA", repository_id: "1313793559", repository_owner: "BoneManTGRM",
    repository_owner_id: "235159333", actor_id: "235159333", ref: RELAY_REF, ref_type: "branch",
    workflow_ref: RELAY_WORKFLOW, workflow_sha: "b".repeat(40), sha: "b".repeat(40),
    event_name: "push", run_attempt: "1", runner_environment: "github-hosted", run_id: "12345",
    head_ref: "", base_ref: "", iat: now / 1000, nbf: now / 1000 - 300, exp: now / 1000 + 300,
    jti: "unit-test-token", ...overrides };
}
function token(payload = claims(), headers: Record<string, unknown> = {}) {
  const encoded = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const data = `${encoded({ alg: "RS256", typ: "JWT", kid: "test-key", ...headers })}.${encoded(payload)}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
const keys: typeof fetch = async (url, init) => {
  assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks");
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal);
  assert.equal(new Headers(init?.headers).get("authorization"), null);
  return Response.json({ keys: [jwk] });
};

// Actual GitHub issuer metadata from diagnostic run 33996944716 includes these
// two claims for a direct workflow too. They may identify only this same pinned
// workflow, never an alternate reusable workflow or an incomplete claim pair.
it("accepts direct-workflow job claims only when both match the pinned workflow", async () => {
  let keyRequests = 0;
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now,
    fetchImpl: async (...args) => { keyRequests++; return keys(...args); } });
  const result = await authenticate(token(claims({
    job_workflow_ref: RELAY_WORKFLOW, job_workflow_sha: "b".repeat(40),
  })), environment());
  assert.equal(result?.authentication, "github_oidc_scoped");
  assert.equal(result?.workflowRevision, "b".repeat(40));
  assert.equal(keyRequests, 1, "same-workflow claims still require real signature verification");
});
for (const [label, change] of [
  ["missing job revision", { job_workflow_ref: RELAY_WORKFLOW }],
  ["missing job reference", { job_workflow_sha: "b".repeat(40) }],
  ["different job revision", { job_workflow_ref: RELAY_WORKFLOW, job_workflow_sha: "c".repeat(40) }],
  ["different job reference", { job_workflow_ref: "foreign/reusable.yml", job_workflow_sha: "b".repeat(40) }],
  ["null pair", { job_workflow_ref: null, job_workflow_sha: null }],
  ["empty pair", { job_workflow_ref: "", job_workflow_sha: "" }],
  ["nonprimitive reference", { job_workflow_ref: [RELAY_WORKFLOW], job_workflow_sha: "b".repeat(40) }],
] as const) it(`rejects partial or foreign direct-workflow job claims: ${label}`, async () => {
  let keyRequests = 0;
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now,
    fetchImpl: async (...args) => { keyRequests++; return keys(...args); } });
  assert.equal(await authenticate(token(claims(change)), environment()), null);
  assert.equal(keyRequests, 0);
});
it("rejects a forged signature even with the matching direct-workflow claim pair", async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: keys });
  const parts = token(claims({ job_workflow_ref: RELAY_WORKFLOW, job_workflow_sha: "b".repeat(40) })).split(".");
  parts[2] = Buffer.alloc(256).toString("base64url");
  assert.equal(await authenticate(parts.join("."), environment()), null);
});
