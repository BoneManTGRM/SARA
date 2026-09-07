import { Worker } from "node:worker_threads";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "./canonical.ts";
import { verifyGenomeLabArtifact, validateProgramCandidateStructure, type GeneratedSkillCandidate } from "./genome-lab.ts";
import type { ExecutorHandoff } from "./handoff.ts";
import type { ProgramCandidateProposal } from "./types.ts";

type Input = { handoff: ExecutorHandoff; candidate: ProgramCandidateProposal; candidateId: string };
type Task = { beforeDispatch?: () => Promise<void> | void; id: number; input: Input; digest: string; resolve(result: GeneratedSkillCandidate): void;
  reject(error: Error): void; timer: ReturnType<typeof setTimeout>; settled: boolean; timedOut?: boolean; started: boolean; enqueued: number };
type Slot = { worker: Worker; task?: Task; retired: boolean; processing?: boolean };
export type VerificationPoolStats = { submitted: number; dispatched: number; completed: number; rejected: number;
  timedOut: number; queueMilliseconds: number; active: number; queued: number; workers: number };

/** Bounded CPU scheduling only. No source/AST/PASS memoization, model calls or shared allowance.
 * Each worker executes the original kernel artifact builder with fresh compiler state per invocation.
 * A timed-out active task is NEVER retried or killed: it drains through verifier cleanup before
 * its worker is eligible again. This avoids abandoning a running isolated child process.
 */
