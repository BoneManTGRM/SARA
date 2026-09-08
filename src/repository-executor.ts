import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";

/** Operator-qualified public-base image, never an official judge image. */
export interface RepositoryEnvironment {
  schemaVersion: 1;
  repository: string;
  baseCommit: string;
  image: string;
  publicTestCommand: string[];
  timeoutSeconds: number;
}
export interface RepositoryTask {
  instanceId: string;
  problemStatement: string;
  arm: "conventional" | "reparodynamic";
  runId: string;
}
export interface RepositoryPatch {
  environmentDigest: string;
  taskDigest: string;
  patch: string;
}
export interface RepositoryGenerator {
  id: string;
  external: boolean;
  maximumCostUsd: number;
  generate(input: { task: RepositoryTask; environment: RepositoryEnvironment;
    environmentDigest: string; taskDigest: string; memoryNamespace: string;
    beforeAction: () => Promise<void> }): Promise<RepositoryPatch>;
}
export interface RepositoryVerification {
  schemaVersion: 1;
  candidateDigest: string;
  environmentDigest: string;
  taskDigest: string;
  patchDigest: string;
  outputDigest: string;
  exitCode: number;
  elapsedMilliseconds: number;
  artifactRelativePath: string;
  productionAuthority: false;
  officialBenchmarkResult: false;
}

export function validateRepositoryEnvironment(value: RepositoryEnvironment): void {
  if (Object.keys(value).sort().join(",") !== "baseCommit,image,publicTestCommand,repository,schemaVersion,timeoutSeconds") throw new Error("REPOSITORY_ENVIRONMENT_FIELDS");
  if (value.schemaVersion !== 1 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)
    || !/^[a-f0-9]{40}$/.test(value.baseCommit)
    || !/^(?:sha256:[a-f0-9]{64}|[a-z0-9./_-]+@sha256:[a-f0-9]{64})$/.test(value.image)
    || !Number.isSafeInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 900
    || !Array.isArray(value.publicTestCommand) || value.publicTestCommand.length < 1
    || value.publicTestCommand.length > 32 || value.publicTestCommand.some(x => typeof x !== "string" || !x || x.length > 4096 || x.includes("\0"))) {
    throw new Error("REPOSITORY_ENVIRONMENT_INVALID");
  }
}

export function repositoryBinding(environment: RepositoryEnvironment, task: RepositoryTask) {
  validateRepositoryEnvironment(environment);
  if (Object.keys(task).sort().join(",") !== "arm,instanceId,problemStatement,runId") throw new Error("REPOSITORY_TASK_FIELDS");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(task.instanceId)
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(task.runId)
    || !["conventional", "reparodynamic"].includes(task.arm)
    || typeof task.problemStatement !== "string" || !task.problemStatement || task.problemStatement.length > 100000) {
    throw new Error("REPOSITORY_TASK_INVALID");
  }
  return { environmentDigest: sha256(canonicalJson(environment)), taskDigest: sha256(canonicalJson(task)),
    memoryNamespace: `repository:${task.runId}:${task.instanceId}:${task.arm}` };
}

/** Deliberately restrict unsupported Git encodings/modes instead of guessing. */
export function validateRepositoryPatch(patch: string): void {
  if (typeof patch !== "string" || Buffer.byteLength(patch) > 1024 * 1024 || patch.includes("\0")) throw new Error("REPOSITORY_PATCH_SIZE");
  if (patch === "") return; // Preserve empty/failed predictions for grading.
  let files = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/([^\s]+) b\/([^\s]+)$/.exec(line);
      if (!match || match[1] !== match[2]) throw new Error("REPOSITORY_PATCH_PATH");
      const path = match[1]!;
      if (path.length > 240 || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error("REPOSITORY_PATCH_PATH");
      files++;
    } else if (/^(?:old mode|new mode|new file mode|deleted file mode) /.test(line)) {
      if (!/ (?:100644|100755)$/.test(line)) throw new Error("REPOSITORY_PATCH_MODE");
    } else if (line.startsWith("index ")) {
      if (!/^index [a-f0-9]+\.\.[a-f0-9]+(?: 100(?:644|755))?$/.test(line)) throw new Error("REPOSITORY_PATCH_MODE");
    } else if (/^(?:rename |copy |GIT binary patch|Binary files )/.test(line)) throw new Error("REPOSITORY_PATCH_UNSUPPORTED");
  }
  if (!patch.startsWith("diff --git ") || files < 1 || files > 256) throw new Error("REPOSITORY_PATCH_FORMAT");
}

