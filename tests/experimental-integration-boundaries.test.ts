import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimBenchmarkRun, type BenchmarkRunGrant } from "../proof/benchmark-run-admission.ts";
import { GuardedRepairMemory, type Scope } from "../proof/guarded-repair-memory.ts";
import { evaluatePair } from "../proof/v7-live-evaluation.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";
const scope: Scope = { contract: sha256("contract"), dependencies: sha256("deps"), verifier: sha256("verifier"), policy: sha256("policy") };
const before: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "fixture", summary: "offline", limitations: [], files: [{ path: "src/index.ts", content: "export const value = 0;" }] };
const after = structuredClone(before); after.files[0].content = "export const value = 1;";
const good: ProgramVerificationResult = { passed: true, score: 1, failures: [], completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: [sha256("evidence")], artifactDigest: sha256(canonicalJson({ schemaVersion: 1, files: after.files.map(f => ({ path: f.path, contentDigest: sha256(f.content) })) })) };
it("freezes an external grant before asynchronous ledger inspection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-grant-snapshot-"));
  const grant: BenchmarkRunGrant = { experimentId: "offline-integration", contractDigest: sha256("contract"), implementationCommit: "a".repeat(40), deploymentId: "12345678-1234-4234-8234-123456789012", expiresAt: 100, maximumPhysicalSpendUsd: 0.15 };
  const saved = structuredClone(grant);
  try {
    const pending = claimBenchmarkRun({ ledgerDirectory: directory, grant, observed: { ...grant }, now: 1 });
    grant.experimentId = "changed"; grant.maximumPhysicalSpendUsd = 999;
    await pending;
    const files = await readdir(directory); assert.equal(files.length, 1);
    const record = JSON.parse(await readFile(join(directory, files[0]), "utf8"));
    assert.equal(record.experimentId, saved.experimentId); assert.equal(record.maximumPhysicalSpendUsd, 0.15);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("the V8 consumed contract cannot be claimed by the old owner helper", async () => {
  const grant = { experimentId: "offline-v8", contractDigest: "5fabd97aeb58eaa82cbe87395b533fe1636d42fbb1acda6a513b185cddabdfc2", implementationCommit: "a".repeat(40), deploymentId: "12345678-1234-4234-8234-123456789012", expiresAt: 100, maximumPhysicalSpendUsd: 0.15 };
  await assert.rejects(claimBenchmarkRun({ ledgerDirectory: "/does-not-exist", grant, observed: { ...grant }, now: 1 }), /RETIRED/);
});
it("repair memory requires actual boolean success", () => {
  assert.throws(() => new GuardedRepairMemory().learn(before, after, { ...good, passed: "true" } as unknown as ProgramVerificationResult, scope), /UNVERIFIED/);
});
it("repair memory requires all four named scope bindings", () => {
  const changed = { ...scope } as unknown as Record<string, string>; delete changed.policy; changed.other = sha256("other");
  assert.throws(() => new GuardedRepairMemory().learn(before, after, good, changed as Scope), /SCOPE/);
});
it("repair memory cannot learn with malformed verification evidence", () => {
  assert.throws(() => new GuardedRepairMemory().learn(before, after, { ...good, evidenceDigests: [""] }, scope), /UNVERIFIED/);
});
it("historical evaluator refuses truthy malformed completion flags", () => {
  const arm = { verifiedComplete: "false", timeMs: 1, costUsd: 0, error: null };
  const evaluated = evaluatePair(arm as never, arm as never);
  assert.equal(evaluated.valid, false); assert.equal(evaluated.speedRatio, null);
});
