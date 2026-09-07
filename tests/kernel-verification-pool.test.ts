import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { KernelVerificationPool } from "../src/kernel-verification-pool.ts";
import { verifyGenomeLabArtifact } from "../src/genome-lab.ts";
import { sha256 } from "../src/canonical.ts";
import { candidate } from "./helpers/repair-memory-fixture.ts";
import type { ExecutorHandoff } from "../src/handoff.ts";
const token = "kernel-worker-local-fixture";
async function fixture(fn: (root: string, kernel: SaraKernel) => Promise<void>, workers: 0 | 1 | 2 = 2) {
  const root = await mkdtemp(join(tmpdir(), "sara-kernel-worker-"));
  const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256: sha256(token), selfBuildVerificationWorkers: workers });
  try { await fn(root, kernel); }
  finally { await kernel.closeVerificationWorkers(); await rm(root, { recursive: true, force: true }); }
}
async function job(kernel: SaraKernel) { return kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
  objective: "Return correct bounded fixture", acceptanceCriteria: ["increment the input"], requiredCapabilities: [],
  expectedOwnerValue: 1, maximumBudgetUsd: 0,
}); }
function gen(proposal = candidate(true)) { return { id: "pool-fixture-generator", external: false, maximumCostUsd: 0,
  generate: async () => structuredClone(proposal) }; }
function handoff(): ExecutorHandoff { return { schemaVersion: 1, role: "sandboxed_coding_executor", jobId: randomUUID(),
  constitutionDigest: sha256("fixture"), objective: "fixture", acceptanceCriteria: ["correct"], missingCapabilities: [],
  maximumBudgetUsd: 0, prohibitedActions: [], requiredProcess: [], requiredOutput: [] }; }
