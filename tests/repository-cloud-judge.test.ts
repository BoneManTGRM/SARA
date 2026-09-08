import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { repositoryBinding, verifyRepositoryPatch, type RepositoryEnvironment, type RepositoryTask } from "../src/repository-executor.ts";
import { runOfficialRepositoryJudge } from "../src/repository-official-judge.ts";
import { persistCloudJudgeFiles } from "../src/repository-cloud-files.ts";

test("remote judge output needs typed results, an exact cleanup receipt and the bound official report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloud-judge-fixture-"));
  const environment: RepositoryEnvironment = { schemaVersion: 1, repository: "fixture/public", baseCommit: "a".repeat(40), image: `sha256:${"b".repeat(64)}`, publicTestCommand: ["true"], timeoutSeconds: 10 };
  const task: RepositoryTask = { instanceId: "fixture", problemStatement: "public fixture", arm: "conventional", runId: "fixture" };
  const binding = repositoryBinding(environment, task);
  try {
    for (const mode of ["good", "string-result", "missing-cleanup", "wrong-report"] as const) {
      const receipt = await verifyRepositoryPatch(directory, environment, task, { ...binding, patch: "" }, async () => ({
        async run() { return { exitCode: 0, output: "fixture only" }; }, async mustRun() { return { exitCode: 0, output: "" }; }, async freezePatch() { return ""; }, async close() {} }));
      const grading = runOfficialRepositoryJudge(directory, receipt, { environmentDigest: binding.environmentDigest,
        image: `swebench/fixture@sha256:${"c".repeat(64)}`, datasetPath: "/unused/dataset", harnessPath: "/unused/harness" },
      async (path, _config, output) => {
        const request = JSON.parse(await readFile(path, "utf8"));
        const reportRelativePath = `logs/evaluation/${request.runId}/sara-frozen-${task.arm}/${task.instanceId}/report.json`;
        const report = JSON.stringify({ [task.instanceId]: { resolved: mode !== "wrong-report" } });
        const { patch: _patch, ...bound } = request;
        const result = { ...bound, gradeCompleted: true, resolved: mode === "string-result" ? "true" : true,
          reportRelativePath, reportDigest: sha256(report) };
        await mkdir(dirname(join(output, reportRelativePath)), { recursive: true });
        await writeFile(join(output, reportRelativePath), report);
        await writeFile(join(output, "judge-receipt.json"), JSON.stringify(result));
        await writeFile(join(dirname(path), "judge-dispatch.json"), JSON.stringify(mode === "missing-cleanup" ? {} : { runId: request.runId, dispatchError: null }));
      });
      if (mode === "good") assert.equal((await grading).result.resolved, true);
      else await assert.rejects(grading, /REPOSITORY_JUDGE_(RESULT_TYPES|DISPATCH_BINDING|REPORT_BINDING)/);
    }
    for (const path of ["../receipt.json", "official-judge/../../receipt.json", "/tmp/escape", "input.json"]) {
      await assert.rejects(persistCloudJudgeFiles(directory, [{ path, content: "x" }, { path: "judge-dispatch.json", content: "{}" }]), /CLOUD_FILE_PATH/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
