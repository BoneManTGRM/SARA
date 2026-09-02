import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { normalizePublicGitHubRepository } from "./founding-pilot.ts";

const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_INVENTORY_ENTRIES = 80;
const MAX_SAMPLED_FILES = 6;
const MAX_FILE_SOURCE_BYTES = 1_500;
const MAX_TOTAL_SOURCE_BYTES = 6_000;
const MAX_PERSISTED_BYTES = 32 * 1024;

type GitHubRepository = {
  private: boolean;
  default_branch: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  stargazers_count: number;
  open_issues_count: number;
  license: { spdx_id?: string | null } | null;
};

type GitHubCommit = {
  sha: string;
  commit: { tree: { sha: string } };
};

type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
};

type GitHubTree = {
  truncated: boolean;
  tree: GitHubTreeEntry[];
};

type GitHubContent = {
  type: "file";
  encoding: "base64";
  content: string;
  size: number;
};

export type PublicRepositoryEvidenceSnapshot = {
  schemaVersion: 1;
  provider: "github";
  repository: string;
  immutableCommitSha: string;
  defaultBranch: string;
  collectedAt: string;
  collectionMode: "anonymous_read_only";
  repositoryFacts: {
    archived: boolean;
    disabled: boolean;
    fork: boolean;
    stars: number;
    openIssues: number;
    licenseSpdx: string | null;
  };
  inventory: Array<{ path: string; type: GitHubTreeEntry["type"]; size: number | null }>;
  inventoryTruncated: boolean;
  sampledFiles: Array<{
    path: string;
    permalink: string;
    sourceText: string;
    sourceTruncated: boolean;
  }>;
  limitations: string[];
};

export type StoredPublicRepositoryEvidence = {
  schemaVersion: 1;
  jobId: string;
  snapshotDigest: string;
  snapshot: PublicRepositoryEvidenceSnapshot;
};

export type PublicRepositoryEvidenceCollector = {
  collect(repository: string): Promise<PublicRepositoryEvidenceSnapshot>;
};

function assertSafeId(value: string): void {
  if (!SAFE_ID.test(value)) throw new Error("jobId is not a safe identifier.");
}

function evidencePath(stateDirectory: string, jobId: string): string {
  assertSafeId(jobId);
  return join(stateDirectory, "revenue-pilot-evidence", `${jobId}.repository.json`);
}

function finiteNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is malformed.`);
  return value as number;
}

function safeRepositoryParts(repository: string): { canonical: string; owner: string; repo: string } {
  const canonical = normalizePublicGitHubRepository(repository);
  if (!canonical || canonical !== repository) {
    throw new Error("Repository evidence requires one canonical public GitHub repository URL.");
  }
  const [owner, repo] = new URL(canonical).pathname.slice(1).split("/");
  return { canonical, owner, repo };
}

function safePath(path: string): boolean {
  return Boolean(path) && !path.includes("\0") && !path.split("/").includes("..");
}

function samplePriority(path: string): number {
  const lower = path.toLowerCase();
  if (lower === "security.md") return 1;
  if (lower === "package.json" || lower === "pyproject.toml" || lower === "cargo.toml" || lower === "go.mod") return 2;
  if (lower === "readme.md" || lower === "readme") return 3;
  if (lower === "dockerfile" || lower === "docker-compose.yml" || lower === "docker-compose.yaml") return 4;
  if (lower.startsWith(".github/workflows/") && (lower.endsWith(".yml") || lower.endsWith(".yaml"))) return 5;
  if (lower === "tsconfig.json" || lower === "requirements.txt") return 6;
  if (lower === "license" || lower === "license.md") return 7;
  return Number.POSITIVE_INFINITY;
}

function decodeBoundedSource(content: GitHubContent, remainingBytes: number): { text: string; truncated: boolean } {
  if (content.type !== "file" || content.encoding !== "base64" || typeof content.content !== "string") {
    throw new Error("GitHub returned malformed file evidence.");
  }
  finiteNonNegativeInteger(content.size, "GitHub file size");
  const decoded = Buffer.from(content.content.replace(/\s/gu, ""), "base64");
  const limit = Math.max(0, Math.min(MAX_FILE_SOURCE_BYTES, remainingBytes));
  const slice = decoded.subarray(0, limit);
  return {
    text: slice.toString("utf8").replace(/\u0000/gu, ""),
    truncated: decoded.length > slice.length,
  };
}

async function readBoundedJson<T>(response: Response, label: string, maximumBytes = MAX_RESPONSE_BYTES): Promise<T> {
  if (!response.ok) throw new Error(`${label} failed with status ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) throw new Error(`${label} exceeded its response limit.`);
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

