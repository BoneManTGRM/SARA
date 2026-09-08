import test from "node:test";
import assert from "node:assert/strict";
import { REPOSITORY_COMPARISON_TASKS, RepositoryComparisonStop, runRepositoryComparison, type RepositoryComparisonPublicTask } from "../src/repository-comparison.ts";
import type { RepositoryProducerResult } from "../src/repository-producer.ts";
const tasks: RepositoryComparisonPublicTask[] = REPOSITORY_COMPARISON_TASKS.map(t => ({ instanceId: t.instanceId, problemStatement: "Public issue", environment: { schemaVersion: 1, repository: t.repository, baseCommit: t.baseCommit, image: "sha256:" + "a".repeat(64), publicTestCommand: ["npm", "test"], timeoutSeconds: 10 } }));
const limits = { maximumModelRequests: 2, maximumToolSteps: 10, maximumPublicTests: 2, maximumOutputBytes: 10000, maximumWallMilliseconds: 10000 };
function producer(): RepositoryProducerResult { return { patch: "", status: "finished", reason: "model_finish", events: [], modelRequests: 1, toolSteps: 1, publicTests: 1, inputTokens: 1, outputTokens: 1, accountedCostUsd: 0, elapsedMilliseconds: 1, officialBenchmarkResult: false, unreconciledModelRequests: 0, accountingComplete: true }; }
const candidateDigest = "b".repeat(64), receiptDigest = "c".repeat(64);
test("all20 isolated equal-limit outcomes freeze before any grade; complete denominator remains20", async () => {
  const namespaces = new Set<string>(); let produced = 0, frozen = false;
  const report = await runRepositoryComparison({ runId: "test", tasks, limits,
    async runAttempt(request) { produced++; namespaces.add(request.task.runId); assert.deepEqual(request.limits, limits); assert.ok(Object.isFrozen(request)); return { producer: producer(), candidateDigest }; },
    async freezeProducers(rows, digest) { assert.equal(rows.length, 20); assert.equal(produced, 20); assert.equal(digest.length, 64); frozen = true; },
    async grade(request) { assert.equal(produced, 20); assert.equal(frozen, true); assert.equal(request.candidateDigest, candidateDigest); return { resolved: request.task.arm === "reparodynamic", receiptDigest }; },
  });
  assert.equal(namespaces.size, 20); assert.equal(report.completedGrades, 20); assert.equal(report.resolvedCount, 10); assert.equal(report.resolvedFraction, .5);
});
test("uncertain provider accounting stops future producers but preserves20 frozen rows and incomplete result", async () => {
  let produced = 0, grades = 0;
  const report = await runRepositoryComparison({ runId: "uncertain", tasks, limits,
    async runAttempt() { produced++; return { producer: { ...producer(), accountingComplete: false, unreconciledModelRequests: 1 }, candidateDigest }; },
    async freezeProducers(rows) { assert.equal(rows.length, 20); assert.equal(rows.filter(r => r.producerStatus === "unrun").length, 19); },
    async grade() { grades++; return { resolved: false, receiptDigest }; },
  });
  assert.equal(produced, 1); assert.equal(grades, 1); assert.equal(report.status, "incomplete"); assert.equal(report.resolvedFraction, null);
});
test("authority rejection preserves attemptedfailure and19unrun without inventing candidate or grade", async () => {
  const report = await runRepositoryComparison({ runId: "stopped", tasks, limits,
    async runAttempt() { throw new RepositoryComparisonStop("authority"); }, async freezeProducers() {}, async grade() { assert.fail("no artifact exists"); },
  });
  assert.equal(report.rows.length, 20); assert.equal(report.rows[0]!.producerStatus, "failed"); assert.equal(report.completedGrades, 0);
  assert.equal(report.rows.filter(r => r.producerStatus === "unrun").length, 19);
});
test("task changes and extra judge fields reject before producer callbacks", async () => {
  for (const mutate of [(copy: RepositoryComparisonPublicTask[]) => { copy[0]!.environment.baseCommit = "f".repeat(40); }, (copy: RepositoryComparisonPublicTask[]) => { Object.assign(copy[0]!, { test_patch: "hidden" }); }]) {
    const copy = structuredClone(tasks); mutate(copy);
    await assert.rejects(runRepositoryComparison({ runId: "invalid", tasks: copy, limits, async runAttempt() { assert.fail("dispatch"); }, async freezeProducers() {}, async grade() { assert.fail("grade"); } }), /COMPARISON_TASK_IDENTITY/);
  }
});
test("failed freeze never grades and returns all20 outcomes without replay", async () => {
  let produced = 0;
  const report = await runRepositoryComparison({ runId: "persistfail", tasks, limits,
    async runAttempt() { produced++; return { producer: producer(), candidateDigest }; }, async freezeProducers() { throw Error("disk full"); }, async grade() { assert.fail("grade before durable freeze"); },
  });
  assert.equal(produced, 20); assert.equal(report.rows.length, 20); assert.equal(report.producerFreezeCompleted, false); assert.equal(report.status, "incomplete");
});
test("failed producer outcomes remain gradeable; grader failure is retained without ratio", async () => {
  let graded = 0;
  const report = await runRepositoryComparison({ runId: "failures", tasks, limits,
    async runAttempt() { return { producer: { ...producer(), status: "failed", reason: "no_solution" }, candidateDigest }; }, async freezeProducers() {},
    async grade() { if (++graded === 1) throw Error("grader failed"); return { resolved: false, receiptDigest }; },
  });
  assert.equal(graded, 20); assert.equal(report.completedGrades, 19); assert.equal(report.rows[0]!.gradeStatus, "failed"); assert.equal(report.resolvedFraction, null);
});
test("uncertainty on final producer prevents completion even when all20 official grades complete", async () => {
  let produced = 0;
  const report = await runRepositoryComparison({ runId: "last-uncertain", tasks, limits,
    async runAttempt() { return { producer: { ...producer(), ...(++produced === 20 ? { accountingComplete: false, unreconciledModelRequests: 1 } : {}) }, candidateDigest }; },
    async freezeProducers() {}, async grade() { return { resolved: true, receiptDigest }; },
  });
  assert.equal(report.completedGrades, 20); assert.equal(report.resolvedCount, 20);
  assert.equal(report.status, "incomplete"); assert.equal(report.resolvedFraction, null);
});
test("pure preflight exposes complete immutable20request mapping before any authority claim", async () => {
  const { prepareRepositoryComparisonPlan } = await import("../src/repository-comparison.ts");
  const plan = prepareRepositoryComparisonPlan({ runId: "preflight", tasks, limits });
  assert.equal(plan.requests.length, 20); assert.equal(plan.rows.length, 20);
  assert.deepEqual(plan.requests[0]!.task, { instanceId: tasks[0]!.instanceId, problemStatement: "Public issue", arm: "conventional", runId: "preflight-0-conventional" });
  assert.deepEqual(plan.requests[2]!.task.arm, "reparodynamic");
  assert.ok(Object.isFrozen(plan.requests[0]!.environment));
  assert.equal(plan.rows.every(row => row.producerStatus === "unrun"), true);
  assert.throws(() => prepareRepositoryComparisonPlan({ runId: "bad/id", tasks, limits }), /COMPARISON_TASKS/);
  const changed = structuredClone(tasks); changed[9]!.environment.baseCommit = "f".repeat(40);
  assert.throws(() => prepareRepositoryComparisonPlan({ runId: "preflight", tasks: changed, limits }), /COMPARISON_TASK_IDENTITY/);
});
