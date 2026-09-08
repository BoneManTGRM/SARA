import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { REPOSITORY_COMPARISON_TASKS, prepareRepositoryComparisonPlan } from "../src/repository-comparison.ts";
import { repositoryBinding } from "../src/repository-executor.ts";
import { repositoryBenchmarkManifestBindings, type RepositoryBenchmarkRegistration } from "../src/repository-benchmark-permit.ts";
import { repositoryCloudAuthorityDigest, repositoryCloudCodeBindings, validateRepositoryCloudPackage, type RepositoryCloudPackage } from "../src/repository-cloud-package.ts";
import { repositoryResourceLimitsRespected } from "../src/repository-resource-evidence.ts";

// Offline compilation only. Does not install the package, activate its digest,
// authenticate an owner, initialize a claim, or contact a provider.
const { values: args } = parseArgs({ options: Object.fromEntries(["public", "controls", "source", "workflow-ref", "output", "not-before", "expires"].map(k => [k, { type: "string" as const }])) });
for (const name of ["public", "controls", "source", "workflow-ref", "output", "not-before", "expires"]) if (!args[name]) throw Error(`Missing --${name}`);
if (!/^[a-f0-9]{40}$/.test(args.source!) || !/^refs\/heads\/run\/swe-cloud-[A-Za-z0-9._-]+$/.test(args["workflow-ref"]!)) throw Error("Exact source and execution branch required");
const notBefore = Date.parse(args["not-before"]!) / 1000, expiresAt = Date.parse(args.expires!) / 1000;
if (!Number.isSafeInteger(notBefore) || !Number.isSafeInteger(expiresAt)) throw Error("ISO timestamps with whole seconds required");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const tasks: RepositoryCloudPackage["tasks"] = [], judges: RepositoryCloudPackage["judges"] = [], qualifications: RepositoryCloudPackage["qualifications"] = [];
for (let i = 0; i < 10; i++) {
  const expected = REPOSITORY_COMPARISON_TASKS[i]!, pub = join(args.public!, String(i)), control = join(args.controls!, String(i));
  const receipt = await json(join(pub, "public-tests/public-environment-receipt.json"));
  const registry = await json(join(pub, "registry-receipt.json"));
  const before = await readFile(join(pub, "public-tests/resources-before.log"), "utf8"), after = await readFile(join(pub, "public-tests/resources-after.log"), "utf8");
  if (!receipt.environmentPrepared || !receipt.publicTestsPassed || receipt.exitCode !== 0 || receipt.error !== null
    || receipt.modelRequests !== 0 || receipt.benchmarkAttempts !== 0 || !repositoryResourceLimitsRespected(before, after)
    || registry.instanceId !== expected.instanceId || registry.qualifiedImageId !== receipt.environment.image
    || registry.pulledImageId !== registry.qualifiedImageId || registry.modelCalls !== 0 || registry.benchmarkAttempts !== 0
    || registry.publicProofDigest !== sha256(await readFile(join(pub, "public-tests/public-environment-receipt.json")))) throw Error(`Public image ${i} is not qualified`);
  const controls = await json(join(control, "control-summary.json"));
  if (controls.kind !== "kernel-official-reference-controls" || controls.modelCalls !== 0 || controls.benchmarkAttempts !== 0
    || !Array.isArray(controls.rows) || controls.rows.length !== 2) throw Error(`Missing independent controls ${i}`);
  const base = controls.rows.find((r: { label: string }) => r.label === "base"), reference = controls.rows.find((r: { label: string }) => r.label === "reference");
  if (!base || !reference || base.official.result.gradeCompleted !== true || base.official.result.resolved !== false
    || base.official.result.expectedFailureObserved !== true || base.official.result.passToPassRegressionCount !== 0
    || reference.official.result.gradeCompleted !== true || reference.official.result.resolved !== true
    || reference.official.result.passToPassRegressionCount !== 0 || base.official.result.image !== reference.official.result.image
    || base.official.result.instanceId !== expected.instanceId || reference.official.result.instanceId !== expected.instanceId
    || !/^repository-lab\/[a-f0-9-]{36}$/.test(base.publicReceipt.artifactRelativePath)) throw Error(`Invalid official controls ${i}`);
  const publicInput = await json(join(control, "base", base.publicReceipt.artifactRelativePath, "input.json"));
  if (publicInput.proposal.patch !== "" || publicInput.task.instanceId !== expected.instanceId
    || publicInput.environment.repository !== expected.repository || publicInput.environment.baseCommit !== expected.baseCommit) throw Error(`Public task binding ${i}`);
  // Never read the reference patch, test patch, judge dataset, or private test log
  // when preparing producer inputs. Only the public issue comes from the base.
  const environment = { ...receipt.environment, image: registry.registryImage };
  tasks.push({ instanceId: expected.instanceId, problemStatement: publicInput.task.problemStatement, environment });
  const environmentDigest = sha256(canonicalJson(environment));
  const result = reference.official.result;
  judges.push({ environmentDigest, datasetPath: "/worker/judge.parquet", harnessPath: "/worker/harness", image: result.image,
    ...(result.fixtureProxyImage ? { fixtureProxyImage: result.fixtureProxyImage } : {}) });
  qualifications.push({ instanceId: expected.instanceId, environmentDigest,
    publicProofDigest: sha256(canonicalJson({ receipt, registry, before, after })), controlProofDigest: sha256(canonicalJson(controls)) });
}
const benchmarkId = randomUUID(), runId = `swe-cloud-${benchmarkId}`;
const producerLimits = { maximumModelRequests: 50, maximumToolSteps: 200, maximumPublicTests: 6,
  maximumOutputBytes: 2 * 1024 * 1024, maximumWallMilliseconds: 30 * 60_000 };