export class GitHubPublicRepositoryEvidenceCollector implements PublicRepositoryEvidenceCollector {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date } = {}) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new RangeError("Repository evidence timeoutMs must be between 100 and 60000.");
    }
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = timeoutMs;
    this.#now = options.now ?? (() => new Date());
  }

  async #get<T>(url: string, label: string, maximumBytes?: number): Promise<T> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com") {
      throw new Error("Repository evidence may only read api.github.com.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(parsed, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "SARA-Revenue-Pilot/1.0",
          "x-github-api-version": "2022-11-28",
        },
        signal: controller.signal,
      });
      return await readBoundedJson<T>(response, label, maximumBytes);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new Error(`${label} timed out.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async collect(repository: string): Promise<PublicRepositoryEvidenceSnapshot> {
    const { canonical, owner, repo } = safeRepositoryParts(repository);
    const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const metadata = await this.#get<GitHubRepository>(base, "GitHub repository metadata", 256 * 1024);
    if (metadata.private) throw new Error("Repository evidence collection refuses private repositories.");
    if (typeof metadata.default_branch !== "string" || !metadata.default_branch) {
      throw new Error("GitHub repository metadata omitted the default branch.");
    }
    const commit = await this.#get<GitHubCommit>(
      `${base}/commits/${encodeURIComponent(metadata.default_branch)}`,
      "GitHub default-branch commit",
      256 * 1024,
    );
    if (!COMMIT_SHA.test(commit.sha) || !COMMIT_SHA.test(commit.commit?.tree?.sha)) {
      throw new Error("GitHub returned malformed immutable revision evidence.");
    }
    const tree = await this.#get<GitHubTree>(
      `${base}/git/trees/${commit.commit.tree.sha}?recursive=1`,
      "GitHub repository tree",
    );
    if (!Array.isArray(tree.tree) || typeof tree.truncated !== "boolean") {
      throw new Error("GitHub returned malformed repository inventory evidence.");
    }
    const safeEntries = tree.tree.filter((entry) =>
      entry && safePath(entry.path) && ["blob", "tree", "commit"].includes(entry.type)
    );
    const inventory = safeEntries.slice(0, MAX_INVENTORY_ENTRIES).map((entry) => ({
      path: entry.path,
      type: entry.type,
      size: entry.size === undefined ? null : finiteNonNegativeInteger(entry.size, "GitHub tree entry size"),
    }));
    const sampleCandidates = safeEntries
      .filter((entry) => entry.type === "blob" && Number.isFinite(samplePriority(entry.path)))
      .sort((left, right) => samplePriority(left.path) - samplePriority(right.path) || left.path.localeCompare(right.path))
      .slice(0, MAX_SAMPLED_FILES);
    const sampledFiles: PublicRepositoryEvidenceSnapshot["sampledFiles"] = [];
    let sampledBytes = 0;
    for (const entry of sampleCandidates) {
      if (sampledBytes >= MAX_TOTAL_SOURCE_BYTES) break;
      const encodedPath = entry.path.split("/").map(encodeURIComponent).join("/");
      const content = await this.#get<GitHubContent>(
        `${base}/contents/${encodedPath}?ref=${commit.sha}`,
        `GitHub public file ${entry.path}`,
        256 * 1024,
      );
      const source = decodeBoundedSource(content, MAX_TOTAL_SOURCE_BYTES - sampledBytes);
      sampledBytes += Buffer.byteLength(source.text, "utf8");
      sampledFiles.push({
        path: entry.path,
        permalink: `${canonical}/blob/${commit.sha}/${encodedPath}`,
        sourceText: source.text,
        sourceTruncated: source.truncated,
      });
    }
    const snapshot: PublicRepositoryEvidenceSnapshot = {
      schemaVersion: 1,
      provider: "github",
      repository: canonical,
      immutableCommitSha: commit.sha,
      defaultBranch: metadata.default_branch,
      collectedAt: this.#now().toISOString(),
      collectionMode: "anonymous_read_only",
      repositoryFacts: {
        archived: metadata.archived === true,
        disabled: metadata.disabled === true,
        fork: metadata.fork === true,
        stars: finiteNonNegativeInteger(metadata.stargazers_count, "GitHub star count"),
        openIssues: finiteNonNegativeInteger(metadata.open_issues_count, "GitHub open issue count"),
        licenseSpdx: typeof metadata.license?.spdx_id === "string" ? metadata.license.spdx_id : null,
      },
      inventory,
      inventoryTruncated: tree.truncated || safeEntries.length > inventory.length,
      sampledFiles,
      limitations: [
        "Anonymous read-only GitHub API evidence only; no private repository, credential, issue mutation, branch, merge, deployment, or customer-system access.",
        "Inventory and sampled source are deliberately bounded; absence from this packet is not evidence that a file or finding does not exist.",
      ],
    };
    if (Buffer.byteLength(canonicalJson(snapshot), "utf8") > MAX_PERSISTED_BYTES - 2_048) {
      throw new Error("Repository evidence snapshot exceeded its storage limit.");
    }
    return snapshot;
  }
}

export async function persistPublicRepositoryEvidence(input: {
  stateDirectory: string;
  jobId: string;
  snapshot: PublicRepositoryEvidenceSnapshot;
}): Promise<StoredPublicRepositoryEvidence> {
  const snapshotDigest = sha256(canonicalJson(input.snapshot));
  const stored: StoredPublicRepositoryEvidence = {
    schemaVersion: 1,
    jobId: input.jobId,
    snapshotDigest,
    snapshot: structuredClone(input.snapshot),
  };
  const raw = canonicalJson(stored);
  if (Buffer.byteLength(raw, "utf8") > MAX_PERSISTED_BYTES) {
    throw new Error("Repository evidence artifact exceeded its storage limit.");
  }
  const destination = evidencePath(input.stateDirectory, input.jobId);
  const directory = join(input.stateDirectory, "revenue-pilot-evidence");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(raw, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return structuredClone(stored);
}

export async function readPublicRepositoryEvidence(input: {
  stateDirectory: string;
  jobId: string;
}): Promise<StoredPublicRepositoryEvidence | null> {
  try {
    const raw = await readFile(evidencePath(input.stateDirectory, input.jobId), "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_PERSISTED_BYTES) throw new Error("Repository evidence artifact is oversized.");
    const stored = JSON.parse(raw) as Partial<StoredPublicRepositoryEvidence>;
    if (
      stored.schemaVersion !== 1 ||
      stored.jobId !== input.jobId ||
      typeof stored.snapshotDigest !== "string" ||
      !stored.snapshot ||
      stored.snapshot.schemaVersion !== 1 ||
      stored.snapshot.collectionMode !== "anonymous_read_only" ||
      stored.snapshotDigest !== sha256(canonicalJson(stored.snapshot))
    ) {
      throw new Error("Repository evidence artifact integrity check failed.");
    }
    return stored as StoredPublicRepositoryEvidence;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
