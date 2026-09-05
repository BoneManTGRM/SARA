import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { it } from "node:test";
import {
  createCodingBenchmarkRelayAuthenticator, RELAY_AUDIENCE, RELAY_PERMIT_KEY, RELAY_REF, RELAY_WORKFLOW,
} from "../src/coding-benchmark-github-relay.ts";
import { ADDITIONAL_BENCHMARK_AUTHORIZATION, BENCHMARK_AUTHORIZATION_KEY, CODING_BENCHMARK_CONTINUATION } from "../src/coding-benchmark-readiness.ts";

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

it("admits only the pinned GitHub-signed benchmark launcher and returns no credentials", async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: keys });
  const result = await authenticate(token(), environment());
  assert.deepEqual(result, { authentication: "github_oidc_scoped", benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
    runId: "12345", workflowRevision: "b".repeat(40), runtimeRevision: "a".repeat(40) });
  assert.ok(!JSON.stringify(result).includes(token()));
});
it("accepts the documented legacy subject only with the same immutable repository and owner IDs", async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: keys });
  assert.ok(await authenticate(token(claims({ sub: `repo:BoneManTGRM/SARA:ref:${RELAY_REF}` })), environment()));
});

const alteredClaims: Record<string, unknown>[] = [
  { aud: "another-audience" }, { iss: "https://attacker.invalid" }, { repository: "BoneManTGRM/NICO" },
  { repository_id: "999" }, { repository_owner_id: "999" }, { actor_id: "999" },
  { ref: "refs/heads/main" }, { workflow_ref: "another/workflow" }, { workflow_sha: "c".repeat(40) },
  { sha: "c".repeat(40) }, { event_name: "pull_request_target" }, { run_attempt: "2" },
  { runner_environment: "self-hosted" }, { run_id: "" }, { head_ref: "feature" },
  { exp: now / 1000 }, { iat: now / 1000 + 100 }, { nbf: now / 1000 + 100 },
  { exp: now / 1000 + 3600 }, { exp: String(now / 1000 + 300) },
  { sub: "repo:BoneManTGRM/SARA:environment:production" }, { job_workflow_ref: "delegated/reusable/workflow" },
];
for (const change of alteredClaims) it(`rejects signed but unauthorized claims: ${Object.keys(change)[0]}`, async () => {
  let fetches = 0;
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: async (...args) => { fetches++; return keys(...args); } });
  assert.equal(await authenticate(token(claims(change)), environment()), null);
  assert.equal(fetches, 0, "cheap identity checks must precede outbound key requests");
});

for (const change of [
  { maximumSpendUsd: 100 }, { expiresAt: now / 1000 }, { expiresAt: now / 1000 + 7200 },
  { notBefore: now / 1000 + 100 }, { benchmarkId: "replacement-grant" },
  { runtimeRevision: "c".repeat(40) }, { workflowRevision: [] }, { schemaVersion: "1" },
]) it(`rejects invalid or expanded relay permit: ${Object.keys(change)[0]}`, async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: async () => { throw new Error("Must not fetch"); } });
  assert.equal(await authenticate(token(), environment(permit(change))), null);
});
it("is disabled without an explicit permit", async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: keys });
  assert.equal(await authenticate(token(), {}), null);
});
it("rejects forged signatures, algorithm confusion and token-directed key URLs", async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: keys });
  const signed = token().split(".");
  signed[2] = Buffer.alloc(256).toString("base64url");
  assert.equal(await authenticate(signed.join("."), environment()), null);
  for (const header of [{ alg: "none" }, { alg: "HS256" }, { jku: "https://attacker.invalid" }]) {
    assert.equal(await authenticate(token(claims(), header), environment()), null);
  }
  assert.equal(await authenticate("x".repeat(40_000), environment()), null);
});
it("rejects invalid, ambiguous or unreachable signing keys without leaking errors", async () => {
  for (const reply of [() => Response.json({ keys: [{ ...jwk, use: "enc" }] }),
    () => Response.json({ keys: [jwk, jwk] }), () => new Response("x".repeat(70_000)),
    () => new Response("not-json"), () => new Response("secret error", { status: 500 }),
    () => { throw new Error("private diagnostic"); }]) {
    const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: async () => reply() });
    assert.equal(await authenticate(token(), environment()), null);
  }
});
it("rechecks permit expiry and replacement after asynchronous signing-key retrieval", async () => {
  for (const mode of ["expiry", "replacement"]) {
    const env = environment(); let clock = now;
    const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => clock, fetchImpl: async (...args) => {
      if (mode === "expiry") clock += 2_000_000; else env[RELAY_PERMIT_KEY] = "";
      return keys(...args);
    } });
    assert.equal(await authenticate(token(), env), null);
  }
});
it("coalesces overlapping key retrieval and never caches an authorization decision", async () => {
  let count = 0;
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now,
    fetchImpl: async (...args) => { count++; await new Promise(resolve => setTimeout(resolve, 2)); return keys(...args); } });
  const results = await Promise.all([authenticate(token(), environment()), authenticate(token(), environment())]);
  assert.ok(results.every(Boolean)); assert.equal(count, 1);
  assert.equal(await authenticate(token(claims({ run_attempt: "2" })), environment()), null);
});

