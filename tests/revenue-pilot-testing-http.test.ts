import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { PublicRepositoryEvidenceCollector } from "../src/public-repository-evidence.ts";
import { createSaraServerWithTesting } from "../src/server-with-testing.ts";

function testingInput() {
  return {
    opportunityId: "owner-http-test-1",
    sourceUrl: "https://github.com/example/project/issues/1",
    sourceAllowsAutomatedDiscovery: true,
    discoveredFromPublicSource: true,
    repoUrl: "https://github.com/example/project",
    repositoryIsPublic: true,
    repositoryOwnerPermissionConfirmed: true,
    requiresPrivateAccess: false,
    containsRegulatedOrPrivateData: false,
    requestsProductionChanges: false,
    requestsExploitValidation: false,
    primaryGoal: "release_readiness" as const,
    desiredTurnaroundDays: 3,
    recentCommitDays: 7,
  };
}

describe("owner-only no-price testing HTTP boundary", () => {
  const token = "testing-owner-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let directory: string;
  let baseUrl: string;
  let server: ReturnType<typeof createSaraServerWithTesting>;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-testing-http-"));
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: tokenHash });
    const modelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens() { return 10; },
      async execute() {
        return { outputText: "Bounded testing output.", inputTokens: 10, billableOutputTokens: 10 };
      },
    } satisfies WorkerModelClient;
    const repositoryEvidenceCollector = {
      async collect(): Promise<never> {
        throw new Error("Repository collection is not used by the creation boundary test.");
      },
    } satisfies PublicRepositoryEvidenceCollector;
    server = createSaraServerWithTesting(kernel, {
      ownerTokenSha256: tokenHash,
      stateDirectory: directory,
      revenuePilotTesting: {
        modelClient,
        repositoryEvidenceCollector,
        monthlyBudgetUsd: 1,
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a testing-ready job only for the owner and exposes no customer price", async () => {
    const url = `${baseUrl}/api/revenue-pilot/testing/jobs`;
    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(testingInput()),
    });
    assert.equal(unauthenticated.status, 401);

    const created = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(testingInput()),
    });
    assert.equal(created.status, 201);
    const job = await created.json() as Record<string, unknown> & {
      status: string;
      input: Record<string, unknown>;
      plan: Record<string, unknown>;
      revenueEvidenceId: unknown;
      externalDeliveryAuthorized: unknown;
    };
    assert.equal(job.status, "testing_ready");
    assert.equal(Object.hasOwn(job.input, "customerBudgetUsd"), false);
    assert.equal(Object.hasOwn(job.plan, "priceUsd"), false);
    assert.equal(job.plan.billingMode, "testing_no_charge");
    assert.equal(job.revenueEvidenceId, null);
    assert.equal(job.externalDeliveryAuthorized, false);
  });
});
