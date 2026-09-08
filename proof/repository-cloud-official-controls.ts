import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { repositoryBinding, type RepositoryEnvironment, type RepositoryTask } from "../src/repository-executor.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";
import { repositoryCloudProofHarness } from "./repository-cloud-harness.ts";

// Published base/reference controls for ONE case, not twenty SARA attempts.
// Twenty distinct scripted outcomes exercise the real freeze barrier before
// checking the two official control grades through the remote file transport.
const [inputPath, output] = process.argv.slice(2);
if (!inputPath || !output) throw Error("Control setup and output directory required");
const input = JSON.parse(await readFile(inputPath, "utf8"));
await mkdir(output, { recursive: true });
const environment = input.environment as RepositoryEnvironment;
const planned = Array.from({ length: 20 }, (_, i) => {
  const task: RepositoryTask = { instanceId: input.task.instance_id, problemStatement: input.task.problem_statement,
    arm: i % 2 ? "reparodynamic" : "conventional", runId: `cloud-reference-control-${i}` };
  return { attemptId: `control-${i}`, task, environmentDigest: repositoryBinding(environment, task).environmentDigest };
});
const judge = { environmentDigest: planned[0]!.environmentDigest, datasetPath: input.datasetPath, harnessPath: input.harnessPath,
  image: input.judgeImage, ...(input.fixtureProxyImage ? { fixtureProxyImage: input.fixtureProxyImage } : {}) };
const cloud = await repositoryCloudProofHarness(output, planned);
const kernel = await SaraKernel.boot({ stateDirectory: output, ownerTokenSha256: sha256("cloud-reference-control-only"),
  repositoryEnvironments: [environment], repositoryJudges: [judge], repositoryExecutionHost: cloud.broker });
const rows = [], grades = [];
try {
  for (let i = 0; i < planned.length; i++) {
    const attempt = planned[i]!; await cloud.start(environment, attempt.task);
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Published reference transport control",
      expectedOwnerValue: 1, requiredCapabilities: ["repository-judge"], acceptanceCriteria: ["Independent official control"], maximumBudgetUsd: 0 });
    const receipt = await kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, job.id, attempt.environmentDigest, attempt.task,
      { id: "published-reference-control-no-model", external: false, maximumCostUsd: 0, async generate() {
        return { ...repositoryBinding(environment, attempt.task), patch: i % 2 ? input.referencePatch : "" };
      } });
    rows.push({ ...attempt, jobId: job.id, candidateDigest: receipt.candidateDigest, patchDigest: receipt.patchDigest,
      fixtureKind: i % 2 ? "published_reference" : "empty_base", benchmarkAttempt: false });
    await cloud.finish();
  }
  await writeBenchmarkAudit(cloud.evidenceDirectory, "producer-freeze.json", { rows, digest: sha256(canonicalJson(rows)) });
  await cloud.broker.producersFrozen();
  for (const row of rows.slice(0, 2)) {
    await cloud.start(environment, row.task, judge);
    const grade = await kernel.runRepositoryOfficialAcceptance(SARA_PRINCIPAL, row.jobId);
    assert.equal(grade.result.gradeCompleted, true);
    assert.equal(grade.result.resolved, row.fixtureKind === "published_reference");
    grades.push(grade); await cloud.finish();
  }
  await writeFile(join(output, "cloud-official-qualification.json"), JSON.stringify({ kind: "one-case-base-reference-transport-controls",
    scriptedOutcomesFrozen: rows.length, officialControls: grades, modelCalls: 0, benchmarkAttempts: 0, saraScore: null }, null, 2));
  console.log("PASS: twenty scripted fixture outcomes frozen, independent official base fails/reference passes through HTTP worker transport; zero benchmark attempts.");
} finally { await cloud.close(); await kernel.closeVerificationWorkers(); }
