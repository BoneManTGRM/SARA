import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { writeBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { repositoryBinding, validateRepositoryPatch, type RepositorySessionFactory, type RepositoryCommandResult } from "./repository-executor.ts";
import type { RepositoryJudgeDispatch } from "./repository-official-judge.ts";
import type { RepositoryCloudIdentity } from "./repository-cloud-auth.ts";
import { persistCloudJudgeFiles } from "./repository-cloud-files.ts";
import { cloudFields, cloudId, validateCloudAssignment, validateCloudCommand, validateCloudReply,
  type CloudAssignment, type CloudCommand, type CloudOperation, type CloudReply } from "./repository-cloud-protocol.ts";

type Pending = { command: CloudCommand; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type Assignment = { value: CloudAssignment; worker?: string; pending: Map<string, Pending>; replies: Map<string, string> };

/** An outbound work queue in the existing authority process, not a spending or
 * persistence authority. Restart cannot reconstruct a claimed paid execution. */
export class RepositoryCloudBroker {
  #directory: string | undefined;
  #assignment: Assignment | undefined;
  #workflowRun: string | undefined;
  #retired = new Set<string>();
  #frozen = false;
  #fault: Error | undefined;
  #ended = false;
  #issuing = 0;
  #serial: Promise<unknown> = Promise.resolve();
  readonly #assertAuthority: () => Promise<void>;
  readonly #timeout: number;
  readonly #onBegin?: () => void;
  readonly #expected?: Array<{ attemptId: string; task: CloudAssignment["task"]; environmentDigest: string }>;
  constructor(options: { assertAuthority(): Promise<void>; commandTimeoutMilliseconds?: number; onBegin?(): void;
    expectedAttempts?: ReadonlyArray<{ attemptId: string; task: CloudAssignment["task"]; environmentDigest: string }> }) {
    this.#assertAuthority = options.assertAuthority;
    this.#timeout = options.commandTimeoutMilliseconds ?? 35 * 60_000;
    this.#onBegin = options.onBegin;
    this.#expected = options.expectedAttempts ? structuredClone([...options.expectedAttempts]) : undefined;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 35 * 60_000) throw Error("CLOUD_TIMEOUT");
  }
  async begin(evidenceDirectory: string) {
    if (this.#directory || this.#ended) throw Error("CLOUD_RUN_ALREADY_STARTED");
    await this.#assertAuthority();
    await writeBenchmarkAudit(evidenceDirectory, "cloud-start.json", { execution: "existing_github_workers", replayAllowed: false });
    this.#directory = evidenceDirectory;
    this.#onBegin?.();
  }
  async assertActive() {
    if (!this.#directory || this.#ended || this.#fault) throw this.#fault ?? Error("CLOUD_RUN_INACTIVE");
    await this.#assertAuthority();
    if (this.#ended || this.#fault) throw this.#fault ?? Error("CLOUD_RUN_INACTIVE");
  }
  async openAssignment(value: Omit<CloudAssignment, "id">) {
    await this.assertActive();
    if (this.#assignment || (value.phase === "judge") !== this.#frozen) throw Error("CLOUD_ASSIGNMENT_PHASE");
    const assignment = { ...structuredClone(value), id: randomUUID() };
    validateCloudAssignment(assignment);
    if (this.#expected && !this.#expected.some(a => a.attemptId === value.attemptId && canonicalJson(a.task) === canonicalJson(value.task)
      && a.environmentDigest === repositoryBinding(value.environment, value.task).environmentDigest)) throw Error("CLOUD_UNREGISTERED_ASSIGNMENT");
    await writeBenchmarkAudit(this.#directory!, `cloud-assignment-${assignment.id}.json`, { ...assignment, openedAt: new Date().toISOString() });
    this.#assignment = { value: assignment, pending: new Map(), replies: new Map() };
  }
  async finishAssignment() {
    const a = this.#assignment; if (!a) return;
    await this.#command({ kind: "finish" });
    if (a.worker) this.#retired.add(a.worker);
    this.#assignment = undefined;
  }
  async producersFrozen() {
    await this.assertActive();
    if (this.#assignment || this.#frozen) throw Error("CLOUD_FREEZE_PHASE");
    const envelope = JSON.parse(await readFile(join(this.#directory!, "producer-freeze.json"), "utf8"));
    const { rows, digest } = envelope.payload;
    if (!Array.isArray(rows) || rows.length !== 20 || sha256(canonicalJson(rows)) !== digest
      || sha256(canonicalJson(envelope.payload)) !== envelope.payloadDigest) throw Error("CLOUD_PRODUCER_FREEZE");
    const identities = rows.map(row => canonicalJson({ task: row.task, environmentDigest: row.environmentDigest })).sort();
    if (!this.#expected || this.#expected.length !== 20 || new Set(identities).size !== 20
      || canonicalJson(identities) !== canonicalJson(this.#expected.map(a => canonicalJson({ task: a.task, environmentDigest: a.environmentDigest })).sort())) throw Error("CLOUD_FREEZE_REGISTERED_PLAN");
    this.#frozen = true;
  }
  end() {
    this.#ended = true;
    this.#fail(Error("CLOUD_EXECUTION_CLOSED"));
  }
  #fail(error: Error) {
    this.#fault ??= error;
    for (const p of this.#assignment?.pending.values() ?? []) { clearTimeout(p.timer); p.reject(this.#fault); }
    this.#assignment?.pending.clear();
  }
  async #command(operation: CloudOperation): Promise<unknown> {
    if (this.#issuing + (this.#assignment?.pending.size ?? 0) >= 2
      || ((this.#issuing || this.#assignment?.pending.size) && operation.kind !== "close")) throw Error("CLOUD_CONCURRENT_COMMAND");
    this.#issuing++;
    try {
    await this.assertActive();
    const a = this.#assignment; if (!a) throw Error("CLOUD_ASSIGNMENT_MISSING");
    if (a.pending.size >= 2 || (a.pending.size && operation.kind !== "close")) throw Error("CLOUD_CONCURRENT_COMMAND");
    const body = { id: randomUUID(), assignmentId: a.value.id, operation: structuredClone(operation) };
    const command = { ...body, digest: sha256(canonicalJson(body)) };
    validateCloudCommand(command, a.value);
    await writeBenchmarkAudit(this.#directory!, `cloud-command-${command.id}.json`, { ...command, issuedAt: new Date().toISOString() });
    await this.assertActive();
    if (this.#assignment !== a) throw Error("CLOUD_ASSIGNMENT_CHANGED");
    // Do not await: release admission after publishing the pending command,
    // while retaining the pending slot until its durable reply arrives.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(Error("CLOUD_EXECUTION_UNCERTAIN_NO_REPLAY")), this.#timeout);
      a.pending.set(command.id, { command, resolve, reject, timer });
    });
    } finally { this.#issuing--; }
  }
  /** Only called after OIDC authentication on the isolated worker route. */
  worker(identity: RepositoryCloudIdentity, raw: unknown): Promise<unknown> {
    const body = structuredClone(raw);
    const next = this.#serial.then(() => this.#worker(identity, body));
    this.#serial = next.catch(() => {}); return next;
  }
  async #worker(identity: RepositoryCloudIdentity, raw: unknown): Promise<unknown> {
    await this.assertActive();
    const b = cloudFields(raw, ["action", "workerId", "phase", ...(Object.hasOwn(raw as object, "reply") ? ["reply"] : []),
      ...(Object.hasOwn(raw as object, "busy") ? ["busy"] : [])]);
    cloudId(b.workerId);
    if (!["producer", "judge"].includes(String(b.phase))) throw Error("CLOUD_PHASE");
    const worker = `${identity.runId}:${b.workerId}`;
    if (this.#workflowRun && this.#workflowRun !== identity.runId) throw Error("CLOUD_WORKFLOW_RUN_CHANGED");
    if (this.#retired.has(worker) || (b.phase === "producer" && this.#frozen)) return { state: "closed" };
    const a = this.#assignment;
    if (!a || a.value.phase !== b.phase) return { state: "waiting" };
    if (a.worker && a.worker !== worker) return { state: "waiting" };
    if (!this.#workflowRun) {
      await writeBenchmarkAudit(this.#directory!, "cloud-github-run.json", identity); this.#workflowRun = identity.runId;
    }
    if (!a.worker) {
      if (b.action !== "connect") throw Error("CLOUD_WORKER_NOT_CONNECTED");
      await writeBenchmarkAudit(this.#directory!, `cloud-worker-${a.value.id}.json`, { identity, workerId: b.workerId, assignmentId: a.value.id, connectedAt: new Date().toISOString() });
      a.worker = worker;
    }
    if (b.action === "connect") {
      cloudFields(b, ["action", "workerId", "phase"]);
      return { state: "assigned", assignment: structuredClone(a.value) };
    }
    if (b.action === "poll") {
      cloudFields(b, ["action", "workerId", "phase", "busy"]);
      if (!Array.isArray(b.busy) || b.busy.length > 2) throw Error("CLOUD_BUSY");
      for (const id of b.busy) cloudId(id);
      const command = [...a.pending.values()].find(p => !(b.busy as string[]).includes(p.command.id))?.command;
      return { state: "assigned", command: command ? structuredClone(command) : null };
    }
    if (b.action !== "reply") throw Error("CLOUD_ACTION");
    cloudFields(b, ["action", "workerId", "phase", "reply"]);
    const reply = b.reply as CloudReply; validateCloudReply(reply);
    const digest = sha256(canonicalJson(reply)), previous = a.replies.get(reply.id);
    if (previous) { if (previous !== digest) { this.#fail(Error("CLOUD_REPLY_SUBSTITUTION")); throw this.#fault; } return { state: "accepted" }; }
    const pending = a.pending.get(reply.id);
    if (!pending || reply.commandDigest !== pending.command.digest) throw Error("CLOUD_REPLY_BINDING");
    try {
      await writeBenchmarkAudit(this.#directory!, `cloud-reply-${reply.id}.json`, { ...reply, receivedAt: new Date().toISOString() });
    } catch { this.#fail(Error("CLOUD_RESPONSE_PERSISTENCE_UNCERTAIN")); throw this.#fault; }
    await this.assertActive();
    a.replies.set(reply.id, digest); a.pending.delete(reply.id); clearTimeout(pending.timer);
    if (reply.error) { const error = Error(`CLOUD_WORKER_FAILED: ${reply.error}`); this.#fail(error); pending.reject(error); }
    else pending.resolve(structuredClone(reply.value));
    return { state: "accepted" };
  }
  readonly startSession: RepositorySessionFactory = async environment => {
    const a = this.#assignment;
    if (!a || a.value.phase !== "producer" || canonicalJson(environment) !== canonicalJson(a.value.environment)) throw Error("CLOUD_SESSION_ENVIRONMENT");
    const id = randomUUID(); await this.#command({ kind: "start", session: id }); let closed = false;
    const run = async (command: string[], input?: string): Promise<RepositoryCommandResult> => {
      if (closed) throw Error("CLOUD_SESSION_CLOSED");
      const result = await this.#command({ kind: "run", session: id, command, ...(input === undefined ? {} : { input }) });
      const value = cloudFields(result, ["exitCode", "output"]);
      if (!Number.isSafeInteger(value.exitCode) || typeof value.output !== "string" || Buffer.byteLength(value.output) > 2 * 1024 * 1024) throw Error("CLOUD_COMMAND_RESULT");
      return value as RepositoryCommandResult;
    };
    return {
      run, async mustRun(command, input) { const r = await run(command, input); if (r.exitCode !== 0) throw Error(`REPOSITORY_COMMAND_FAILED: ${r.output}`); return r; },
      freezePatch: async () => { if (closed) throw Error("CLOUD_SESSION_CLOSED"); const p = await this.#command({ kind: "freeze", session: id }); validateRepositoryPatch(p as string); return p as string; },
      close: async () => { if (closed) return; closed = true; await this.#command({ kind: "close", session: id }); },
    };
  };
  readonly dispatchJudge: RepositoryJudgeDispatch = async (requestPath, config, _output) => {
    const a = this.#assignment;
    if (!a || a.value.phase !== "judge" || repositoryBinding(a.value.environment, a.value.task).environmentDigest !== config.environmentDigest) throw Error("CLOUD_JUDGE_ASSIGNMENT");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    const files = await this.#command({ kind: "judge", request });
    await persistCloudJudgeFiles(dirname(requestPath), files);
  };
}
