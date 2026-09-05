import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import { RevenuePilotTestingRuntime } from "../src/revenue-pilot-testing-runtime.ts";
import { claimRevenuePilotTestingRole } from "../src/revenue-pilot-testing.ts";
import { persistRevenuePilotTestingJob, readRevenuePilotTestingJob, assertRevenuePilotTestingJobIntegrity } from "../src/revenue-pilot-testing-store.ts";
import { persistRevenuePilotArtifact } from "../src/revenue-pilot-artifacts.ts";
import { persistPublicRepositoryEvidence, type PublicRepositoryEvidenceSnapshot } from "../src/public-repository-evidence.ts";
import { executeWorkerModelTask, planWorkerModelTask, type WorkerModelClient } from "../src/model-router.ts";

const repo = "https://github.com/example/project";
const input = (id: string) => ({ opportunityId: id, sourceUrl: `${repo}/issues/${id}`,
  sourceAllowsAutomatedDiscovery: true, discoveredFromPublicSource: true, repoUrl: repo,
  repositoryIsPublic: true, repositoryOwnerPermissionConfirmed: true, requiresPrivateAccess: false,
  containsRegulatedOrPrivateData: false, requestsProductionChanges: false, requestsExploitValidation: false,
  primaryGoal: "release_readiness" as const, desiredTurnaroundDays: 3, recentCommitDays: 7 });
const snapshot: PublicRepositoryEvidenceSnapshot = { schemaVersion: 1, provider: "github", repository: repo,
  immutableCommitSha: "a".repeat(40), defaultBranch: "main", collectedAt: "2026-09-04T20:00:00.000Z",
  collectionMode: "anonymous_read_only", repositoryFacts: { archived: false, disabled: false, fork: false, stars: 0, openIssues: 0, licenseSpdx: "MIT" },
  inventory: [], inventoryTruncated: false, sampledFiles: [], limitations: ["Synthetic restart fixture only."] };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sara-testing-crash-"));
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: "a".repeat(64), bootstrapRevenueCapabilities: true });
  let calls = 0, collections = 0;
  const model: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1_000,
    async countInputTokens() { return 10; }, async execute() { calls++; throw new Error("No redispatch allowed in this fixture."); } };
  const initial = new Date("2026-09-30T23:59:00.000Z");
  const runtime = (now: Date, monthlyBudgetUsd = 1) => new RevenuePilotTestingRuntime({ kernel, stateDirectory: directory, modelClient: model,
    repositoryEvidenceCollector: { async collect() { collections++; return snapshot; } }, monthlyBudgetUsd, now: () => now });
  const first = runtime(initial);
  const created = await first.createJob(input("interrupted"));
  const authorized = await first.authorizeJob(created.id, "owner-authorized-interrupted");
  const claimed = claimRevenuePilotTestingRole(authorized, "testing-work-director", initial, 600);
  await persistRevenuePilotTestingJob({ stateDirectory: directory, job: claimed.job });
  return { directory, kernel, runtime, claimed, calls: () => calls, collections: () => collections,
    close: () => rm(directory, { recursive: true, force: true }) };
}

test("expired claimed role without a persisted output never redispatches after restart", async () => {
  const f = await fixture();
  try {
    for (const date of ["2026-10-01T00:10:01Z", "2026-11-01T00:00:00Z"]) {
      await assert.rejects(f.runtime(new Date(date)).runJob(f.claimed.job.id), /unresolved|recoverable|reconciliation/i);
      assert.equal(f.calls(), 0); assert.equal(f.collections(), 0);
      assert.deepEqual(await readRevenuePilotTestingJob({ stateDirectory: f.directory, jobId: f.claimed.job.id }), f.claimed.job);
    }
  } finally { await f.close(); }
});

for (const date of ["2026-09-30T23:59:30Z", "2026-10-01T00:10:01Z", "2026-11-01T00:00:00Z"]) {
  test(`unresolved claim still reserves its role cap in monthly admission at ${date}`, async () => {
    const f = await fixture();
    try {
      const second = f.runtime(new Date(date), 0.05);
      const job = await second.createJob(input("second")); await second.authorizeJob(job.id, "owner-second");
      await assert.rejects(second.runJob(job.id), /monthly model budget/);
      assert.equal(f.calls(), 0); assert.equal(f.collections(), 0);
    } finally { await f.close(); }
  });
}

test("expired lease with a durable output recovers that receipt without generation", async () => {
  const f = await fixture();
  try {
    const now = new Date("2026-10-01T00:10:01Z");
    const seedClient: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1_000,
      async countInputTokens() { return 10; }, async execute() { return { outputText: "Synthetic saved work packet.", inputTokens: 10, billableOutputTokens: 10 }; } };
    const generated = await executeWorkerModelTask(planWorkerModelTask({ taskKind: "requirements_analysis", dataClassification: "public", maximumTaskCostUsd: 0.05, allowGeminiFreeTier: false, pricedAt: now }), "Synthetic work packet", [seedClient]);
    await persistPublicRepositoryEvidence({ stateDirectory: f.directory, jobId: f.claimed.job.id, snapshot });
    await persistRevenuePilotArtifact({ stateDirectory: f.directory, jobId: f.claimed.job.id, role: "work_director",
      outputDigest: generated.evidence.outputDigest, outputText: generated.outputText, modelExecution: generated.evidence, storedAt: now });
    const restarted = f.runtime(now, 0);
    await assert.rejects(restarted.runJob(f.claimed.job.id), /monthly model budget/);
    const recovered = await restarted.getJob(f.claimed.job.id);
    assert.equal(recovered?.receipts.length, 1); assert.equal(recovered?.receipts[0]?.role, "work_director");
    assert.equal(recovered?.activeLease, null); assert.equal(f.calls(), 0); assert.equal(f.collections(), 0);
  } finally { await f.close(); }
});

for (const invalid of ["unrecognized_role", "opportunity_scout"]) {
  test(`unrecognized durable lease role ${invalid} is rejected before budget accounting`, async () => {
    const f = await fixture();
    try {
      const malformed = structuredClone(f.claimed.job);
      (malformed.activeLease as unknown as {role: string}).role = invalid;
      assert.throws(() => assertRevenuePilotTestingJobIntegrity(malformed), /lease/i);
    } finally { await f.close(); }
  });
}
