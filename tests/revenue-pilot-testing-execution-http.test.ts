import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type {
  PublicRepositoryEvidenceCollector,
  PublicRepositoryEvidenceSnapshot,
} from "../src/public-repository-evidence.ts";
import { createSaraServerWithTesting } from "../src/server-with-testing.ts";

const IMMUTABLE_COMMIT = "a".repeat(40);
const REPOSITORY = "https://github.com/example/project";
const DELIVERY_OUTPUT = JSON.stringify({
  categoryEvidence: [
    { category: "code", note: "Reviewed the supplied immutable source sample only." },
    { category: "dependencies", note: "Reviewed the supplied immutable dependency manifest only." },
    { category: "secret_exposure", note: "Reviewed the supplied immutable samples only; absence is not proof of safety." },
    { category: "release_controls", note: "Reviewed the supplied immutable workflow sample only." },
  ],
  findings: [],
  evidenceLimitations: ["Synthetic test evidence is deliberately bounded."],
});

function testingInput() {
  return {
    opportunityId: "owner-execution-test-1",
    sourceUrl: "https://github.com/example/project/issues/1",
    sourceAllowsAutomatedDiscovery: true,
    discoveredFromPublicSource: true,
    repoUrl: REPOSITORY,
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

function evidenceSnapshot(): PublicRepositoryEvidenceSnapshot {
  return {
    schemaVersion: 1,
    provider: "github",
    repository: REPOSITORY,
    immutableCommitSha: IMMUTABLE_COMMIT,
    defaultBranch: "main",
    collectedAt: "2026-09-04T20:00:00.000Z",
    collectionMode: "anonymous_read_only",
    repositoryFacts: {
      archived: false,
      disabled: false,
      fork: false,
      stars: 1,
      openIssues: 0,
      licenseSpdx: "MIT",
    },
    inventory: [
      { path: "src/index.ts", type: "blob", size: 27 },
      { path: "package.json", type: "blob", size: 37 },
      { path: ".github/workflows/ci.yml", type: "blob", size: 68 },
    ],
    inventoryTruncated: false,
    sampledFiles: [
      {
        path: "src/index.ts",
        permalink: `${REPOSITORY}/blob/${IMMUTABLE_COMMIT}/src/index.ts`,
        sourceText: "export const ready = true;\n",
        sourceTruncated: false,
      },
      {
        path: "package.json",
        permalink: `${REPOSITORY}/blob/${IMMUTABLE_COMMIT}/package.json`,
        sourceText: "{\"scripts\":{\"test\":\"node --test\"}}\n",
        sourceTruncated: false,
      },
      {
        path: ".github/workflows/ci.yml",
        permalink: `${REPOSITORY}/blob/${IMMUTABLE_COMMIT}/.github/workflows/ci.yml`,
        sourceText: "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
        sourceTruncated: false,
      },
    ],
    limitations: ["Synthetic immutable public-repository evidence packet."],
  };
}

type TestingJobResponse = {
  id: string;
  status: string;
  completedRoles: string[];
  actualExecutionCostUsd: number;
  input: Record<string, unknown>;
  plan: Record<string, unknown>;
  revenueEvidenceId: unknown;
  externalDeliveryAuthorized: unknown;
};

describe("owner-authorized no-price testing execution", () => {
  const ownerToken = "testing-execution-owner-token";
  const ownerTokenSha256 = createHash("sha256").update(ownerToken).digest("hex");
  const outputs = [
    "Bounded work packet anchored to the supplied immutable evidence.",
    "Private owner-review readiness draft with explicit evidence limits.",
    "VERDICT: PASS\nThe draft is consistent with the supplied work packet and immutable samples.",
    DELIVERY_OUTPUT,
  ];
  let directory: string;
  let baseUrl: string;
  let server: ReturnType<typeof createSaraServerWithTesting>;
  let modelExecutions = 0;
  let evidenceCollections = 0;

  const modelClient = {
    routeKey: "openai:gpt-5.6-luna:paid",
    maximumWallTimeMs: 1_000,
    async countInputTokens() { return 10; },
    async execute() {
      const outputText = outputs[modelExecutions];
      if (!outputText) throw new Error("Unexpected extra testing model execution.");
      modelExecutions += 1;
      return { outputText, inputTokens: 10, billableOutputTokens: 10 };
    },
  } satisfies WorkerModelClient;

  const repositoryEvidenceCollector = {
    async collect(repository: string) {
      evidenceCollections += 1;
      assert.equal(repository, REPOSITORY);
      return evidenceSnapshot();
    },
  } satisfies PublicRepositoryEvidenceCollector;

  function ownerHeaders(includeJson = false): Record<string, string> {
    return {
      Authorization: `Bearer ${ownerToken}`,
      ...(includeJson ? { "content-type": "application/json" } : {}),
    };
  }

  async function startServer(): Promise<void> {
    const kernel = await SaraKernel.boot({
      stateDirectory: directory,
      ownerTokenSha256,
      bootstrapRevenueCapabilities: true,
    });
    server = createSaraServerWithTesting(kernel, {
      ownerTokenSha256,
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
  }

  async function stopServer(): Promise<void> {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-testing-execution-http-"));
    await startServer();
  });

  after(async () => {
    await stopServer();
    await rm(directory, { recursive: true, force: true });
  });

  it("blocks pre-authorization work, then completes and recovers one private verified report", async () => {
    const createdResponse = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify(testingInput()),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as TestingJobResponse;

    const prematureRun = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/run`, {
      method: "POST",
      headers: ownerHeaders(),
    });
    assert.equal(prematureRun.status, 409);
    assert.equal(modelExecutions, 0);
    assert.equal(evidenceCollections, 0);

    const rejectedAuthorization = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/authorize`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ confirmTesting: false, testingAuthorizationId: "testing-run-1" }),
    });
    assert.equal(rejectedAuthorization.status, 400);
    assert.equal(modelExecutions, 0);
    assert.equal(evidenceCollections, 0);

    const authorizedResponse = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/authorize`, {
      method: "POST",
      headers: ownerHeaders(true),
      body: JSON.stringify({ confirmTesting: true, testingAuthorizationId: "testing-run-1" }),
    });
    assert.equal(authorizedResponse.status, 200);
    const authorized = await authorizedResponse.json() as TestingJobResponse;
    assert.equal(authorized.status, "queued");
    assert.equal(authorized.revenueEvidenceId, null);
    assert.equal(authorized.externalDeliveryAuthorized, false);

    const runResponse = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/run`, {
      method: "POST",
      headers: ownerHeaders(),
    });
    assert.equal(runResponse.status, 200);
    const completed = await runResponse.json() as TestingJobResponse;
    assert.equal(completed.status, "testing_complete");
    assert.deepEqual(completed.completedRoles, [
      "work_director",
      "specialist_worker",
      "independent_verifier",
      "delivery_operator",
    ]);
    assert.equal(completed.actualExecutionCostUsd, 0.04);
    assert.equal(Object.hasOwn(completed.input, "customerBudgetUsd"), false);
    assert.equal(Object.hasOwn(completed.plan, "priceUsd"), false);
    assert.equal(completed.revenueEvidenceId, null);
    assert.equal(completed.externalDeliveryAuthorized, false);
    assert.equal(modelExecutions, 4);
    assert.equal(evidenceCollections, 1);

    const reportResponse = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/report`, {
      headers: ownerHeaders(),
    });
    assert.equal(reportResponse.status, 200);
    const reportArtifact = await reportResponse.json() as {
      reportDigest: string;
      report: { status: string; externalDeliveryAuthorized: boolean };
    };
    assert.match(reportArtifact.reportDigest, /^[a-f0-9]{64}$/u);
    assert.equal(reportArtifact.report.status, "ready_for_owner_review");
    assert.equal(reportArtifact.report.externalDeliveryAuthorized, false);

    const repeatedRun = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/run`, {
      method: "POST",
      headers: ownerHeaders(),
    });
    assert.equal(repeatedRun.status, 200);
    assert.equal(modelExecutions, 4);
    assert.equal(evidenceCollections, 1);

    await stopServer();
    await startServer();

    const recoveredReport = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/report`, {
      headers: ownerHeaders(),
    });
    assert.equal(recoveredReport.status, 200);
    const recoveredArtifact = await recoveredReport.json() as { reportDigest: string };
    assert.equal(recoveredArtifact.reportDigest, reportArtifact.reportDigest);

    const recoveredRun = await fetch(`${baseUrl}/api/revenue-pilot/testing/jobs/${encodeURIComponent(created.id)}/run`, {
      method: "POST",
      headers: ownerHeaders(),
    });
    assert.equal(recoveredRun.status, 200);
    assert.equal(modelExecutions, 4);
    assert.equal(evidenceCollections, 1);
  });
});
