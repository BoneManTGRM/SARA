import { canonicalJson, sha256 } from "../src/canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { codingRepairCandidateDigest, assertCodingRepairVerification } from "../src/experimental-v5/coding-repair-verification.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { ProgramVerificationResult, CodingRepairProposal } from "../src/coding-repair-types.ts";

export type Scope = { contract: string; dependencies: string; verifier: string; policy: string };
type Recipe = {
  id: string; key: string; changes: CodingRepairProposal["changes"]; changedLines: number;
  verifiedArtifactDigest: string; verificationEvidence: string[]; quarantineDigest: string | null;
};
const MAX_IDENTITIES = 32;
// Do not borrow the exported policy's mutable nested array as memory authority.
const limits = structuredClone(INITIAL_CODING_REPAIR_LIMITS);
Object.freeze(limits.protectedPaths);
Object.freeze(limits);
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function key(candidate: ProgramCandidateProposal, scope: Scope): string {
  if (!scope || typeof scope !== "object" || Object.keys(scope).length !== 4
      || !["contract", "dependencies", "verifier", "policy"].every(k => Object.hasOwn(scope, k))
      || !Object.values(scope).every(isDigest)) throw new Error("INVALID_RECIPE_SCOPE");
  return sha256(canonicalJson({ artifact: codingRepairCandidateDigest(candidate), scope }));
}
function lines(a: string, b: string): number {
  const left = a.split("\n"), right = b.split("\n");
  let result = Math.abs(left.length - right.length);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) result++;
  return result;
}

/**
 * In-memory, exact-source proof mechanism; never a substitute for fresh verification.
 * A repair ID binds its scope, before/after source and changes, NOT the evidence
 * label. Retained identities include superseded/quarantined recipes and are never
 * evicted to make a revoked repair usable again. At 32 identities learning stops.
 * These revocations live only as long as this memory instance; production use
 * would require a separately reviewed durable store, not a new instance per job.
 */
export class GuardedRepairMemory {
  readonly #records = new Map<string, Recipe>();
  readonly #active = new Map<string, string>();

  learn(before: ProgramCandidateProposal, after: ProgramCandidateProposal,
    verification: ProgramVerificationResult, scope: Scope): string {
    let verified: ProgramVerificationResult;
    try {
      assertCodingRepairVerification(verification);
      verified = structuredClone(verification);
      if (verified.passed !== true || verified.artifactDigest !== codingRepairCandidateDigest(after)) {
        throw new Error("UNVERIFIED_RECIPE");
      }
    } catch { throw new Error("UNVERIFIED_RECIPE"); }
    if (new Set(before.files.map(f => f.path)).size !== before.files.length
        || before.files.length !== after.files.length
        || new Set(after.files.map(f => f.path)).size !== after.files.length) throw new Error("RECIPE_FILE_SET_CHANGED");
    const changes: CodingRepairProposal["changes"] = [];
    let changedLines = 0;
    for (const old of before.files) {
      const next = after.files.find(f => f.path === old.path);
      if (!next) throw new Error("RECIPE_FILE_SET_CHANGED");
      if (old.content === next.content) continue;
      if (!/^src\/[a-z0-9][a-z0-9._/-]*\.ts$/u.test(old.path) || old.path.includes("..")
          || limits.protectedPaths.some(p => old.path === p || old.path.startsWith(p))) throw new Error("RECIPE_PROTECTED_PATH");
      if (!next.content.trim() || Buffer.byteLength(next.content) > 16384) throw new Error("RECIPE_SIZE");
      changes.push({ path: old.path, expectedContentDigest: sha256(old.content), replacementText: next.content });
      changedLines += lines(old.content, next.content);
    }
    if (!changes.length || changes.length > limits.deepFiles || changedLines > limits.deepChangedLines) {
      throw new Error("RECIPE_MUTATION_LIMIT");
    }
    const k = key(before, scope);
    changes.sort((a, b) => a.path.localeCompare(b.path));
    const identity = { schemaVersion: 2, key: k, changes, changedLines, verifiedArtifactDigest: verified.artifactDigest };
    const id = sha256(canonicalJson(identity));
    const previous = this.#records.get(id);
    if (!previous && this.#records.size >= MAX_IDENTITIES) throw new Error("RECIPE_CAPACITY");
    this.#records.set(id, {
      id, key: k, changes: structuredClone(changes), changedLines,
      verifiedArtifactDigest: verified.artifactDigest, verificationEvidence: [...verified.evidenceDigests],
      quarantineDigest: previous?.quarantineDigest ?? null,
    });
    this.#active.set(k, id);
    return id;
  }

  lookup(candidate: ProgramCandidateProposal, verification: ProgramVerificationResult,
    scope: Scope, strategy: "surgical" | "deep"): CodingRepairProposal | null {
    if (strategy !== "surgical" && strategy !== "deep") return null;
    const id = this.#active.get(key(candidate, scope));
    const recipe = id ? this.#records.get(id) : undefined;
    if (!recipe || recipe.quarantineDigest) return null;
    let verified: ProgramVerificationResult;
    try {
      assertCodingRepairVerification(verification);
      verified = structuredClone(verification);
    } catch { return null; }
    if (verified.passed !== false || !verified.failures.length || !verified.evidenceDigests.length
        || verified.artifactDigest !== codingRepairCandidateDigest(candidate)) return null;
    const maxFiles = strategy === "surgical" ? limits.surgicalFiles : limits.deepFiles;
    const maxLines = strategy === "surgical" ? limits.surgicalChangedLines : limits.deepChangedLines;
    if (recipe.changes.length > maxFiles || recipe.changedLines > maxLines) return null;
    return { schemaVersion: 1, baseArtifactDigest: verified.artifactDigest,
      failureFingerprint: verified.failures[0].fingerprint, strategy, changes: structuredClone(recipe.changes),
      limitations: ["Exact-source verified recipe; fresh verification is still mandatory."] };
  }

  quarantine(id: string, failureDigest: string): void {
    if (!isDigest(failureDigest)) throw new Error("INVALID_FAILURE_EVIDENCE");
    const record = this.#records.get(id);
    if (!record) throw new Error("UNKNOWN_RECIPE");
    record.quarantineDigest = failureDigest;
  }
  get size(): number { return this.#active.size; }
  get identityCount(): number { return this.#records.size; }
  snapshot(): readonly Recipe[] {
    return structuredClone([...this.#active.values()].map(id => this.#records.get(id)!));
  }
}
