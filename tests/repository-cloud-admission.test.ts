import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { SaraKernel } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { REPOSITORY_COMPARISON_TASKS, prepareRepositoryComparisonPlan } from "../src/repository-comparison.ts";
import { repositoryBinding } from "../src/repository-executor.ts";
import { repositoryBenchmarkManifestBindings } from "../src/repository-benchmark-permit.ts";
import { repositoryCloudAuthorityDigest, repositoryCloudCodeBindings, validateRepositoryCloudPackage, type RepositoryCloudPackage } from "../src/repository-cloud-package.ts";
import { CLOUD_APPROVAL_KEY, CLOUD_PACKAGE_KEY, CLOUD_LAUNCH_KEY, prepareRepositoryCloudRuntime } from "../src/repository-cloud-runtime.ts";

function fixture(): RepositoryCloudPackage {
  const recipes = JSON.parse(readFileSync(new URL("../docs/benchmarks/swe-repository-recipes.json", import.meta.url), "utf8")).tasks;
  const tasks = REPOSITORY_COMPARISON_TASKS.map((t, i) => ({ instanceId: t.instanceId, problemStatement: "Public fixture, never an actual qualification",
    environment: { schemaVersion: 1 as const, repository: t.repository, baseCommit: t.baseCommit,
      image: `ghcr.io/bonemantgrm/sara-swe-public-fixture-${i}@sha256:${"a".repeat(64)}`, publicTestCommand: recipes[i].publicTestCommand, timeoutSeconds: 900 } }));
  const producerLimits = { maximumModelRequests: 50, maximumToolSteps: 200, maximumPublicTests: 6, maximumOutputBytes: 2097152, maximumWallMilliseconds: 1800000 };
  const runId = "fixture", plan = prepareRepositoryComparisonPlan({ runId, tasks, limits: producerLimits });
  const registration = { schemaVersion: 1 as const, attempts: plan.requests.map((r, i) => ({ attemptId: `attempt-${i}`, task: r.task,
    environmentDigest: repositoryBinding(r.environment, r.task).environmentDigest })), producerLimits,
    model: { name: "gpt-5.6-luna" as const, reasoning: "medium" as const, maximumInputTokens: 30000, maximumOutputTokens: 8000,
      maximumRequestsPerAttempt: 50, inputPriceTenthsMicros: 2, outputPriceTenthsMicros: 12 }, spend: { totalMicros: 15600000, armMicros: 7800000, attemptMicros: 780000 } };
  const benchmarkId = "8fa0e5f3-d945-4f68-9653-038bcdf545f0", bindings = repositoryBenchmarkManifestBindings(registration);
  const permit = { schemaVersion: 1 as const, benchmarkId, registrationDigest: bindings.policyDigest, runtimeRevision: "b".repeat(40),
    workflowRevision: "b".repeat(40), workflowRef: "refs/heads/run/swe-cloud-fixture", notBefore: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const judges = tasks.map(t => ({ environmentDigest: sha256(canonicalJson(t.environment)), datasetPath: "/worker/judge.parquet", harnessPath: "/worker/harness", image: `swebench/fixture@sha256:${"c".repeat(64)}` }));
  const qualifications = tasks.map(t => ({ instanceId: t.instanceId, environmentDigest: sha256(canonicalJson(t.environment)), publicProofDigest: "d".repeat(64), controlProofDigest: "e".repeat(64) }));
  return { schemaVersion: 1, runId, tasks, registration, judges, qualifications, permit,
    manifest: { schemaVersion: 1, benchmarkId, bindings: { ...bindings, ...repositoryCloudCodeBindings(), sourceCommit: permit.runtimeRevision,
      authorityDigest: repositoryCloudAuthorityDigest({ registration, permit, judges, qualifications }) }, maximumSpendUsd: 15.6,
      currentCanaryPercent: 5, caseIds: tasks.map(t => t.instanceId), createdAt: new Date().toISOString() } };
}
test("cloud package validates the frozen plan and rejects image, source, cap and test substitutions", () => {
  const p = fixture(); validateRepositoryCloudPackage(p);
  const mutations = [(q: RepositoryCloudPackage) => { q.tasks[0]!.environment.publicTestCommand = ["true"]; },
    (q: RepositoryCloudPackage) => { q.registration.spend.totalMicros++; },
    (q: RepositoryCloudPackage) => { q.permit.runtimeRevision = "f".repeat(40); },
    (q: RepositoryCloudPackage) => { q.qualifications[0]!.environmentDigest = "f".repeat(64); },
    (q: RepositoryCloudPackage) => { q.registration.attempts.pop(); },
    (q: RepositoryCloudPackage) => { q.judges[0]!.image = "swebench/fixture:latest"; }];
  for (const mutate of mutations) { const q = structuredClone(p); mutate(q); assert.throws(() => validateRepositoryCloudPackage(q)); }
});
test("an exact fixture approval cannot turn disposable storage into durable execution authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-admission-"));
  try {
    const p = fixture(), ownerToken = "cloud-fixture-owner", env: Record<string, string | undefined> = {
      [CLOUD_PACKAGE_KEY]: canonicalJson(p), [CLOUD_APPROVAL_KEY]: sha256(canonicalJson(p)), RAILWAY_GIT_COMMIT_SHA: p.permit.runtimeRevision,
      OPENAI_API_KEY: "fixture-never-dispatched", SARA_OWNER_TOKEN: ownerToken, SARA_OWNER_TOKEN_SHA256: sha256(ownerToken) };
    const runtime = (await prepareRepositoryCloudRuntime({ stateDirectory: directory, environment: env }))!;
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(ownerToken), ...runtime.kernelOptions }); runtime.bindKernel(kernel);
    assert.deepEqual(await runtime.launchConfigured(), { status: "not_requested" }, "approval alone cannot launch");
    env[CLOUD_LAUNCH_KEY] = "0".repeat(64); await assert.rejects(runtime.launchConfigured(), /BOOT_LAUNCH_MISMATCH/);
    env[CLOUD_LAUNCH_KEY] = sha256(canonicalJson(p));
    await assert.rejects(runtime.launchConfigured(), /PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE/);
    const ready = await runtime.readiness(); assert.equal(ready.ready, false);
    assert.ok(ready.blockers.includes("PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE"));
    await assert.rejects(runtime.launch(kernel.authenticateOwnerToken(ownerToken), { packageDigest: ready.packageDigest,
      registrationDigest: ready.registrationDigest, authorityDigest: ready.authorityDigest }), /PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE/);
    assert.ok(!(await readdir(directory)).includes("coding-repair-benchmarks"), "no execution claim or budget was initialized");
    await kernel.closeVerificationWorkers();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("the existing HTTP server keeps worker credentials out of owner routes and defaults to disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-http-")), token = "cloud-http-owner";
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(token) });
  const server = createSaraServer(kernel, { stateDirectory: directory, ownerTokenSha256: sha256(token) });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    for (const path of ["readiness", "run", "result"]) {
      const r = await fetch(`${base}/api/repository-benchmark/${path}`, { method: path === "run" ? "POST" : "GET", headers: { authorization: "Bearer fixture-worker-oidc" } });
      assert.equal(r.status, 401);
    }
    const worker = await fetch(`${base}/api/repository-benchmark/worker`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
    assert.equal(worker.status, 403, "even an owner token is not a worker identity");
    const ready = await fetch(`${base}/api/repository-benchmark/readiness`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ready.status, 423); assert.equal(((await ready.json()) as { ready: boolean }).ready, false);
    assert.equal(await prepareRepositoryCloudRuntime({ stateDirectory: directory, environment: {} }), undefined);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await kernel.closeVerificationWorkers(); await rm(directory, { recursive: true, force: true }); }
});