it("accepts issuer-observed self-workflow claims only when both repeat the exact pinned job source", async () => {
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: keys });
  const result = await authenticate(token(claims({
    job_workflow_ref: RELAY_WORKFLOW, job_workflow_sha: "b".repeat(40),
  })), environment());
  assert.equal(result?.workflowRevision, "b".repeat(40));
  assert.equal(result?.authentication, "github_oidc_scoped");
});
for (const change of [
  { job_workflow_ref: RELAY_WORKFLOW },
  { job_workflow_sha: "b".repeat(40) },
  { job_workflow_ref: RELAY_WORKFLOW, job_workflow_sha: "c".repeat(40) },
  { job_workflow_ref: "another/reusable/workflow", job_workflow_sha: "b".repeat(40) },
  { job_workflow_ref: RELAY_WORKFLOW, job_workflow_sha: ["b".repeat(40)] },
  { job_workflow_ref: null, job_workflow_sha: null },
]) it(`rejects incomplete, changed or malformed job workflow claims ${JSON.stringify(change)}`, async () => {
  let fetches = 0;
  const authenticate = createCodingBenchmarkRelayAuthenticator({ now: () => now, fetchImpl: async (...args) => {
    fetches++; return keys(...args);
  } });
  assert.equal(await authenticate(token(claims(change)), environment()), null);
  assert.equal(fetches, 0);
});


it("a fresh-grant relay cannot authenticate the old grant and requires exact selected identity", async () => {
  const auth=createCodingBenchmarkRelayAuthenticator({now:()=>now,fetchImpl:keys});
  const added=ADDITIONAL_BENCHMARK_AUTHORIZATION.benchmarkId;
  const env: Record<string,string>={...environment(permit({benchmarkId:added})),[BENCHMARK_AUTHORIZATION_KEY]:added};
  assert.equal((await auth(token(),env))?.benchmarkId,added);
  assert.equal(await auth(token(),{...env,[RELAY_PERMIT_KEY]:JSON.stringify(permit())}),null);
  assert.equal(await auth(token(),{...env,[BENCHMARK_AUTHORIZATION_KEY]:"invalid"}),null);
});
it("revoking fresh-grant selection during signing-key I/O denies admission", async () => {
  const added=ADDITIONAL_BENCHMARK_AUTHORIZATION.benchmarkId;
  const env: Record<string,string>={...environment(permit({benchmarkId:added})),[BENCHMARK_AUTHORIZATION_KEY]:added};
  const auth=createCodingBenchmarkRelayAuthenticator({now:()=>now,fetchImpl:async(...args)=>{env[BENCHMARK_AUTHORIZATION_KEY]=CODING_BENCHMARK_CONTINUATION.benchmarkId;return keys(...args);}});
  assert.equal(await auth(token(),env),null);
});
