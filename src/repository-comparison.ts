import { readFileSync } from "node:fs";
import { canonicalJson, sha256 } from "./canonical.ts";
import { repositoryBinding, validateRepositoryPatch, type RepositoryEnvironment, type RepositoryTask } from "./repository-executor.ts";
import type { RepositoryProducerLimits, RepositoryProducerResult } from "./repository-producer.ts";

const manifestBytes = readFileSync(new URL("../docs/benchmarks/swe-bench-multilingual-pilot.json", import.meta.url), "utf8");
if (sha256(manifestBytes) !== "e11f02da9075de689e0fedd7425f8f29027a298a4622ffd9b4ad98905af7bc14") throw Error("COMPARISON_MANIFEST_DRIFT");
const manifest = JSON.parse(manifestBytes);
/** Public identity allowlist only. No judge image/parser/reference data crosses this seam. */
export const REPOSITORY_COMPARISON_TASKS: readonly Readonly<{ instanceId: string; repository: string; baseCommit: string }>[] = Object.freeze(
  manifest.tasks.map((row: { instance_id: string; repo: string; base_commit: string }) => Object.freeze({ instanceId: row.instance_id, repository: row.repo, baseCommit: row.base_commit })),
);
export interface RepositoryComparisonPublicTask { instanceId: string; problemStatement: string; environment: RepositoryEnvironment }
export interface RepositoryComparisonRequest { task: RepositoryTask; environment: RepositoryEnvironment; limits: RepositoryProducerLimits }
export interface RepositoryComparisonAttempt {
  producer: RepositoryProducerResult;
  /** Kernel-owned immutable candidate identity; null means no kernel artifact exists. */
  candidateDigest: string | null;
}
export interface RepositoryComparisonRow {
  index: number; task: RepositoryTask; environmentDigest: string;
  producerStatus: "unrun" | "finished" | "exhausted" | "failed";
  producer: RepositoryProducerResult | null; candidateDigest: string | null; patchDigest: string | null;
  reason: string | null;
  gradeStatus: "unrun" | "completed" | "failed";
  resolved: boolean | null; gradeReceiptDigest: string | null; gradingMilliseconds: number; gradeReason: string | null;
}
export class RepositoryComparisonStop extends Error {
  constructor(readonly causeCode: "authority" | "spend_uncertainty") { super(`REPOSITORY_COMPARISON_STOP_${causeCode}`); }
}
function keys(value: object, expected: string[]) { return Object.keys(value).sort().join(",") === expected.sort().join(","); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function frozen<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown) { if (item && typeof item === "object") { for (const child of Object.values(item)) freeze(child); Object.freeze(item); } }
  freeze(copy); return copy;
}

/** Pure full-plan validation: call before claiming any owner-funded execution. */
export function prepareRepositoryComparisonPlan(input: {
  runId: string; tasks: RepositoryComparisonPublicTask[]; limits: RepositoryProducerLimits;
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(input.runId) || input.tasks.length !== 10 || REPOSITORY_COMPARISON_TASKS.length !== 10) throw Error("COMPARISON_TASKS");
  const tasks = structuredClone(input.tasks), limits = structuredClone(input.limits);
  const limitKeys = ["maximumModelRequests", "maximumToolSteps", "maximumPublicTests", "maximumOutputBytes", "maximumWallMilliseconds"];
  if (!keys(limits, limitKeys) || Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 1)
    || limits.maximumModelRequests > 1000 || limits.maximumToolSteps > 10000 || limits.maximumPublicTests > 1000
    || limits.maximumOutputBytes > 16 * 1024 * 1024 || limits.maximumWallMilliseconds > 24 * 3600_000) throw Error("COMPARISON_LIMITS");
  const rows: RepositoryComparisonRow[] = [];
  for (let index = 0; index < tasks.length; index++) {
    const publicTask = tasks[index]!, expected = REPOSITORY_COMPARISON_TASKS[index]!;
    if (!keys(publicTask, ["instanceId", "problemStatement", "environment"]) || publicTask.instanceId !== expected.instanceId
      || publicTask.environment.repository !== expected.repository || publicTask.environment.baseCommit !== expected.baseCommit) throw Error("COMPARISON_TASK_IDENTITY");
    // Alternate pair order deterministically without changing task selection.
    const arms: RepositoryTask["arm"][] = index % 2 ? ["reparodynamic", "conventional"] : ["conventional", "reparodynamic"];
    for (const arm of arms) {
      const task: RepositoryTask = { instanceId: publicTask.instanceId, problemStatement: publicTask.problemStatement, arm, runId: `${input.runId}-${index}-${arm}` };
      const binding = repositoryBinding(publicTask.environment, task);
      rows.push({ index: rows.length, task, environmentDigest: binding.environmentDigest, producerStatus: "unrun", producer: null, candidateDigest: null,
        patchDigest: null, reason: null, gradeStatus: "unrun", resolved: null, gradeReceiptDigest: null, gradingMilliseconds: 0, gradeReason: null });
    }
  }
  const requests: RepositoryComparisonRequest[] = rows.map(row => ({ task: row.task,
    environment: tasks[Math.floor(row.index / 2)]!.environment, limits }));
  return frozen({ rows, requests });
}

