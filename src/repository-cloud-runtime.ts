import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { persistentBenchmarkStateDirectory } from "./coding-benchmark-owner.ts";
import { runRepositoryBenchmark } from "./repository-benchmark-runner.ts";
import { RepositoryCloudBroker } from "./repository-cloud-broker.ts";
import { createRepositoryCloudAuthenticator } from "./repository-cloud-auth.ts";
import { validateRepositoryCloudPackage, type RepositoryCloudPackage } from "./repository-cloud-package.ts";
import { cloudFields } from "./repository-cloud-protocol.ts";
import type { SaraKernel } from "./kernel.ts";
import type { Principal } from "./types.ts";
import { writeBenchmarkAudit } from "./coding-benchmark-audit.ts";

export const CLOUD_PACKAGE_KEY = "SARA_REPOSITORY_BENCHMARK_PACKAGE_JSON";
export const CLOUD_APPROVAL_KEY = "SARA_REPOSITORY_BENCHMARK_APPROVED_SHA256";
export const CLOUD_LAUNCH_KEY = "SARA_REPOSITORY_BENCHMARK_LAUNCH_SHA256";

/** Optional integration in the existing service, disabled unless the operator
 * installs a reviewed package. Installation never launches or grants spending. */
export async function prepareRepositoryCloudRuntime(input: {
  stateDirectory: string; environment: Record<string, string | undefined>;
}) {
  const raw = input.environment[CLOUD_PACKAGE_KEY]; if (!raw) return undefined;
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw Error("CLOUD_PACKAGE_SIZE");
  const p = JSON.parse(raw) as RepositoryCloudPackage; validateRepositoryCloudPackage(p);
  const digest = sha256(canonicalJson(p));
  let kernel: SaraKernel | undefined, epoch: string | null | undefined;
  let status = "not_started", failureCode: string | null = null;
  let admit: (() => void) | undefined;
  let running: Promise<unknown> | undefined;
  let admittedApiKey: string | undefined;
  async function assertAuthority() {
    const env = input.environment;
    if (env[CLOUD_PACKAGE_KEY] !== raw || env[CLOUD_APPROVAL_KEY] !== digest
      || env.RAILWAY_GIT_COMMIT_SHA !== p.permit.runtimeRevision || !env.OPENAI_API_KEY?.trim()
      || !kernel || !env.SARA_OWNER_TOKEN || !env.SARA_OWNER_TOKEN_SHA256) throw Error("CLOUD_FRESH_EXACT_APPROVAL_REQUIRED");
    if (admittedApiKey !== undefined && env.OPENAI_API_KEY !== admittedApiKey) throw Error("CLOUD_MODEL_CREDENTIAL_CHANGED");
    const seconds = Math.floor(Date.now() / 1000);
    if (seconds < p.permit.notBefore || seconds >= p.permit.expiresAt) throw Error("CLOUD_APPROVAL_EXPIRED_OR_NOT_YET_ACTIVE");
    await persistentBenchmarkStateDirectory(input.stateDirectory);
    kernel.authenticateOwnerToken(env.SARA_OWNER_TOKEN);
    if (sha256(env.SARA_OWNER_TOKEN) !== env.SARA_OWNER_TOKEN_SHA256) throw Error("CLOUD_OWNER_CHANGED");
    const state = await kernel.getStatus();
    if (!state.constitution.verified || state.emergencyStopped) throw Error("CLOUD_AUTHORITY_STOPPED");
    if (epoch !== undefined && (await kernel.inspectAudit()).filter(e => e.type === "emergency_stop_changed").at(-1)?.hash !== (epoch ?? undefined)) throw Error("CLOUD_AUTHORITY_EPOCH_CHANGED");
  }
  const broker = new RepositoryCloudBroker({ assertAuthority, expectedAttempts: p.registration.attempts,
    async onBegin(directory) { await writeBenchmarkAudit(directory, "cloud-launch-package.json", p); admit?.(); } });
  const authenticate = createRepositoryCloudAuthenticator({ currentPermit: () => status === "running" ? p.permit : undefined });
  const kernelOptions = {
    repositoryEnvironments: p.tasks.map(t => structuredClone(t.environment)), repositoryJudges: structuredClone(p.judges),
    repositoryExecutionHost: broker,
    repositoryBenchmarkAuthorization: { manifest: structuredClone(p.manifest), registration: structuredClone(p.registration), assertRuntimeAuthority: assertAuthority },
  };
  const root = join(input.stateDirectory, "coding-repair-benchmarks", p.manifest.benchmarkId);
  async function claimed() {
    try { await readFile(join(root, "execution-claim.json")); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  return {
    kernelOptions,
    bindKernel(value: SaraKernel) { if (kernel) throw Error("CLOUD_KERNEL_ALREADY_BOUND"); kernel = value; },
    async readiness() {
      const blockers: string[] = [];
      try { await assertAuthority(); } catch (error) { blockers.push(error instanceof Error ? error.message : "CLOUD_AUTHORITY_UNAVAILABLE"); }
      const consumed = await claimed(); if (consumed) blockers.push("CLOUD_EXECUTION_ALREADY_CLAIMED");
      return { schemaVersion: 1, ready: blockers.length === 0 && status === "not_started", status: consumed && status === "not_started" ? "claimed_no_replay" : status,
        blockers, packageDigest: digest, benchmarkId: p.manifest.benchmarkId, sourceRevision: p.permit.runtimeRevision,
        registrationDigest: p.permit.registrationDigest, authorityDigest: p.manifest.bindings.authorityDigest,
        maximumSpendUsd: p.manifest.maximumSpendUsd, plannedAttempts: 20, newHostingExpenseUsd: 0,
        failureCode, replayAllowed: false, productionAuthority: false };
    },
    async worker(token: string, body: unknown) {
      await assertAuthority();
      const identity = await authenticate(token); if (!identity) throw Error("CLOUD_WORKER_UNAUTHORIZED");
      await assertAuthority(); return broker.worker(identity, body);
    },
    async launch(owner: Principal, body: unknown) {
      const b = cloudFields(body, ["packageDigest", "registrationDigest", "authorityDigest"]);
      if (!kernel || status !== "not_started" || running) throw Error("CLOUD_LAUNCH_UNAVAILABLE");
      if (b.packageDigest !== digest || b.registrationDigest !== p.permit.registrationDigest
        || b.authorityDigest !== p.manifest.bindings.authorityDigest) throw Error("CLOUD_LAUNCH_APPROVAL_MISMATCH");
      await assertAuthority(); if (await claimed()) throw Error("CLOUD_EXECUTION_ALREADY_CLAIMED");
      // Serialize admission before returning to the event loop. No launch route
      // can create a second in-memory coordinator while the first claim awaits I/O.
      if (status !== "not_started") throw Error("CLOUD_LAUNCH_UNAVAILABLE"); status = "running";
      admittedApiKey = input.environment.OPENAI_API_KEY;
      epoch = (await kernel.inspectAudit()).filter(e => e.type === "emergency_stop_changed").at(-1)?.hash ?? null;
      let rejectAdmission: (reason: unknown) => void;
      const admitted = new Promise<void>((resolve, reject) => { admit = resolve; rejectAdmission = reject; });
      running = runRepositoryBenchmark({ kernel, owner, registration: p.registration, tasks: p.tasks, runId: p.runId,
        approval: { registrationDigest: p.permit.registrationDigest, authorityDigest: p.manifest.bindings.authorityDigest },
        apiKey: input.environment.OPENAI_API_KEY!, cloud: { broker, judges: p.judges } }).then(result => {
        status = result.status; return result;
      }).catch(() => {
        status = "failed"; failureCode = "CLOUD_EXECUTION_FAILED_INSPECT_DURABLE_EVIDENCE";
        broker.end(); rejectAdmission(Error(failureCode));
      });
      await admitted;
      return { status: "started", benchmarkId: p.manifest.benchmarkId, maximumSpendUsd: p.manifest.maximumSpendUsd, replayAllowed: false };
    },
    /** Explicit owner-installed, target-bound boot mandate, using the existing
     * owner credential in place. Package installation/approval alone never runs. */
    async launchConfigured(): Promise<{ status: string }> {
      const launchDigest = input.environment[CLOUD_LAUNCH_KEY];
      if (!launchDigest) return { status: "not_requested" };
      if (launchDigest !== digest || !kernel || !input.environment.SARA_OWNER_TOKEN) throw Error("CLOUD_BOOT_LAUNCH_MISMATCH");
      if (await claimed()) return { status: "claimed_no_replay" };
      await this.launch(kernel.authenticateOwnerToken(input.environment.SARA_OWNER_TOKEN), {
        packageDigest: digest, registrationDigest: p.permit.registrationDigest, authorityDigest: p.manifest.bindings.authorityDigest });
      return { status: "started" };
    },
    stop() { status = "stopped"; broker.end(); },
    async result() {
      const raw = await readFile(join(root, "repository-trace", "comparison-result.json"), "utf8");
      const envelope = JSON.parse(raw);
      if (sha256(canonicalJson(envelope.payload)) !== envelope.payloadDigest) throw Error("CLOUD_RESULT_DIGEST");
      return envelope;
    },
  };
}
export type RepositoryCloudRuntime = NonNullable<Awaited<ReturnType<typeof prepareRepositoryCloudRuntime>>>;
