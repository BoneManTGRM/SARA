import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runRepositoryBenchmark } from "../src/repository-benchmark-runner.ts";
import { prepareRepositoryComparisonPlan, REPOSITORY_COMPARISON_TASKS } from "../src/repository-comparison.ts";
import { repositoryBinding } from "../src/repository-executor.ts";
import type { RepositoryBenchmarkRegistration } from "../src/repository-benchmark-permit.ts";
import type { SaraKernel } from "../src/kernel.ts";

test("runner validates the entire registered plan before entering irreversible execution", async () => {
  const limits = { maximumModelRequests: 50, maximumToolSteps: 200, maximumPublicTests: 6,
    maximumOutputBytes: 2 * 1024 * 1024, maximumWallMilliseconds: 1800000 };
  const tasks = REPOSITORY_COMPARISON_TASKS.map(t => ({ instanceId: t.instanceId, problemStatement: "Public fixture issue",
    environment: { schemaVersion: 1 as const, repository: t.repository, baseCommit: t.baseCommit,
      image: "sha256:" + "a".repeat(64), publicTestCommand: ["true"], timeoutSeconds: 10 } }));
  const plan = prepareRepositoryComparisonPlan({ runId: "preflight", tasks, limits });
  const registration: RepositoryBenchmarkRegistration = { schemaVersion: 1,
    attempts: plan.requests.map((r, i) => ({ attemptId: `attempt-${i}`, task: r.task,
      environmentDigest: repositoryBinding(r.environment, r.task).environmentDigest })),
    model: { name: "gpt-5.6-luna", reasoning: "medium", maximumInputTokens: 30000,
      maximumOutputTokens: 8000, maximumRequestsPerAttempt: 50, inputPriceTenthsMicros: 2, outputPriceTenthsMicros: 12 },
    spend: { totalMicros: 15600000, armMicros: 7800000, attemptMicros: 780000 }, producerLimits: limits };
  let claims = 0;
  const kernel = { async withRepositoryBenchmarkExecution() { claims++; throw new Error("FIXTURE_CLAIM_BOUNDARY"); } } as unknown as SaraKernel;
  const input = { kernel, owner: { id: "OWNER", kind: "owner" as const, authenticated: true }, registration,
    approval: { registrationDigest: sha256(canonicalJson(registration)), authorityDigest: "b".repeat(64) },
    runId: "preflight", tasks, apiKey: "offline-fixture-never-dispatched" };
  await assert.rejects(runRepositoryBenchmark({ ...input, runId: "wrong-run" }), /PLAN_MISMATCH/);
  const changed = structuredClone(tasks); changed[9]!.problemStatement = "changed public issue";
  await assert.rejects(runRepositoryBenchmark({ ...input, tasks: changed }), /PLAN_MISMATCH/);
  await assert.rejects(runRepositoryBenchmark({ ...input, tasks: tasks.slice(0, 9) }), /COMPARISON_TASKS/);
  assert.equal(claims, 0);
  await assert.rejects(runRepositoryBenchmark(input), /FIXTURE_CLAIM_BOUNDARY/);
  assert.equal(claims, 1);
});
