import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import { persistRevenuePilotArtifact } from "../src/revenue-pilot-artifacts.ts";
import {
  RevenuePilotOperator,
  type RevenuePilotOperatorTick,
} from "../src/revenue-pilot-operator.ts";
import { PILOT_REQUIRED_CAPABILITIES, type RevenuePilotInput } from "../src/revenue-pilot.ts";

const OWNER_TOKEN = "operator-test-owner-token";
const OWNER_DIGEST = createHash("sha256").update(OWNER_TOKEN).digest("hex");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sara-operator-"));
  directories.push(directory);
  return directory;
}

function opportunity(): RevenuePilotInput {
  return {
    opportunityId: "operator-public-opportunity",
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
    recentCommitDays: 2,
  };
}

async function authorizedKernel(directory: string): Promise<{ kernel: SaraKernel; jobId: string }> {
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_DIGEST });
  const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
  for (const capabilityId of PILOT_REQUIRED_CAPABILITIES) {
    await kernel.registerCapability(SARA_PRINCIPAL, {
      id: capabilityId,
      name: capabilityId,
      status: "available",
      evidence: [`operator-test:${capabilityId}`],
      limitations: ["Public repository pilot only."],
    });
  }
  const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, opportunity());
  const revenue = await kernel.recordLedgerEntry(owner, {
    kind: "revenue",
    source: "customer",
    amountUsd: 149,
    realized: true,
    recurringMonthly: false,
    description: `Collected revenue for ${job.id}`,
    occurredAt: "2026-09-02T00:00:00.000Z",
  });
  await kernel.authorizeRevenuePilotJob(owner, job.id, revenue.id, {
    approvalId: "operator-test-approval",
    action: "contract_commitment",
    targetId: `revenue-pilot:${job.id}:fulfillment`,
    approvedAt: "2026-09-02T00:01:00.000Z",
    ownerId: owner.id,
  });
  return { kernel, jobId: job.id };
}

function fakeLuna(outputs: string[], calls: string[]): WorkerModelClient {
  return {
    routeKey: "openai:gpt-5.6-luna:paid",
    maximumWallTimeMs: 1_000,
    async countInputTokens(prompt) {
      return Math.ceil(Buffer.byteLength(prompt, "utf8") / 4);
    },
    async execute(input) {
      calls.push(input.prompt);
      const outputText = outputs.shift();
      if (!outputText) throw new Error("No fake Luna output remains.");
      return { outputText, inputTokens: 100, billableOutputTokens: 50 };
    },
  };
}

async function runUntilSettled(operator: RevenuePilotOperator): Promise<RevenuePilotOperatorTick[]> {
  const ticks: RevenuePilotOperatorTick[] = [];
  for (let index = 0; index < 8; index += 1) {
    const tick = await operator.tick();
    ticks.push(tick);
    if (tick.outcome !== "completed_role") break;
  }
  return ticks;
}

