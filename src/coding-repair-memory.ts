import { constants } from "node:fs";
import { ExactByteSnapshotCache, readExactMemoryBytes } from "./repair-memory-snapshot.ts";
import { mkdir, open, readFile, realpath, rename, rmdir, unlink, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import { validateProgramCandidateStructure } from "./genome-lab.ts";
import { assertCodingRepairVerification, codingRepairCandidateDigest, isEvidenceDigest } from "./experimental-v5/coding-repair-verification.ts";
import type { CodingRepairProposal, ProgramVerificationResult } from "./coding-repair-types.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "./types.ts";

const LIMITS = structuredClone(INITIAL_CODING_REPAIR_LIMITS);
Object.freeze(LIMITS.protectedPaths);
Object.freeze(LIMITS);
const MAX_RECORDS = 128;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = 100 * 1024;
export type RepairMemoryHit = { key: string; id: string; verifiedArtifactDigest: string; proposal: CodingRepairProposal };
type RecipeBody = { key: string; verifiedArtifactDigest: string; changes: CodingRepairProposal["changes"]; changedLines: number };
type Recipe = RecipeBody & { id: string; evidenceDigests: string[]; quarantineDigest: string | null };

function changedLines(before: string, after: string): number {
  const a = before.split("\n"), b = after.split("\n");
  let count = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) count++;
  return count;
}
function identity(r: RecipeBody): string {
  return sha256(canonicalJson({ key: r.key, verifiedArtifactDigest: r.verifiedArtifactDigest, changes: r.changes, changedLines: r.changedLines }));
}
export function codingRepairMemoryKey(candidate: ProgramCandidateProposal, verification: ProgramVerificationResult, scope: string): string {
  if (!isEvidenceDigest(scope)) throw new Error("REPAIR_MEMORY_INVALID_SCOPE");
  validateProgramCandidateStructure(candidate);
  assertCodingRepairVerification(verification);
  if (verification.passed || !verification.failures.length || verification.artifactDigest !== codingRepairCandidateDigest(candidate)) {
    throw new Error("REPAIR_MEMORY_BASELINE_MISMATCH");
  }
  return sha256(canonicalJson({ schemaVersion: 1, scope, candidate,
    failures: verification.failures.map(f => f.fingerprint).sort() }));
}
function validateRecords(value: unknown): asserts value is Recipe[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error("REPAIR_MEMORY_INVALID_RECORDS");
  const keys = new Set<string>();
  for (const r of value as Recipe[]) {
    if (!r || Object.keys(r).sort().join() !== "changedLines,changes,evidenceDigests,id,key,quarantineDigest,verifiedArtifactDigest" ||
        !isEvidenceDigest(r.key) || !isEvidenceDigest(r.id) || !isEvidenceDigest(r.verifiedArtifactDigest) || keys.has(r.key) ||
        (r.quarantineDigest !== null && !isEvidenceDigest(r.quarantineDigest)) ||
        !Number.isSafeInteger(r.changedLines) || r.changedLines < 1 || r.changedLines > LIMITS.deepChangedLines ||
        !Array.isArray(r.changes) || !r.changes.length || r.changes.length > LIMITS.deepFiles ||
        !Array.isArray(r.evidenceDigests) || !r.evidenceDigests.length || r.evidenceDigests.length > 256 ||
        !r.evidenceDigests.every(isEvidenceDigest) || Buffer.byteLength(canonicalJson(r)) > MAX_RECORD_BYTES) {
      throw new Error("REPAIR_MEMORY_INVALID_RECORD");
    }
    const paths = new Set<string>();
    for (const change of r.changes) {
      if (!change || Object.keys(change).sort().join() !== "expectedContentDigest,path,replacementText" ||
          typeof change.path !== "string" || !/^src\/[a-z0-9][a-z0-9._/-]*\.ts$/u.test(change.path) || change.path.includes("..") ||
          LIMITS.protectedPaths.some(p => change.path === p || change.path.startsWith(p)) || paths.has(change.path) ||
          !isEvidenceDigest(change.expectedContentDigest) || typeof change.replacementText !== "string" ||
          !change.replacementText.trim() || Buffer.byteLength(change.replacementText) > 16384) throw new Error("REPAIR_MEMORY_INVALID_CHANGE");
      paths.add(change.path);
    }
    if (r.id !== identity(r)) throw new Error("REPAIR_MEMORY_IDENTITY_MISMATCH");
    keys.add(r.key);
  }
}

// One bounded process-local cache with a fixed, context-independent structural validator.
// Every transaction still reads current bytes under the unchanged filesystem lock.
const recordSnapshots = new ExactByteSnapshotCache<Recipe[]>(text => {
  const state = JSON.parse(text);
  if (!state || state.schemaVersion !== 1 || Object.keys(state).sort().join() !== "digest,records,schemaVersion" ||
      sha256(canonicalJson(state.records)) !== state.digest) throw new Error("REPAIR_MEMORY_CORRUPT");
  validateRecords(state.records);
  return state.records;
});