/** Orchestration only: callbacks must use existing kernel authority, durable grant
 * claims and independent grading. No model, credential, grant or retry is created.
 * All twenty producer rows are durably frozen before the first grading callback. */
export async function runRepositoryComparison(input: {
  runId: string; tasks: RepositoryComparisonPublicTask[]; limits: RepositoryProducerLimits;
  runAttempt(request: RepositoryComparisonRequest): Promise<RepositoryComparisonAttempt>;
  freezeProducers(rows: readonly RepositoryComparisonRow[], digest: string): Promise<void>;
  grade(request: { task: RepositoryTask; candidateDigest: string; patchDigest: string }): Promise<{ resolved: boolean; receiptDigest: string }>;
}) {
  const plan = prepareRepositoryComparisonPlan(input);
  const rows = structuredClone(plan.rows), limits = structuredClone(input.limits);
  let stopReason: string | null = null;
  for (const row of rows) {
    if (stopReason) { row.reason = stopReason; continue; }
    try {
      const output = structuredClone(await input.runAttempt(plan.requests[row.index]!));
      if (!keys(output, ["producer", "candidateDigest"]) || (output.candidateDigest !== null && !digest(output.candidateDigest))) throw Error("COMPARISON_ATTEMPT_FIELDS");
      const p = output.producer;
      if (!p || !keys(p, ["patch", "status", "reason", "events", "modelRequests", "toolSteps", "publicTests", "inputTokens", "outputTokens", "accountedCostUsd", "elapsedMilliseconds", "officialBenchmarkResult", "unreconciledModelRequests", "accountingComplete"]) || !["finished", "exhausted", "failed"].includes(p.status) || p.officialBenchmarkResult !== false
        || typeof p.accountingComplete !== "boolean" || !Number.isSafeInteger(p.unreconciledModelRequests) || p.unreconciledModelRequests < 0
        || ![p.modelRequests, p.toolSteps, p.publicTests, p.inputTokens, p.outputTokens, p.elapsedMilliseconds].every(n => Number.isSafeInteger(n) && n >= 0)
        || p.modelRequests > limits.maximumModelRequests || p.toolSteps > limits.maximumToolSteps || p.publicTests > limits.maximumPublicTests
        || !Array.isArray(p.events) || typeof p.reason !== "string"
        || !Number.isFinite(p.accountedCostUsd) || p.accountedCostUsd < 0
        || p.accountingComplete !== (p.unreconciledModelRequests === 0)) throw Error("COMPARISON_PRODUCER_OUTCOME");
      validateRepositoryPatch(p.patch);
      row.producer = p; row.producerStatus = p.status; row.candidateDigest = output.candidateDigest;
      row.patchDigest = sha256(p.patch); row.reason = p.reason;
      if (!p.accountingComplete || p.reason === "PRODUCER_CLEANUP_FAILED") stopReason = "producer_accounting_or_cleanup_uncertain";
    } catch (error) {
      row.producerStatus = "failed";
      row.reason = error instanceof RepositoryComparisonStop ? error.causeCode : "producer_outcome_uncertain";
      stopReason = row.reason;
    }
  }
  const producerDigest = sha256(canonicalJson(rows));
  // A failed persistence barrier aborts grading outright. Caller retains its
  // durable producer receipts and must not restart paid generation automatically.
  let producerFreezeCompleted = false;
  try { await input.freezeProducers(frozen(rows), producerDigest); producerFreezeCompleted = true; } catch { /* Preserve all rows; never grade without durable freeze. */ }
  let gradingStopped = !producerFreezeCompleted;
  for (const row of rows) {
    if (gradingStopped || !row.candidateDigest || !row.patchDigest) continue;
    const started = Date.now();
    try {
      const grade = await input.grade(frozen({ task: row.task, candidateDigest: row.candidateDigest, patchDigest: row.patchDigest }));
      if (!keys(grade, ["resolved", "receiptDigest"]) || typeof grade.resolved !== "boolean" || !digest(grade.receiptDigest)) throw Error("COMPARISON_GRADE_FIELDS");
      row.gradeStatus = "completed"; row.resolved = grade.resolved; row.gradeReceiptDigest = grade.receiptDigest;
    } catch (error) {
      row.gradeStatus = "failed"; row.gradeReason = error instanceof RepositoryComparisonStop ? error.causeCode : "grade_failed";
      if (error instanceof RepositoryComparisonStop) gradingStopped = true;
    } finally { row.gradingMilliseconds = Date.now() - started; }
  }
  const completedGrades = rows.filter(row => row.gradeStatus === "completed").length;
  const resolvedCount = rows.filter(row => row.resolved === true).length;
  const complete = producerFreezeCompleted && completedGrades === 20 && stopReason === null
    && rows.every(row => row.producer?.accountingComplete === true && row.producer.unreconciledModelRequests === 0
      && row.producer.reason !== "PRODUCER_CLEANUP_FAILED");
  return frozen({ schemaVersion: 1 as const, runId: input.runId, rows, producerDigest, producerFreezeCompleted, plannedAttempts: 20 as const,
    completedGrades, resolvedCount, status: complete ? "completed" as const : "incomplete" as const,
    resolvedFraction: complete ? resolvedCount / 20 : null, spendingAuthority: false as const });
}
