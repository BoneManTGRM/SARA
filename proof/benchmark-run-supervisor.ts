import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { canonicalJson } from "../src/canonical.ts";
import { claimBenchmarkRun, type BenchmarkRunGrant } from "./benchmark-run-admission.ts";

const execFileAsync = promisify(execFile);
const HEX64 = /^[a-f0-9]{64}$/u;

type ExecuteInput = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

type Execute = (input: ExecuteInput) => Promise<number>;

export type OwnerSupervisedBenchmarkInput = {
  repoRoot: string;
  ledgerDirectory: string;
  grant: BenchmarkRunGrant;
  contractPath: string;
  runnerPath: string;
  runnerDigest: string;
  apiKey: string;
  now: number;
  execute?: Execute;
};

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function exactRegularFile(root: string, requested: string, requiredPrefix: string): Promise<string> {
  if (!requested || isAbsolute(requested) || requested.includes("\0")) throw new Error("INVALID_RUNNER_PATH");
  const absolute = resolve(root, requested);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel) || !rel.startsWith(`${requiredPrefix}${sep}`)) {
    throw new Error("INVALID_RUNNER_PATH");
  }
  const stat = await lstat(absolute).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("RUNNER_UNAVAILABLE");
  const actual = await realpath(absolute);
  if (actual !== absolute) throw new Error("RUNNER_UNAVAILABLE");
  return absolute;
}

async function defaultExecute(input: ExecuteInput): Promise<number> {
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(input.executable, input.args, { cwd: input.cwd, env: input.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error("BENCHMARK_CHILD_SIGNALLED"));
      else resolveExit(code ?? 1);
    });
  });
}

/**
 * Claims the contract before execution, validates checked-out source and exact runner,
 * then runs exactly one local owner-supervised child. The provider credential is passed
 * only to that child and is never persisted in the claim ledger. Railway execution is refused.
 */
export async function launchOwnerSupervisedBenchmarkOnce(input: OwnerSupervisedBenchmarkInput): Promise<void> {
  if (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID) {
    throw new Error("EXTERNAL_SUPERVISOR_REQUIRED");
  }
  if (!input.apiKey?.trim()) throw new Error("API_KEY_REQUIRED");
  if (!isAbsolute(input.repoRoot)) throw new Error("INVALID_REPO_ROOT");
  if (!HEX64.test(input.runnerDigest)) throw new Error("INVALID_RUNNER_DIGEST");
  const root = await realpath(input.repoRoot).catch(() => null);
  if (!root || root !== resolve(input.repoRoot)) throw new Error("INVALID_REPO_ROOT");
  const runner = await exactRegularFile(root, input.runnerPath, "proof");
  const contractFile = await exactRegularFile(root, input.contractPath, "proof");
  const actualRunnerDigest = sha256Bytes(await readFile(runner));
  if (actualRunnerDigest !== input.runnerDigest) throw new Error("RUNNER_IDENTITY_MISMATCH");
  let contract: unknown;
  try { contract = JSON.parse(await readFile(contractFile, "utf8")); }
  catch { throw new Error("CONTRACT_UNREADABLE"); }
  const contractDigest = createHash("sha256").update(canonicalJson(contract)).digest("hex");
  if (contractDigest !== input.grant.contractDigest) throw new Error("CONTRACT_IDENTITY_MISMATCH");
  let head: string;
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 5000 });
    head = result.stdout.trim();
  } catch { throw new Error("SOURCE_IDENTITY_UNAVAILABLE"); }
  if (head !== input.grant.implementationCommit) throw new Error("SOURCE_IDENTITY_MISMATCH");
  await claimBenchmarkRun({
    ledgerDirectory: input.ledgerDirectory,
    grant: input.grant,
    observed: { contractDigest, implementationCommit: head, deploymentId: input.grant.deploymentId },
    now: input.now,
  });
  const env: Record<string, string> = {
    OPENAI_API_KEY: input.apiKey,
    SARA_BENCHMARK_COMMIT_SHA: head,
    SARA_OWNER_SUPERVISED: "1",
    NODE_ENV: "production",
  };
  const execute = input.execute ?? defaultExecute;
  const code = await execute({
    executable: process.execPath,
    args: ["--import", "tsx", runner, "--live", `--acknowledge-max-spend-usd=${input.grant.maximumPhysicalSpendUsd}`],
    cwd: root,
    env,
  });
  if (code !== 0) throw new Error("BENCHMARK_CHILD_FAILED");
}
