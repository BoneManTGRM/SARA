import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingBenchmarkManifest } from "./coding-repair-benchmark-store.ts";
import { repositoryBinding, type RepositoryEnvironment, type RepositoryTask } from "./repository-executor.ts";
import type { RepositoryProducerLimits } from "./repository-producer.ts";

export interface RepositoryBenchmarkRegistration {
  schemaVersion: 1;
  attempts: Array<{ attemptId: string; task: RepositoryTask; environmentDigest: string }>;
  model: { name: "gpt-5.6-luna"; reasoning: "medium"; maximumInputTokens: number; maximumOutputTokens: number;
    maximumRequestsPerAttempt: number; inputPriceTenthsMicros: number; outputPriceTenthsMicros: number };
  spend: { totalMicros: number; armMicros: number; attemptMicros: number };
  producerLimits: RepositoryProducerLimits;
}
/** Boot-only validation is an integration seam, not itself an owner grant. */
export interface RepositoryBenchmarkAuthorization {
  manifest: CodingBenchmarkManifest;
  registration: RepositoryBenchmarkRegistration;
  assertRuntimeAuthority(): Promise<void>;
}
/** Only a kernel-private WeakMap gives this object authority; its fields do not. */
export interface RepositoryBenchmarkPermit { readonly permitId: string }
export interface RepositoryBenchmarkExecution {
  readonly evidenceDirectory: string;
  permitFor(jobId: string, attemptId: string): Promise<RepositoryBenchmarkPermit>;
}
export function repositoryBenchmarkManifestBindings(registration: RepositoryBenchmarkRegistration) {
  return { policyDigest: sha256(canonicalJson(registration)), corpusDigest: sha256(canonicalJson(registration.attempts)),
    modelDigest: sha256(canonicalJson(registration.model)),
    environmentDigest: sha256(canonicalJson(registration.attempts.map(a => a.environmentDigest))) };
}
export function validateRepositoryBenchmarkAuthorization(config: RepositoryBenchmarkAuthorization,
  environments: ReadonlyMap<string, RepositoryEnvironment>): void {
  const r = config.registration, m = config.manifest;
  const fields = (value: object, keys: string[]) => Object.keys(value).sort().join(",") === keys.sort().join(",");
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (typeof config.assertRuntimeAuthority !== "function" || !fields(r, ["schemaVersion", "attempts", "model", "spend", "producerLimits"]) ||
    r.schemaVersion !== 1 || !Array.isArray(r.attempts) || r.attempts.length !== 20 ||
    !fields(r.model, ["name", "reasoning", "maximumInputTokens", "maximumOutputTokens", "maximumRequestsPerAttempt", "inputPriceTenthsMicros", "outputPriceTenthsMicros"]) ||
    r.model.name !== "gpt-5.6-luna" || r.model.reasoning !== "medium" ||
    ![r.model.maximumInputTokens, r.model.maximumOutputTokens, r.model.maximumRequestsPerAttempt,
      r.model.inputPriceTenthsMicros, r.model.outputPriceTenthsMicros].every(positive) ||
    !fields(r.spend, ["totalMicros", "armMicros", "attemptMicros"]) || !Object.values(r.spend).every(positive) ||
    r.spend.totalMicros > 100_000_000 || r.spend.armMicros > r.spend.totalMicros || r.spend.attemptMicros > r.spend.armMicros ||
    BigInt(r.spend.totalMicros) < 2n * BigInt(r.spend.armMicros) || BigInt(r.spend.armMicros) < 10n * BigInt(r.spend.attemptMicros) ||
    !fields(r.producerLimits, ["maximumModelRequests", "maximumToolSteps", "maximumPublicTests", "maximumOutputBytes", "maximumWallMilliseconds"]) ||
    !Object.values(r.producerLimits).every(positive) || r.producerLimits.maximumModelRequests !== r.model.maximumRequestsPerAttempt ||
    r.producerLimits.maximumModelRequests > 1000 || r.producerLimits.maximumToolSteps > 10000 || r.producerLimits.maximumPublicTests > 1000 ||
    r.producerLimits.maximumOutputBytes > 16 * 1024 * 1024 || r.producerLimits.maximumWallMilliseconds > 24 * 3600_000 ||
    m.maximumSpendUsd !== r.spend.totalMicros / 1e6) throw new Error("REPOSITORY_BENCHMARK_REGISTRATION_INVALID");
  const requestMicros = (BigInt(r.model.maximumInputTokens) * BigInt(r.model.inputPriceTenthsMicros) +
    BigInt(r.model.maximumOutputTokens) * BigInt(r.model.outputPriceTenthsMicros) + 9n) / 10n;
  if (requestMicros > BigInt(r.spend.attemptMicros)) throw new Error("REPOSITORY_BENCHMARK_REQUEST_EXCEEDS_CAP");
  const ids = new Set<string>(), tasks = new Map<string, typeof r.attempts>();
  for (const attempt of r.attempts) {
    if (!fields(attempt, ["attemptId", "task", "environmentDigest"]) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u.test(attempt.attemptId) || ids.has(attempt.attemptId)) throw new Error("REPOSITORY_BENCHMARK_ATTEMPTS_INVALID");
    ids.add(attempt.attemptId);
    const environment = environments.get(attempt.environmentDigest);
    if (!environment) throw new Error("REPOSITORY_BENCHMARK_BINDING_INVALID");
    repositoryBinding(environment, attempt.task);
    const group = tasks.get(attempt.task.instanceId) ?? []; group.push(attempt); tasks.set(attempt.task.instanceId, group);
  }
  if (tasks.size !== 10 || [...tasks.values()].some(pair => pair.length !== 2 || pair[0].task.arm === pair[1].task.arm ||
    pair[0].environmentDigest !== pair[1].environmentDigest || pair[0].task.problemStatement !== pair[1].task.problemStatement) ||
    canonicalJson([...tasks.keys()].sort()) !== canonicalJson([...m.caseIds].sort())) throw new Error("REPOSITORY_BENCHMARK_MATCHING_INVALID");
  for (const [key, value] of Object.entries(repositoryBenchmarkManifestBindings(r))) {
    if (m.bindings[key as keyof typeof m.bindings] !== value) throw new Error("REPOSITORY_BENCHMARK_MANIFEST_MISMATCH");
  }
}
