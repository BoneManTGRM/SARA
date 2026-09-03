import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import { OwnerAssistant } from "../src/owner-assistant.ts";
import { createSaraServer } from "../src/server.ts";
import { PILOT_REQUIRED_CAPABILITIES } from "../src/revenue-pilot.ts";

describe("SARA owner dashboard HTTP boundary", () => {
  const token = "test-owner-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const bridgeToken = "test-read-only-bridge-token";
  const bridgeTokenHash = createHash("sha256").update(bridgeToken).digest("hex");
  const telegramBridgeToken = "test-telegram-action-bridge-token";
  const telegramBridgeTokenHash = createHash("sha256").update(telegramBridgeToken).digest("hex");
  let directory: string;
  let baseUrl: string;
  let kernel: SaraKernel;
  let server: ReturnType<typeof createSaraServer>;
  let jobId: string;
  let mutationId: string;
  let revenuePilotJobId: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-http-"));
    kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: tokenHash });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Verify owner promotion boundary",
      expectedOwnerValue: 1,
      requiredCapabilities: [],
      acceptanceCriteria: ["Unauthenticated promotion is rejected."],
      maximumBudgetUsd: 0,
    });
    jobId = job.id;
    const execution = await kernel.executeDeterministicSkillScaffold(SARA_PRINCIPAL, job.id);
    mutationId = execution.mutation.id;
    await kernel.promoteMutation(SARA_PRINCIPAL, mutationId, "SHADOW");
    for (const capabilityId of PILOT_REQUIRED_CAPABILITIES) {
      await kernel.registerCapability(SARA_PRINCIPAL, {
        id: capabilityId,
        name: capabilityId,
        status: "available",
        evidence: [`http-test:${capabilityId}`],
        limitations: ["Public-repository readiness pilot only."],
      });
    }
    server = createSaraServer(kernel, {
      ownerTokenSha256: tokenHash,
      readOnlyBridgeTokenSha256: bridgeTokenHash,
      telegramBridgeTokenSha256: telegramBridgeTokenHash,
      ownerAssistant: new OwnerAssistant({
        stateDirectory: directory,
        monthlyBudgetUsd: 2,
        modelClient: {
          routeKey: "openai:gpt-5.6-luna:paid",
          maximumWallTimeMs: 1_000,
          async countInputTokens() { return 100; },
          async execute() {
            return { outputText: "Bounded HTTP Luna analysis.", inputTokens: 100, billableOutputTokens: 50 };
          },
        } satisfies WorkerModelClient,
      }),
      runtimeStatus: async () => ({
        worker: { configured: true, running: true, monthlyBudgetUsd: 10 },
        startupProof: { status: "succeeded", accountedCostUsd: 0.001 },
      }),
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

  it("serves public health and keeps owner state private", async () => {
    const home = await fetch(baseUrl);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /SARA/);
    assert.match(html, /SARA compound reserve/);
    assert.match(html, /Intelligence[\s\S]*with <em>roots\.<\/em>/);
    assert.match(html, /\$0 bootstrap target/);
    assert.match(html, /data-owner="locked"/);
    assert.match(html, /Owner state locked/);
    assert.match(html, /Owner directive channel/);
    assert.match(html, /id="directive-fields" disabled/);
    assert.match(html, /prefers-reduced-motion: reduce/);
    assert.match(html, /@media \(max-width: 720px\)/);
    assert.match(html, /No deployment, live banking, or general autonomous coder implied/);
    assert.doesNotMatch(html, /(?:src|href)="https?:\/\//i);
    assert.doesNotMatch(html, new RegExp(token));
    assert.doesNotMatch(html, new RegExp(mutationId));
    assert.match(home.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const publicHealth = await health.json() as { constitutionVerified: boolean; workerConfigured: boolean };
    assert.equal(publicHealth.constitutionVerified, true);
    assert.equal(publicHealth.workerConfigured, true);
    assert.equal((await fetch(`${baseUrl}/api/status`)).status, 401);
    const ownerStatus = await fetch(`${baseUrl}/api/status`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(ownerStatus.status, 200);
    assert.equal((await ownerStatus.json() as { runtime: { startupProof: { status: string } } }).runtime.startupProof.status, "succeeded");
  });

  it("exposes tools and service choices only to the authenticated owner", async () => {
    assert.equal((await fetch(`${baseUrl}/api/tools`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/revenue-pilot/services`)).status, 401);

    const toolsResponse = await fetch(`${baseUrl}/api/tools`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(toolsResponse.status, 200);
    const tools = await toolsResponse.json() as Array<{ id: string; status: string }>;
    assert.equal(tools.find((tool) => tool.id === "luna-worker")?.status, "available");

    const servicesResponse = await fetch(`${baseUrl}/api/revenue-pilot/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(servicesResponse.status, 200);
    const services = await servicesResponse.json() as Array<{ id: string; priceUsd: number }>;
    assert.deepEqual(services.map((service) => service.id), [
      "public-repository-readiness-snapshot",
      "documentation-clarity-review",
      "ci-workflow-readiness-review",
      "dependency-hygiene-brief",
    ]);
    assert.deepEqual(services.map((service) => service.priceUsd), [149, 79, 99, 79]);
  });

  it("gives the bridge a read-only catalog without owner authority", async () => {
    assert.equal((await fetch(`${baseUrl}/api/bridge/catalog`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bridge/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    })).status, 401);

    const catalogResponse = await fetch(`${baseUrl}/api/bridge/catalog`, {
      headers: { Authorization: `Bearer ${bridgeToken}` },
    });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as {
      schemaVersion: number;
      access: string;
      tools: Array<{ id: string; status: string }>;
      services: Array<{ id: string; priceUsd: number }>;
    };
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.access, "read_only");
    assert.equal(catalog.tools.find((tool) => tool.id === "luna-worker")?.status, "available");
    assert.deepEqual(catalog.services.map((service) => service.id), [
      "public-repository-readiness-snapshot",
      "documentation-clarity-review",
      "ci-workflow-readiness-review",
      "dependency-hygiene-brief",
    ]);

    assert.equal((await fetch(`${baseUrl}/api/status`, {
      headers: { Authorization: `Bearer ${bridgeToken}` },
    })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/objectives`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridgeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ objective: "must remain unauthorized" }),
    })).status, 401);
  });

  it("gives the Telegram action credential only bounded explicit actions", async () => {
    const headers = { Authorization: `Bearer ${telegramBridgeToken}`, "content-type": "application/json" };
    assert.equal((await fetch(`${baseUrl}/api/bridge/actions/status`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/bridge/catalog`, { headers })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/status`, { headers })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/revenue-pilot/opportunities`, {
      method: "POST",
      headers,
      body: JSON.stringify({ opportunityId: "must-not-pass" }),
    })).status, 401);

    const statusResponse = await fetch(`${baseUrl}/api/bridge/actions/status`, { headers });
    assert.equal(statusResponse.status, 200);
    const actionStatus = await statusResponse.json() as {
      access: string;
      ownerAssistant: { monthlyBudgetUsd: number };
      prohibitedActions: string[];
    };
    assert.equal(actionStatus.access, "telegram_explicit_actions");
    assert.equal(actionStatus.ownerAssistant.monthlyBudgetUsd, 2);
    assert.ok(actionStatus.prohibitedActions.includes("deployment"));

    const luna = await fetch(`${baseUrl}/api/bridge/actions/luna`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: "telegram:http:luna", text: "Plan a safe documentation review." }),
    });
    assert.equal(luna.status, 200);
    const lunaResult = await luna.json() as { outputText: string; accountedCostUsd: number };
    assert.equal(lunaResult.outputText, "Bounded HTTP Luna analysis.");
    assert.equal(lunaResult.accountedCostUsd, 0.00008);

    const task = await fetch(`${baseUrl}/api/bridge/actions/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: "telegram:http:task", objective: "Prepare a deterministic documentation gap skill." }),
    });
    assert.equal(task.status, 201);
    const taskResult = await task.json() as { outcome: string; job: { workCard: { maximumBudgetUsd: number }; status: string } };
    assert.equal(taskResult.outcome, "work_card_created");
    assert.equal(taskResult.job.workCard.maximumBudgetUsd, 0);
    assert.equal(taskResult.job.status, "authorized");

    const scaffold = await fetch(`${baseUrl}/api/bridge/actions/scaffolds`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: "telegram:http:scaffold", objective: "Create an isolated release checklist scaffold." }),
    });
    assert.equal(scaffold.status, 201);
    const scaffoldResult = await scaffold.json() as { outcome: string; stage: string; candidateDigest: string };
    assert.equal(scaffoldResult.outcome, "sandbox_scaffold_verified");
    assert.equal(scaffoldResult.stage, "SANDBOX");
    assert.match(scaffoldResult.candidateDigest, /^[a-f0-9]{64}$/u);
  });

  it("rejects unauthenticated promotion and accepts target-bound owner approval", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/mutations/${mutationId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "CANARY" }),
    });
    assert.equal(unauthenticated.status, 401);
    const approved = await fetch(`${baseUrl}/api/mutations/${mutationId}/promote`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ stage: "CANARY" }),
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json() as { stage: string }).stage, "CANARY");
  });

  it("exports a private zero-cost coding handoff for the next executor", async () => {
    assert.equal((await fetch(`${baseUrl}/api/jobs/${jobId}/handoff`)).status, 401);
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/handoff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const handoff = await response.json() as { role: string; maximumBudgetUsd: number };
    assert.equal(handoff.role, "sandboxed_coding_executor");
    assert.equal(handoff.maximumBudgetUsd, 0);
  });

  it("runs the deterministic coding child only behind owner authentication", async () => {
    assert.equal(
      (await fetch(`${baseUrl}/api/jobs/${jobId}/execute-scaffold`, { method: "POST" })).status,
      401,
    );
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/execute-scaffold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 201);
    const execution = await response.json() as {
      mutation: { stage: string };
      evidence: { attestation: string; exitCode: number };
      artifactRelativePath: string;
    };
    assert.equal(execution.mutation.stage, "SANDBOX");
    assert.equal(execution.evidence.attestation, "kernel_executed");
    assert.equal(execution.evidence.exitCode, 0);
    assert.match(execution.artifactRelativePath, /^genome-lab[/\\]/);
  });

  it("accepts a bounded zero-cost owner directive only after authentication", async () => {
    const payload = {
      objective: "Prepare a verified customer-value experiment",
      expectedOwnerValue: 25,
      requiredCapabilities: [],
      acceptanceCriteria: ["Produce evidence without external spend."],
      maximumBudgetUsd: 0,
    };
    assert.equal((await fetch(`${baseUrl}/api/objectives`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })).status, 401);
    const response = await fetch(`${baseUrl}/api/objectives`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    const created = await response.json() as {
      id: string;
      workCard: { objective: string; maximumBudgetUsd: number };
    };
    assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(created.workCard.objective, payload.objective);
    assert.equal(created.workCard.maximumBudgetUsd, 0);
  });

  it("accepts a bounded candidate and returns only a verified SHADOW mutation", async () => {
    const createResponse = await fetch(`${baseUrl}/api/objectives`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        objective: "Create a pure doubling skill",
        expectedOwnerValue: 5,
        requiredCapabilities: ["doubling"],
        acceptanceCriteria: ["Double numeric inputs deterministically."],
        maximumBudgetUsd: 0,
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { id: string };
    assert.equal(
      (await fetch(`${baseUrl}/api/jobs/${created.id}/self-build`, { method: "POST" })).status,
      401,
    );

    const response = await fetch(`${baseUrl}/api/jobs/${created.id}/self-build`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        proposal: {
          schemaVersion: 1,
          skillName: "Doubling Skill",
          summary: "Pure deterministic arithmetic.",
          source: [
            "export function runSkill(input: unknown): unknown {",
            '  return typeof input === "number" ? input * 2 : null;',
            "}",
          ].join("\n"),
          tests: [
            { name: "number", input: 3, expected: 6 },
            { name: "other", input: "3", expected: null },
          ],
          limitations: ["Numbers only."],
        },
      }),
    });
    assert.equal(response.status, 201);
    const execution = await response.json() as {
      job: { status: string };
      mutation: { stage: string };
      evidence: { attestation: string; exitCode: number };
    };
    assert.equal(execution.job.status, "verified");
    assert.equal(execution.mutation.stage, "SHADOW");
    assert.deepEqual(
      { attestation: execution.evidence.attestation, exitCode: execution.evidence.exitCode },
      { attestation: "kernel_executed", exitCode: 0 },
    );
  });

  it("accepts a complete multi-file program only through the authenticated Genome Lab boundary", async () => {
    const createResponse = await fetch(`${baseUrl}/api/objectives`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        objective: "Build a dependency-free order calculator",
        expectedOwnerValue: 10,
        requiredCapabilities: ["multi-file-program-building"],
        acceptanceCriteria: ["Type-check and pass independent tests."],
        maximumBudgetUsd: 0,
      }),
    });
    const created = await createResponse.json() as { id: string };
    const payload = {
      proposal: {
        schemaVersion: 1,
        candidateKind: "typescript_program",
        programName: "Order Calculator",
        summary: "A dependency-free multi-module order calculator.",
        files: [
          { path: "src/math.ts", content: "export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);\n" },
          { path: "src/index.ts", content: 'import { sum } from "./math.ts";\nexport const orderTotal = (values: readonly number[]): number => sum(values);\n' },
          { path: "tests/order.test.ts", content: 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { orderTotal } from "../src/index.ts";\ntest("totals an order", () => assert.equal(orderTotal([2, 3]), 5));\n' },
        ],
        limitations: ["No external dependencies or I/O."],
      },
    };
    assert.equal((await fetch(`${baseUrl}/api/jobs/${created.id}/self-build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })).status, 401);
    const response = await fetch(`${baseUrl}/api/jobs/${created.id}/self-build`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    const execution = await response.json() as {
      job: { status: string };
      mutation: { stage: string; summary: string };
      evidence: { command: string; exitCode: number };
    };
    assert.deepEqual(
      {
        status: execution.job.status,
        stage: execution.mutation.stage,
        command: execution.evidence.command,
        exitCode: execution.evidence.exitCode,
      },
      {
        status: "verified",
        stage: "SHADOW",
        command: "kernel:isolated-typescript-program-verification",
        exitCode: 0,
      },
    );
    assert.match(execution.mutation.summary, /Generated program candidate: Order Calculator/);
  });

  it("creates and payment-authorizes a revenue pilot only behind owner authentication", async () => {
    const opportunity = {
      opportunityId: "http-public-opportunity-1",
      sourceUrl: "https://github.com/example/project/issues/123",
      sourceAllowsAutomatedDiscovery: true,
      discoveredFromPublicSource: true,
      repoUrl: "https://github.com/example/project",
      repositoryIsPublic: true,
      repositoryOwnerPermissionConfirmed: true,
      requiresPrivateAccess: false,
      containsRegulatedOrPrivateData: false,
      requestsProductionChanges: false,
      requestsExploitValidation: false,
      primaryGoal: "release_readiness",
      customerBudgetUsd: 149,
      desiredTurnaroundDays: 3,
      recentCommitDays: 4,
    };
    assert.equal((await fetch(`${baseUrl}/api/revenue-pilot/opportunities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opportunity),
    })).status, 401);
    const createdResponse = await fetch(`${baseUrl}/api/revenue-pilot/opportunities`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(opportunity),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: string; status: string };
    revenuePilotJobId = created.id;
    assert.equal(created.status, "offer_ready");

    const paymentReferenceDigest = "e".repeat(64);
    const authorizedResponse = await fetch(`${baseUrl}/api/revenue-pilot/jobs/${revenuePilotJobId}/authorize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        collectedRevenueUsd: 149,
        occurredAt: "2026-09-02T00:00:00.000Z",
        paymentReferenceDigest,
      }),
    });
    assert.equal(authorizedResponse.status, 200);
    const authorized = await authorizedResponse.json() as { status: string; revenueEvidenceId: string };
    assert.equal(authorized.status, "queued");
    assert.match(authorized.revenueEvidenceId, /^[0-9a-f-]{36}$/i);

    const retryResponse = await fetch(`${baseUrl}/api/revenue-pilot/jobs/${revenuePilotJobId}/authorize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        collectedRevenueUsd: 149,
        occurredAt: "2026-09-02T00:00:00.000Z",
        paymentReferenceDigest,
      }),
    });
    assert.equal(retryResponse.status, 200);
    assert.equal((await retryResponse.json() as { revenueEvidenceId: string }).revenueEvidenceId, authorized.revenueEvidenceId);

    const status = await fetch(`${baseUrl}/api/status`, { headers: { Authorization: `Bearer ${token}` } });
    const ownerState = await status.json() as {
      revenuePilotJobs: Array<{ id: string; status: string }>;
      realizedProfit: { collectedRevenueUsd: number };
    };
    assert.equal(ownerState.revenuePilotJobs.find((job) => job.id === revenuePilotJobId)?.status, "queued");
    assert.equal(ownerState.realizedProfit.collectedRevenueUsd, 149);
  });

  it("freezes new external work while preserving health and owner reads", async () => {
    const stopped = await fetch(`${baseUrl}/api/emergency-stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    assert.equal(stopped.status, 200);
    const blocked = await fetch(`${baseUrl}/api/objectives`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        objective: "Must remain blocked",
        expectedOwnerValue: 1,
        requiredCapabilities: [],
        acceptanceCriteria: ["blocked"],
        maximumBudgetUsd: 0,
      }),
    });
    assert.equal(blocked.status, 423);
    await assert.rejects(
      () => kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "stopped-worker"),
      (error: unknown) =>
        error instanceof Error &&
        "decision" in error &&
        (error as { decision: { code: string } }).decision.code === "EMERGENCY_STOP",
    );
    const blockedOpportunity = await fetch(`${baseUrl}/api/revenue-pilot/opportunities`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ opportunityId: "blocked-opportunity" }),
    });
    assert.equal(blockedOpportunity.status, 423);
    const blockedLuna = await fetch(`${baseUrl}/api/bridge/actions/luna`, {
      method: "POST",
      headers: { Authorization: `Bearer ${telegramBridgeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: "telegram:stopped:luna", text: "analyze while stopped" }),
    });
    assert.equal(blockedLuna.status, 423);
    assert.match(await blockedLuna.text(), /No paid request was made/iu);
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/status`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  });
});
