import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { selectedBenchmarkAuthorization } from "./coding-benchmark-readiness.ts";

export const RELAY_AUDIENCE = "https://sara-operator-production.up.railway.app/api/coding-benchmark";
export const RELAY_PERMIT_KEY = "SARA_CODING_BENCHMARK_GITHUB_RELAY_PERMIT_JSON";
export const RELAY_REF = "refs/heads/verify/coding-benchmark-owner-relay-20260905";
export const RELAY_WORKFLOW = `BoneManTGRM/SARA/.github/workflows/coding-benchmark-owner-relay.yml@${RELAY_REF}`;
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = `${ISSUER}/.well-known/jwks`;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/u.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OBJECT");
  return value as Record<string, unknown>;
}
function decode(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("INVALID_ENCODING");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("NONCANONICAL_ENCODING");
  return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
type Permit = { schemaVersion: 1; benchmarkId: string; runtimeRevision: string;
  workflowRevision: string; notBefore: number; expiresAt: number };
function permit(raw: string | undefined, runtime: string | undefined, milliseconds: number, benchmarkId: string): Permit {
  if (!raw || raw.length > 2048 || !Number.isFinite(milliseconds)) throw new Error("NO_PERMIT");
  const v = record(JSON.parse(raw));
  const fields = ["schemaVersion", "benchmarkId", "runtimeRevision", "workflowRevision", "notBefore", "expiresAt"];
  const seconds = Math.floor(milliseconds / 1000);
  if (Object.keys(v).length !== fields.length || !fields.every(k => Object.hasOwn(v, k))
    || v.schemaVersion !== 1 || v.benchmarkId !== benchmarkId
    || !sha(v.runtimeRevision) || v.runtimeRevision !== runtime || !sha(v.workflowRevision)
    || !integer(v.notBefore) || !integer(v.expiresAt) || v.expiresAt <= v.notBefore
    || v.expiresAt - v.notBefore > 3600 || seconds < v.notBefore || seconds >= v.expiresAt) {
    throw new Error("INVALID_PERMIT");
  }
  return v as Permit;
}
function claimsMatch(c: Record<string, unknown>, p: Permit, milliseconds: number): boolean {
  const seconds = Math.floor(milliseconds / 1000);
  const subjects = [`repo:BoneManTGRM/SARA:ref:${RELAY_REF}`,
    `repo:BoneManTGRM@235159333/SARA@1313793559:ref:${RELAY_REF}`];
  return c.iss === ISSUER && c.aud === RELAY_AUDIENCE && typeof c.sub === "string" && subjects.includes(c.sub)
    && c.repository === "BoneManTGRM/SARA" && c.repository_id === "1313793559"
    && c.repository_owner === "BoneManTGRM" && c.repository_owner_id === "235159333" && c.actor_id === "235159333"
    && c.ref === RELAY_REF && c.ref_type === "branch" && c.workflow_ref === RELAY_WORKFLOW
    && c.workflow_sha === p.workflowRevision && c.sha === p.workflowRevision
    && c.event_name === "push" && c.run_attempt === "1" && c.runner_environment === "github-hosted"
    && typeof c.run_id === "string" && /^[1-9][0-9]{0,19}$/u.test(c.run_id)
    && (c.head_ref === "" || c.head_ref === undefined) && (c.base_ref === "" || c.base_ref === undefined)
    // The real issuer also supplies these fields for the job's own workflow.
    // Accept their joint absence OR the exact pinned self-workflow pair only.
    && ((c.job_workflow_ref === undefined && c.job_workflow_sha === undefined)
      || (c.job_workflow_ref === RELAY_WORKFLOW && c.job_workflow_sha === p.workflowRevision))
    && integer(c.iat) && integer(c.nbf) && integer(c.exp) && c.nbf <= c.iat
    && c.iat <= seconds + 30 && c.nbf <= seconds && c.exp > seconds
    && c.exp > c.iat && c.exp - c.iat <= 600 && c.iat - c.nbf <= 600;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("KEYS_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65_536) throw new Error("KEYS_TOO_LARGE");
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export type CodingBenchmarkRelayIdentity = {
  authentication: "github_oidc_scoped"; benchmarkId: string; runId: string;
  workflowRevision: string; runtimeRevision: string;
};

/** An owner-configured, at-most-one-hour delegation to a specific workflow commit.
 * It grants NO new spending and authenticates NO other route. The server still
 * authenticates its existing owner with the kernel and uses the unchanged launch
 * gate, durable claim and runner. No owner/provider credential leaves Railway.
 */
export function createCodingBenchmarkRelayAuthenticator(options: {
  now?: () => number; fetchImpl?: typeof fetch;
} = {}) {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? ((resource, init) => globalThis.fetch(resource, init));
  // Cache only public signing keys, never token decisions. Coalesce simultaneous
  // lookups. A failed lookup remains failed briefly rather than flooding upstream.
  let cache: { expiresAt: number; keys: Promise<Record<string, unknown>[]> } | null = null;
  const keys = () => {
    if (cache && now() < cache.expiresAt) return cache.keys;
    const entry = { expiresAt: now() + 300_000, keys: Promise.resolve([] as Record<string, unknown>[]) };
    entry.keys = (async () => {
      try {
        const value = record(await boundedJson(await fetchImpl(JWKS, {
          method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000),
        })));
        if (!Array.isArray(value.keys) || value.keys.length > 20) throw new Error("INVALID_KEYS");
        return value.keys.map(record);
      } catch { entry.expiresAt = now() + 10_000; return []; }
    })();
    cache = entry;
    return entry.keys;
  };
  return async (token: string, environment: Record<string, string | undefined>): Promise<CodingBenchmarkRelayIdentity | null> => {
    try {
      const rawPermit = environment[RELAY_PERMIT_KEY];
      const runtime = environment.RAILWAY_GIT_COMMIT_SHA;
      const selectedId = selectedBenchmarkAuthorization(environment).benchmarkId;
      const p = permit(rawPermit, runtime, now(), selectedId);
      if (typeof token !== "string" || token.length > 24_000) return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const header = decode(parts[0]!); const claims = decode(parts[1]!);
      if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string"
        || !/^[A-Za-z0-9_-]{1,200}$/u.test(header.kid)
        || Object.keys(header).some(k => !["alg", "typ", "kid", "x5t"].includes(k))
        || !claimsMatch(claims, p, now()) || !/^[A-Za-z0-9_-]{1,1400}$/u.test(parts[2]!)) return null;
      const matching = (await keys()).filter(key => key.kid === header.kid);
      if (matching.length !== 1) return null;
      const k = matching[0]!;
      if (k.kty !== "RSA" || k.alg !== "RS256" || k.use !== "sig" || typeof k.n !== "string" || typeof k.e !== "string") return null;
      const key = createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e } as JsonWebKey, format: "jwk" });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
        || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2]!, "base64url"))) return null;
      // Revocation, runtime identity changes and expiry during key I/O all deny.
      if (environment[RELAY_PERMIT_KEY] !== rawPermit || environment.RAILWAY_GIT_COMMIT_SHA !== runtime
        || selectedBenchmarkAuthorization(environment).benchmarkId !== selectedId
        || !claimsMatch(claims, permit(rawPermit, runtime, now(), selectedId), now())) return null;
      return { authentication: "github_oidc_scoped", benchmarkId: p.benchmarkId, runId: claims.run_id as string,
        workflowRevision: p.workflowRevision, runtimeRevision: p.runtimeRevision };
    } catch { return null; } // Never return token, credentials or untrusted error prose.
  };
}
export const authenticateCodingBenchmarkRelay = createCodingBenchmarkRelayAuthenticator();
