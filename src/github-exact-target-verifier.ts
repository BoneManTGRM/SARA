import { timingSafeEqual } from "node:crypto";

export type ExactGitHubTarget = {
  repository: string;
  repositoryUrl: string;
  commitSha: string;
};

export type GitHubExactTargetVerifierOptions = {
  fetchImpl?: typeof fetch;
};

const OWNER_OR_REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;

function exactText(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function canonicalRepository(input: string): { repository: string; repositoryUrl: string } {
  if (typeof input !== "string" || input.length > 300) throw new Error("Provide one canonical public GitHub repository URL.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Provide one canonical public GitHub repository URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Provide one canonical public GitHub repository URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || !OWNER_OR_REPOSITORY.test(parts[0]!) || !OWNER_OR_REPOSITORY.test(parts[1]!) || parts[1]!.endsWith(".git")) {
    throw new Error("Repository requests must identify only one GitHub owner/repository target.");
  }
  const repository = `${parts[0]}/${parts[1]}`;
  const repositoryUrl = `https://github.com/${repository}`;
  if (input !== repositoryUrl && input !== `${repositoryUrl}/`) throw new Error("Use the canonical GitHub repository URL without a branch, tag, path, query, or fragment.");
  return { repository, repositoryUrl };
}

async function githubJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "SARA-Exact-Target-Verifier/1",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || response.redirected || response.status >= 300 && response.status < 400) {
    throw new Error("GitHub did not return the exact public target.");
  }
  const parsed = await response.json() as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("GitHub returned an invalid target record.");
  return parsed as Record<string, unknown>;
}

export class GitHubExactTargetVerifier {
  readonly #fetchImpl: typeof fetch;

  constructor(options: GitHubExactTargetVerifierOptions = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async verify(input: { repositoryUrl: string; commitSha: string } | string, commitShaInput?: string): Promise<ExactGitHubTarget> {
    const repositoryInput = typeof input === "string" ? input : input.repositoryUrl;
    const commitSha = typeof input === "string" ? commitShaInput : input.commitSha;
    const target = canonicalRepository(repositoryInput);
    if (typeof commitSha !== "string" || !COMMIT_SHA.test(commitSha)) {
      throw new Error("A locked lowercase 40-character commit SHA is required.");
    }
    const [owner, repositoryName] = target.repository.split("/");
    const base = `https://api.github.com/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repositoryName!)}`;
    const repository = await githubJson(this.#fetchImpl, base);
    if (repository.private !== false || repository.archived === true || repository.disabled === true || typeof repository.full_name !== "string") {
      throw new Error("The repository must be public, active, and directly addressable.");
    }
    if (!exactText(repository.full_name.toLowerCase(), target.repository.toLowerCase())) {
      throw new Error("The repository identity changed or was transferred.");
    }
    const commit = await githubJson(this.#fetchImpl, `${base}/commits/${commitSha}`);
    if (typeof commit.sha !== "string" || !exactText(commit.sha, commitSha)) {
      throw new Error("GitHub did not resolve the exact requested commit.");
    }
    return {
      repository: repository.full_name,
      repositoryUrl: `https://github.com/${repository.full_name}`,
      commitSha,
    };
  }
}
