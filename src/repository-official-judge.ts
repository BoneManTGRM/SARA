import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "./canonical.ts";
import { verifyRepositoryArtifact, type RepositoryVerification } from "./repository-executor.ts";

export interface RepositoryJudgeConfiguration {
  environmentDigest: string;
  datasetPath: string;
  harnessPath: string;
  image: string;
  fixtureProxyImage?: string;
}
export function validateRepositoryJudgeConfiguration(config: RepositoryJudgeConfiguration): void {
  if (!/^[a-f0-9]{64}$/.test(config.environmentDigest) || !isAbsolute(config.datasetPath)
    || !isAbsolute(config.harnessPath) || !/^swebench\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(config.image)
    || (config.fixtureProxyImage !== undefined && !/^python@sha256:[a-f0-9]{64}$/.test(config.fixtureProxyImage))) {
    throw new Error("REPOSITORY_JUDGE_CONFIGURATION");
  }
}
export interface OfficialRepositoryResult {
  schemaVersion: 1;
  instanceId: string;
  arm: string;
  runId: string;
  patchDigest: string;
  environmentDigest: string;
  taskDigest: string;
  image: string;
  fixtureProxyImage: string | null;
  repository: string;
  baseCommit: string;
  resolved: boolean;
  gradeCompleted: boolean;
  reportRelativePath?: string;
  reportDigest?: string;
  error?: string;
}

/** Concrete trusted judge dispatch. Callers cannot inject a grading callback. */
export async function runOfficialRepositoryJudge(stateDirectory: string, receipt: RepositoryVerification,
  config: RepositoryJudgeConfiguration) {
  receipt = structuredClone(receipt); config = structuredClone(config);
  validateRepositoryJudgeConfiguration(config);
  await verifyRepositoryArtifact(stateDirectory, receipt);
  if (config.environmentDigest !== receipt.environmentDigest) throw new Error("REPOSITORY_JUDGE_ENVIRONMENT");
  const root = join(stateDirectory, receipt.artifactRelativePath);
  const input = JSON.parse(await readFile(join(root, "input.json"), "utf8"));
  const request = { schemaVersion: 1, instanceId: input.task.instanceId, arm: input.task.arm,
    runId: `sara-judge-${randomUUID()}`, patch: input.proposal.patch, patchDigest: receipt.patchDigest,
    repository: input.environment.repository, baseCommit: input.environment.baseCommit,
    environmentDigest: receipt.environmentDigest, taskDigest: receipt.taskDigest, image: config.image,
    fixtureProxyImage: config.fixtureProxyImage ?? null };
  const requestPath = join(root, "judge-request.json");
  const file = await open(requestPath, "wx", 0o600);
  try { await file.writeFile(canonicalJson(request)); await file.sync(); } finally { await file.close(); }
  const output = join(root, "official-judge");
  let dispatchError: string | undefined;
  try {
    await promisify(execFile)("python3", [fileURLToPath(new URL("../scripts/swe-bench-judge.py", import.meta.url)),
      "--request", requestPath, "--dataset", config.datasetPath,
      "--manifest", fileURLToPath(new URL("../docs/benchmarks/swe-bench-multilingual-pilot.json", import.meta.url)),
      "--harness", config.harnessPath, "--output", output],
    { env: { PATH: process.env.PATH, LANG: "C.UTF-8" }, timeout: 1200000, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) { dispatchError = error instanceof Error ? error.message.slice(0, 1000) : "JUDGE_DISPATCH_FAILED"; }
  finally {
    // Independent cleanup survives Python being killed by the outer deadline.
    // Only containers bearing this fresh, kernel-generated run label are ours.
    try {
      const options = { env: { PATH: process.env.PATH }, timeout: 30000, maxBuffer: 65536 };
      const listed = await promisify(execFile)("docker", ["ps", "--all", "--quiet", "--filter", `label=sara.repositoryJudgeRun=${request.runId}`], options);
      const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
      if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id)) || ids.length > 10) throw new Error("JUDGE_CLEANUP_IDENTITY");
      if (ids.length) await promisify(execFile)("docker", ["rm", "--force", ...ids], options);
      const networks = await promisify(execFile)("docker", ["network", "ls", "--quiet", "--filter", `label=sara.repositoryJudgeRun=${request.runId}`], options);
      const networkIds = networks.stdout.trim().split(/\s+/).filter(Boolean);
      if (networkIds.some(id => !/^[a-f0-9]{12,64}$/.test(id)) || networkIds.length > 2) throw new Error("JUDGE_NETWORK_CLEANUP_IDENTITY");
      if (networkIds.length) await promisify(execFile)("docker", ["network", "rm", ...networkIds], options);
    } catch (error) { dispatchError = `JUDGE_CLEANUP_FAILED: ${String(error).slice(0, 500)}; ${dispatchError ?? ""}`; }
    const file = await open(join(root, "judge-dispatch.json"), "wx", 0o600);
    try { await file.writeFile(canonicalJson({ runId: request.runId, dispatchError: dispatchError ?? null })); await file.sync(); }
    finally { await file.close(); }
  }
  const result = JSON.parse(await readFile(join(output, "judge-receipt.json"), "utf8")) as OfficialRepositoryResult;
  for (const key of ["instanceId", "arm", "runId", "patchDigest", "environmentDigest", "taskDigest", "image", "fixtureProxyImage", "repository", "baseCommit"] as const) {
    if (result[key] !== request[key]) throw new Error("REPOSITORY_JUDGE_RECEIPT_BINDING");
  }
  if (dispatchError || !result.gradeCompleted) result.resolved = false;
  if (result.gradeCompleted) {
    const expectedPath = `logs/evaluation/${request.runId}/sara-frozen-${request.arm}/${request.instanceId}/report.json`;
    if (result.reportRelativePath !== expectedPath) throw new Error("REPOSITORY_JUDGE_REPORT_PATH");
    const report = await readFile(join(output, expectedPath), "utf8");
    if (sha256(report) !== result.reportDigest || JSON.parse(report)[request.instanceId]?.resolved !== result.resolved) {
      throw new Error("REPOSITORY_JUDGE_REPORT_BINDING");
    }
  }
  return { result, judgeReceiptDigest: sha256(await readFile(join(output, "judge-receipt.json"))),
    artifactRelativePath: `${receipt.artifactRelativePath}/official-judge`, candidateDigest: receipt.candidateDigest,
    productionAuthority: false as const, ...(dispatchError ? { dispatchError } : {}) };
}
