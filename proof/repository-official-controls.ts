import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { repositoryBinding, type RepositoryEnvironment, type RepositoryTask } from "../src/repository-executor.ts";
import { sha256 } from "../src/canonical.ts";

// Judge-only reference controls, never SARA solutions or paid producer inputs.
const [inputPath, output] = process.argv.slice(2);
if (!inputPath || !output) throw new Error("Judge control input and output required");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const environment = input.environment as RepositoryEnvironment;
await mkdir(output, { recursive: true });
const rows = [];
for (const label of ["base", "reference"] as const) {
  const stateDirectory = join(output, label);
  const task: RepositoryTask = { instanceId: input.task.instance_id, problemStatement: input.task.problem_statement,
    arm: "conventional", runId: `official-control-${label}` };
  const binding = repositoryBinding(environment, task);
  const kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256("official-control-owner-only"),
    repositoryEnvironments: [environment], repositoryJudges: [{ environmentDigest: binding.environmentDigest,
      datasetPath: input.datasetPath, harnessPath: input.harnessPath, image: input.judgeImage }] });
  try {
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: `Official ${label} grading control`,
      expectedOwnerValue: 1, requiredCapabilities: ["repository-judge"], acceptanceCriteria: ["Official grader produces the expected control result"], maximumBudgetUsd: 0 });
    const publicReceipt = await kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, job.id, binding.environmentDigest, task,
      { id: "published-reference-control-no-model", external: false, maximumCostUsd: 0,
        async generate() { return { ...binding, patch: label === "base" ? "" : input.referencePatch }; } });
    const official = await kernel.runRepositoryOfficialAcceptance(SARA_PRINCIPAL, job.id);
    rows.push({ label, publicReceipt, official });
    assert.equal(official.result.gradeCompleted, true, `${label}: official grading must finish`);
    assert.equal(official.result.resolved, label === "reference", `${label}: unexpected resolution`);
    if (label === "base") {
      const details = official.result as unknown as { expectedFailureObserved: boolean; passToPassRegressionCount: number };
      assert.equal(details.expectedFailureObserved, true, "Negative control must observe an expected failing test");
      assert.equal(details.passToPassRegressionCount, 0, "Negative control must preserve previously passing tests");
    }
    await assert.rejects(kernel.runRepositoryOfficialAcceptance(SARA_PRINCIPAL, job.id), /ALREADY_CLAIMED/);
  } finally {
    await kernel.closeVerificationWorkers();
    await writeFile(join(output, "control-summary.json"), JSON.stringify({ kind: "kernel-official-reference-controls",
      modelCalls: 0, benchmarkAttempts: 0, saraScore: null, rows }, null, 2));
  }
}
console.log("PASS: actual kernel-owned official base/reference controls; duplicate grading claim rejected; no model calls.");