// Bound and serialize only short local cache I/O, never model or verifier work.
// The existing filesystem lock still guards other processes and crash recovery.
type MemoryQueue = { tail: Promise<void>; pending: number };
const memoryQueues = new Map<string, MemoryQueue>();
let pendingMemoryOperations = 0;
async function withMemoryQueue<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const queue = memoryQueues.get(directory) ?? { tail: Promise.resolve(), pending: 0 };
  if (queue.pending >= 32 || pendingMemoryOperations >= 128) throw new Error("REPAIR_MEMORY_QUEUE_FULL");
  const previous = queue.tail;
  let release!: () => void;
  queue.tail = new Promise<void>(resolve => { release = resolve; });
  queue.pending++; pendingMemoryOperations++; memoryQueues.set(directory, queue);
  try { await previous; return await operation(); }
  finally {
    queue.pending--; pendingMemoryOperations--; release();
    if (queue.pending === 0) memoryQueues.delete(directory);
  }
}

/** Private bounded proposal store, never a PASS cache. Crash locks intentionally disable reuse. */
export class DurableCodingRepairMemory {
  readonly directory: string;
  constructor(stateDirectory: string) { this.directory = resolve(stateDirectory, "coding-repair-memory-v1"); }

  async #transaction<T>(write: boolean, action: (records: Recipe[]) => T): Promise<T> {
    return withMemoryQueue(this.directory, () => this.#filesystemTransaction(write, action));
  }
  async #filesystemTransaction<T>(write: boolean, action: (records: Recipe[]) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (await realpath(this.directory) !== this.directory) throw new Error("REPAIR_MEMORY_DIRECTORY_SYMLINK");
    const dir = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let lockHeld = false;
    let releaseLock = true;
    const lock = join(this.directory, "transaction.lock");
    const path = join(this.directory, "memory.json");
    let temporary: string | undefined;
    try {
      if (((await dir.stat()).mode & 0o077) !== 0) throw new Error("REPAIR_MEMORY_DIRECTORY_PERMISSIONS");
      try {
        await lstat(join(this.directory, "disabled"));
        throw new Error("REPAIR_MEMORY_DISABLED");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await mkdir(lock, { mode: 0o700 }); // No automatic stale-lock deletion or unlocked readers.
      lockHeld = true;
      await dir.sync();
      let records: Recipe[] = [];
      try {
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw new Error("REPAIR_MEMORY_FILE_BOUNDARY");
          const bytes = await readExactMemoryBytes(file, stat.size);
          records = recordSnapshots.decode(this.directory, bytes);
        } finally { await file.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const result = action(records);
      if (write) {
        validateRecords(records);
        const bytes = canonicalJson({ schemaVersion: 1, records, digest: sha256(canonicalJson(records)) });
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error("REPAIR_MEMORY_CAPACITY");
        temporary = join(this.directory, `pending-${randomUUID()}.json`);
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(bytes, "utf8"); await file.sync(); } finally { await file.close(); }
        // On an ambiguous durability failure retain the lock, disabling all future reads.
        releaseLock = false;
        await rename(temporary, path);
        temporary = undefined;
        await dir.sync();
        releaseLock = true;
      }
      return structuredClone(result);
    } finally {
      try {
        if (temporary) await unlink(temporary).catch(() => {});
        if (lockHeld && releaseLock) { await rmdir(lock); await dir.sync(); }
      } finally { await dir.close(); }
    }
  }

