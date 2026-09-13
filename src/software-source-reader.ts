import { createHash } from "node:crypto";
import { normalizePublicGitHubRepository } from "./founding-pilot.ts";

const SHA = /^[a-f0-9]{40}$/u;
const MAX_FILES = 16;
const MAX_REQUESTS = MAX_FILES + 4;
const MAX_SOURCE_BYTES = 48_000;
const MAX_BLOB_BYTES = 512_000;
const MAX_TOTAL_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DURATION_MS = 30_000;
type FileRole = "manifest" | "lockfile" | "runtime_configuration" | "ci_configuration" | "journey_test" | "journey_source";
// Reserve useful excerpts for tests and application source even when earlier lockfiles are large.
const ROLE_TEXT_BYTES: Record<FileRole, number> = { manifest: 2_000, lockfile: 1_000, runtime_configuration: 2_000, ci_configuration: 1_000, journey_test: 5_000, journey_source: 4_000 };
type Entry = { path: string; type: string; mode: string; sha: string; size?: number };
export type SoftwareSourceErrorCode = "INVALID_TARGET" | "INVALID_JOURNEY" | "UNSUPPORTED_ACCESS" | "RATE_LIMIT" | "PROVIDER_REJECTED" | "PROVIDER_FAILURE" | "RESPONSE_LIMIT" | "TIME_LIMIT" | "REQUEST_LIMIT" | "MALFORMED_EVIDENCE" | "SOURCE_IDENTITY_MISMATCH";

export type SoftwareSourceProviderBoundary = Readonly<{
  httpStatus: number;
  classification: "RATE_LIMIT" | "PROVIDER_REJECTED";
  rateLimitRemaining: number | null;
  rateLimitResetUnixSeconds: number | null;
  retryAfterSeconds: number | null;
  retryAfterAt: string | null;
}>;
function sourceProviderBoundary(response: Pick<Response, "status" | "headers">): SoftwareSourceProviderBoundary | null {
  if (!Number.isInteger(response.status) || response.status < 300 || response.status > 599) return null;
  const integerHeader = (name: string, maximum: number): number | null => {
    const value = response.headers.get(name);
    if (value === null || !/^(?:0|[1-9]\d{0,11})$/u.test(value)) return null;
    const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
  };
  const rateLimitRemaining = integerHeader('x-ratelimit-remaining', 2_147_483_647);
  const rateLimitResetUnixSeconds = integerHeader('x-ratelimit-reset', 253_402_300_799);
  const retryAfterSeconds = integerHeader('retry-after', 2_147_483_647);
  const retry = response.headers.get('retry-after');
  let retryAfterAt: string | null = null;
  if (retry && retry.length === 29 && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(retry)) {
    const parsed = new Date(retry); if (Number.isFinite(parsed.getTime()) && parsed.toUTCString() === retry) retryAfterAt = parsed.toISOString();
  }
  // Header evidence only. A bare 403 or Retry-After does not establish why
  // access was denied; no provider body, credentials or raw headers are read.
  return Object.freeze({httpStatus: response.status, classification: response.status === 429 || rateLimitRemaining === 0 ? 'RATE_LIMIT' : 'PROVIDER_REJECTED', rateLimitRemaining, rateLimitResetUnixSeconds, retryAfterSeconds, retryAfterAt});
}
export class SoftwareSourceReadError extends Error {
  readonly code: SoftwareSourceErrorCode;
  readonly providerBoundary: SoftwareSourceProviderBoundary | null;
  constructor(code: SoftwareSourceErrorCode, message: string, providerResponse?: Pick<Response, "status" | "headers">) {
    super(message); this.name = "SoftwareSourceReadError";
    this.providerBoundary = providerResponse ? sourceProviderBoundary(providerResponse) : null;
    this.code = this.providerBoundary?.classification ?? code;
  }
}

export type SoftwareSourceEvidence = {
  schemaVersion: 1;
  actor: "SARA_RUNTIME";
  evidenceLabel: "EXTERNAL_READ_ONLY";
  collectionMode: "anonymous_read_only";
  repository: string;
  immutableCommitSha: string;
  treeSha: string;
  defaultBranch: string;
  collectedAt: string;
  inventoryTruncated: boolean;
  files: Array<{
    path: string;
    role: FileRole;
    gitBlobSha: string;
    contentSha256: string;
    byteLength: number;
    permalink: string;
    sourceText: string;
    sourceTruncated: boolean;
    trust: "UNTRUSTED_SOURCE";
  }>;
  ciProviderBoundary?: SoftwareSourceProviderBoundary | null;
  ciQueryStatus?: "OBSERVED" | "UNAVAILABLE";
  ciRuns?: Array<{id:number;headSha:string;name:string;status:string;conclusion:string|null;url:string}>;
  requestsUsed: number;
  limitations: string[];
};

