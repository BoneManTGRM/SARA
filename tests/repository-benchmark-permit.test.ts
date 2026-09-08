import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import type { RepositoryEnvironment, RepositoryGenerator } from "../src/repository-executor.ts";
import { repositoryBenchmarkManifestBindings, validateRepositoryBenchmarkAuthorization,
  type RepositoryBenchmarkAuthorization, type RepositoryBenchmarkPermit, type RepositoryBenchmarkExecution } from "../src/repository-benchmark-permit.ts";

const environment: RepositoryEnvironment = { schemaVersion: 1, repository: "fixture/public", baseCommit: "a".repeat(40),
  image: "sha256:" + "b".repeat(64), publicTestCommand: ["true"], timeoutSeconds: 10 };
const environmentDigest = sha256(canonicalJson(environment));
function authorization(): RepositoryBenchmarkAuthorization {
  const benchmarkId = randomUUID();
  const registration: RepositoryBenchmarkAuthorization["registration"] = { schemaVersion: 1,
    attempts: Array.from({ length: 10 }, (_, i) => (["conventional", "reparodynamic"] as const).map(arm => ({
      attemptId: `task-${i}/${arm}`, environmentDigest,
      task: { instanceId: `task-${i}`, problemStatement: `Public issue ${i}`, arm, runId: `${benchmarkId}-${i}-${arm}` },
    }))).flat(),
    model: { name: "gpt-5.6-luna", reasoning: "medium", maximumInputTokens: 30000, maximumOutputTokens: 8000,
      maximumRequestsPerAttempt: 50, inputPriceTenthsMicros: 2, outputPriceTenthsMicros: 12 },
    spend: { totalMicros: 15600000, armMicros: 7800000, attemptMicros: 780000 },
    producerLimits: { maximumModelRequests: 50, maximumToolSteps: 200, maximumPublicTests: 6,
      maximumOutputBytes: 2 * 1024 * 1024, maximumWallMilliseconds: 1800000 },
  };
  return { registration, manifest: { schemaVersion: 1, benchmarkId, currentCanaryPercent: 0, maximumSpendUsd: 15.6,
    createdAt: "2026-09-08T00:00:00Z", caseIds: Array.from({ length: 10 }, (_, i) => `task-${i}`),
    bindings: { sourceCommit: "c".repeat(64), authorityDigest: "d".repeat(64), controllerDigest: "e".repeat(64),
      verifierDigest: "f".repeat(64), ...repositoryBenchmarkManifestBindings(registration) } },
    async assertRuntimeAuthority() {}, // Offline fixture only: no configured production grant or provider.
  };
}
async function fixture(fn: (input: { kernel: SaraKernel; config: RepositoryBenchmarkAuthorization; jobId: string; directory: string;
  owner: ReturnType<SaraKernel["authenticateOwnerToken"]>; approval: { registrationDigest: string; authorityDigest: string }; revoke(): void }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "repository-permit-"));
  const config = authorization(); let revoked = false;
  config.assertRuntimeAuthority = async () => { if (revoked) throw Error("FIXTURE_GRANT_REVOKED"); };
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256("fixture-owner"),
    repositoryEnvironments: [environment], repositoryBenchmarkAuthorization: config });
  try {
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Isolated repository benchmark fixture", expectedOwnerValue: 1,
      acceptanceCriteria: ["Preserve owner authority"], maximumBudgetUsd: 0, requiredCapabilities: ["repository-patch"] });
    await fn({ kernel, config, directory, jobId: job.id, owner: kernel.authenticateOwnerToken("fixture-owner"),
      approval: { registrationDigest: config.manifest.bindings.policyDigest, authorityDigest: config.manifest.bindings.authorityDigest },
      revoke() { revoked = true; } });
  } finally { await kernel.closeVerificationWorkers(); await rm(directory, { recursive: true, force: true }); }
}
const generator: RepositoryGenerator = { id: "offline-permit-fixture", external: true, maximumCostUsd: .78,
  async generate() { throw Error("FIXTURE_NO_PROVIDER_OR_DOCKER"); } };

