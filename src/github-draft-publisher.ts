import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "./canonical.ts";
import { digestArtifactTree } from "./genome-lab.ts";
import type {
  CandidatePublication,
  DraftPullRequestEvidence,
  DraftPullRequestPublisher,
} from "./site-directive.ts";

const execFileAsync = promisify(execFile);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const DRAFT_PR = /^https:\/\/github\.com\/BoneManTGRM\/SARA\/pull\/[1-9][0-9]*$/u;
const PUBLISHED_FILES = ["manifest.json", "skill.ts", "verification.json", "verification.ts"] as const;

export type CommandInvocation = {
  file: string;
  args: string[];
  cwd: string;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (invocation: CommandInvocation) => Promise<CommandResult>;

type PublisherOptions = {
  repository: string;
  run?: CommandRunner;
};

type ExecutionReceipt = {
  schemaVersion: 1;
  directiveId: string;
  mutationId: string;
  jobId: string;
  candidateDigest: string;
  sourceTreeDigest: string;
  stage: "SHADOW";
  productionAuthority: false;
  verification: DraftPullRequestEvidence["verification"];
};

async function defaultRunner(invocation: CommandInvocation): Promise<CommandResult> {
  try {
    const result = await execFileAsync(invocation.file, invocation.args, {
      cwd: invocation.cwd,
      env: process.env,
      encoding: "utf8",
      timeout: 15 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
}

function requireSuccess(result: CommandResult, label: string): CommandResult {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}; output length ${result.stdout.length + result.stderr.length}.`);
  }
  return result;
}

async function digestPublishedSource(directory: string): Promise<string> {
  const entries: Array<{ path: string; contentDigest: string }> = [];
  for (const name of PUBLISHED_FILES) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Published candidates may contain regular files only.");
    entries.push({ path: name, contentDigest: sha256(await readFile(path)) });
  }
  return sha256(canonicalJson(entries));
}

function parseReceipt(value: unknown, expected: CandidatePublication): ExecutionReceipt {
  const receipt = value as Partial<ExecutionReceipt>;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.directiveId !== expected.directiveId ||
    receipt.mutationId !== expected.mutationId ||
    receipt.jobId !== expected.jobId ||
    receipt.candidateDigest !== expected.candidateDigest ||
    !SHA256.test(receipt.sourceTreeDigest ?? "") ||
    receipt.stage !== "SHADOW" ||
    receipt.productionAuthority !== false ||
    !Array.isArray(receipt.verification) ||
    receipt.verification.some((item) =>
      typeof item?.command !== "string" || item.exitCode !== 0 || !SHA256.test(item.outputDigest),
    )
  ) {
    throw new Error("Existing candidate branch receipt does not match the claimed directive.");
  }
  return receipt as ExecutionReceipt;
}

function parsePullRequest(value: string, expectedCommit: string): { url: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("GitHub returned malformed draft PR evidence.");
  }
  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
  const pr = candidate as { url?: unknown; isDraft?: unknown; state?: unknown; headRefOid?: unknown } | undefined;
  if (
    !pr ||
    typeof pr.url !== "string" ||
    !DRAFT_PR.test(pr.url) ||
    pr.isDraft !== true ||
    pr.state !== "OPEN" ||
    pr.headRefOid !== expectedCommit
  ) {
    throw new Error("GitHub did not confirm an open draft PR for the exact candidate commit.");
  }
  return { url: pr.url };
}

export class GithubDraftPullRequestPublisher implements DraftPullRequestPublisher {
  readonly #repository: string;
  readonly #run: CommandRunner;

  constructor(options: PublisherOptions) {
    this.#repository = resolve(options.repository);
    this.#run = options.run ?? defaultRunner;
  }

  async #command(file: string, args: string[]): Promise<CommandResult> {
    return this.#run({ file, args, cwd: this.#repository });
  }

  async publish(candidate: CandidatePublication): Promise<DraftPullRequestEvidence> {
    if (!UUID_V4.test(candidate.directiveId) || !UUID_V4.test(candidate.mutationId) || !UUID_V4.test(candidate.jobId)) {
      throw new Error("Candidate publication identifiers must be UUID v4 values.");
    }
    if (!SHA256.test(candidate.candidateDigest) || candidate.stage !== "SHADOW") {
      throw new Error("Only SHA-256 identified SHADOW candidates may be published.");
    }
    if (await digestArtifactTree(candidate.artifactDirectory) !== candidate.candidateDigest) {
      throw new Error("Verified Genome Lab artifact digest changed before publication.");
    }

    const topLevel = (await readdir(candidate.artifactDirectory)).sort();
    const allowed = new Set([...PUBLISHED_FILES, "runtime"]);
    if (topLevel.some((name) => !allowed.has(name as (typeof PUBLISHED_FILES)[number] | "runtime"))) {
      throw new Error("Genome Lab artifact contains an unauthorized publication entry.");
    }

    const clean = requireSuccess(await this.#command("git", ["status", "--porcelain"]), "Git worktree inspection");
    if (clean.stdout.trim()) throw new Error("GitHub publication requires a clean isolated checkout.");

    const branch = `sara/directive-${candidate.directiveId}`;
    const remote = await this.#command("git", ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`]);
    if (remote.exitCode === 0) return this.#reuseExisting(candidate, branch);
    if (remote.exitCode !== 2) requireSuccess(remote, "Candidate branch lookup");

    requireSuccess(await this.#command("git", ["checkout", "-b", branch]), "Candidate branch creation");
    const target = join(this.#repository, "generated", "candidates", candidate.directiveId);
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of PUBLISHED_FILES) {
      const source = join(candidate.artifactDirectory, name);
      const sourceStat = await lstat(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(`Authorized candidate file ${name} is not a regular file.`);
      }
      await writeFile(join(target, name), await readFile(source), { mode: 0o600 });
    }

    const sourceTreeDigest = await digestPublishedSource(target);
    const kernelVerification = JSON.parse(await readFile(join(target, "verification.json"), "utf8")) as unknown;
    const verification: DraftPullRequestEvidence["verification"] = [{
      command: "kernel:isolated-typescript-behavioral-verification",
      exitCode: 0,
      outputDigest: sha256(canonicalJson(kernelVerification)),
    }];
    const repositoryVerification = requireSuccess(await this.#command("npm", ["run", "verify"]), "Repository verification");
    verification.push({
      command: "npm run verify",
      exitCode: 0,
      outputDigest: sha256(canonicalJson({ stdout: repositoryVerification.stdout, stderr: repositoryVerification.stderr })),
    });
    const receipt: ExecutionReceipt = {
      schemaVersion: 1,
      directiveId: candidate.directiveId,
      mutationId: candidate.mutationId,
      jobId: candidate.jobId,
      candidateDigest: candidate.candidateDigest,
      sourceTreeDigest,
      stage: "SHADOW",
      productionAuthority: false,
      verification,
    };
    await writeFile(join(target, "execution-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

    const relativeTarget = `generated/candidates/${candidate.directiveId}`;
    requireSuccess(await this.#command("git", ["add", "--", relativeTarget]), "Candidate staging");
    requireSuccess(await this.#command("git", ["config", "user.name", "SARA Candidate Builder"]), "Git author configuration");
    requireSuccess(await this.#command("git", ["config", "user.email", "sara-candidate-builder@users.noreply.github.com"]), "Git author configuration");
    requireSuccess(
      await this.#command("git", ["commit", "-m", `SARA SHADOW candidate ${candidate.directiveId}`]),
      "Candidate commit",
    );
    const commitSha = requireSuccess(await this.#command("git", ["rev-parse", "HEAD"]), "Candidate commit digest").stdout.trim();
    if (!GIT_COMMIT.test(commitSha)) throw new Error("Git returned an invalid candidate commit digest.");
    requireSuccess(await this.#command("git", ["push", "origin", `HEAD:refs/heads/${branch}`]), "Candidate branch push");

    const body = [
      "## SARA SHADOW candidate",
      "",
      `Directive: \`${candidate.directiveId}\``,
      `Candidate digest: \`${candidate.candidateDigest}\``,
      "",
      "This is a draft-only, zero-cost candidate. It has no merge, deployment, spending, or production authority.",
    ].join("\n");
    const create = requireSuccess(
      await this.#command("gh", [
        "pr", "create", "--draft", "--base", "main", "--head", branch,
        "--title", `SARA SHADOW candidate ${candidate.directiveId.slice(0, 8)}`,
        "--body", body,
      ]),
      "Draft PR creation",
    );
    const draftPrUrl = create.stdout.trim();
    if (!DRAFT_PR.test(draftPrUrl)) throw new Error("GitHub did not return a trusted SARA draft PR URL.");
    const view = requireSuccess(
      await this.#command("gh", ["pr", "view", draftPrUrl, "--json", "url,isDraft,state,headRefOid"]),
      "Draft PR verification",
    );
    parsePullRequest(view.stdout, commitSha);
    return { draftPrUrl, commitSha, sourceTreeDigest, verification };
  }

  async #reuseExisting(candidate: CandidatePublication, branch: string): Promise<DraftPullRequestEvidence> {
    requireSuccess(await this.#command("git", ["fetch", "origin", `refs/heads/${branch}`]), "Existing candidate fetch");
    const commitSha = requireSuccess(await this.#command("git", ["rev-parse", "FETCH_HEAD"]), "Existing candidate digest").stdout.trim();
    if (!GIT_COMMIT.test(commitSha)) throw new Error("Existing candidate commit digest is invalid.");
    const receiptPath = `generated/candidates/${candidate.directiveId}/execution-receipt.json`;
    const receiptText = requireSuccess(
      await this.#command("git", ["show", `FETCH_HEAD:${receiptPath}`]),
      "Existing candidate receipt",
    ).stdout;
    let receiptValue: unknown;
    try {
      receiptValue = JSON.parse(receiptText);
    } catch {
      throw new Error("Existing candidate receipt is malformed.");
    }
    const receipt = parseReceipt(receiptValue, candidate);
    const list = requireSuccess(
      await this.#command("gh", [
        "pr", "list", "--repo", "BoneManTGRM/SARA", "--head", branch, "--state", "open", "--limit", "1",
        "--json", "url,isDraft,state,headRefOid",
      ]),
      "Existing draft PR lookup",
    );
    const existing = JSON.parse(list.stdout) as unknown[];
    if (existing.length === 0) {
      throw new Error("Matching candidate branch exists without an open draft PR; refusing to alter it.");
    }
    const pr = parsePullRequest(list.stdout, commitSha);
    return {
      draftPrUrl: pr.url,
      commitSha,
      sourceTreeDigest: receipt.sourceTreeDigest,
      verification: receipt.verification,
    };
  }
}