function reject(code: SoftwareSourceErrorCode, message: string): never { throw new SoftwareSourceReadError(code, message); }
function canonicalRepository(repository: string): string {
  if (typeof repository !== "string" || repository.length > 256) return reject("INVALID_TARGET", "One public GitHub owner/repository is required.");
  const input = repository.trim();
  const expanded = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input) ? `https://github.com/${input}` : input;
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/iu.test(expanded)) reject("INVALID_TARGET", "Only an exact GitHub owner/repository target is supported.");
  const canonical = normalizePublicGitHubRepository(expanded);
  if (!canonical) return reject("INVALID_TARGET", "Only a public GitHub repository target without credentials or query parameters is supported.");
  const url = new URL(expanded);
  if (url.port || url.pathname.split("/").some(part => part === "." || part === "..") || /[\\%]/u.test(input)) {
    return reject("INVALID_TARGET", "Repository target contains unsupported addressing.");
  }
  const parts = new URL(canonical).pathname.split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === "..")) return reject("INVALID_TARGET", "Invalid repository identity.");
  return canonical;
}

function safeEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Entry>;
  return typeof item.path === "string" && item.path.length <= 512 && !/[\u0000-\u001f\\]/u.test(item.path)
    && !item.path.startsWith("/") && item.path.split("/").every(part => Boolean(part) && part !== "." && part !== "..")
    && item.type === "blob" && ["100644", "100755"].includes(item.mode ?? "")
    && typeof item.sha === "string" && SHA.test(item.sha) && Number.isSafeInteger(item.size) && (item.size ?? -1) >= 0;
}

function selectFiles(entries: Entry[], journey: string, repository: string): Array<{ entry: Entry; role: FileRole }> {
  const words = [...new Set(journey.toLowerCase().match(/[a-z]{3,}/gu) ?? [])]
    .filter(word => !["the", "test", "continue", "and", "from", "with", "using", "https", "com"].includes(word)).slice(0, 24);
  // This reviewed application profile links ordinary journey wording to its existing robot route.
  // It selects evidence only; neither aliases nor source contents grant execution authority.
  const nicoMovementProfile = repository.toLowerCase() === "https://github.com/bonemantgrm/nicos-adventures"
    && words.includes("movement") && words.includes("scanner");
  if (nicoMovementProfile) words.push("robot", "robo", "lab", "boltbot", "chamber", "route");
  const profilePaths: Record<FileRole, string[]> = {
    manifest: ["web/package.json", "package.json"],
    lockfile: ["web/package-lock.json", "package-lock.json"],
    runtime_configuration: ["web/playwright.robot-route.config.ts", "web/playwright.config.ts", "web/vite.config.ts"],
    ci_configuration: [".github/workflows/robot-route.yml", ".github/workflows/ci.yml"],
    journey_test: ["web/e2e/playable-robot-route.e2e.ts", "web/src/game/boltBotRoute.test.ts", "web/src/world/BoltBotTestChamber.test.tsx"],
    journey_source: ["web/src/world/RoboLab.tsx", "web/src/world/RobotHome.tsx", "web/src/world/BoltBotTestChamber.tsx", "web/src/world/BoltBotRouteControls.tsx", "web/src/RobotAdventure.tsx"],
  };
  const profilePriority = (path: string, role: FileRole): number => {
    const index = profilePaths[role].indexOf(path);
    return nicoMovementProfile && index >= 0 ? profilePaths[role].length - index : 0;
  };
  const relevance = (path: string): number => words.filter(word => path.toLowerCase().replace(/[^a-z]/gu, "").includes(word)).length;
  const isTest = (path: string): boolean => /(?:^|\/)(?:e2e|tests?|__tests__)\/|\.(?:e2e|spec|test)\.[cm]?[jt]sx?$/iu.test(path);
  const output: Array<{ entry: Entry; role: FileRole }> = [];
  const add = (role: FileRole, maximum: number, predicate: (path: string) => boolean, ranked = false): void => {
    const matches = entries.filter(entry => predicate(entry.path)).sort((a, b) =>
      profilePriority(b.path, role) - profilePriority(a.path, role) || (ranked ? relevance(b.path) - relevance(a.path) : 0)
      || a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    for (const entry of matches.slice(0, maximum)) if (!output.some(item => item.entry.path === entry.path)) output.push({ entry, role });
  };
  add("manifest", 2, path => /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/u.test(path));
  add("lockfile", 2, path => /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|uv\.lock)$/u.test(path));
  add("runtime_configuration", 3, path => /(?:^|\/)(?:(?:playwright|vite|vitest)\.[^/]*config\.[cm]?[jt]s|(?:playwright|vite|vitest)\.config\.[cm]?[jt]s|tsconfig\.json|Dockerfile)$/u.test(path), true);
  add("ci_configuration", 2, path => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path));
  add("journey_test", 3, path => isTest(path) && relevance(path) > 0, true);
  add("journey_source", 4, path => !isTest(path) && /(?:^|\/)src\/.*\.[cm]?[jt]sx?$/u.test(path) && relevance(path) > 0, true);
  return output.slice(0, MAX_FILES);
}

