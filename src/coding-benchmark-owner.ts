import { readCodingBenchmarkEvidence, type BenchmarkEvidence } from "./coding-benchmark-evidence.ts";
import type { CodingBenchmarkRelayIdentity } from "./coding-benchmark-github-relay.ts";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codingBenchmarkAuthorityDigest } from "./coding-repair-benchmark-command.ts";
import { writeBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { KERNEL_CODING_BENCHMARK_GRANT, HARDENED_REUSE_BENCHMARK_GRANT, REUSE_SPEED_BENCHMARK_GRANT, CURRENT_CODING_BENCHMARK_GRANT, activeCodingBenchmarkContinuation, assertCodingBenchmarkDispatch, CodingBenchmarkNotReadyError, inspectCodingBenchmarkReadiness } from "./coding-benchmark-readiness.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
type OwnerBenchmarkInput = {
  environment: Record<string, string | undefined>;
  stateDirectory?: string;
  constitutionVerified: boolean;
  emergencyStopped: boolean;
  launcher?: CodingBenchmarkRelayIdentity;
};

export async function persistentBenchmarkStateDirectory(stateDirectory: string | undefined): Promise<string> {
  if (!stateDirectory || !isAbsolute(stateDirectory)) throw new CodingBenchmarkNotReadyError("PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE");
  const actual = await realpath(stateDirectory);
  if (actual !== resolve(stateDirectory)) throw new CodingBenchmarkNotReadyError("BENCHMARK_STATE_SYMLINK_REJECTED");
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  if (!mounts.split("\n").some(line => {
    const mount = line.split(" ")[4];
    if (mount !== "/data") return false;
    const rel = relative(mount.replace(/\\040/gu, " "), actual);
    return !rel.startsWith("..") && !isAbsolute(rel);
  })) throw new CodingBenchmarkNotReadyError("PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE");
  return join(actual, "coding-benchmark-lab");
}

export async function ownerCodingBenchmarkReadiness(input: OwnerBenchmarkInput) {
  const readiness = inspectCodingBenchmarkReadiness(input);
  let executionEvidence: BenchmarkEvidence | null = null;
  try {
    const directory = await persistentBenchmarkStateDirectory(input.stateDirectory);
    try {
      executionEvidence = await readCodingBenchmarkEvidence(directory, readiness.benchmarkId);
      if (executionEvidence.status !== "not_started") {
        readiness.blockers.push("BENCHMARK_EXECUTION_ALREADY_CLAIMED");
        readiness.availableAuthorizationUsd = 0;
        readiness.unresolvedExposureUsd = readiness.maximumSpendUsd;
      }
    } catch { readiness.blockers.push("BENCHMARK_EVIDENCE_UNAVAILABLE"); readiness.availableAuthorizationUsd = 0; }
  } catch { readiness.blockers.push("PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE"); }
  readiness.ready = readiness.blockers.length === 0;
  return { ...readiness, executionEvidence,
    ...(input.launcher ? { launcher: structuredClone(input.launcher) } : {}),
    authenticatedLaunchPath: "/api/coding-benchmark/run",
    execution: readiness.benchmarkId === KERNEL_CODING_BENCHMARK_GRANT.benchmarkId ? "full_kernel_exact_repeat_pilot" : [REUSE_SPEED_BENCHMARK_GRANT.benchmarkId, HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId].some(id => id === readiness.benchmarkId)
      ? "maximum_observed_reuse_pilot" : readiness.benchmarkId === CURRENT_CODING_BENCHMARK_GRANT.benchmarkId
      ? "current_components_cold_pilot" : "existing_matched_cli_only",
    authorityDigest: readiness.sourceRevision ? codingBenchmarkAuthorityDigest({
      benchmarkId: readiness.benchmarkId, sourceRevision: readiness.sourceRevision,
      maximumSpendUsd: readiness.maximumSpendUsd, maximumModelSpendUsdPerArm: readiness.maximumModelSpendUsdPerArm,
      currentCanaryPercent: 5, caseCount: 1,
    }) : null,
    canaryPercentMeaning: "historical benchmark metadata only; not measured production traffic",
  };
}

export function codingBenchmarkLaunchSpec(input: {
  environment: Record<string, string | undefined>;
  stateDirectory: string;
  sourceRevision: string;
}) {
  if (!/^[a-f0-9]{40}$/u.test(input.sourceRevision) || !isAbsolute(input.stateDirectory)) throw new Error("Invalid benchmark launch identity.");
  const active = activeCodingBenchmarkContinuation(input.environment);
  const benchmarkId = active.benchmarkId;
  const authorityDigest = codingBenchmarkAuthorityDigest({ benchmarkId, sourceRevision: input.sourceRevision,
    maximumSpendUsd: active.maximumSpendUsd, maximumModelSpendUsdPerArm: active.maximumModelSpendUsdPerArm,
    currentCanaryPercent: 5, caseCount: 1 });
  const environment: Record<string, string> = {};
  for (const key of ["OPENAI_API_KEY", "SARA_OWNER_TOKEN", "SARA_OWNER_TOKEN_SHA256", "SARA_STATE_DIRECTORY", "PORT", "RAILWAY_GIT_COMMIT_SHA", "SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256"]) {
    const value = input.environment[key]; if (value !== undefined) environment[key] = value;
  }
  if ([KERNEL_CODING_BENCHMARK_GRANT.benchmarkId, CURRENT_CODING_BENCHMARK_GRANT.benchmarkId, REUSE_SPEED_BENCHMARK_GRANT.benchmarkId, HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId].some(id => id === active.benchmarkId)) environment.SARA_REPARODYNAMIC_CODING_MODE = input.environment.SARA_REPARODYNAMIC_CODING_MODE ?? "";
  environment.SARA_CODING_BENCHMARK_SOURCE_REVISION = input.sourceRevision;
  environment.SARA_CODING_BENCHMARK_AUTHORITY_SHA256 = authorityDigest;
  return { command: process.execPath, cwd: root, environment,
    args: ["--import", "tsx", active.benchmarkId === KERNEL_CODING_BENCHMARK_GRANT.benchmarkId ? "scripts/benchmark-kernel-coding.ts" : active.benchmarkId === HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId
      ? "scripts/benchmark-hardened-reuse.ts" : active.benchmarkId === REUSE_SPEED_BENCHMARK_GRANT.benchmarkId
      ? "scripts/benchmark-reuse-speed.ts" : active.benchmarkId === CURRENT_CODING_BENCHMARK_GRANT.benchmarkId
      ? "scripts/benchmark-current-coding-evidence.ts" : "scripts/benchmark-matched-coding-evidence.ts", "--live", "--acknowledge-lab-only",
      "--benchmark-id", benchmarkId, "--max-spend-usd", String(active.maximumSpendUsd),
      "--max-arm-spend-usd", String(active.maximumModelSpendUsdPerArm),
      "--current-canary-percent", "5", "--case-count", "1", "--state-directory", input.stateDirectory],
  };
}

export async function launchOwnerCodingBenchmark(input: OwnerBenchmarkInput & { body: Record<string, unknown> }) {
  const allowed = new Set(["benchmarkId", "sourceRevision", "authorityDigest"]);
  if (Object.keys(input.body).some(key => !allowed.has(key))) throw new CodingBenchmarkNotReadyError("BENCHMARK_REQUEST_FIELDS_REJECTED");
  assertCodingBenchmarkDispatch({ ...input, benchmarkId: String(input.body.benchmarkId ?? "") });
  const readiness = await ownerCodingBenchmarkReadiness(input);
  if (!readiness.ready) throw new CodingBenchmarkNotReadyError(readiness.blockers.join(","));
  if (input.body.sourceRevision !== readiness.sourceRevision || input.body.authorityDigest !== readiness.authorityDigest) {
    throw new CodingBenchmarkNotReadyError("BENCHMARK_SOURCE_OR_AUTHORITY_MISMATCH");
  }
  const stateDirectory = await persistentBenchmarkStateDirectory(input.stateDirectory);
  const spec = codingBenchmarkLaunchSpec({ environment: input.environment, sourceRevision: readiness.sourceRevision!, stateDirectory });
  const journal = join(stateDirectory, "coding-repair-benchmarks", readiness.benchmarkId, "trace");
  await writeBenchmarkAudit(journal, "owner-launch-claim.json", {
    benchmarkId: readiness.benchmarkId, sourceRevision: readiness.sourceRevision,
    authorityDigest: readiness.authorityDigest, reservedUsd: readiness.maximumSpendUsd,
    claimedAt: new Date().toISOString(), launch: "existing_cli", replayAllowed: false,
    launcher: input.launcher ? structuredClone(input.launcher) : { authentication: "owner_token" },
  });
  // Preserve the benchmark's sanitized result/error stream in Railway logs so a
  // one-use launch remains observable without exposing credentials or model source.
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.environment, stdio: ["ignore", "inherit", "inherit"], timeout: readiness.benchmarkId === KERNEL_CODING_BENCHMARK_GRANT.benchmarkId ? 600_000 : 300_000 });
  child.once("exit", (code, signal) => {
    void writeBenchmarkAudit(journal, "owner-launch-exit.json", { code, signal, exitedAt: new Date().toISOString(), replayAllowed: false })
      .catch(() => { console.error("Benchmark launch exit evidence failed; reservation remains held."); });
  });
  await new Promise<void>((done, reject) => { child.once("spawn", done); child.once("error", () => reject(new CodingBenchmarkNotReadyError("BENCHMARK_LAUNCH_FAILED_NO_REPLAY"))); });
  return { schemaVersion: 1, benchmarkId: readiness.benchmarkId, outcome: "started", maximumSpendUsd: readiness.maximumSpendUsd, replayAllowed: false };
}