test("registration fixes all20 matched task/arm inputs, producer limits and finite caps", () => {
  const config = authorization(), environments = new Map([[environmentDigest, environment]]);
  validateRepositoryBenchmarkAuthorization(config, environments);
  for (const change of [
    (c: RepositoryBenchmarkAuthorization) => { c.registration.attempts.pop(); },
    (c: RepositoryBenchmarkAuthorization) => { c.registration.attempts[1]!.task.arm = "conventional"; },
    (c: RepositoryBenchmarkAuthorization) => { c.registration.attempts[1]!.task.problemStatement = "different issue"; },
    (c: RepositoryBenchmarkAuthorization) => { c.registration.spend.totalMicros = NaN; },
    (c: RepositoryBenchmarkAuthorization) => { c.registration.model.maximumRequestsPerAttempt++; },
    (c: RepositoryBenchmarkAuthorization) => { c.registration.producerLimits.maximumWallMilliseconds = Infinity; },
    (c: RepositoryBenchmarkAuthorization) => { c.registration.attempts[0]!.task.runId = "different-bound-run"; },
  ]) {
    const changed = { manifest: structuredClone(config.manifest), registration: structuredClone(config.registration), assertRuntimeAuthority: config.assertRuntimeAuthority };
    change(changed); assert.throws(() => validateRepositoryBenchmarkAuthorization(changed, environments));
  }
});
test("owner authentication and exact approval are required before durable claim", () => fixture(async ({ kernel, config, owner, approval, directory }) => {
  await assert.rejects(kernel.withRepositoryBenchmarkExecution({ id: "OWNER", kind: "owner", authenticated: true }, approval, async () => {}), /OWNER_REQUIRED/);
  await assert.rejects(kernel.withRepositoryBenchmarkExecution(owner, { ...approval, registrationDigest: "0".repeat(64) }, async () => {}), /APPROVAL_MISMATCH/);
  await assert.rejects(readFile(join(directory, "coding-repair-benchmarks", config.manifest.benchmarkId, "execution-claim.json")), /ENOENT/);
}));
test("permit cannot be forged, cloned, retargeted, reused or describe paid work as free", () => fixture(async ({ kernel, config, owner, approval, jobId, directory }) => {
  const first = config.registration.attempts[0]!;
  await kernel.withRepositoryBenchmarkExecution(owner, approval, async execution => {
    assert.equal(execution.evidenceDirectory, join(directory, "coding-repair-benchmarks", config.manifest.benchmarkId, "repository-trace"));
    assert.equal(Object.isFrozen(execution), true);
    const claim = JSON.parse(await readFile(join(directory, "coding-repair-benchmarks", config.manifest.benchmarkId, "execution-claim.json"), "utf8"));
    assert.equal(claim.reservedUsd, 15.6); assert.equal(claim.reservationStatus, "held_until_reconciled");
    const permit = await execution.permitFor(jobId, first.attemptId);
    await assert.rejects(execution.permitFor(jobId, first.attemptId), /CONSUMED_OR_UNKNOWN/);
    for (const fake of [{ permitId: "forged" }, structuredClone(permit)]) await assert.rejects(
      kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, first.task, generator, fake), /PERMIT_INVALID/);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest,
      config.registration.attempts[1]!.task, generator, permit), /PERMIT_MISMATCH/);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, first.task,
      { ...generator, external: false, maximumCostUsd: 0 }, permit), /PERMIT_MISMATCH/);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, first.task,
      { ...generator, maximumCostUsd: .79 }, permit), /PERMIT_MISMATCH/);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, first.task, generator, permit), /FIXTURE_NO_PROVIDER_OR_DOCKER/);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, first.task, generator, permit), /PERMIT_MISMATCH/);
  });
  await assert.rejects(kernel.withRepositoryBenchmarkExecution(owner, approval, async () => {}), /already claimed/);
  const issue = (await kernel.inspectAudit()).find(e => e.type === "repository_benchmark_permit_issued")!;
  assert.equal((issue.data as { maximumOwnerGrantExposureUsd: number }).maximumOwnerGrantExposureUsd, .78);
  assert.equal((issue.data as { actualCostKnown: boolean }).actualCostKnown, false);
}));
test("callback expiry invalidates issued permits and captured permit issuer", () => fixture(async ({ kernel, config, owner, approval, jobId }) => {
  let permit!: RepositoryBenchmarkPermit, retained!: RepositoryBenchmarkExecution;
  const attempt = config.registration.attempts[0]!;
  await kernel.withRepositoryBenchmarkExecution(owner, approval, async execution => { retained = execution; permit = await execution.permitFor(jobId, attempt.attemptId); });
  await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, attempt.task, generator, permit), /PERMIT_MISMATCH/);
  await assert.rejects(retained.permitFor(jobId, config.registration.attempts[1]!.attemptId), /EXECUTION_CLOSED/);
}));
test("grant revocation is rechecked before a generator action", () => fixture(async ({ kernel, config, owner, approval, jobId, revoke }) => {
  let afterBoundary = false;
  const attempt = config.registration.attempts[0]!;
  await kernel.withRepositoryBenchmarkExecution(owner, approval, async execution => {
    const permit = await execution.permitFor(jobId, attempt.attemptId);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, attempt.task, { ...generator,
      async generate(input) { revoke(); await input.beforeAction(); afterBoundary = true; throw Error("unreachable"); },
    }, permit), /FIXTURE_GRANT_REVOKED/);
  });
  assert.equal(afterBoundary, false);
}));
test("configured manifest alone grants nothing when runtime owner authority rejects", () => fixture(async ({ kernel, config, owner, approval, directory, revoke }) => {
  revoke(); let executed = false;
  await assert.rejects(kernel.withRepositoryBenchmarkExecution(owner, approval, async () => { executed = true; }), /FIXTURE_GRANT_REVOKED/);
  assert.equal(executed, false);
  await assert.rejects(readFile(join(directory, "coding-repair-benchmarks", config.manifest.benchmarkId, "execution-claim.json")), /ENOENT/);
}));
test("captured producer action boundary expires with its whole-run claim callback", () => fixture(async ({ kernel, config, owner, approval, jobId }) => {
  let captured!: () => Promise<void>;
  const attempt = config.registration.attempts[0]!;
  await kernel.withRepositoryBenchmarkExecution(owner, approval, async execution => {
    const permit = await execution.permitFor(jobId, attempt.attemptId);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, attempt.task, { ...generator,
      async generate(input) { captured = input.beforeAction; throw Error("FIXTURE_END"); },
    }, permit), /FIXTURE_END/);
  });
  await assert.rejects(captured(), /EXECUTION_CLOSED/);
}));
test("stop epoch remains invalid even after owner resumes", () => fixture(async ({ kernel, config, owner, approval, jobId }) => {
  const attempt = config.registration.attempts[0]!;
  await kernel.withRepositoryBenchmarkExecution(owner, approval, async execution => {
    const permit = await execution.permitFor(jobId, attempt.attemptId);
    await kernel.setEmergencyStop(owner, true); await kernel.setEmergencyStop(owner, false);
    await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, environmentDigest, attempt.task, generator, permit), /AUTHORITY_CHANGED/);
  });
}));
