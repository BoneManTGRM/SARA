import * as ts from "typescript";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rmdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { validateProgramCandidateStructure } from "./genome-lab.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import { assertCodingRepairVerification, codingRepairCandidateDigest, isEvidenceDigest } from "./experimental-v5/coding-repair-verification.ts";
import type { CodingRepairModel } from "./coding-repair-controller.ts";
import type { CodingRepairProposal, CodingRepairRun, ProgramVerificationResult } from "./coding-repair-types.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "./types.ts";

type Request = Parameters<CodingRepairModel["propose"]>[0];
type Verify = (candidate: ProgramCandidateProposal) => Promise<ProgramVerificationResult>;
type Recipe = { schemaVersion: 1; key: string; id: string; afterDigest: string; changes: CodingRepairProposal["changes"]; changedLines: number; evidence: string[] };
export type RepairReuseHit = { key: string; id: string; afterDigest: string; proposal: CodingRepairProposal };
export type RepairReuseEvent = { schemaVersion: 1; event: string; scopeDigest: string; elapsedMilliseconds: number; verificationCalls: number; key?: string; recipeId?: string; artifactDigest?: string };
const limits = structuredClone(INITIAL_CODING_REPAIR_LIMITS);
Object.freeze(limits.protectedPaths); Object.freeze(limits);
const MAX_RECORD_BYTES = 131072;
function requireDigest(value: string): void { if (!isEvidenceDigest(value)) throw new Error("INVALID_REUSE_DIGEST"); }
function artifact(candidate: ProgramCandidateProposal): string {
  validateProgramCandidateStructure(candidate);
  return codingRepairCandidateDigest(candidate);
}
function boundVerification(candidate: ProgramCandidateProposal, verification: ProgramVerificationResult): void {
  assertCodingRepairVerification(verification);
  if (verification.artifactDigest !== artifact(candidate)) throw new Error("REUSE_VERIFICATION_ARTIFACT_MISMATCH");
}
function keyFor(candidate: ProgramCandidateProposal, scope: string): string {
  requireDigest(scope); artifact(candidate);
  // Include metadata and all protected test bytes, not just changed source files.
  return sha256(canonicalJson({ schemaVersion: 1, scope, candidate }));
}
function changedLines(before: string, after: string): number {
  const a = before.split("\n"), b = after.split("\n");
  return Math.abs(a.length - b.length) + a.slice(0, b.length).filter((line, i) => line !== b[i]).length;
}
function apply(candidate: ProgramCandidateProposal, changes: CodingRepairProposal["changes"]): ProgramCandidateProposal {
  const replacements = new Map(changes.map(change => [change.path, change.replacementText]));
  return { ...structuredClone(candidate), files: candidate.files.map(file => ({ ...file, content: replacements.get(file.path) ?? file.content })) };
}
async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeOnce(path: string, value: unknown): Promise<void> {
  const content = canonicalJson(value) + "\n";
  if (Buffer.byteLength(content) > MAX_RECORD_BYTES) throw new Error("REUSE_RECORD_BOUND");
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
}

// Serialize short cache I/O across store instances in this process. A warm
// lookup must not become a paid fallback merely because another local lookup
// briefly owns the filesystem lock. Never share verification or model results.
type StoreQueue = { tail: Promise<void>; pending: number };
const storeQueues = new Map<string, StoreQueue>();
let queuedStoreOperations = 0;
async function withStoreQueue<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const queue = storeQueues.get(directory) ?? { tail: Promise.resolve(), pending: 0 };
  if (queue.pending >= 32 || queuedStoreOperations >= 128) throw new Error("REUSE_QUEUE_FULL");
  const previous = queue.tail;
  let release!: () => void;
  queue.tail = new Promise<void>(resolve => { release = resolve; });
  queue.pending++; queuedStoreOperations++; storeQueues.set(directory, queue);
  try { await previous; return await operation(); }
  finally {
    queue.pending--; queuedStoreOperations--; release();
    if (queue.pending === 0) storeQueues.delete(directory);
  }
}

/** Local private storage is a proposal source, never proof of a current PASS.
 * No eviction, expiry-based revival, or automatic lock recovery is permitted.
 * A crashed writer leaves reuse unavailable until an operator inspects its lock.
 */