export class KernelVerificationPool {
  readonly #slots = new Set<Slot>();
  readonly #queue: Task[] = [];
  readonly #concurrency: number;
  readonly #maximumQueued: number;
  readonly #maximumWaitMs: number;
  readonly #workerUrl: URL;
  #nextId = 1;
  #closed = false;
  #drainers: Array<() => void> = [];
  #terminations: Promise<number>[] = [];
  #stats = { submitted: 0, dispatched: 0, completed: 0, rejected: 0, timedOut: 0, queueMilliseconds: 0 };
  readonly #stateDirectory: string;
  constructor(stateDirectory: string, options: { concurrency?: number; maximumQueued?: number; maximumWaitMs?: number;
    /** Trusted host/test configuration only, never read from a candidate or HTTP request. */
    workerUrl?: URL } = {}) {
    this.#stateDirectory = resolve(stateDirectory);
    this.#concurrency = options.concurrency ?? 2;
    this.#maximumQueued = options.maximumQueued ?? 32;
    this.#maximumWaitMs = options.maximumWaitMs ?? 30_000;
    this.#workerUrl = options.workerUrl ?? new URL("./kernel-verification-worker.mjs", import.meta.url);
    if (!Number.isSafeInteger(this.#concurrency) || this.#concurrency < 1 || this.#concurrency > 2 ||
        !Number.isSafeInteger(this.#maximumQueued) || this.#maximumQueued < 0 || this.#maximumQueued > 32 ||
        !Number.isSafeInteger(this.#maximumWaitMs) || this.#maximumWaitMs < 1 || this.#maximumWaitMs > 30_000 ||
        this.#workerUrl.protocol !== "file:") throw new Error("VERIFICATION_POOL_INVALID_OPTIONS");
  }
  async verify(input: Input, beforeDispatch?: () => Promise<void> | void): Promise<GeneratedSkillCandidate> {
    if (this.#closed) throw new Error("VERIFICATION_POOL_CLOSED");
    if (this.#queue.length >= this.#maximumQueued && !this.#hasIdleCapacity()) throw new Error("VERIFICATION_POOL_CAPACITY");
    if (!input || !input.handoff || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(input.candidateId)) {
      throw new Error("VERIFICATION_POOL_INPUT_BOUND");
    }
    validateProgramCandidateStructure(input.candidate);
    // Drop extra object properties. No generator, model client, auth credential,
    // callback or mutable compiler state enters the worker.
    const h = input.handoff;
    const snapshot: Input = structuredClone({ candidate: input.candidate, candidateId: input.candidateId,
      handoff: { schemaVersion: h.schemaVersion, role: h.role, jobId: h.jobId,
        constitutionDigest: h.constitutionDigest, objective: h.objective, acceptanceCriteria: h.acceptanceCriteria,
        missingCapabilities: h.missingCapabilities, maximumBudgetUsd: h.maximumBudgetUsd,
        prohibitedActions: h.prohibitedActions, requiredProcess: h.requiredProcess, requiredOutput: h.requiredOutput } });
    if (snapshot.handoff.schemaVersion !== 1 || snapshot.handoff.role !== "sandboxed_coding_executor" ||
        !/^[a-f0-9]{64}$/iu.test(snapshot.handoff.constitutionDigest) ||
        Buffer.byteLength(canonicalJson(snapshot)) > 256 * 1024) throw new Error("VERIFICATION_POOL_INPUT_BOUND");
    const digest = sha256(canonicalJson(snapshot));
    this.#stats.submitted++;
    return new Promise<GeneratedSkillCandidate>((resolve, reject) => {
      const task: Task = { beforeDispatch, id: this.#nextId++, input: snapshot, digest, resolve, reject, settled: false,
        started: false, enqueued: performance.now(), timer: undefined as unknown as ReturnType<typeof setTimeout> };
      task.timer = setTimeout(() => {
        this.#stats.timedOut++; task.timedOut = true;
        this.#reject(task, "VERIFICATION_POOL_DEADLINE");
        if (!task.started) { const at = this.#queue.indexOf(task); if (at >= 0) this.#queue.splice(at, 1); }
        this.#pump();
      }, this.#maximumWaitMs);
      this.#queue.push(task);
      this.#pump();
    });
  }
  #hasIdleCapacity(): boolean {
    return this.#slots.size < this.#concurrency || [...this.#slots].some(slot => !slot.retired && !slot.task);
  }
  #reject(task: Task, code: string): void {
    if (task.settled) return;
    task.settled = true; clearTimeout(task.timer); this.#stats.rejected++;
    task.reject(new Error(code));
  }
  #newSlot(): Slot {
    const worker = new Worker(this.#workerUrl, { env: {}, execArgv: [], argv: [],
      stdin: false, stdout: true, stderr: true, trackUnmanagedFds: true,
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    // Compiler/library diagnostics are private; returned results use the existing typed verifier.
    worker.stdout.resume(); worker.stderr.resume();
    const slot: Slot = { worker, retired: false }; this.#slots.add(slot);
    worker.on("message", message => { void this.#message(slot, message); });
    worker.on("error", () => this.#lost(slot));
    worker.on("exit", () => this.#lost(slot));
    worker.unref();
    return slot;
  }
  async #message(slot: Slot, message: unknown): Promise<void> {
    if (slot.retired) return;
    if (slot.processing) {
      this.#closed = true;
      if (slot.task) this.#reject(slot.task, "VERIFICATION_WORKER_DUPLICATE_REPLY");
      for (const queued of this.#queue.splice(0)) this.#reject(queued, "VERIFICATION_POOL_CLOSED");
      return;
    }
    const task = slot.task;
    const terminal = task && message && typeof message === "object" && !Array.isArray(message) &&
      (message as { id?: unknown }).id === task.id && (message as { drained?: unknown }).drained === true;
    if (!terminal) {
      if (task) this.#reject(task, "VERIFICATION_WORKER_PROTOCOL");
      this.#closed = true;
      for (const queued of this.#queue.splice(0)) this.#reject(queued, "VERIFICATION_POOL_CLOSED");
      // Keep an active slot until its matching cleanup-complete response or exit.
      // An unsolicited/mismatched message cannot make an executing child idle.
      this.#pump(); return;
    }
    slot.processing = true;
    let accepted = false;
    try {
      const envelope = message as { result?: unknown; failed?: unknown };
      if (envelope.failed === true) { this.#reject(task, "VERIFICATION_WORKER_FAILED"); }
      else {
        const result = envelope.result as GeneratedSkillCandidate | undefined;
        if (!result || (message as { binding?: unknown }).binding !== task.digest ||
            result.artifactDirectory !== join(this.#stateDirectory, "genome-lab", task.input.candidateId) ||
            result.artifactRelativePath !== join("genome-lab", task.input.candidateId) ||
            !/^[a-f0-9]{64}$/u.test(result.candidateDigest) || !/^[a-f0-9]{64}$/u.test(result.verificationOutputDigest)) throw new Error("binding");
        // The kernel checks the artifact again under its acceptance lock. This
        // first check also rejects a malformed or mismatched worker response.
        await verifyGenomeLabArtifact(this.#stateDirectory, result.artifactRelativePath, result.candidateDigest);
        if (!task.settled) {
          accepted = true;
          task.settled = true; clearTimeout(task.timer); this.#stats.completed++;
          task.resolve(structuredClone(result));
        }
      }
    } catch {
      if (task) this.#reject(task, "VERIFICATION_WORKER_PROTOCOL");
      // Do not kill an active verifier: cleanup/child timeout must still run.
      // A malformed response is fatal to this pool; no automated retry or fallback.
      this.#closed = true;
      for (const queued of this.#queue.splice(0)) this.#reject(queued, "VERIFICATION_POOL_CLOSED");
    }
    // Timed-out successful work is never accepted. Remove only this task's
    // private artifact AFTER the builder's child execution has drained.
    if (!accepted) {
      await rm(join(this.#stateDirectory, "genome-lab", task.input.candidateId), { recursive: true, force: true }).catch(() => {});
    }
    slot.processing = false;
    slot.task = undefined;
    slot.worker.unref();
    this.#pump();
  }
  #lost(slot: Slot): void {
    if (slot.retired) return;
    slot.retired = true; this.#slots.delete(slot);
    if (slot.task) this.#reject(slot.task, "VERIFICATION_WORKER_EXIT");
    // Unexpected exits close admissions rather than multiplying work in a crash loop.
    this.#closed = true;
    for (const task of this.#queue.splice(0)) this.#reject(task, "VERIFICATION_POOL_CLOSED");
    this.#pump();
  }
  async #dispatch(slot: Slot, task: Task): Promise<void> {
    try {
      // Host authority is rechecked at dispatch, not merely before queueing.
      await task.beforeDispatch?.();
      if (task.settled || this.#closed) {
        this.#reject(task, "VERIFICATION_POOL_CLOSED");
        slot.task = undefined; slot.worker.unref(); this.#pump(); return;
      }
      this.#stats.dispatched++;
      this.#stats.queueMilliseconds += performance.now() - task.enqueued;
      slot.worker.postMessage({ id: task.id, binding: task.digest, input: task.input, root: join(this.#stateDirectory, "genome-lab") });
    } catch {
      this.#reject(task, "VERIFICATION_POOL_ADMISSION_OR_DISPATCH");
      slot.task = undefined; slot.worker.unref(); this.#pump();
    }
  }
  #pump(): void {
    if (!this.#closed) {
      while (this.#queue.length && this.#hasIdleCapacity()) {
        let slot = [...this.#slots].find(s => !s.retired && !s.task);
        if (!slot) {
          try { slot = this.#newSlot(); }
          catch { this.#closed = true; for (const t of this.#queue.splice(0)) this.#reject(t, "VERIFICATION_WORKER_START"); break; }
        }
        const task = this.#queue.shift()!;
        slot.task = task; task.started = true; slot.worker.ref();
        void this.#dispatch(slot, task);
      }
    }
    if (this.#closed && ![...this.#slots].some(s => s.task)) {
      const idle = [...this.#slots]; this.#slots.clear();
      // All response messages come after verification's finally/cleanup completed.
      for (const slot of idle) { slot.retired = true; this.#terminations.push(slot.worker.terminate()); }
      for (const resolve of this.#drainers.splice(0)) resolve();
    }
  }
  snapshot(): VerificationPoolStats {
    return { ...this.#stats, active: [...this.#slots].filter(s => s.task).length, queued: this.#queue.length, workers: this.#slots.size };
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const task of this.#queue.splice(0)) this.#reject(task, "VERIFICATION_POOL_CLOSED");
    const drained = new Promise<void>(resolve => { this.#drainers.push(resolve); });
    this.#pump(); await drained; await Promise.allSettled(this.#terminations);
  }
}

