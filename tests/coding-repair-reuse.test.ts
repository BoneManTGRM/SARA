import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DurableRepairReuseStore, RepairReuseSession, repairReuseScope } from "../src/coding-repair-reuse.ts";
import { createReparodynamicCandidateGenerator } from "../src/reparodynamic-candidate-generator.ts";
import { codingRepairCandidateDigest as digest } from "../src/experimental-v5/coding-repair-verification.ts";
import { sha256 } from "../src/canonical.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { ProgramCandidateProposal, CandidateGenerator } from "../src/types.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";

const scope = sha256("same contract, engine, dependencies, owner");
const context = { objective: "Return 42", acceptanceCriteria: ["42 is returned"], missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
function candidate(value = "41"): ProgramCandidateProposal {
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: "Reuse fixture", summary: "Fixture", limitations: [], files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: `export const value: number = ${value};\n` },
    { path: "tests/value.test.ts", content: 'import { value } from "../src/value.ts";\nif (value !== 42) throw new Error("acceptance");\n' },
  ] };
}
function result(c: ProgramCandidateProposal, passed = c.files[1].content.includes("42")): ProgramVerificationResult {
  return { passed, score: passed ? 1 : 0.8, artifactDigest: digest(c), failures: passed ? [] : [{ kind: "behavior", code: "WRONG_VALUE", file: "src/value.ts", line: 1, column: 1, severity: "medium", existedBeforeRepair: true, evidenceDigest: "e".repeat(64), fingerprint: "f".repeat(64) }], completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: [sha256(passed ? "pass" : "fail")] };
}
async function rootTest(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-reuse-test-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const request = () => ({ candidate: candidate(), verification: result(candidate()), strategy: "surgical" as const, cycle: 1, remainingCostUsd: 0.15 });
function model(counter: { calls: number }) {
  return { async propose(r: ReturnType<typeof request>) { counter.calls++; return { proposal: { schemaVersion: 1 as const, baseArtifactDigest: r.verification.artifactDigest, failureFingerprint: r.verification.failures[0].fingerprint, strategy: r.strategy, changes: [{ path: "src/value.ts", expectedContentDigest: sha256(r.candidate.files[1].content), replacementText: candidate("42").files[1].content }], limitations: [] }, inputTokens: 10, outputTokens: 5, accountedCostUsd: 0.001 }; } };
}
async function learned(root: string, capacity = 128) {
  const store = new DurableRepairReuseStore(root, capacity);
  await store.learn(candidate(), candidate("42"), result(candidate("42")), scope);
  return store;
}

test("durable exact repair survives store recreation and returned mutation", () => rootTest(async root => {
  await learned(root);
  const store = new DurableRepairReuseStore(root);
  const hit = await store.lookup(request(), scope); assert(hit);
  hit.proposal.changes[0].replacementText = "corrupt";
  assert.notEqual((await store.lookup(request(), scope))?.proposal.changes[0].replacementText, "corrupt");
}));
test("revocation survives restart, changed evidence labels, and relearning", () => rootTest(async root => {
  const store = await learned(root); const hit = (await store.lookup(request(), scope))!;
  await store.quarantine(hit.key, sha256("failed fresh verification"));
  const restarted = new DurableRepairReuseStore(root);
  assert.equal(await restarted.learn(candidate(), candidate("42"), { ...result(candidate("42")), evidenceDigests: ["9".repeat(64)] }, scope), "revoked");
  assert.equal(await restarted.lookup(request(), scope), null);
}));
test("source, protected tests, metadata and scope changes invalidate reuse", () => rootTest(async root => {
  const store = await learned(root);
  for (const c of [candidate("40"), { ...candidate(), summary: "new meaning" }, { ...candidate(), files: candidate().files.map(f => f.path.startsWith("tests/") ? { ...f, content: f.content + "// changed\n" } : f) }]) {
    assert.equal(await store.lookup({ ...request(), candidate: c, verification: result(c, false) }, scope), null);
  }
  assert.equal(await store.lookup(request(), sha256("different contract or engine")), null);
}));
test("unverified, partial, mismatched and protected-file repairs cannot be learned", () => rootTest(async root => {
  const store = new DurableRepairReuseStore(root);
  for (const v of [result(candidate()), { ...result(candidate("42")), artifactDigest: "0".repeat(64) }, { ...result(candidate("42")), completedChecks: [] }])
    await assert.rejects(store.learn(candidate(), candidate("42"), v, scope));
  const c = candidate("42"); c.files[2].content += "// modified\n";
  await assert.rejects(store.learn(candidate(), c, result(c), scope));
  await assert.rejects(store.learn(candidate(), candidate(), result(candidate(), true), scope));
}));
test("capacity never evicts identities or revocations", () => rootTest(async root => {
  const store = await learned(root, 1);
  assert.equal(await store.learn(candidate("40"), candidate("42"), result(candidate("42")), scope), "capacity");
  assert(await store.lookup(request(), scope));
}));
test("corrupted, oversized and symlinked records fail closed", () => rootTest(async root => {
  await learned(root); const directory = join(root, "coding-repair-reuse-v1");
  const path = join(directory, (await readdir(directory)).find(f => f.endsWith(".json"))!);
  const saved = await readFile(path);
  for (const text of ["{bad", "x".repeat(131073), saved.toString().replace("42", "43")]) {
    await writeFile(path, text);
    await assert.rejects(new DurableRepairReuseStore(root).lookup(request(), scope));
  }
  await rm(path); await writeFile(join(root, "outside"), saved); await symlink(join(root, "outside"), path);
  await assert.rejects(new DurableRepairReuseStore(root).lookup(request(), scope));
}));
test("an interrupted lock does not reactivate a record", () => rootTest(async root => {
  const store = await learned(root); await mkdir(join(root, "coding-repair-reuse-v1", ".lock"));
  await assert.rejects(store.lookup(request(), scope), /REUSE_STORE_BUSY/);
}));
test("concurrent writers produce at most one complete record", () => rootTest(async root => {
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => new DurableRepairReuseStore(root).learn(candidate(), candidate("42"), result(candidate("42")), scope)));
  assert(attempts.some(x => x.status === "fulfilled"));
  assert.equal((await readdir(join(root, "coding-repair-reuse-v1"))).filter(f => f.endsWith(".json")).length, 1);
  assert(await new DurableRepairReuseStore(root).lookup(request(), scope));
}));
test("scope binds semantics without importing recalled memories or diagnostic answers", async () => {
  const a = await repairReuseScope(context, "owner-proposal");
  assert.notEqual(a, await repairReuseScope({ ...context, objective: "different" }, "owner-proposal"));
  assert.notEqual(a, await repairReuseScope({ ...context, constitutionDigest: "c".repeat(64) }, "owner-proposal"));
  assert.notEqual(a, await repairReuseScope(context, "other-proposal-source"));
  assert.equal(a, await repairReuseScope({ ...context, memoryContext: { ...context.memoryContext, contextDigest: "d".repeat(64) } }, "owner-proposal"));
});
test("CANARY learns once and avoids the next model call but retains every fresh check", () => rootTest(async root => {
  const counter = { calls: 0 }; let verifications = 0; const events: unknown[] = [];
  const verify = async (c: ProgramCandidateProposal) => { verifications++; return result(c); };
  const base: CandidateGenerator = { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() };
  for (let i = 0; i < 2; i++) {
    const generator = createReparodynamicCandidateGenerator({ base, mode: "canary", model: model(counter), verify,
      reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async e => { events.push(e); }) });
    assert.deepEqual(await generator.generate(context), candidate("42"));
  }
  assert.equal(counter.calls, 1); assert.equal(verifications, 6);
  assert(events.some(e => (e as { event: string }).event === "recipe_hit"));
}));
test("OFF and SHADOW never activate reuse or change existing semantics", () => rootTest(async root => {
  for (const mode of ["off", "shadow"] as const) {
    let reused = false; const counter = { calls: 0 };
    const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode,
      model: model(counter), verify: async c => result(c), reuse: async () => { reused = true; throw new Error("must not run"); } });
    assert.deepEqual(await generator.generate(context), candidate()); assert.equal(reused, false);
  }
}));
test("a stale recipe is quarantined before bounded model fallback", () => rootTest(async root => {
  await learned(root); const counter = { calls: 0 }; let checks = 0;
  const verify = async (c: ProgramCandidateProposal) => { checks++; return result(c, checks === 2 ? false : c.files[1].content.includes("42")); };
  const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model(counter), verify,
    reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async () => {}) });
  // Existing duplicate-proposal policy may stop a repeated fallback. It must never reactivate the revoked recipe.
  await generator.generate(context);
  assert(counter.calls > 0); assert.equal(await new DurableRepairReuseStore(root).lookup(request(), scope), null);
}));
test("failed mandatory reuse telemetry never triggers a paid fallback", () => rootTest(async root => {
  await learned(root); const counter = { calls: 0 }; const verify = async (c: ProgramCandidateProposal) => result(c);
  const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model(counter), verify,
    reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async () => { throw new Error("disk failed"); }) });
  await assert.rejects(generator.generate(context), /disk failed/); assert.equal(counter.calls, 0);
}));
test("actual isolated verifier accepts a reused repair and still rejects changed behavior", () => rootTest(async root => {
  const counter = { calls: 0 }; let checks = 0;
  const verify = async (c: ProgramCandidateProposal) => { checks++; return verifyGenomeLabProgramCandidate({ candidate: c, ...context }); };
  for (let i = 0; i < 2; i++) {
    const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model(counter), verify,
      reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async () => {}) });
    const completed = await generator.generate(context) as ProgramCandidateProposal;
    assert((await verify(completed)).passed); // Represents the separate kernel-side verification.
  }
  assert.equal(counter.calls, 1); assert.equal(checks, 8);
  assert.equal((await verify(candidate("40"))).passed, false);
}));
test("revocation is not blocked by another active store lock", () => rootTest(async root => {
  const store = await learned(root), hit = (await store.lookup(request(), scope))!;
  await mkdir(join(root, "coding-repair-reuse-v1", ".lock"));
  await store.quarantine(hit.key, sha256("failed"));
  assert(await new DurableRepairReuseStore(root).isQuarantined(hit.key));
}));
test("a failed independent final verification never learns or returns a repair", () => rootTest(async root => {
  const counter = { calls: 0 }; let checks = 0;
  const verify = async (c: ProgramCandidateProposal) => result(c, ++checks === 3 ? false : c.files[1].content.includes("42"));
  let persisted = false;
  const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model(counter), verify,
    onRun: () => { persisted = true; }, reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async () => {}) });
  await assert.rejects(generator.generate(context), /REUSE_FINAL_VERIFICATION_FAILED/);
  assert.equal(persisted, false); assert.equal(await new DurableRepairReuseStore(root).lookup(request(), scope), null);
}));
test("failed durable run persistence prevents recipe learning", () => rootTest(async root => {
  const verify = async (c: ProgramCandidateProposal) => result(c);
  const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model({ calls: 0 }), verify,
    onRun: () => { throw new Error("receipt failed"); }, reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async () => {}) });
  await assert.rejects(generator.generate(context), /receipt failed/);
  assert.equal(await new DurableRepairReuseStore(root).lookup(request(), scope), null);
}));
test("corrupt optional reuse falls back once without laundering the bad entry", () => rootTest(async root => {
  await learned(root); const directory = join(root, "coding-repair-reuse-v1");
  const path = join(directory, (await readdir(directory)).find(f => f.endsWith(".json"))!); await writeFile(path, "{corrupt");
  const counter = { calls: 0 }, events: string[] = [], verify = async (c: ProgramCandidateProposal) => result(c);
  const generator = createReparodynamicCandidateGenerator({ base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() }, mode: "canary", model: model(counter), verify,
    reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async e => { events.push(e.event); }) });
  assert.deepEqual(await generator.generate(context), candidate("42")); assert.equal(counter.calls, 1);
  assert(events.includes("reuse_unavailable_model_fallback")); assert.equal(await readFile(path, "utf8"), "{corrupt");
}));
test("symlinked storage directories and malformed capacity are rejected", () => rootTest(async root => {
  const outside = join(root, "outside"); await mkdir(outside); await symlink(outside, join(root, "coding-repair-reuse-v1"));
  await assert.rejects(new DurableRepairReuseStore(root).lookup(request(), scope), /REUSE_STORE_SYMLINK/);
  for (const cap of [0, -1, 129, NaN, Infinity, 0.5]) assert.throws(() => new DurableRepairReuseStore(root, cap));
}));