const plan = prepareRepositoryComparisonPlan({ runId, tasks, limits: producerLimits });
const registration: RepositoryBenchmarkRegistration = { schemaVersion: 1,
  attempts: plan.requests.map((r, i) => ({ attemptId: `attempt-${String(i).padStart(2, "0")}`, task: r.task, environmentDigest: repositoryBinding(r.environment, r.task).environmentDigest })),
  model: { name: "gpt-5.6-luna", reasoning: "medium", maximumInputTokens: 30000, maximumOutputTokens: 8000,
    maximumRequestsPerAttempt: 50, inputPriceTenthsMicros: 2, outputPriceTenthsMicros: 12 },
  spend: { totalMicros: 15600000, armMicros: 7800000, attemptMicros: 780000 }, producerLimits };
const bindings = repositoryBenchmarkManifestBindings(registration);
const permit = { schemaVersion: 1 as const, benchmarkId, registrationDigest: bindings.policyDigest, runtimeRevision: args.source!,
  workflowRevision: args.source!, workflowRef: args["workflow-ref"]!, notBefore, expiresAt };
const manifest = { schemaVersion: 1 as const, benchmarkId, bindings: { ...bindings, ...repositoryCloudCodeBindings(), sourceCommit: args.source!,
  authorityDigest: repositoryCloudAuthorityDigest({ registration, permit, judges, qualifications }) },
  currentCanaryPercent: 5, maximumSpendUsd: 15.6, caseIds: tasks.map(t => t.instanceId), createdAt: new Date().toISOString() };
const pkg: RepositoryCloudPackage = { schemaVersion: 1, runId, manifest, registration, tasks, judges, qualifications, permit };
validateRepositoryCloudPackage(pkg);
await mkdir(dirname(args.output!), { recursive: true });
await writeFile(args.output!, canonicalJson(pkg) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ benchmarkId, packageDigest: sha256(canonicalJson(pkg)), sourceRevision: args.source,
  registrationDigest: bindings.policyDigest, authorityDigest: manifest.bindings.authorityDigest,
  plannedAttempts: 20, maximumSpendUsd: 15.6, newHostingExpenseUsd: 0, grantActivated: false, modelCalls: 0, replayAllowed: false }));
