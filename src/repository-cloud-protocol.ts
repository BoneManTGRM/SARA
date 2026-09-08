import { canonicalJson, sha256 } from "./canonical.ts";
import { repositoryBinding, validateRepositoryPatch, type RepositoryEnvironment, type RepositoryTask } from "./repository-executor.ts";

export const CLOUD_WORKER_ROUTE = "/api/repository-benchmark/worker";
export const CLOUD_AUDIENCE = "https://sara-operator-production.up.railway.app/api/repository-benchmark/worker";
export const CLOUD_MAX_BYTES = 16 * 1024 * 1024;
export type CloudPhase = "producer" | "judge";
export interface CloudAssignment {
  id: string; phase: CloudPhase; attemptId: string;
  environment: RepositoryEnvironment; task: RepositoryTask;
  judge?: { image: string; fixtureProxyImage?: string };
}
export type CloudOperation =
  | { kind: "start"; session: string }
  | { kind: "run"; session: string; command: string[]; input?: string }
  | { kind: "freeze"; session: string }
  | { kind: "close"; session: string }
  | { kind: "judge"; request: Record<string, unknown> }
  | { kind: "finish" };
export interface CloudCommand { id: string; assignmentId: string; operation: CloudOperation; digest: string }
export interface CloudReply { id: string; commandDigest: string; value: unknown; error: string | null }
export function cloudRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CLOUD_OBJECT");
  return value as Record<string, unknown>;
}
export function cloudFields(value: unknown, names: string[]): Record<string, unknown> {
  const r = cloudRecord(value);
  if (Object.keys(r).sort().join(",") !== [...names].sort().join(",")) throw new Error("CLOUD_FIELDS");
  return r;
}
export function cloudId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) throw new Error("CLOUD_ID");
}
export function cloudDigest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("CLOUD_DIGEST");
}
export function validateCloudAssignment(a: CloudAssignment): void {
  cloudFields(a, ["id", "phase", "attemptId", "environment", "task", ...(a.judge ? ["judge"] : [])]);
  cloudId(a.id); repositoryBinding(a.environment, a.task);
  if (!["producer", "judge"].includes(a.phase) || typeof a.attemptId !== "string" || a.attemptId.length > 240
    || (a.phase === "judge") !== Boolean(a.judge)) throw new Error("CLOUD_ASSIGNMENT");
  if (a.judge) {
    cloudFields(a.judge, ["image", ...(a.judge.fixtureProxyImage ? ["fixtureProxyImage"] : [])]);
    if (!/^swebench\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(a.judge.image)
      || (a.judge.fixtureProxyImage && !/^python@sha256:[a-f0-9]{64}$/.test(a.judge.fixtureProxyImage))) throw new Error("CLOUD_JUDGE_IMAGE");
  }
}
export function validateCloudCommand(c: CloudCommand, a: CloudAssignment): void {
  cloudFields(c, ["id", "assignmentId", "operation", "digest"]); cloudId(c.id); cloudDigest(c.digest);
  if (c.assignmentId !== a.id || c.digest !== sha256(canonicalJson({ id: c.id, assignmentId: c.assignmentId, operation: c.operation }))) throw new Error("CLOUD_COMMAND_BINDING");
  const op = cloudRecord(c.operation);
  if (op.kind === "finish") { cloudFields(op, ["kind"]); return; }
  if (op.kind === "judge") {
    cloudFields(op, ["kind", "request"]);
    if (a.phase !== "judge" || !a.judge) throw new Error("CLOUD_PHASE");
    const r = cloudFields(op.request, ["schemaVersion", "instanceId", "arm", "runId", "patch", "patchDigest", "repository", "baseCommit", "environmentDigest", "taskDigest", "image", "fixtureProxyImage"]);
    const binding = repositoryBinding(a.environment, a.task);
    if (r.schemaVersion !== 1 || r.instanceId !== a.task.instanceId || r.arm !== a.task.arm
      || r.environmentDigest !== binding.environmentDigest || r.taskDigest !== binding.taskDigest
      || r.repository !== a.environment.repository || r.baseCommit !== a.environment.baseCommit
      || r.image !== a.judge.image || r.fixtureProxyImage !== (a.judge.fixtureProxyImage ?? null)
      || typeof r.runId !== "string" || !/^sara-judge-[a-f0-9-]{36}$/.test(r.runId)
      || typeof r.patch !== "string" || sha256(r.patch) !== r.patchDigest) throw new Error("CLOUD_JUDGE_BINDING");
    validateRepositoryPatch(r.patch); return;
  }
  if (a.phase !== "producer") throw new Error("CLOUD_PHASE");
  cloudId(op.session);
  if (["start", "freeze", "close"].includes(String(op.kind))) { cloudFields(op, ["kind", "session"]); return; }
  if (op.kind !== "run") throw new Error("CLOUD_OPERATION");
  cloudFields(op, ["kind", "session", "command", ...(op.input !== undefined ? ["input"] : [])]);
  if (!Array.isArray(op.command) || !op.command.length || op.command.length > 64
    || op.command.some(x => typeof x !== "string" || !x || x.includes("\0") || x.length > 32768)
    || (op.input !== undefined && (typeof op.input !== "string" || Buffer.byteLength(op.input) > 1024 * 1024))) throw new Error("CLOUD_CONTAINER_COMMAND");
}
export function validateCloudReply(r: CloudReply): void {
  cloudFields(r, ["id", "commandDigest", "value", "error"]); cloudId(r.id); cloudDigest(r.commandDigest);
  if ((r.error !== null && (typeof r.error !== "string" || r.error.length > 1000))
    || Buffer.byteLength(canonicalJson(r)) > CLOUD_MAX_BYTES) throw new Error("CLOUD_REPLY");
}