export class DurableRepairReuseStore {
  readonly #directory: string;
  readonly #capacity: number;
  constructor(stateDirectory: string, capacity = 128) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 128) throw new Error("REUSE_CAPACITY_BOUND");
    this.#directory = resolve(stateDirectory, "coding-repair-reuse-v1"); this.#capacity = capacity;
  }
  async #locked<T>(operation: () => Promise<T>): Promise<T> {
    return withStoreQueue(this.#directory, () => this.#filesystemLocked(operation));
  }
  async #filesystemLocked<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    if (await realpath(this.#directory) !== this.#directory) throw new Error("REUSE_STORE_SYMLINK");
    const lock = join(this.#directory, ".lock");
    try { await mkdir(lock, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("REUSE_STORE_BUSY"); throw error;
    }
    try { return await operation(); } finally { await rmdir(lock); }
  }
  async #read(key: string): Promise<Recipe> {
    const file = await open(join(this.#directory, `${key}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_RECORD_BYTES) throw new Error("REUSE_RECORD_BOUND");
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1); let used = 0;
      while (used < buffer.length) {
        const read = await file.read(buffer, used, buffer.length - used, used);
        if (!read.bytesRead) break; used += read.bytesRead;
      }
      if (used > MAX_RECORD_BYTES) throw new Error("REUSE_RECORD_BOUND");
      bytes = buffer.subarray(0, used);
    } finally { await file.close(); }
    const envelope = JSON.parse(bytes.toString("utf8")) as { digest: string; recipe: Recipe };
    const record = envelope.recipe;
    if (!record || envelope.digest !== sha256(canonicalJson(record)) || record.schemaVersion !== 1 || record.key !== key
      || !isEvidenceDigest(record.afterDigest) || !Array.isArray(record.changes) || !record.changes.length
      || !Number.isSafeInteger(record.changedLines) || record.changedLines < 1 || record.changedLines > limits.deepChangedLines
      || !Array.isArray(record.evidence) || !record.evidence.length || record.evidence.length > 256 || !record.evidence.every(isEvidenceDigest)
      || record.id !== sha256(canonicalJson({ key, changes: record.changes, afterDigest: record.afterDigest }))) throw new Error("REUSE_RECORD_INTEGRITY");
    return record;
  }
  async lookup(request: Request, scope: string): Promise<RepairReuseHit | null> {
    request = structuredClone(request); const key = keyFor(request.candidate, scope);
    boundVerification(request.candidate, request.verification);
    if (request.verification.passed || !request.verification.failures.length || !["surgical", "deep"].includes(request.strategy)) return null;
    return this.#locked(async () => {
      if (await present(join(this.#directory, `${key}.revoked`)) || !await present(join(this.#directory, `${key}.json`))) return null;
      const record = await this.#read(key);
      if (record.changes.length > (request.strategy === "surgical" ? limits.surgicalFiles : limits.deepFiles)
        || record.changedLines > (request.strategy === "surgical" ? limits.surgicalChangedLines : limits.deepChangedLines)) return null;
      const proposal: CodingRepairProposal = { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
        failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
        changes: structuredClone(record.changes), limitations: ["Durable exact-source recipe; fresh acceptance is mandatory."] };
      validateCodingRepairProposal({ proposal, candidate: request.candidate, artifactDigest: request.verification.artifactDigest,
        failureFingerprints: new Set(request.verification.failures.map(f => f.fingerprint)), limits, expectedStrategy: request.strategy });
      const after = apply(request.candidate, proposal.changes);
      if (artifact(after) !== record.afterDigest || request.candidate.files.reduce((n, f, i) => n + changedLines(f.content, after.files[i].content), 0) !== record.changedLines)
        throw new Error("REUSE_RECORD_ARTIFACT_MISMATCH");
      return { key, id: record.id, afterDigest: record.afterDigest, proposal };
    });
  }
  async learn(before: ProgramCandidateProposal, after: ProgramCandidateProposal, verification: ProgramVerificationResult, scope: string): Promise<"stored" | "existing" | "revoked" | "capacity"> {
    before = structuredClone(before); after = structuredClone(after); verification = structuredClone(verification);
    const key = keyFor(before, scope); boundVerification(after, verification);
    if (!verification.passed || canonicalJson({ ...before, files: [] }) !== canonicalJson({ ...after, files: [] })
      || before.files.length !== after.files.length) throw new Error("UNVERIFIED_REUSE_RECIPE");
    const changes: CodingRepairProposal["changes"] = []; let count = 0;
    for (const old of before.files) {
      const next = after.files.find(file => file.path === old.path);
      if (!next) throw new Error("REUSE_FILE_SET_CHANGED");
      if (old.content === next.content) continue;
      changes.push({ path: old.path, expectedContentDigest: sha256(old.content), replacementText: next.content });
      count += changedLines(old.content, next.content);
    }
    if (!changes.length || count > limits.deepChangedLines) throw new Error("REUSE_MUTATION_BOUND");
    changes.sort((a, b) => a.path.localeCompare(b.path));
    // Enforce the same protected-path, expected-source, file-count and size limits as live repair.
    validateCodingRepairProposal({ proposal: { schemaVersion: 1, baseArtifactDigest: artifact(before), failureFingerprint: scope,
      strategy: "deep", changes, limitations: [] }, candidate: before, artifactDigest: artifact(before), failureFingerprints: new Set([scope]), limits, expectedStrategy: "deep" });
    const afterDigest = artifact(after), id = sha256(canonicalJson({ key, changes, afterDigest }));
    const recipe: Recipe = { schemaVersion: 1, key, id, afterDigest, changes, changedLines: count, evidence: [...verification.evidenceDigests] };
    return this.#locked(async () => {
      if (await present(join(this.#directory, `${key}.revoked`))) return "revoked";
      if (await present(join(this.#directory, `${key}.json`))) { await this.#read(key); return "existing"; }
      const names = await readdir(this.#directory);
      const identities = new Set(names.filter(n => /^[a-f0-9]{64}\.(json|revoked)$/u.test(n)).map(n => n.slice(0, 64)));
      if (identities.size >= this.#capacity) return "capacity";
      await writeOnce(join(this.#directory, `${key}.json`), { digest: sha256(canonicalJson(recipe)), recipe });
      await syncDirectory(this.#directory); return "stored";
    });
  }
  async isQuarantined(key: string): Promise<boolean> {
    requireDigest(key);
    if (await realpath(this.#directory) !== this.#directory) throw new Error("REUSE_STORE_SYMLINK");
    return present(join(this.#directory, `${key}.revoked`));
  }
  async quarantine(key: string, evidenceDigest: string): Promise<void> {
    requireDigest(key); requireDigest(evidenceDigest);
    // Revocation cannot wait behind a learning/lookup lock. Creation is exclusive
    // and monotonic; even a partial marker blocks all subsequent reuse.
    if (await realpath(this.#directory) !== this.#directory) throw new Error("REUSE_STORE_SYMLINK");
    if (!await present(join(this.#directory, `${key}.json`))) throw new Error("UNKNOWN_REUSE_RECIPE");
    try { await writeOnce(join(this.#directory, `${key}.revoked`), { schemaVersion: 1, key, evidenceDigest }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await syncDirectory(this.#directory);
  }
}

/** New scope on any verifier, policy, controller, runtime or dependency change.
 * Memory text is not imported into recipes; exact task semantics and bytes decide eligibility.
 */
export async function repairReuseScope(context: Parameters<CandidateGenerator["generate"]>[0], generatorId: string): Promise<string> {
  context = structuredClone(context);
  const paths = ["genome-lab.ts", "genome-lab-verifier.ts", "coding-repair-controller.ts", "coding-repair-policy.ts", "coding-repair-prompt.ts",
    "coding-repair-reuse.ts", "reparodynamic-candidate-generator.ts", "coding-repair-artifacts.ts", "canonical.ts",
    "experimental-v5/coding-repair-verification.ts", "luna-coding-repair-model.ts", "coding-repair-lessons.ts",
    "coding-repair-lessons-base.ts", "coding-repair-information-lessons.ts", "server.ts", "../package-lock.json", "../tsconfig.json"];
  const implementation = await Promise.all(paths.map(async path => [path, sha256(await readFile(new URL(path, import.meta.url), "utf8"))]));
  return sha256(canonicalJson({ schemaVersion: 1, generatorId, implementation, node: process.version, typescript: ts.version, platform: process.platform, arch: process.arch,
    objective: context.objective, acceptanceCriteria: context.acceptanceCriteria, missingCapabilities: context.missingCapabilities, constitutionDigest: context.constitutionDigest }));
}

export class RepairReuseSession {
  #pending: RepairReuseHit | null = null;
  readonly #used = new Map<string, RepairReuseHit>();
  #checks = 0;
  readonly #started = performance.now();
  constructor(readonly store: DurableRepairReuseStore, readonly scope: string, readonly verifier: Verify,
    readonly onEvent: (event: RepairReuseEvent) => Promise<void>) { requireDigest(scope); }
  async #event(event: string, hit?: RepairReuseHit, artifactDigest?: string): Promise<void> {
    await this.onEvent({ schemaVersion: 1, event, scopeDigest: this.scope, elapsedMilliseconds: performance.now() - this.#started,
      verificationCalls: this.#checks, ...(hit ? { key: hit.key, recipeId: hit.id } : {}), ...(artifactDigest ? { artifactDigest } : {}) });
  }
  async propose(request: Request, fallback: CodingRepairModel): ReturnType<CodingRepairModel["propose"]> {
    let hit: RepairReuseHit | null = null; let unavailable = false;
    try { hit = await this.store.lookup(request, this.scope); } catch { unavailable = true; }
    if (hit) {
      await this.#event("recipe_hit", hit); // Persist provenance BEFORE using the recipe.
      this.#pending = hit;
      return { proposal: hit.proposal, inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
    }
    await this.#event(unavailable ? "reuse_unavailable_model_fallback" : "recipe_miss_model_fallback");
    return fallback.propose(request);
  }
  async verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult> {
    const snapshot = structuredClone(candidate), hit = this.#pending; this.#pending = null; this.#checks++;
    try {
      const result = await this.verifier(structuredClone(snapshot)); boundVerification(snapshot, result);
      if (hit && (artifact(snapshot) !== hit.afterDigest || !result.passed)) {
        await this.store.quarantine(hit.key, sha256(canonicalJson(result)));
        await this.#event("recipe_quarantined", hit);
        if (artifact(snapshot) !== hit.afterDigest) throw new Error("REUSE_APPLIED_ARTIFACT_MISMATCH");
      }
      if (hit && result.passed) this.#used.set(hit.key, hit);
      return result;
    } catch (error) {
      if (hit) { await this.store.quarantine(hit.key, sha256("REUSE_VERIFIER_EXCEPTION")); await this.#event("recipe_quarantined", hit); }
      throw error;
    }
  }
  async finish(run: CodingRepairRun, persistRun: () => Promise<void>): Promise<void> {
    let final: ProgramVerificationResult | undefined;
    if (run.state === "VERIFIED_CANDIDATE") {
      try {
        final = await this.verify(run.champion);
        if (!final.passed) throw new Error("REUSE_FINAL_VERIFICATION_FAILED");
        for (const hit of this.#used.values()) if (await this.store.isQuarantined(hit.key)) throw new Error("REUSE_REVOKED_DURING_RUN");
      } catch (error) {
        for (const hit of this.#used.values()) await this.store.quarantine(hit.key, sha256("REUSE_FINAL_VERIFICATION_FAILED"));
        await this.#event("fresh_final_failed"); throw error;
      }
      await this.#event("fresh_final_pass", undefined, final.artifactDigest);
    }
    await persistRun(); // A failed mandatory receipt can never be converted to a successful learning event.
    if (final && !run.baselineVerification.passed && artifact(run.baseline) !== final.artifactDigest) {
      let outcome: string;
      try { outcome = await this.store.learn(run.baseline, run.champion, final, this.scope); } catch { outcome = "unavailable"; }
      await this.#event(`learn_${outcome}`, undefined, final.artifactDigest);
    }
    await this.#event("run_finished", undefined, run.verification.artifactDigest);
    // Mandatory event/run persistence yields to other jobs. Recheck after ALL
    // such callbacks, not only before them. There is no async work after this
    // return-boundary guard in this session. The kernel still verifies afresh.
    if (final) {
      try {
        for (const hit of this.#used.values()) if (await this.store.isQuarantined(hit.key)) throw new Error("REUSE_REVOKED_DURING_RUN");
      } catch (error) {
        await this.#event("return_boundary_rejected");
        throw error;
      }
    }
  }
}

export function persistRepairReuseEvents(stateDirectory: string, runId: string): (event: RepairReuseEvent) => Promise<void> {
  if (!/^[a-f0-9-]{36}$/u.test(runId)) throw new Error("INVALID_REUSE_RUN_ID");
  const directory = resolve(stateDirectory, "coding-repair-receipts", runId); let sequence = 0;
  return async event => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new Error("REUSE_RECEIPT_SYMLINK");
    await writeOnce(join(directory, `reuse-${String(++sequence).padStart(3, "0")}.json`), { runId, ...event });
    await syncDirectory(directory);
  };
}
