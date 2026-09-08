import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { createRepositoryCloudAuthenticator, type RepositoryCloudPermit } from "../src/repository-cloud-auth.ts";
import { CLOUD_AUDIENCE } from "../src/repository-cloud-protocol.ts";

const now = 1800000000000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" };
const permit: RepositoryCloudPermit = { schemaVersion: 1, benchmarkId: "cloud-fixture", registrationDigest: "a".repeat(64),
  runtimeRevision: "b".repeat(40), workflowRevision: "b".repeat(40), workflowRef: "refs/heads/run/swe-cloud-fixture",
  notBefore: now / 1000 - 1, expiresAt: now / 1000 + 3600 };
const claims = { iss: "https://token.actions.githubusercontent.com", aud: CLOUD_AUDIENCE,
  sub: "repo:BoneManTGRM/SARA:ref:refs/heads/run/swe-cloud-fixture", repository: "BoneManTGRM/SARA", repository_id: "1313793559",
  repository_owner: "BoneManTGRM", repository_owner_id: "235159333", actor_id: "235159333", ref: permit.workflowRef, ref_type: "branch",
  workflow_ref: `BoneManTGRM/SARA/.github/workflows/repository-cloud-benchmark.yml@${permit.workflowRef}`,
  workflow_sha: permit.workflowRevision, sha: permit.workflowRevision, event_name: "push", run_attempt: "1",
  runner_environment: "github-hosted", run_id: "1234", iat: now / 1000, nbf: now / 1000 - 100, exp: now / 1000 + 300 };
function token(change = {}, header = {}) {
  const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const data = `${encode({ alg: "RS256", typ: "JWT", kid: "fixture", ...header })}.${encode({ ...claims, ...change })}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
test("cloud OIDC is disabled without its exact permit and never returns owner credentials", async () => {
  let current: RepositoryCloudPermit | undefined;
  const authenticate = createRepositoryCloudAuthenticator({ currentPermit: () => current, now: () => now,
    fetchImpl: async () => Response.json({ keys: [jwk] }) });
  assert.equal(await authenticate(token()), null); current = permit;
  assert.deepEqual(await authenticate(token()), { authentication: "github_oidc_repository_worker", benchmarkId: permit.benchmarkId,
    registrationDigest: permit.registrationDigest, workflowRevision: permit.workflowRevision, runId: "1234" });
});
test("signed fork, source, role, event, rerun, time and owner substitutions cannot authenticate", async () => {
  let fetches = 0;
  const authenticate = createRepositoryCloudAuthenticator({ currentPermit: () => permit, now: () => now,
    fetchImpl: async () => { fetches++; return Response.json({ keys: [jwk] }); } });
  for (const change of [{ aud: "owner" }, { repository_id: "2" }, { actor_id: "2" }, { repository_owner_id: "2" },
    { ref: "refs/heads/main" }, { sha: "c".repeat(40) }, { workflow_sha: "c".repeat(40) }, { workflow_ref: "other" },
    { event_name: "workflow_dispatch" }, { event_name: "pull_request_target" }, { run_attempt: "2" }, { runner_environment: "self-hosted" },
    { run_id: "" }, { job_workflow_ref: claims.workflow_ref }, { job_workflow_sha: claims.sha }, { head_ref: "fork" },
    { exp: now / 1000 }, { nbf: now / 1000 + 1 }, { iat: now / 1000 + 31 }, { exp: now / 1000 + 1000 }]) {
    assert.equal(await authenticate(token(change)), null, JSON.stringify(change));
  }
  assert.equal(fetches, 0);
});
test("cloud OIDC rejects signature and key confusion and rechecks revocation after key fetch", async () => {
  let current: RepositoryCloudPermit | undefined = permit;
  const authenticate = createRepositoryCloudAuthenticator({ currentPermit: () => current, now: () => now,
    fetchImpl: async () => Response.json({ keys: [jwk] }) });
  for (const header of [{ alg: "none" }, { alg: "HS256" }, { jku: "https://attacker.invalid" }]) assert.equal(await authenticate(token({}, header)), null);
  const parts = token().split("."); parts[2] = Buffer.alloc(256).toString("base64url"); assert.equal(await authenticate(parts.join(".")), null);
  for (const keys of [[jwk, jwk], [{ ...jwk, use: "enc" }]]) {
    const check = createRepositoryCloudAuthenticator({ currentPermit: () => permit, now: () => now, fetchImpl: async () => Response.json({ keys }) });
    assert.equal(await check(token()), null);
  }
  const revoked = createRepositoryCloudAuthenticator({ currentPermit: () => current, now: () => now,
    fetchImpl: async () => { current = undefined; return Response.json({ keys: [jwk] }); } });
  assert.equal(await revoked(token()), null);
});