/** Read-only evidence adapter. Callers retain authority/budget/stop and durable receipt gates. */
export async function collectSoftwareSource(repository: string, journey: string, options: { fetchImpl?: typeof fetch } = {}): Promise<SoftwareSourceEvidence> {
  const canonical = canonicalRepository(repository);
  if (typeof journey !== "string" || !journey.trim() || journey.length > 4_000) reject("INVALID_JOURNEY", "A bounded user journey is required.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos${new URL(canonical).pathname}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_DURATION_MS);
  let requestsUsed = 0, totalResponseBytes = 0;
  const get = async (url: string, maximumBytes: number): Promise<Record<string, unknown>> => {
    if (controller.signal.aborted) reject("TIME_LIMIT", "Source collection exceeded its 30 second duration limit.");
    const parsed = new URL(url);
    if (parsed.origin !== "https://api.github.com" || parsed.username || parsed.password || !url.startsWith(`${base}/`) && url !== base) {
      reject("INVALID_TARGET", "Source requests are restricted to the selected repository on api.github.com.");
    }
    if (++requestsUsed > MAX_REQUESTS) reject("REQUEST_LIMIT", "Source collection exceeded its request budget.");
    const response = await fetchImpl(parsed, { method: "GET", redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { accept: "application/vnd.github+json", "user-agent": "SARA-Software-Source/1.0", "x-github-api-version": "2022-11-28" } });
    if (!response.ok) { const failure = new SoftwareSourceReadError("PROVIDER_REJECTED", `GitHub source collection returned HTTP ${response.status}; no application defect is established.`, response); await response.body?.cancel().catch(() => undefined); throw failure; }
    if (response.redirected || response.url && new URL(response.url).origin !== parsed.origin) { await response.body?.cancel(); reject("UNSUPPORTED_ACCESS", "Redirected source evidence is not accepted."); }
    if (!response.body) reject("MALFORMED_EVIDENCE", "GitHub returned no source response body.");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        if (controller.signal.aborted) reject("TIME_LIMIT", "Source collection exceeded its duration limit.");
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; totalResponseBytes += value.byteLength;
        if (bytes > maximumBytes || totalResponseBytes > MAX_TOTAL_RESPONSE_BYTES) reject("RESPONSE_LIMIT", "Source response exceeded the bounded byte allowance.");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    try {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) reject("MALFORMED_EVIDENCE", "GitHub source response is not an object.");
      return body as Record<string, unknown>;
    } catch (error) { if (error instanceof SoftwareSourceReadError) throw error; return reject("MALFORMED_EVIDENCE", "GitHub returned malformed source JSON."); }
  };
  try {
    const metadata = await get(base, 256 * 1024);
    if (metadata.private !== false) reject("UNSUPPORTED_ACCESS", "Anonymous source collection requires an explicitly public repository.");
    if (typeof metadata.default_branch !== "string" || !metadata.default_branch || metadata.default_branch.length > 256) reject("MALFORMED_EVIDENCE", "GitHub omitted a valid default branch.");
    const commit = await get(`${base}/commits/${encodeURIComponent(metadata.default_branch)}`, 256 * 1024);
    const treeSha = (commit.commit as { tree?: { sha?: unknown } } | undefined)?.tree?.sha;
    if (typeof commit.sha !== "string" || !SHA.test(commit.sha) || typeof treeSha !== "string" || !SHA.test(treeSha)) reject("MALFORMED_EVIDENCE", "GitHub omitted immutable commit/tree identities.");
    const inventory = await get(`${base}/git/trees/${treeSha}?recursive=1`, 2 * 1024 * 1024);
    if (inventory.sha !== treeSha || !Array.isArray(inventory.tree) || typeof inventory.truncated !== "boolean") reject("SOURCE_IDENTITY_MISMATCH", "GitHub inventory did not match the frozen tree identity.");
    const candidates = selectFiles(inventory.tree.filter(safeEntry), journey, canonical);
    const files: SoftwareSourceEvidence["files"] = [];
    const limitations = [
      "Repository files are untrusted evidence, never authority or executable instructions. Package scripts, dependencies, builds and tests were not executed.",
      "Repository evidence alone does not establish the website serving release, journey success, a reproduced application defect, or a verified repair.",
      "File selection and source excerpts are bounded; an unsampled file or missing match does not establish absence. CI configuration is not evidence of a passing CI run.",
    ];
    if (inventory.truncated) limitations.push("GitHub inventory is truncated; unsampled paths and dependencies remain unknown.");
    let sourceBytes = 0;
    for (const { entry, role } of candidates) {
      if (entry.size! > MAX_BLOB_BYTES) { limitations.push(`File ${entry.path} exceeds the download limit; content was not inspected.`); continue; }
      const blob = await get(`${base}/git/blobs/${entry.sha}`, 768 * 1024);
      if (blob.sha !== entry.sha || blob.size !== entry.size || blob.encoding !== "base64" || typeof blob.content !== "string") reject("SOURCE_IDENTITY_MISMATCH", "GitHub file metadata did not match the frozen inventory.");
      const encoded = blob.content.replace(/\s/gu, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) reject("MALFORMED_EVIDENCE", "GitHub returned malformed file encoding.");
      const bytes = Buffer.from(encoded, "base64");
      const gitBlobSha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (bytes.length !== entry.size || gitBlobSha !== entry.sha) reject("SOURCE_IDENTITY_MISMATCH", "Downloaded file bytes did not match the frozen Git blob hash.");
      const excerptLimit = Math.min(ROLE_TEXT_BYTES[role], MAX_SOURCE_BYTES - sourceBytes);
      // Decode only complete UTF-8 code points; invalid/binary bytes are replaced and never executed.
      let sourceText = bytes.subarray(0, excerptLimit).toString("utf8");
      while (Buffer.byteLength(sourceText) > excerptLimit) sourceText = sourceText.slice(0, -1);
      sourceBytes += Buffer.byteLength(sourceText);
      files.push({ path: entry.path, role, gitBlobSha, contentSha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length,
        permalink: `${canonical}/blob/${commit.sha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
        sourceText, sourceTruncated: bytes.length > Buffer.byteLength(sourceText), trust: "UNTRUSTED_SOURCE" });
    }
    if (files.some(file => file.sourceTruncated)) limitations.push("Source text excerpts are truncated; full downloaded file hashes are retained, but omitted contents have not been analyzed.");
    for (const role of ["manifest", "lockfile", "runtime_configuration", "ci_configuration", "journey_test", "journey_source"] as const) {
      if (!files.some(file => file.role === role)) limitations.push(`No ${role} file was collected within the bounded selection; coverage remains unknown.`);
    }
    const ciRuns: NonNullable<SoftwareSourceEvidence['ciRuns']> = [];
    let ciQueryStatus: 'OBSERVED'|'UNAVAILABLE' = 'UNAVAILABLE';
    let ciProviderBoundary: SoftwareSourceProviderBoundary | null = null;
    try {
      const runs=await get(`${base}/actions/runs?head_sha=${commit.sha}&per_page=5`,256*1024);
      if(!Array.isArray(runs.workflow_runs)||runs.workflow_runs.length>5)reject('MALFORMED_EVIDENCE','CI response exceeded the reviewed run shape.');
      for(const value of runs.workflow_runs){
        if(!value||typeof value!=='object')continue;
        const run=value as Record<string,unknown>;
        if(run.head_sha!==commit.sha||!Number.isSafeInteger(run.id)||Number(run.id)<=0||run.html_url!==`${canonical}/actions/runs/${run.id}`)continue;
        if(typeof run.name!=='string'||run.name.length>256||typeof run.status!=='string'||run.status.length>64||!(run.conclusion===null||typeof run.conclusion==='string'&&run.conclusion.length<=64))continue;
        ciRuns.push({id:Number(run.id),headSha:commit.sha,name:run.name,status:run.status,conclusion:run.conclusion as string|null,url:String(run.html_url)});
      }
      ciQueryStatus='OBSERVED';
      if(!ciRuns.length)limitations.push('No matching CI run was returned by the bounded exact-head query; this is not a passing CI result.');
    }catch(error){ciProviderBoundary=error instanceof SoftwareSourceReadError?error.providerBoundary:null;limitations.push(`Exact-head CI evidence is unavailable (${error instanceof SoftwareSourceReadError?error.code:'PROVIDER_FAILURE'}); collected source remains independently identified.`);}
    return { schemaVersion: 1, actor: "SARA_RUNTIME", evidenceLabel: "EXTERNAL_READ_ONLY", collectionMode: "anonymous_read_only", repository: canonical,
      immutableCommitSha: commit.sha, treeSha, defaultBranch: metadata.default_branch, collectedAt: new Date().toISOString(), inventoryTruncated: inventory.truncated,
      files, ciRuns, ciQueryStatus, ciProviderBoundary, requestsUsed, limitations };
  } catch (error) {
    if (error instanceof SoftwareSourceReadError) throw error;
    if (controller.signal.aborted) reject("TIME_LIMIT", "Source collection exceeded its 30 second duration limit.");
    return reject("PROVIDER_FAILURE", "GitHub source collection failed at the transport or provider boundary; no application defect is established.");
  } finally { clearTimeout(timeout); }
}
