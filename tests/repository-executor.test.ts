import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { repositoryBinding, validateRepositoryPatch, validateRepositoryEnvironment,
  type RepositoryEnvironment, type RepositoryTask } from "../src/repository-executor.ts";

const environment: RepositoryEnvironment = { schemaVersion: 1, repository: "example/public",
  baseCommit: "a".repeat(40), image: `sha256:${"b".repeat(64)}`, publicTestCommand: ["npm", "test"], timeoutSeconds: 10 };
const task: RepositoryTask = { instanceId: "public-1", problemStatement: "Repair the public calculation.", arm: "conventional", runId: "qualification-1" };
const patch = "diff --git a/src/a.ts b/src/a.ts\nindex 1111111..2222222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";

test("repository binding isolates arms, tasks, runs, commands and images", () => {
  const binding = repositoryBinding(environment, task);
  for (const changed of [{ ...task, arm: "reparodynamic" as const }, { ...task, runId: "qualification-2" }, { ...task, problemStatement: "Other" }]) {
    assert.notEqual(repositoryBinding(environment, changed).taskDigest, binding.taskDigest);
  }
  assert.notEqual(repositoryBinding(environment, { ...task, arm: "reparodynamic" }).memoryNamespace, binding.memoryNamespace);
  assert.notEqual(repositoryBinding({ ...environment, publicTestCommand: ["true"] }, task).environmentDigest, binding.environmentDigest);
  assert.throws(() => validateRepositoryEnvironment({ ...environment, image: "node:latest" }));
  assert.throws(() => repositoryBinding(environment, { ...task, runId: "../../shared" }));
  assert.throws(() => repositoryBinding(environment, { ...task, test_patch: "SECRET" } as RepositoryTask), /TASK_FIELDS/);
  assert.throws(() => repositoryBinding({ ...environment, referencePatch: "SECRET" } as RepositoryEnvironment, task), /ENVIRONMENT_FIELDS/);
});

test("repository patch refuses traversal, Git metadata, symlinks, submodules and binary encodings", () => {
  validateRepositoryPatch(patch);
  validateRepositoryPatch("");
  for (const path of ["../escape", ".git/config", "src/../../escape", "src//a.ts", "src/./a.ts", "src\\a.ts"]) {
    assert.throws(() => validateRepositoryPatch(patch.replaceAll("src/a.ts", path)), path);
  }
  for (const mode of ["120000", "160000"]) {
    assert.throws(() => validateRepositoryPatch(patch.replace("100644", mode)));
    assert.throws(() => validateRepositoryPatch(patch + `new file mode ${mode}\n`));
  }
  assert.throws(() => validateRepositoryPatch(patch + "GIT binary patch\n"));
  assert.throws(() => validateRepositoryPatch(patch + "\0"));
});

async function withKernel(fn: (kernel: SaraKernel, jobId: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "sara-repository-test-"));
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256("repository-test-owner"), repositoryEnvironments: [environment] });
  try {
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Qualify repository verification", expectedOwnerValue: 1,
      requiredCapabilities: ["repository-patch"], acceptanceCriteria: ["Verify a frozen patch independently"], maximumBudgetUsd: 0 });
    await fn(kernel, job.id);
  } finally { await kernel.closeVerificationWorkers(); await rm(directory, { recursive: true, force: true }); }
}

test("kernel refuses unknown images and paid launch before calling producer", async () => withKernel(async (kernel, jobId) => {
  let calls = 0;
  const generator = { id: "qualification", external: false, maximumCostUsd: 0, async generate() { calls++; return { ...repositoryBinding(environment, task), patch }; } };
  await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, "c".repeat(64), task, generator), /NOT_QUALIFIED/);
  await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, sha256(canonicalJson(environment)), task, { ...generator, external: true }), /FRESH_PAID_GRANT_REQUIRED/);
  assert.equal(calls, 0);
}));

test("producer receives no shared memories; binding forgery fails without acceptance or promotion", async () => withKernel(async (kernel, jobId) => {
  await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, sha256(canonicalJson(environment)), task, {
    id: "qualification", external: false, maximumCostUsd: 0, async generate(input) {
      assert.deepEqual(Object.keys(input).sort(), ["environment", "environmentDigest", "memoryNamespace", "task", "taskDigest"].sort());
      return { environmentDigest: input.environmentDigest, taskDigest: "0".repeat(64), patch };
    },
  }), /BINDING_MISMATCH/);
  const audit = await kernel.inspectAudit();
  assert.ok(audit.some(e => e.type === "job_status_changed" && (e.data as {status: string}).status === "failed"));
  assert.ok(!audit.some(e => e.type === "repository_build_cycle_completed" || e.type === "mutation_created"));
}));

test("stop and resume during production revokes repository acceptance", async () => withKernel(async (kernel, jobId) => {
  const owner = kernel.authenticateOwnerToken("repository-test-owner");
  await assert.rejects(kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, jobId, sha256(canonicalJson(environment)), task, {
    id: "qualification", external: false, maximumCostUsd: 0, async generate(input) {
      await kernel.setEmergencyStop(owner, true);
      await kernel.setEmergencyStop(owner, false);
      return { environmentDigest: input.environmentDigest, taskDigest: input.taskDigest, patch };
    },
  }), /AUTHORITY_CHANGED/);
  assert.ok(!(await kernel.inspectAudit()).some(e => e.type === "repository_build_cycle_completed"));
}));
