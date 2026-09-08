import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./canonical.ts";
import { RepositorySession, type RepositorySessionFactory, type RepositorySessionHandle } from "./repository-executor.ts";
import { dispatchLocalRepositoryJudge } from "./repository-official-judge.ts";
import { collectCloudJudgeFiles } from "./repository-cloud-files.ts";
import { repositoryBinding } from "./repository-executor.ts";
import { cloudRecord, validateCloudAssignment, validateCloudCommand, type CloudAssignment, type CloudCommand, type CloudReply, type CloudPhase } from "./repository-cloud-protocol.ts";

/** Fixed operations against a fresh disposable job. No shell command, Docker
 * option, host path, credential or model endpoint comes from a producer. */
export function createRepositoryCloudWorkerEngine(options: {
  assignment: CloudAssignment; directory: string;
  judge?: { datasetPath: string; harnessPath: string };
  startSession?: RepositorySessionFactory;
}) {
  const a = structuredClone(options.assignment); validateCloudAssignment(a);
  const sessions = new Map<string, Promise<RepositorySessionHandle>>();
  const used = new Set<string>(); let closed = false, judged = false;
  const close = async () => {
    closed = true;
    const settled = await Promise.allSettled([...sessions.values()].map(async p => (await p).close()));
    sessions.clear();
    if (settled.some(r => r.status === "rejected")) throw Error("CLOUD_WORKER_CLEANUP_FAILED");
  };
  return {
    close,
    async execute(command: CloudCommand): Promise<unknown> {
      validateCloudCommand(command, a);
      if (closed) throw Error("CLOUD_WORKER_CLOSED");
      const op = command.operation;
      if (op.kind === "finish") { await close(); return { finished: true }; }
      if (op.kind === "judge") {
        if (!options.judge || !a.judge || judged) throw Error("CLOUD_JUDGE_UNAVAILABLE_OR_CONSUMED");
        judged = true;
        const root = join(options.directory, "judge"); await mkdir(root, { recursive: false, mode: 0o700 });
        const path = join(root, "judge-request.json");
        await writeFile(path, canonicalJson(op.request), { flag: "wx", mode: 0o600 });
        await dispatchLocalRepositoryJudge(path, { ...options.judge, ...a.judge,
          environmentDigest: repositoryBinding(a.environment, a.task).environmentDigest }, join(root, "official-judge"));
        return collectCloudJudgeFiles(root);
      }
      if (op.kind === "start") {
        if (used.has(op.session) || used.size >= 16 || sessions.size) throw Error("CLOUD_SESSION_REPLAY_OR_OVERLAP");
        used.add(op.session);
        const starting = (options.startSession ?? RepositorySession.start)(a.environment);
        sessions.set(op.session, starting);
        await starting; return { started: true };
      }
      const pending = sessions.get(op.session);
      if (!pending) throw Error("CLOUD_SESSION_UNKNOWN");
      const session = await pending;
      if (op.kind === "close") { await session.close(); sessions.delete(op.session); return { closed: true }; }
      if (op.kind === "freeze") return session.freezePatch();
      return session.run(op.command, op.input);
    },
  };
}

/** Delivery may repeat; execution never does. Concurrent polling allows a close
 * to kill an in-flight container operation after the producer deadline. */
export async function runRepositoryCloudWorker(options: {
  phase: CloudPhase;
  call(body: Record<string, unknown>): Promise<unknown>;
  prepare(assignment: CloudAssignment): Promise<{ execute(command: CloudCommand): Promise<unknown>; close(): Promise<void> }>;
  signal: AbortSignal;
  pause?: () => Promise<void>;
}) {
  const workerId = randomUUID(), pause = options.pause ?? (() => new Promise<void>(resolve => setTimeout(resolve, 1000)));
  const call = (body: Record<string, unknown>) => options.call({ ...body, workerId, phase: options.phase }).then(cloudRecord);
  let engine: Awaited<ReturnType<typeof options.prepare>> | undefined;
  let assignment: CloudAssignment | undefined;
  let ended = false, failure: unknown;
  const running = new Map<string, Promise<void>>(), replies = new Map<string, CloudReply>();
  let bytes = 0;
  try {
    while (!assignment) {
      options.signal.throwIfAborted();
      const r = await call({ action: "connect" });
      if (r.state === "closed") return;
      if (r.state === "assigned") { assignment = r.assignment as CloudAssignment; validateCloudAssignment(assignment); }
      else if (r.state !== "waiting") throw Error("CLOUD_CONNECT_RESPONSE");
      if (!assignment) await pause();
    }
    engine = await options.prepare(assignment);
    while (!ended) {
      options.signal.throwIfAborted(); if (failure) throw failure;
      const r = await call({ action: "poll", busy: [...running.keys()] });
      if (r.state === "closed") { ended = true; break; }
      if (r.state !== "assigned") throw Error("CLOUD_ASSIGNMENT_LOST");
      if (r.command) {
        const command = r.command as CloudCommand; validateCloudCommand(command, assignment);
        if (running.has(command.id)) throw Error("CLOUD_POLL_BUSY_REDELIVERED");
        const cached = replies.get(command.id);
        if (cached && cached.commandDigest !== command.digest) throw Error("CLOUD_COMMAND_SUBSTITUTION");
        if (replies.size >= 2048 || running.size >= 2) throw Error("CLOUD_WORKER_LIMIT");
        const work = (async () => {
          let reply = cached;
          if (!reply) {
            try { reply = { id: command.id, commandDigest: command.digest, value: await engine!.execute(command), error: null }; }
            catch (error) { reply = { id: command.id, commandDigest: command.digest, value: null,
              error: error instanceof Error ? error.message.slice(0, 1000) : "CLOUD_EXECUTION_FAILED" }; }
            bytes += Buffer.byteLength(canonicalJson(reply));
            if (bytes > 64 * 1024 * 1024) throw Error("CLOUD_REPLY_CACHE_LIMIT");
            replies.set(command.id, reply);
          }
          // The HTTP client may retry the same response bytes. It must never
          // retry an operation or request a new assignment on uncertain delivery.
          const accepted = await call({ action: "reply", reply });
          if (!["accepted", "closed"].includes(String(accepted.state))) throw Error("CLOUD_REPLY_NOT_ACCEPTED");
          if (command.operation.kind === "finish") ended = true;
          if (reply.error) throw Error("CLOUD_WORKER_OPERATION_FAILED");
        })().catch(error => { failure = error; }).finally(() => { running.delete(command.id); });
        running.set(command.id, work);
      }
      if (!ended) await pause();
    }
  } finally {
    // Close first: an outstanding docker exec must not delay cleanup.
    await engine?.close();
    await Promise.allSettled([...running.values()]);
  }
  if (failure) throw failure;
}