test("concurrent warm lookups across store instances retain every eligible hit", () => rootTest(async root => {
  await learned(root);
  const hits = await Promise.all(Array.from({ length: 12 }, () => new DurableRepairReuseStore(root).lookup(request(), scope)));
  assert.equal(hits.filter(Boolean).length, 12);
}));
test("concurrent warm sessions do not invoke generation merely because storage is busy", () => rootTest(async root => {
  await learned(root); const counter = { calls: 0 };
  const proposals = await Promise.all(Array.from({ length: 8 }, async () => {
    const session = new RepairReuseSession(new DurableRepairReuseStore(root), scope, async c => result(c), async () => {});
    return session.propose(request(), model(counter));
  }));
  assert.equal(counter.calls, 0);
  assert(proposals.every(p => p.accountedCostUsd === 0 && p.inputTokens === 0 && p.outputTokens === 0));
}));
test("concurrent local learning queues without dropping writers or changing identity", () => rootTest(async root => {
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => new DurableRepairReuseStore(root).learn(candidate(), candidate("42"), result(candidate("42")), scope)));
  assert.equal(outcomes.filter(x => x === "stored").length, 1);
  assert.equal(outcomes.filter(x => x === "existing").length, 7);
  assert(await new DurableRepairReuseStore(root).lookup(request(), scope));
}));
for (const boundary of ["persist_run", "run_finished"] as const) {
  test(`quarantine during ${boundary} cannot return a reused champion`, () => rootTest(async root => {
    const store = await learned(root), hit = (await store.lookup(request(), scope))!;
    const counter = { calls: 0 }, verify = async (c: ProgramCandidateProposal) => result(c);
    const revoke = () => store.quarantine(hit.key, sha256(`revoked at ${boundary}`));
    const generator = createReparodynamicCandidateGenerator({
      base: { id: "fixture", external: false, maximumCostUsd: 0, generate: async () => candidate() },
      mode: "canary", model: model(counter), verify,
      onRun: async () => { if (boundary === "persist_run") await revoke(); },
      reuse: async () => new RepairReuseSession(store, scope, verify, async event => {
        if (boundary === "run_finished" && event.event === "run_finished") await revoke();
      }),
    });
    await assert.rejects(generator.generate(context), /REUSE_REVOKED_DURING_RUN/);
    assert.equal(counter.calls, 0);
    assert(await store.isQuarantined(hit.key));
  }));
}

