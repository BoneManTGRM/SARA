import { readFileSync } from "node:fs";
import { canonicalJson, sha256 } from "./canonical.ts";
import { repositoryBinding } from "./repository-executor.ts";
import { prepareRepositoryComparisonPlan, type RepositoryComparisonPublicTask } from "./repository-comparison.ts";
import { repositoryBenchmarkManifestBindings, validateRepositoryBenchmarkAuthorization, type RepositoryBenchmarkRegistration } from "./repository-benchmark-permit.ts";
import { validateRepositoryJudgeConfiguration, type RepositoryJudgeConfiguration } from "./repository-official-judge.ts";
import { validateRepositoryCloudPermit, type RepositoryCloudPermit } from "./repository-cloud-auth.ts";
import { cloudDigest, cloudFields } from "./repository-cloud-protocol.ts";
import type { CodingBenchmarkManifest } from "./coding-repair-benchmark-store.ts";

export interface RepositoryCloudPackage {
  schemaVersion: 1; runId: string;
  manifest: CodingBenchmarkManifest; registration: RepositoryBenchmarkRegistration;
  tasks: RepositoryComparisonPublicTask[]; judges: RepositoryJudgeConfiguration[];
  permit: RepositoryCloudPermit;
  qualifications: Array<{ instanceId: string; environmentDigest: string; publicProofDigest: string; controlProofDigest: string }>;
}
export function repositoryCloudAuthorityDigest(p: Pick<RepositoryCloudPackage, "registration" | "permit" | "judges" | "qualifications">): string {
  return sha256(canonicalJson({ purpose: "one_matched20_repository_run_existing_cloud_only",
    registration: p.registration, permit: p.permit, judges: p.judges, qualifications: p.qualifications,
    newHostingExpenseUsd: 0, replayAllowed: false, productionAuthority: false }));
}
export function repositoryCloudCodeBindings() {
  const digest = (paths: string[]) => sha256(canonicalJson(paths.map(path => ({ path,
    digest: sha256(readFileSync(new URL(`../${path}`, import.meta.url))) }))));
  return {
    controllerDigest: digest(["src/repository-benchmark-runner.ts", "src/repository-producer.ts", "src/repository-luna-model.ts",
      "src/benchmark-dispatch-budget.ts", "src/repository-cloud-broker.ts", "src/repository-cloud-auth.ts", "src/repository-cloud-runtime.ts",
      "src/server.ts", "src/main.ts", "src/repository-cloud-package.ts"]),
    verifierDigest: digest(["src/kernel.ts", "src/repository-executor.ts", "src/repository-official-judge.ts",
      "src/repository-cloud-protocol.ts", "src/repository-cloud-worker.ts", "src/repository-cloud-files.ts",
      "scripts/repository-cloud-worker.ts", "scripts/prepare-cloud-judge.py", "scripts/swe-bench-judge.py"]),
  };
}
/** Pure admission checks run before a durable execution claim or model call. */
export function validateRepositoryCloudPackage(p: RepositoryCloudPackage): void {
  cloudFields(p, ["schemaVersion", "runId", "manifest", "registration", "tasks", "judges", "permit", "qualifications"]);
  if (p.schemaVersion !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.manifest.benchmarkId)) throw Error("CLOUD_PACKAGE_ID");
  validateRepositoryCloudPermit(p.permit);
  const plan = prepareRepositoryComparisonPlan({ runId: p.runId, tasks: p.tasks, limits: p.registration.producerLimits });
  const environments = new Map(p.tasks.map(t => [repositoryBinding(t.environment, plan.requests.find(r => r.task.instanceId === t.instanceId)!.task).environmentDigest, t.environment]));
  validateRepositoryBenchmarkAuthorization({ manifest: p.manifest, registration: p.registration, assertRuntimeAuthority: async () => {} }, environments);
  const bindings = repositoryBenchmarkManifestBindings(p.registration);
  if (p.permit.benchmarkId !== p.manifest.benchmarkId || p.permit.registrationDigest !== bindings.policyDigest
    || p.permit.runtimeRevision !== p.manifest.bindings.sourceCommit || p.manifest.bindings.authorityDigest !== repositoryCloudAuthorityDigest(p)
    || p.manifest.bindings.controllerDigest !== repositoryCloudCodeBindings().controllerDigest
    || p.manifest.bindings.verifierDigest !== repositoryCloudCodeBindings().verifierDigest) throw Error("CLOUD_PACKAGE_BINDING");
  const registered = p.registration.attempts.map(a => canonicalJson({ task: a.task, environmentDigest: a.environmentDigest })).sort();
  if (canonicalJson(registered) !== canonicalJson(plan.requests.map(r => canonicalJson({ task: r.task, environmentDigest: repositoryBinding(r.environment, r.task).environmentDigest })).sort())) throw Error("CLOUD_PACKAGE_PLAN");
  const recipes = JSON.parse(readFileSync(new URL("../docs/benchmarks/swe-repository-recipes.json", import.meta.url), "utf8")).tasks;
  if (p.registration.producerLimits.maximumWallMilliseconds > 30 * 60_000 || p.judges.length !== 10
    || p.qualifications.length !== 10 || new Set(p.judges.map(j => j.environmentDigest)).size !== 10
    || new Set(p.qualifications.map(q => q.instanceId)).size !== 10) throw Error("CLOUD_PACKAGE_BOUNDS");
  for (const task of p.tasks) {
    const environmentDigest = sha256(canonicalJson(task.environment));
    const qualification = p.qualifications.find(q => q.instanceId === task.instanceId);
    const judge = p.judges.find(j => j.environmentDigest === environmentDigest);
    if (!qualification || qualification.environmentDigest !== environmentDigest || !judge
      || !/^ghcr\.io\/bonemantgrm\/sara-swe-public-[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(task.environment.image)
      || task.environment.timeoutSeconds !== 900
      || canonicalJson(task.environment.publicTestCommand) !== canonicalJson(recipes.find((r: { instanceId: string }) => r.instanceId === task.instanceId)?.publicTestCommand)) throw Error("CLOUD_QUALIFICATION_BINDING");
    cloudFields(qualification, ["instanceId", "environmentDigest", "publicProofDigest", "controlProofDigest"]);
    cloudDigest(qualification.publicProofDigest); cloudDigest(qualification.controlProofDigest);
    validateRepositoryJudgeConfiguration(judge);
    if (judge.datasetPath !== "/worker/judge.parquet" || judge.harnessPath !== "/worker/harness") throw Error("CLOUD_JUDGE_PATH");
  }
}