  async learn(input: { before: ProgramCandidateProposal; beforeVerification: ProgramVerificationResult;
    after: ProgramCandidateProposal; verification: ProgramVerificationResult; scope: string }): Promise<string> {
    input = structuredClone(input);
    const key = codingRepairMemoryKey(input.before, input.beforeVerification, input.scope);
    validateProgramCandidateStructure(input.after);
    assertCodingRepairVerification(input.verification);
    if (!input.verification.passed || input.verification.artifactDigest !== codingRepairCandidateDigest(input.after)) throw new Error("REPAIR_MEMORY_UNVERIFIED");
    if (input.before.files.length !== input.after.files.length) throw new Error("REPAIR_MEMORY_FILE_SET_CHANGED");
    const changes: CodingRepairProposal["changes"] = [];
    let count = 0;
    for (const old of input.before.files) {
      const next = input.after.files.find(f => f.path === old.path);
      if (!next) throw new Error("REPAIR_MEMORY_FILE_SET_CHANGED");
      if (old.content === next.content) continue;
      changes.push({ path: old.path, expectedContentDigest: sha256(old.content), replacementText: next.content });
      count += changedLines(old.content, next.content);
    }
    changes.sort((a, b) => a.path.localeCompare(b.path));
    const body: RecipeBody = { key, changes, changedLines: count, verifiedArtifactDigest: input.verification.artifactDigest };
    const record: Recipe = { ...body, id: identity(body), evidenceDigests: [...input.verification.evidenceDigests], quarantineDigest: null };
    validateRecords([record]);
    return this.#transaction(true, records => {
      const existing = records.find(r => r.key === key);
      if (existing) {
        if (existing.quarantineDigest) throw new Error("REPAIR_MEMORY_QUARANTINED");
        if (existing.id !== record.id) throw new Error("REPAIR_MEMORY_CONFLICT");
        return existing.id;
      }
      if (records.length >= MAX_RECORDS) throw new Error("REPAIR_MEMORY_CAPACITY");
      records.push(record);
      return record.id;
    });
  }

  async lookup(candidate: ProgramCandidateProposal, verification: ProgramVerificationResult,
    scope: string, strategy: "surgical" | "deep"): Promise<RepairMemoryHit | null> {
    candidate = structuredClone(candidate); verification = structuredClone(verification);
    const key = codingRepairMemoryKey(candidate, verification, scope);
    if (strategy !== "surgical" && strategy !== "deep") return null;
    return this.#transaction(false, records => {
      const r = records.find(record => record.key === key);
      if (!r || r.quarantineDigest) return null;
      const limit = strategy === "surgical" ? LIMITS.surgicalChangedLines : LIMITS.deepChangedLines;
      const count = r.changes.reduce((n, change) => n + changedLines(candidate.files.find(f => f.path === change.path)?.content ?? "", change.replacementText), 0);
      if (count !== r.changedLines || count > limit) return null;
      const proposal: CodingRepairProposal = { schemaVersion: 1, baseArtifactDigest: verification.artifactDigest,
        failureFingerprint: verification.failures[0].fingerprint, strategy, changes: structuredClone(r.changes),
        limitations: ["Exact-source learned repair; all current verification remains mandatory."] };
      validateCodingRepairProposal({ proposal, candidate, artifactDigest: verification.artifactDigest,
        failureFingerprints: new Set(verification.failures.map(f => f.fingerprint)), limits: LIMITS, expectedStrategy: strategy });
      const replacements = new Map(proposal.changes.map(c => [c.path, c.replacementText]));
      const after = { ...candidate, files: candidate.files.map(f => ({ ...f, content: replacements.get(f.path) ?? f.content })) };
      if (codingRepairCandidateDigest(after) !== r.verifiedArtifactDigest) throw new Error("REPAIR_MEMORY_RESULT_MISMATCH");
      return { key, id: r.id, verifiedArtifactDigest: r.verifiedArtifactDigest, proposal };
    });
  }

  async assertReusable(hit: RepairMemoryHit): Promise<void> {
    const { key, id, verifiedArtifactDigest } = hit;
    if (![key, id, verifiedArtifactDigest].every(isEvidenceDigest)) throw new Error("REPAIR_MEMORY_INVALID_HIT");
    await this.#transaction(false, records => {
      const record = records.find(r => r.key === key);
      if (!record || record.quarantineDigest !== null || record.id !== id || record.verifiedArtifactDigest !== verifiedArtifactDigest)
        throw new Error("REPAIR_MEMORY_REVOKED_DURING_RUN");
    });
  }

  async quarantine(key: string, failureDigest: string): Promise<void> {
    if (!isEvidenceDigest(key) || !isEvidenceDigest(failureDigest)) throw new Error("REPAIR_MEMORY_INVALID_QUARANTINE");
    try {
      await this.#transaction(true, records => {
        const record = records.find(r => r.key === key);
        if (!record) throw new Error("REPAIR_MEMORY_UNKNOWN_RECORD");
        record.quarantineDigest ??= failureDigest;
      });
    } catch (error) {
      // A quarantine that cannot commit must not silently become an eligible recipe
      // on the next job. Disable the entire optional store, including after restart.
      if (await realpath(this.directory) !== this.directory) throw error;
      try {
        const marker = await open(join(this.directory, "disabled"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await marker.sync(); } finally { await marker.close(); }
      } catch (markerError) { if ((markerError as NodeJS.ErrnoException).code !== "EEXIST") throw markerError; }
      const dir = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await dir.sync(); } finally { await dir.close(); }
      throw error;
    }
  }
}

/** No job ID: reuse may cross authorized jobs, but never owners, contracts, tests or runtimes. */
export async function codingRepairMemoryScope(ownerId: string, context: Parameters<CandidateGenerator["generate"]>[0]): Promise<string> {
  const paths = ["genome-lab.ts", "genome-lab-verifier.ts", "coding-repair-controller.ts", "coding-repair-policy.ts",
    "coding-repair-prompt.ts", "luna-coding-repair-model.ts", "adaptive-coding-repair-model.ts", "coding-repair-edits.ts", "model-router.ts", "reparodynamic-candidate-generator.ts", "coding-repair-memory.ts",
    "reusable-coding-candidate-generator.ts", "coding-repair-singleflight.ts", "repair-memory-snapshot.ts", "fresh-typecheck-host.ts", "experimental-compiler-cache.ts", "experimental-v5/coding-repair-verification.ts", "kernel.ts", "server.ts", "../package-lock.json"];
  const implementation = await Promise.all(paths.map(async path => [path, sha256(await readFile(new URL(path, import.meta.url), "utf8"))]));
  return sha256(canonicalJson({ schemaVersion: 1, ownerId, objective: context.objective,
    acceptanceCriteria: context.acceptanceCriteria, constitutionDigest: context.constitutionDigest,
    missingCapabilities: context.missingCapabilities, implementation,
    node: process.version, platform: process.platform, arch: process.arch }));
}
