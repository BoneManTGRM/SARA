import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubExactTargetVerifier } from "../src/github-exact-target-verifier.ts";

const REPOSITORY = "https://github.com/sindresorhus/p-map";
const COMMIT = "22dda61ea29037ba85af25e84bc5efba77e62f44";

describe("GitHub exact target verifier", () => {
  it("locks one canonical public repository and exact 40-character commit", async () => {
    const urls: string[] = [];
    const verifier = new GitHubExactTargetVerifier({
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        return url.endsWith(`/commits/${COMMIT}`)
          ? Response.json({ sha: COMMIT })
          : Response.json({ private: false, archived: false, disabled: false, full_name: "sindresorhus/p-map" });
      },
    });
    assert.deepEqual(await verifier.verify({ repositoryUrl: REPOSITORY, commitSha: COMMIT }), {
      repository: "sindresorhus/p-map",
      repositoryUrl: REPOSITORY,
      commitSha: COMMIT,
    });
    assert.equal(urls.length, 2);
  });

  it("rejects arbitrary URLs, branch paths, and moving or abbreviated revisions before fetch", async () => {
    let calls = 0;
    const verifier = new GitHubExactTargetVerifier({ fetchImpl: async () => { calls += 1; return Response.json({}); } });
    await assert.rejects(() => verifier.verify({ repositoryUrl: "https://example.com/x/y", commitSha: COMMIT }), /canonical public GitHub/);
    await assert.rejects(() => verifier.verify({ repositoryUrl: `${REPOSITORY}/tree/main`, commitSha: COMMIT }), /Branch-only|canonical/);
    await assert.rejects(() => verifier.verify({ repositoryUrl: REPOSITORY, commitSha: "main" }), /40-character/);
    await assert.rejects(() => verifier.verify({ repositoryUrl: REPOSITORY, commitSha: COMMIT.toUpperCase() }), /40-character/);
    assert.equal(calls, 0);
  });

  it("rejects private, archived, transferred, redirected, and mismatched commit records", async () => {
    for (const repositoryRecord of [
      { private: true, archived: false, disabled: false, full_name: "sindresorhus/p-map" },
      { private: false, archived: true, disabled: false, full_name: "sindresorhus/p-map" },
      { private: false, archived: false, disabled: true, full_name: "sindresorhus/p-map" },
      { private: false, archived: false, disabled: false, full_name: "other/p-map" },
    ]) {
      const verifier = new GitHubExactTargetVerifier({ fetchImpl: async () => Response.json(repositoryRecord) });
      await assert.rejects(() => verifier.verify({ repositoryUrl: REPOSITORY, commitSha: COMMIT }), /public|identity/);
    }
    const mismatch = new GitHubExactTargetVerifier({
      fetchImpl: async (input) => String(input).includes("/commits/")
        ? Response.json({ sha: "0".repeat(40) })
        : Response.json({ private: false, archived: false, disabled: false, full_name: "sindresorhus/p-map" }),
    });
    await assert.rejects(() => mismatch.verify({ repositoryUrl: REPOSITORY, commitSha: COMMIT }), /exact requested commit/);
    const redirected = new GitHubExactTargetVerifier({ fetchImpl: async () => new Response(null, { status: 301, headers: { location: "https://api.github.com/other" } }) });
    await assert.rejects(() => redirected.verify({ repositoryUrl: REPOSITORY, commitSha: COMMIT }), /exact public target/);
  });
});
