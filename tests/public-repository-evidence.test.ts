import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  GitHubPublicRepositoryEvidenceCollector,
  persistPublicRepositoryEvidence,
  readPublicRepositoryEvidence,
} from "../src/public-repository-evidence.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function githubFetch(requests: Array<{ url: string; init?: RequestInit }>): typeof fetch {
  const commitSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://api.github.com/repos/example/project") {
      return json({
        private: false,
        default_branch: "main",
        archived: false,
        disabled: false,
        fork: false,
        stargazers_count: 7,
        open_issues_count: 2,
        license: { spdx_id: "MIT" },
      });
    }
    if (url.endsWith("/commits/main")) return json({ sha: commitSha, commit: { tree: { sha: treeSha } } });
    if (url.includes(`/git/trees/${treeSha}`)) {
      return json({
        truncated: false,
        tree: [
          { path: "README.md", type: "blob", size: 30 },
          { path: "package.json", type: "blob", size: 40 },
          { path: ".github/workflows/ci.yml", type: "blob", size: 50 },
          { path: ".env", type: "blob", size: 60 },
          { path: "src", type: "tree" },
        ],
      });
    }
    const source = url.includes("package.json")
      ? "{\"scripts\":{\"test\":\"node --test\"}}"
      : url.includes("ci.yml")
        ? "name: CI\non: push\njobs: {}"
        : "# Example public repository";
    return json({
      type: "file",
      encoding: "base64",
      content: Buffer.from(source).toString("base64"),
      size: Buffer.byteLength(source),
    });
  }) as typeof fetch;
}

describe("bounded public GitHub evidence", () => {
  it("collects anonymous read-only evidence pinned to one immutable commit", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const collector = new GitHubPublicRepositoryEvidenceCollector({
      fetchImpl: githubFetch(requests),
      now: () => new Date("2026-09-02T00:00:00.000Z"),
    });

    const snapshot = await collector.collect("https://github.com/example/project");
    assert.equal(snapshot.immutableCommitSha, "a".repeat(40));
    assert.equal(snapshot.collectionMode, "anonymous_read_only");
    assert.equal(snapshot.collectedAt, "2026-09-02T00:00:00.000Z");
    assert.deepEqual(snapshot.sampledFiles.map((file) => file.path), [
      "package.json",
      "README.md",
      ".github/workflows/ci.yml",
    ]);
    assert.equal(snapshot.sampledFiles.some((file) => file.path === ".env"), false);
    assert.ok(snapshot.sampledFiles.every((file) => file.permalink.includes("a".repeat(40))));
    assert.ok(requests.every((request) => request.url.startsWith("https://api.github.com/")));
    assert.ok(requests.every((request) => request.init?.method === "GET"));
    assert.ok(requests.every((request) => !(request.init?.headers as Record<string, string>).authorization));
    assert.ok(requests.filter((request) => request.url.includes("/contents/")).every((request) => request.url.endsWith(`?ref=${"a".repeat(40)}`)));
  });

  it("rejects non-canonical and lookalike targets without making a request", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const collector = new GitHubPublicRepositoryEvidenceCollector({ fetchImpl: githubFetch(requests) });

    await assert.rejects(
      collector.collect("https://github.com.evil.example/example/project"),
      /canonical public GitHub repository/u,
    );
    await assert.rejects(
      collector.collect("https://github.com/example/project/issues/1"),
      /canonical public GitHub repository/u,
    );
    assert.equal(requests.length, 0);
  });

  it("refuses repositories reported private before requesting source", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
      requests.push(String(input));
      return json({ private: true, default_branch: "main" });
    }) as typeof fetch;
    const collector = new GitHubPublicRepositoryEvidenceCollector({ fetchImpl });

    await assert.rejects(collector.collect("https://github.com/example/project"), /refuses private repositories/u);
    assert.equal(requests.length, 1);
  });

  it("detects persisted evidence tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-repository-evidence-"));
    directories.push(directory);
    const collector = new GitHubPublicRepositoryEvidenceCollector({
      fetchImpl: githubFetch([]),
      now: () => new Date("2026-09-02T00:00:00.000Z"),
    });
    const snapshot = await collector.collect("https://github.com/example/project");
    const stored = await persistPublicRepositoryEvidence({ stateDirectory: directory, jobId: "job-1", snapshot });
    assert.equal((await readPublicRepositoryEvidence({ stateDirectory: directory, jobId: "job-1" }))?.snapshotDigest, stored.snapshotDigest);

    const path = join(directory, "revenue-pilot-evidence", "job-1.repository.json");
    const raw = await readFile(path, "utf8");
    await writeFile(path, raw.replace("Example public repository", "Altered public repository"), "utf8");
    await assert.rejects(
      readPublicRepositoryEvidence({ stateDirectory: directory, jobId: "job-1" }),
      /integrity check failed/u,
    );
  });
});