for (const workers of [0, 1, 2] as const) {
  test(`kernel mode ${workers} retains fresh verification and timestamps after all acceptance events`, () => fixture(async (root, k) => {
    const j = await job(k); const started = performance.now();
    const result = await k.runSelfBuildCycle(k.authenticateOwnerToken(token), j.id, gen()); const elapsed = performance.now() - started;
    assert.equal(result.job.status, "verified"); assert.equal(result.mutation.stage, "SHADOW");
    assert.equal(result.evidence.attestation, "kernel_executed"); assert.equal(result.timing.pooled, workers > 0);
    assert(result.timing.totalMilliseconds > 0 && result.timing.totalMilliseconds <= elapsed);
    assert(result.timing.kernelVerificationMilliseconds > 0); assert(result.timing.acceptanceAndReceiptsMilliseconds > 0);
    const audit = await k.inspectAudit(); assert.equal(audit.at(-1)?.type, "self_build_cycle_completed");
    await verifyGenomeLabArtifact(root, result.artifactRelativePath, result.mutation.candidateDigest);
    await assert.rejects(k.runSelfBuildCycle(k.authenticateOwnerToken(token), j.id, gen()));
  }, workers));
}
test("two parallel kernel builds yield distinct artifacts and receipts, never a shared PASS", () => fixture(async (root, k) => {
  const jobs = await Promise.all(Array.from({ length: 4 }, () => job(k)));
  const results = await Promise.all(jobs.map(j => k.runSelfBuildCycle(k.authenticateOwnerToken(token), j.id, gen())));
  assert.equal(new Set(results.map(r => r.mutation.id)).size, 4); assert.equal(new Set(results.map(r => r.evidence.id)).size, 4);
  assert.equal(new Set(results.map(r => r.mutation.candidateDigest)).size, 1);
  assert.equal(k.verificationWorkerStatus()?.completed, 4);
  for (const r of results) await verifyGenomeLabArtifact(root, r.artifactRelativePath, r.mutation.candidateDigest);
}));
for (const workers of [0, 2] as const) for (const resume of [false, true]) {
  test(`emergency stop during mode ${workers} verification rejects acceptance${resume ? " even after resume" : ""}`, () => fixture(async (root, k) => {
    const j = await job(k); const owner = k.authenticateOwnerToken(token);
    const proposal = candidate(true);
    // Fault injection only: keep the isolated behavioral process alive long
    // enough to request stop after verification starts. Not a latency benchmark.
    if (!workers) proposal.files[2].content += '\nlet n=0;for(let i=0;i<500000000;i++){n++;}if(n!==500000000)throw new Error("fault fixture");\n';
    const pending = k.runSelfBuildCycle(owner, j.id, gen(proposal)).then(value => ({ value }), error => ({ error }));
    let started = false;
    for (let n = 0; n < 1000; n++) {
      if (workers) started = (k.verificationWorkerStatus()?.dispatched ?? 0) >= 1;
      else { try { started = (await readdir(join(root, "genome-lab"))).length > 0; } catch {} }
      if (started) break; await delay(2);
    }
    assert(started);
    await k.setEmergencyStop(owner, true); if (resume) await k.setEmergencyStop(owner, false);
    const result = await pending; assert("error" in result);
    const status = await k.getStatus(); assert.equal(status.mutations.length, 0); assert.equal(status.jobs.find(x => x.id === j.id)?.status, "failed");
    assert.deepEqual(await readdir(join(root, "genome-lab")), []);
  }, workers));
}
for (const fault of ["wrong behavior", "wrong type", "capability"]) {
  test(`pooled kernel rejects ${fault} without accepting an artifact`, () => fixture(async (_, k) => {
    const c = candidate(fault !== "wrong behavior");
    if (fault === "wrong type") c.files[1].content = 'export function value(input: number): number { return "wrong"; }';
    if (fault === "capability") c.files[1].content = 'export function value(input: number): number { return process.exit(0); }';
    const j = await job(k); await assert.rejects(k.runSelfBuildCycle(k.authenticateOwnerToken(token), j.id, gen(c)));
    assert.equal((await k.getStatus()).mutations.length, 0);
  }));
}
test("pending authority rejection never starts a worker build", () => fixture(async (root) => {
  const pool = new KernelVerificationPool(root, { concurrency: 1 });
  try {
    await assert.rejects(pool.verify({ handoff: handoff(), candidate: candidate(true), candidateId: randomUUID() }, async () => { throw Error("stop"); }));
    assert.equal(pool.snapshot().dispatched, 0);
  } finally { await pool.close(); }
}));
test("pool queue and caller deadline fail closed without retry or late acceptance", () => fixture(async root => {
  const pool = new KernelVerificationPool(root, { concurrency: 1, maximumQueued: 0, maximumWaitMs: 1 });
  try {
    const first = pool.verify({ handoff: handoff(), candidate: candidate(true), candidateId: randomUUID() });
    await assert.rejects(pool.verify({ handoff: handoff(), candidate: candidate(true), candidateId: randomUUID() }), /CAPACITY/);
    await assert.rejects(first, /DEADLINE/); await pool.close();
    assert.equal(pool.snapshot().completed, 0); assert.equal(pool.snapshot().dispatched, 1);
    assert.deepEqual(await readdir(join(root, "genome-lab")), []);
  } finally { await pool.close(); }
}));
test("worker input is detached from caller mutations across async admission", () => fixture(async root => {
  const pool = new KernelVerificationPool(root, { concurrency: 1 }); const c = candidate(true); const id = randomUUID();
  try {
    const result = await pool.verify({ handoff: handoff(), candidate: c, candidateId: id }, async () => { c.files[1].content = "process.exit(0)"; });
    const disk = await readFile(join(root, result.artifactRelativePath, "project", c.files[1].path), "utf8");
    assert.equal(disk, candidate(true).files[1].content);
  } finally { await pool.close(); }
}));
test("arbitrary verifier-worker counts cannot be enabled through boot", async () => {
  await assert.rejects(SaraKernel.boot({ stateDirectory: "/does-not-get-created", selfBuildVerificationWorkers: 8 as 2 }), /WORKERS_INVALID/);
});
