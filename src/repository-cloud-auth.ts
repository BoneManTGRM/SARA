import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import { CLOUD_AUDIENCE, cloudFields, cloudRecord } from "./repository-cloud-protocol.ts";

export interface RepositoryCloudPermit {
  schemaVersion: 1; benchmarkId: string; registrationDigest: string;
  runtimeRevision: string; workflowRevision: string; workflowRef: string;
  notBefore: number; expiresAt: number;
}
export interface RepositoryCloudIdentity {
  authentication: "github_oidc_repository_worker";
  benchmarkId: string; registrationDigest: string; workflowRevision: string; runId: string;
}
const issuer = "https://token.actions.githubusercontent.com";
const integer = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
export function validateRepositoryCloudPermit(p: RepositoryCloudPermit): void {
  cloudFields(p, ["schemaVersion", "benchmarkId", "registrationDigest", "runtimeRevision", "workflowRevision", "workflowRef", "notBefore", "expiresAt"]);
  if (p.schemaVersion !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(p.benchmarkId)
    || !/^[a-f0-9]{64}$/.test(p.registrationDigest) || !/^[a-f0-9]{40}$/.test(p.runtimeRevision)
    || p.workflowRevision !== p.runtimeRevision || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/.test(p.workflowRef)
    || p.workflowRef.includes("..") || !integer(p.notBefore) || !integer(p.expiresAt)
    || p.expiresAt <= p.notBefore || p.expiresAt - p.notBefore > 72 * 3600) throw new Error("CLOUD_PERMIT");
}
function decode(part: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("CLOUD_JWT_ENCODING");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw new Error("CLOUD_JWT_ENCODING");
  return cloudRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
function match(c: Record<string, unknown>, p: RepositoryCloudPermit, now: number): boolean {
  const workflow = `BoneManTGRM/SARA/.github/workflows/repository-cloud-benchmark.yml@${p.workflowRef}`;
  const subjects = [`repo:BoneManTGRM/SARA:ref:${p.workflowRef}`, `repo:BoneManTGRM@235159333/SARA@1313793559:ref:${p.workflowRef}`];
  return now >= p.notBefore && now < p.expiresAt && c.iss === issuer && c.aud === CLOUD_AUDIENCE
    && typeof c.sub === "string" && subjects.includes(c.sub)
    && c.repository === "BoneManTGRM/SARA" && c.repository_id === "1313793559"
    && c.repository_owner === "BoneManTGRM" && c.repository_owner_id === "235159333" && c.actor_id === "235159333"
    && c.ref === p.workflowRef && c.ref_type === "branch" && c.workflow_ref === workflow
    && c.workflow_sha === p.workflowRevision && c.sha === p.workflowRevision
    && c.event_name === "workflow_dispatch" && c.run_attempt === "1" && c.runner_environment === "github-hosted"
    && typeof c.run_id === "string" && /^[1-9][0-9]{0,19}$/.test(c.run_id)
    && (c.head_ref === "" || c.head_ref === undefined) && (c.base_ref === "" || c.base_ref === undefined)
    && c.job_workflow_ref === undefined && c.job_workflow_sha === undefined
    && integer(c.iat) && integer(c.nbf) && integer(c.exp) && c.nbf <= c.iat && c.iat <= now + 30
    && c.nbf <= now && c.exp > now && c.exp > c.iat && c.exp - c.iat <= 600 && c.iat - c.nbf <= 600;
}
/** Worker identity grants no owner, model, launch, stop or general API authority. */
export function createRepositoryCloudAuthenticator(options: {
  currentPermit(): RepositoryCloudPermit | undefined; fetchImpl?: typeof fetch; now?: () => number;
}) {
  const now = options.now ?? Date.now, fetchImpl = options.fetchImpl ?? fetch;
  let cache: { until: number; keys: Promise<Record<string, unknown>[]> } | undefined;
  async function keys() {
    if (!cache || cache.until <= now()) {
      const entry = { until: now() + 300000, keys: Promise.resolve([] as Record<string, unknown>[]) };
      entry.keys = (async () => {
        try {
          const response = await fetchImpl(`${issuer}/.well-known/jwks`, { redirect: "error", signal: AbortSignal.timeout(5000) });
          if (!response.ok || !response.body) throw Error("CLOUD_JWKS");
          const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
          try {
            for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
              if (bytes > 65536) throw Error("CLOUD_JWKS_SIZE"); chunks.push(part.value); }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          const value = cloudRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          if (!Array.isArray(value.keys) || value.keys.length > 20) throw Error("CLOUD_JWKS");
          return value.keys.map(cloudRecord);
        } catch { entry.until = now() + 10000; return []; }
      })(); cache = entry;
    }
    return cache.keys;
  }
  return async (token: string): Promise<RepositoryCloudIdentity | null> => {
    try {
      const p = structuredClone(options.currentPermit()); if (!p) return null;
      validateRepositoryCloudPermit(p);
      if (typeof token !== "string" || token.length > 24000) return null;
      const parts = token.split("."); if (parts.length !== 3) return null;
      const h = decode(parts[0]!), c = decode(parts[1]!);
      if (h.alg !== "RS256" || h.typ !== "JWT" || typeof h.kid !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(h.kid)
        || Object.keys(h).some(k => !["alg", "typ", "kid", "x5t"].includes(k)) || !match(c, p, Math.floor(now() / 1000))
        || !/^[A-Za-z0-9_-]{1,1400}$/.test(parts[2]!)) return null;
      const found = (await keys()).filter(k => k.kid === h.kid); if (found.length !== 1) return null;
      const k = found[0]!;
      if (k.kty !== "RSA" || k.alg !== "RS256" || k.use !== "sig" || typeof k.n !== "string" || typeof k.e !== "string") return null;
      const key = createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e } as JsonWebKey, format: "jwk" });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
        || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2]!, "base64url"))
        || canonicalJson(p) !== canonicalJson(options.currentPermit()) || !match(c, p, Math.floor(now() / 1000))) return null;
      return { authentication: "github_oidc_repository_worker", benchmarkId: p.benchmarkId,
        registrationDigest: p.registrationDigest, workflowRevision: p.workflowRevision, runId: c.run_id as string };
    } catch { return null; }
  };
}
