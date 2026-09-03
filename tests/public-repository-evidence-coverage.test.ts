import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubPublicRepositoryEvidenceCollector } from "../src/public-repository-evidence.ts";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("public repository evidence category coverage", () => {
  it("includes source code and the complete small CI and CodeQL workflows inside a bounded packet", async () => {
    const commitSha = "a".repeat(40);
    const treeSha = "b".repeat(40);
    const sources = new Map<string, string>([
      ["package.json", JSON.stringify({ name: "example", private: true, scripts: { test: "node --test" } }, null, 2)],
      ["README.md", `# Example\n${"readme context\n".repeat(700)}`],
      ["src/index.ts", `${"export const value = 1;\n".repeat(120)}`],
      [".github/workflows/ci.yml", "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n"],
      [
        ".github/workflows/codeql.yml",
        `${"# bounded codeql context\n".repeat(170)}permissions:\n  security-events: write\n`,
      ],
      [".github/workflows/zzz.yml", `${"# less relevant workflow\n".repeat(220)}`],
      ["LICENSE", "Proprietary\n"],
    ]);
    const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url === "https://api.github.com/repos/example/project") {
        return json({
          private: false,
          default_branch: "main",
          archived: false,
          disabled: false,
          fork: false,
          stargazers_count: 0,
          open_issues_count: 0,
          license: { spdx_id: "NOASSERTION" },
        });
      }
      if (url.endsWith("/commits/main")) return json({ sha: commitSha, commit: { tree: { sha: treeSha } } });
      if (url.includes(`/git/trees/${treeSha}`)) {
        return json({
          truncated: false,
          tree: [...sources].map(([path, source]) => ({
            path,
            type: "blob",
            size: Buffer.byteLength(source),
          })),
        });
      }
      const marker = "/contents/";
      const encodedPath = url.slice(url.indexOf(marker) + marker.length, url.indexOf("?ref="));
      const path = encodedPath.split("/").map(decodeURIComponent).join("/");
      const source = sources.get(path);
      if (source === undefined) return json({ message: "not found" });
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(source).toString("base64"),
        size: Buffer.byteLength(source),
      });
    }) as typeof fetch;

    const snapshot = await new GitHubPublicRepositoryEvidenceCollector({ fetchImpl }).collect(
      "https://github.com/example/project",
    );
    const sampled = new Map(snapshot.sampledFiles.map((file) => [file.path, file]));

    assert.ok(sampled.has("package.json"), "dependency manifest must be sampled");
    assert.ok(sampled.has("src/index.ts"), "at least one source file must be sampled");
    assert.ok(sampled.has(".github/workflows/ci.yml"), "CI workflow must be sampled");
    assert.ok(sampled.has(".github/workflows/codeql.yml"), "CodeQL workflow must be sampled");
    assert.equal(sampled.get(".github/workflows/ci.yml")?.sourceTruncated, false);
    assert.equal(sampled.get(".github/workflows/codeql.yml")?.sourceTruncated, false);
    assert.match(sampled.get(".github/workflows/codeql.yml")?.sourceText ?? "", /security-events: write/u);
    const sampledBytes = snapshot.sampledFiles.reduce(
      (total, file) => total + Buffer.byteLength(file.sourceText, "utf8"),
      0,
    );
    assert.ok(sampledBytes <= 16_000, `sampled packet exceeded 16,000 bytes: ${sampledBytes}`);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") < 32 * 1024);
  });
});
