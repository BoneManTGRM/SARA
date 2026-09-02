import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimSiteDirective,
  recordSiteDirectiveResult,
  requestGithubOidcToken,
} from "../src/site-executor-client.ts";

const actionEnvironment = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "BoneManTGRM/SARA",
  GITHUB_REF: "refs/heads/main",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example.test/oidc?job=7",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret-token",
};

describe("site executor HTTP client", () => {
  it("requests a scoped GitHub OIDC token without accepting another repository or ref", async () => {
    let requestedUrl = "";
    const token = await requestGithubOidcToken(actionEnvironment, async (input, init) => {
      requestedUrl = String(input);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer request-secret-token");
      return Response.json({ value: "v".repeat(64) });
    });
    assert.equal(token, "v".repeat(64));
    assert.equal(new URL(requestedUrl).searchParams.get("audience"), "https://saraseed.app/api/executor");

    let called = false;
    await assert.rejects(
      () => requestGithubOidcToken({ ...actionEnvironment, GITHUB_REF: "refs/heads/feature" }, async () => {
        called = true;
        return Response.json({ value: "v".repeat(64) });
      }),
      /main-branch GitHub Actions/,
    );
    assert.equal(called, false);
  });

  it("treats an empty claim queue as normal and never sends a non-zero budget", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const claim = await claimSiteDirective("o".repeat(64), "https://saraseed.app", async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      assert.equal(body.maximumBudgetUsd, 0);
      return new Response(null, { status: 204 });
    });
    assert.equal(claim, null);
    assert.deepEqual(bodies, [
      { maximumBudgetUsd: 0, executorKind: "free_ai_pure_skill_candidate_v1" },
      {
        maximumBudgetUsd: 0,
        executorKind: "deterministic_release_evidence_normalizer_v1",
        recoveryDirectiveId: "488818de-840a-42cd-a951-1a69b2067f9d",
      },
    ]);
  });

  it("claims a generalized proposal before consulting the deterministic recovery queue", async () => {
    let calls = 0;
    const claim = await claimSiteDirective("o".repeat(64), "https://saraseed.app", async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.executorKind, "free_ai_pure_skill_candidate_v1");
      return Response.json({
        directive: { id: "b040e302-8188-45be-bc74-2e735e2c626d" },
        claim: { id: "78e6fccc-d230-48cd-9049-8d41d83bc799", expiresAt: "2099-01-01T00:00:00.000Z" },
      });
    });
    assert.equal(calls, 1);
    assert.equal(claim?.directive.id, "b040e302-8188-45be-bc74-2e735e2c626d");
  });

  it("falls back safely when the live site has not enabled the generalized claim contract yet", async () => {
    const kinds: string[] = [];
    const claim = await claimSiteDirective("o".repeat(64), "https://saraseed.app", async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      kinds.push(body.executorKind);
      return body.executorKind === "free_ai_pure_skill_candidate_v1"
        ? Response.json({ error: "Executor kind is unsupported." }, { status: 400 })
        : new Response(null, { status: 204 });
    });
    assert.equal(claim, null);
    assert.deepEqual(kinds, [
      "free_ai_pure_skill_candidate_v1",
      "deterministic_release_evidence_normalizer_v1",
    ]);
  });

  it("records a claim-bound result only at the canonical executor origin", async () => {
    let requestedUrl = "";
    await recordSiteDirectiveResult(
      "o".repeat(64),
      "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
      "78e6fccc-d230-48cd-9049-8d41d83bc799",
      {
        schemaVersion: 1,
        status: "FAILED",
        maximumCostUsd: 0,
        generatorId: "deterministic-release-evidence-normalizer-v1",
        failureCode: "CANDIDATE_VERIFICATION_FAILED",
        failureDigest: "f".repeat(64),
        lessons: ["Candidate rejected before publication."],
      },
      "https://saraseed.app",
      async (input) => {
        requestedUrl = String(input);
        return Response.json({ directive: { status: "FAILED_VERIFICATION" } });
      },
    );
    assert.equal(
      requestedUrl,
      "https://saraseed.app/api/executor/directives/12f1399e-4d2b-4f64-91b4-20ac93006ec3/result",
    );
    await assert.rejects(
      () => claimSiteDirective("o".repeat(64), "https://attacker.example", async () => new Response(null, { status: 204 })),
      /canonical saraseed.app origin/,
    );
  });
});