test("local queue overload is bounded and releases its capacity after settlement", () => rootTest(async root => {
  const store = await learned(root);
  const observations = await Promise.allSettled(Array.from({ length: 33 }, () => new DurableRepairReuseStore(root).lookup(request(), scope)));
  assert.equal(observations.filter(r => r.status === "fulfilled" && r.value !== null).length, 32);
  const failures = observations.filter(r => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(failures.length, 1); assert.match(String(failures[0].reason), /REUSE_QUEUE_FULL/);
  assert(await store.lookup(request(), scope));
}));
test("corrupt-entry rejection releases the local queue for a different valid entry", () => rootTest(async root => {
  const store = await learned(root), corruptHit = (await store.lookup(request(), scope))!;
  const other = candidate("40");
  await store.learn(other, candidate("42"), result(candidate("42")), scope);
  await writeFile(join(root, "coding-repair-reuse-v1", `${corruptHit.key}.json`), "{broken");
  const settled = await Promise.allSettled([
    store.lookup(request(), scope),
    new DurableRepairReuseStore(root).lookup({ ...request(), candidate: other, verification: result(other, false) }, scope),
  ]);
  assert.equal(settled[0].status, "rejected");
  assert(settled[1].status === "fulfilled" && settled[1].value !== null);
}));
test("queued work never steals an interrupted on-disk lock", () => rootTest(async root => {
  const store = await learned(root), lock = join(root, "coding-repair-reuse-v1", ".lock");
  await mkdir(lock);
  const settled = await Promise.allSettled(Array.from({ length: 4 }, () => store.lookup(request(), scope)));
  assert(settled.every(r => r.status === "rejected" && /REUSE_STORE_BUSY/u.test(String(r.reason))));
  assert((await readdir(join(root, "coding-repair-reuse-v1"))).includes(".lock"));
  // Explicit test-only operator cleanup, never performed by the implementation.
  await rm(lock, { recursive: true });
  assert(await store.lookup(request(), scope));
}));