describe("bounded persistent Luna revenue operator", () => {
  it("does not call a model unless a paid job has owner authorization", async () => {
    const directory = await stateDirectory();
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_DIGEST });
    const calls: string[] = [];
    const operator = new RevenuePilotOperator({
      kernel,
      modelClient: fakeLuna(["must not be used"], calls),
      stateDirectory: directory,
    });

    assert.deepEqual(await operator.tick(), { outcome: "idle", reason: "no_authorized_job" });
    assert.equal(calls.length, 0);
  });

  it("persists every role artifact before advancing and stops at owner review", async () => {
    const directory = await stateDirectory();
    const { kernel, jobId } = await authorizedKernel(directory);
    const calls: string[] = [];
    const operator = new RevenuePilotOperator({
      kernel,
      modelClient: fakeLuna([
        "DIRECTOR: bounded public-repository plan",
        "SPECIALIST: owner-review assessment draft",
        "VERDICT: PASS\nEvidence and limitations are explicit.",
        "DELIVERY: private owner-review package",
      ], calls),
      stateDirectory: directory,
      now: () => new Date("2026-09-02T00:02:00.000Z"),
    });

    const ticks = await runUntilSettled(operator);
    assert.deepEqual(ticks.map((tick) => tick.outcome), [
      "completed_role",
      "completed_role",
      "completed_role",
      "completed_role",
      "idle",
    ]);
    const job = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === jobId);
    assert.equal(job?.status, "owner_review");
    assert.equal(job?.externalDeliveryAuthorized, false);
    assert.deepEqual(job?.receipts.slice(-4).map((receipt) => receipt.workerId), [
      "luna-work-director",
      "luna-specialist-worker",
      "luna-independent-verifier",
      "luna-delivery-operator",
    ]);
    assert.equal(job?.receipts.find((receipt) => receipt.role === "independent_verifier")?.verificationPassed, true);
    assert.ok(calls[1].includes("DIRECTOR: bounded public-repository plan"));
    assert.ok(calls[2].includes("SPECIALIST: owner-review assessment draft"));
    assert.ok(calls[3].includes("VERDICT: PASS"));
    assert.equal(JSON.stringify(await kernel.inspectAudit()).includes("SPECIALIST: owner-review"), false);
  });

  it("recovers the next role from private artifacts after a kernel restart", async () => {
    const directory = await stateDirectory();
    const { kernel } = await authorizedKernel(directory);
    const firstCalls: string[] = [];
    const first = new RevenuePilotOperator({
      kernel,
      modelClient: fakeLuna(["DIRECTOR: restart-safe packet"], firstCalls),
      stateDirectory: directory,
      now: () => new Date("2026-09-02T00:02:00.000Z"),
    });
    assert.equal((await first.tick()).outcome, "completed_role");

    const restartedKernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_DIGEST });
    const restartedCalls: string[] = [];
    const restarted = new RevenuePilotOperator({
      kernel: restartedKernel,
      modelClient: fakeLuna(["SPECIALIST: resumed safely"], restartedCalls),
      stateDirectory: directory,
      now: () => new Date("2026-09-02T00:03:00.000Z"),
    });
    assert.equal((await restarted.tick()).outcome, "completed_role");
    assert.ok(restartedCalls[0].includes("DIRECTOR: restart-safe packet"));
  });

  it("replays a persisted response after a crash without another model call", async () => {
    const directory = await stateDirectory();
    const { kernel, jobId } = await authorizedKernel(directory);
    const claim = await kernel.claimRevenuePilotRole(SARA_PRINCIPAL, "luna-work-director", 300, {
      jobId,
      role: "work_director",
    });
    const outputText = "DIRECTOR: persisted before simulated process loss";
    const outputDigest = sha256(outputText);
    const accountedCostUsd = 0.00008;
    const modelExecution = {
      schemaVersion: 1 as const,
      taskKind: "requirements_analysis" as const,
      provider: "openai" as const,
      model: "gpt-5.6-luna" as const,
      billingMode: "paid" as const,
      reasoningLevel: "low" as const,
      inputTokens: 100,
      billableOutputTokens: 50,
      attemptCount: 1,
      accountedCostUsd,
      outputDigest,
      attempts: [{
        provider: "openai" as const,
        model: "gpt-5.6-luna" as const,
        billingMode: "paid" as const,
        outcome: "succeeded" as const,
        accountedCostUsd,
      }],
    };
    await persistRevenuePilotArtifact({
      stateDirectory: directory,
      jobId,
      role: claim.lease.role,
      outputDigest,
      outputText,
      modelExecution,
    });

    const restartedKernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: OWNER_DIGEST });
    const calls: string[] = [];
    const restarted = new RevenuePilotOperator({
      kernel: restartedKernel,
      modelClient: fakeLuna(["must not be used"], calls),
      stateDirectory: directory,
    });
    const tick = await restarted.tick();
    assert.equal(tick.outcome, "completed_role");
    assert.equal(calls.length, 0);
    const job = (await restartedKernel.getStatus()).revenuePilotJobs[0];
    assert.equal(job.nextRole, "specialist_worker");
    assert.equal(job.actualExecutionCostUsd, 0.01);
  });

  it("fails closed on a non-passing verifier result", async () => {
    const directory = await stateDirectory();
    const { kernel } = await authorizedKernel(directory);
    const operator = new RevenuePilotOperator({
      kernel,
      modelClient: fakeLuna([
        "DIRECTOR: plan",
        "SPECIALIST: draft",
        "VERDICT: FAIL\nMissing evidence.",
      ], []),
      stateDirectory: directory,
      now: () => new Date("2026-09-02T00:02:00.000Z"),
    });
    await operator.tick();
    await operator.tick();
    await operator.tick();
    const job = (await kernel.getStatus()).revenuePilotJobs[0];
    assert.equal(job.status, "failed");
    assert.equal(job.nextRole, null);
  });

  it("blocks a role before calling Luna when the monthly allowance is exhausted", async () => {
    const directory = await stateDirectory();
    const { kernel } = await authorizedKernel(directory);
    const calls: string[] = [];
    const operator = new RevenuePilotOperator({
      kernel,
      modelClient: fakeLuna(["must not be used"], calls),
      stateDirectory: directory,
      monthlyBudgetUsd: 0.04,
      now: () => new Date("2026-09-02T00:02:00.000Z"),
    });

    assert.deepEqual(await operator.tick(), { outcome: "idle", reason: "monthly_budget" });
    assert.equal(calls.length, 0);
  });

  it("does not round away sub-cent proof usage at the monthly boundary", async () => {
    const directory = await stateDirectory();
    const { kernel } = await authorizedKernel(directory);
    const calls: string[] = [];
    const operator = new RevenuePilotOperator({
      kernel,
      modelClient: fakeLuna(["must not be used"], calls),
      stateDirectory: directory,
      monthlyBudgetUsd: 10,
      monthlyCostOffsetUsd: 9.951,
      now: () => new Date("2026-09-02T00:02:00.000Z"),
    });

    assert.deepEqual(await operator.tick(), { outcome: "idle", reason: "monthly_budget" });
    assert.equal(calls.length, 0);
  });
});