export type RepositoryCommandResult = { exitCode: number; output: string };
type CommandResult = RepositoryCommandResult;
/** Trusted host seam. Request bodies and producer proposals never select it. */
export type RepositorySessionHandle = Pick<RepositorySession, "run" | "mustRun" | "freezePatch" | "close">;
export type RepositorySessionFactory = (environment: RepositoryEnvironment) => Promise<RepositorySessionHandle>;
function docker(args: string[], timeoutSeconds: number, input?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    // No shell, provider keys, Git credentials, Docker context overrides or host mounts.
    const child = spawn("docker", args, { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", bytes = 0, failed = false;
    const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); reject(new Error("REPOSITORY_COMMAND_TIMEOUT")); }, timeoutSeconds * 1000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { failed = true; child.kill("SIGKILL"); reject(new Error("REPOSITORY_OUTPUT_LIMIT")); }
      else output += chunk.toString("utf8");
    });
    child.on("error", error => { clearTimeout(timer); failed = true; reject(error); });
    child.on("close", code => { clearTimeout(timer); if (!failed) resolve({ exitCode: code ?? 1, output }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Each session gets a new writable tmpfs; the pinned image stays read-only. */
export class RepositorySession {
  readonly #name = `sara-repository-${randomUUID()}`;
  readonly #environment: RepositoryEnvironment;
  #closed = false;
  private constructor(environment: RepositoryEnvironment) { this.#environment = structuredClone(environment); }
  static async start(environment: RepositoryEnvironment): Promise<RepositorySession> {
    validateRepositoryEnvironment(environment);
    const session = new RepositorySession(environment);
    try {
      const result = await docker(["run", "--detach", "--pull=never", "--name", session.#name,
        "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--user=1000:1000", "--cpus=2", "--memory=2g", "--memory-swap=2g", "--pids-limit=256",
        "--tmpfs=/work:rw,exec,nosuid,nodev,size=4g,uid=1000,gid=1000",
        "--tmpfs=/tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000", "--workdir=/work",
        "--env=HOME=/tmp", "--entrypoint=/bin/sleep", environment.image, "1800"], 30);
      if (result.exitCode !== 0) throw new Error(`REPOSITORY_CONTAINER_START: ${result.output}`);
      await session.mustRun(["cp", "-R", "/sara/base/.", "/work/"]);
      const commit = await session.mustRun(["git", "rev-parse", "HEAD"]);
      if (commit.output.trim() !== environment.baseCommit) throw new Error("REPOSITORY_BASE_MISMATCH");
      const history = await session.mustRun(["git", "rev-list", "--all", "--count"]);
      if (history.output.trim() !== "1") throw new Error("REPOSITORY_FUTURE_HISTORY");
      const clean = await session.mustRun(["git", "status", "--porcelain", "--untracked-files=no"]);
      if (clean.output.trim()) throw new Error("REPOSITORY_BASE_DIRTY");
      return session;
    } catch (error) { await session.close(); throw error; }
  }
  async run(command: string[], input?: string): Promise<CommandResult> {
    if (this.#closed || !command.length || command.some(x => typeof x !== "string" || x.includes("\0"))) throw new Error("REPOSITORY_SESSION_COMMAND");
    try { return await docker(["exec", "-i", this.#name, ...command], this.#environment.timeoutSeconds, input); }
    catch (error) { await this.close(); throw error; }
  }
  async mustRun(command: string[], input?: string): Promise<CommandResult> {
    const result = await this.run(command, input);
    if (result.exitCode !== 0) throw new Error(`REPOSITORY_COMMAND_FAILED: ${result.output}`);
    return result;
  }
  async freezePatch(): Promise<string> {
    await this.mustRun(["git", "add", "--all"]);
    const result = await this.mustRun(["git", "diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", this.#environment.baseCommit, "--"]);
    validateRepositoryPatch(result.output);
    return result.output;
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const result = await docker(["rm", "--force", this.#name], 30);
    if (result.exitCode !== 0 && !result.output.includes("No such container")) throw new Error("REPOSITORY_CONTAINER_CLEANUP_FAILED");
  }
}

async function writeDurable(path: string, content: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
}

/** Kernel calls this concrete verifier; producer callbacks cannot supply PASS. */
export async function verifyRepositoryPatch(stateDirectory: string, environment: RepositoryEnvironment,
  task: RepositoryTask, proposal: RepositoryPatch,
  startSession: RepositorySessionFactory = RepositorySession.start): Promise<RepositoryVerification> {
  environment = structuredClone(environment); task = structuredClone(task); proposal = structuredClone(proposal);
  const binding = repositoryBinding(environment, task);
  if (proposal.environmentDigest !== binding.environmentDigest || proposal.taskDigest !== binding.taskDigest) throw new Error("REPOSITORY_BINDING_MISMATCH");
  validateRepositoryPatch(proposal.patch);
  const candidateDigest = sha256(canonicalJson(proposal));
  const artifactRelativePath = `repository-lab/${randomUUID()}`;
  const directory = join(stateDirectory, artifactRelativePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeDurable(join(directory, "patch.diff"), proposal.patch);
  await writeDurable(join(directory, "input.json"), canonicalJson({ environment, task, proposal }));
  const started = performance.now();
  let session: RepositorySessionHandle | undefined;
  let result: CommandResult;
  try {
    session = await startSession(environment);
    if (proposal.patch) {
      await session.mustRun(["git", "apply", "--check", "--whitespace=nowarn", "-"], proposal.patch);
      await session.mustRun(["git", "apply", "--whitespace=nowarn", "-"], proposal.patch);
    }
    result = await session.run(environment.publicTestCommand);
  } catch (error) { result = { exitCode: 1, output: error instanceof Error ? error.message : "REPOSITORY_VERIFIER_FAILED" }; }
  finally {
    if (session) try { await session.close(); }
    catch (error) {
      // Cleanup uncertainty must retain a failed receipt, never turn into PASS
      // or erase the original test output by throwing before persistence.
      result = { exitCode: 1, output: `${result!.output}\nCLEANUP_FAILED: ${error instanceof Error ? error.message : "unknown"}` };
    }
  }
  await writeDurable(join(directory, "verification.log"), result.output);
  const receipt: RepositoryVerification = { schemaVersion: 1, candidateDigest, ...binding,
    patchDigest: sha256(proposal.patch), outputDigest: sha256(result.output), exitCode: result.exitCode,
    elapsedMilliseconds: performance.now() - started, artifactRelativePath,
    productionAuthority: false, officialBenchmarkResult: false };
  await writeDurable(join(directory, "receipt.json"), canonicalJson(receipt));
  const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
  return receipt;
}

export async function verifyRepositoryArtifact(stateDirectory: string, receipt: RepositoryVerification): Promise<void> {
  if (!/^repository-lab\/[a-f0-9-]{36}$/.test(receipt.artifactRelativePath)) throw new Error("REPOSITORY_ARTIFACT_PATH");
  const directory = join(stateDirectory, receipt.artifactRelativePath);
  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8")) as {
    environment: RepositoryEnvironment; task: RepositoryTask; proposal: RepositoryPatch };
  const binding = repositoryBinding(input.environment, input.task);
  if (binding.environmentDigest !== receipt.environmentDigest || binding.taskDigest !== receipt.taskDigest
    || input.proposal.environmentDigest !== receipt.environmentDigest || input.proposal.taskDigest !== receipt.taskDigest
    || sha256(canonicalJson(input.proposal)) !== receipt.candidateDigest
    || sha256(await readFile(join(directory, "patch.diff"), "utf8")) !== receipt.patchDigest
    || sha256(input.proposal.patch) !== receipt.patchDigest
    || sha256(await readFile(join(directory, "verification.log"), "utf8")) !== receipt.outputDigest
    || await readFile(join(directory, "receipt.json"), "utf8") !== canonicalJson(receipt)) throw new Error("REPOSITORY_ARTIFACT_MISMATCH");
}
