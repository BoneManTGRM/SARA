import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { verifyGenomeLabArtifact } from "../src/genome-lab.ts";
import { sha256 } from "../src/canonical.ts";
import { candidate } from "./helpers/repair-memory-fixture.ts";

const token = "kernel-preview-safety-local-fixture";
type Preview = (proposal: ReturnType<typeof candidate>) => void;
async function fixture(run: (root: string, kernel: SaraKernel) => Promise<void>, workers: 0 | 2 = 0) {
  const root = await mkdtemp(join(tmpdir(), "sara-kernel-preview-safety-"));
  const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256: sha256(token), selfBuildVerificationWorkers: workers });
  try { await run(root, kernel); }
  finally { await kernel.closeVerificationWorkers(); await rm(root, { recursive: true, force: true }); }
}
function generator(generateWithPreview: (_context: unknown, preview: Preview) => Promise<ReturnType<typeof candidate>>) {
  return { id: "preview-safety-generator", external: false, maximumCostUsd: 0,
    generate: async () => { throw new Error("preview-capable generator used wrong entry point"); }, generateWithPreview };
}
async function job(kernel: SaraKernel) {
  return kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Return the accepted fixture value",
    acceptanceCriteria: ["Value equals 17"], requiredCapabilities: [], expectedOwnerValue: 1, maximumBudgetUsd: 0 });
}
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 15_000;
  while (!predicate() && performance.now() < deadline) await delay(5);
  assert(predicate(), label);
}
async function noAcceptedArtifacts(root: string, kernel: SaraKernel, jobId: string) {
  const status = await kernel.getStatus();
  assert.equal(status.mutations.length, 0);
  assert.equal(status.jobs.find(j => j.id === jobId)?.status, "failed");
  assert.deepEqual(await readdir(join(root, "genome-lab")), []);
  assert.equal((await kernel.inspectAudit()).filter(event => event.type === "self_build_cycle_completed").length, 0);
}

for (const workers of [0, 2] as const) for (const resume of [false, true]) {
  test(`preview mode ${workers} rejects stop${resume ? " and resume" : ""} while generation is held after successful verification`, () => fixture(async (root, kernel) => {
    const j = await job(kernel), owner = kernel.authenticateOwnerToken(token);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const pending = kernel.runSelfBuildCycle(owner, j.id, generator(async (_context, preview) => {
      preview(candidate(true)); await held; return candidate(true);
    })).then(value => ({ value }), error => ({ error }));
    try {
      await until(() => kernel.previewVerificationWorkerStatus()?.completed === 1, "preview must complete while generator remains pending");
      assert.equal((await kernel.getStatus()).mutations.length, 0);
      await kernel.setEmergencyStop(owner, true);
      if (resume) await kernel.setEmergencyStop(owner, false);
    } finally { release(); }
    const result = await pending; assert("error" in result);
    await noAcceptedArtifacts(root, kernel, j.id);
  }, workers));
}

for (const workers of [0, 2] as const) {
  test(`successful preview cannot authorize incorrect returned source in mode ${workers}`, () => fixture(async (root, kernel) => {
    const j = await job(kernel);
    await assert.rejects(kernel.runSelfBuildCycle(kernel.authenticateOwnerToken(token), j.id, generator(async (_context, preview) => {
      preview(candidate(true));
      await until(() => kernel.previewVerificationWorkerStatus()?.completed === 1, "preview must pass before bad final proposal");
      return candidate(false);
    })));
    assert.equal(kernel.previewVerificationWorkerStatus()?.completed, 1);
    await noAcceptedArtifacts(root, kernel, j.id);
  }, workers));
}

test("preview captures immutable bytes before the generator mutates its retained object", () => fixture(async (root, kernel) => {
  const j = await job(kernel), retained = candidate(true);
  const result = await kernel.runSelfBuildCycle(kernel.authenticateOwnerToken(token), j.id, generator(async (_context, preview) => {
    preview(retained);
    retained.files[1].content = candidate(false).files[1].content;
    retained.limitations.push("mutated by generator after preview");
    await until(() => kernel.previewVerificationWorkerStatus()?.completed === 1, "detached preview must pass");
    return candidate(true);
  }));
  assert.equal(result.job.status, "verified");
  assert.equal(await readFile(join(root, result.artifactRelativePath, "project/src/value.ts"), "utf8"), candidate(true).files[1].content);
  assert.equal(kernel.previewVerificationWorkerStatus()?.submitted, 1);
  await verifyGenomeLabArtifact(root, result.artifactRelativePath, result.mutation.candidateDigest);
}));

test("returning the retained object after mutation cannot reuse the earlier successful preview", () => fixture(async (root, kernel) => {
  const j = await job(kernel), retained = candidate(true);
  await assert.rejects(kernel.runSelfBuildCycle(kernel.authenticateOwnerToken(token), j.id, generator(async (_context, preview) => {
    preview(retained);
    await until(() => kernel.previewVerificationWorkerStatus()?.completed === 1, "preview must pass before mutation");
    retained.files[1].content = candidate(false).files[1].content;
    return retained;
  })));
  await noAcceptedArtifacts(root, kernel, j.id);
}));

test("repeated and post-acceptance preview callbacks cannot submit extra work or replace the accepted candidate", () => fixture(async (root, kernel) => {
  const j = await job(kernel); let retainedPreview!: Preview;
  const result = await kernel.runSelfBuildCycle(kernel.authenticateOwnerToken(token), j.id, generator(async (_context, preview) => {
    retainedPreview = preview;
    preview(candidate(true)); preview(candidate(false)); preview(candidate(true));
    return candidate(true);
  }));
  const before = kernel.previewVerificationWorkerStatus();
  assert.equal(before?.submitted, 1); assert.equal(before?.completed, 1);
  retainedPreview(candidate(false)); retainedPreview(candidate(true));
  await delay(0);
  assert.deepEqual(kernel.previewVerificationWorkerStatus(), before);
  assert.equal((await kernel.getStatus()).mutations.length, 1);
  assert.equal((await readdir(join(root, "genome-lab"))).length, 1);
  await verifyGenomeLabArtifact(root, result.artifactRelativePath, result.mutation.candidateDigest);
}));

test("post-failure callbacks cannot resurrect a drained successful preview", () => fixture(async (root, kernel) => {
  const j = await job(kernel); let retainedPreview!: Preview;
  await assert.rejects(kernel.runSelfBuildCycle(kernel.authenticateOwnerToken(token), j.id, generator(async (_context, preview) => {
    retainedPreview = preview; preview(candidate(true));
    await until(() => kernel.previewVerificationWorkerStatus()?.completed === 1, "preview must complete before generator failure");
    throw new Error("mandatory final generation failed");
  })), /mandatory final generation failed/);
  const before = kernel.previewVerificationWorkerStatus();
  retainedPreview(candidate(true)); await delay(0);
  assert.deepEqual(kernel.previewVerificationWorkerStatus(), before);
  await noAcceptedArtifacts(root, kernel, j.id);
}));
