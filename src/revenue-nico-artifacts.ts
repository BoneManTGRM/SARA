import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { NicoArtifactIdentity } from "./nico-operator.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RUN_ID = /^comprun_[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;

export type RevenueNicoArtifact = {
  schemaVersion: 1;
  jobId: string;
  runId: string;
  repository: string;
  commitSha: string;
  state: "running" | "package_ready";
  artifactIdentity: NicoArtifactIdentity | null;
  packageDigest: string | null;
  contentType: string | null;
  updatedAt: string;
};

function paths(stateDirectory: string, jobId: string): { directory: string; metadata: string; packagePath: string } {
  if (!SAFE_ID.test(jobId)) throw new Error("NICO revenue job ID is unsafe.");
  const directory = join(stateDirectory, "revenue-nico");
  return { directory, metadata: join(directory, `${jobId}.json`), packagePath: join(directory, `${jobId}.package`) };
}

function validate(value: RevenueNicoArtifact, jobId: string): RevenueNicoArtifact {
  if (value.schemaVersion !== 1 || value.jobId !== jobId || !RUN_ID.test(value.runId)) throw new Error("NICO revenue artifact identity is invalid.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository) || !/^[0-9a-f]{40}$/u.test(value.commitSha)) throw new Error("NICO revenue target is invalid.");
  if (!new Set(["running", "package_ready"]).has(value.state)) throw new Error("NICO revenue artifact state is invalid.");
  if (value.state === "package_ready" && (!value.artifactIdentity || !value.packageDigest || !SHA256.test(value.packageDigest))) {
    throw new Error("Completed NICO revenue artifact lacks integrity evidence.");
  }
  if (value.artifactIdentity && (
    value.artifactIdentity.run_id !== value.runId ||
    !SHA256.test(value.artifactIdentity.report_artifact_digest) ||
    Object.values(value.artifactIdentity.artifact_digests).some((digest) => !SHA256.test(digest))
  )) throw new Error("NICO revenue artifact contains a stale or malformed report identity.");
  if (value.contentType && !new Set(["application/zip", "application/octet-stream"]).has(value.contentType)) {
    throw new Error("NICO revenue package content type is unsupported.");
  }
  return value;
}

async function atomicWrite(path: string, body: Uint8Array | string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function readRevenueNicoArtifact(stateDirectory: string, jobId: string): Promise<RevenueNicoArtifact | null> {
  const target = paths(stateDirectory, jobId);
  let parsed: RevenueNicoArtifact;
  try {
    parsed = validate(JSON.parse(await readFile(target.metadata, "utf8")) as RevenueNicoArtifact, jobId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (parsed.state === "package_ready") {
    const body = await readFile(target.packagePath);
    if (body.byteLength > MAX_PACKAGE_BYTES || sha256(body) !== parsed.packageDigest) throw new Error("NICO revenue package integrity check failed.");
  }
  return parsed;
}

export async function persistRevenueNicoRun(input: {
  stateDirectory: string;
  jobId: string;
  runId: string;
  repository: string;
  commitSha: string;
  updatedAt: string;
}): Promise<RevenueNicoArtifact> {
  const target = paths(input.stateDirectory, input.jobId);
  await mkdir(target.directory, { recursive: true, mode: 0o700 });
  const value: RevenueNicoArtifact = validate({ schemaVersion: 1, jobId: input.jobId, runId: input.runId, repository: input.repository, commitSha: input.commitSha, state: "running", artifactIdentity: null, packageDigest: null, contentType: null, updatedAt: input.updatedAt }, input.jobId);
  await atomicWrite(target.metadata, `${canonicalJson(value)}\n`);
  return value;
}

export async function persistRevenueNicoPackage(input: {
  stateDirectory: string;
  artifact: RevenueNicoArtifact;
  artifactIdentity: NicoArtifactIdentity;
  body: Uint8Array;
  contentType: string;
  providerDigest: string | null;
  updatedAt: string;
}): Promise<RevenueNicoArtifact> {
  if (input.body.byteLength === 0 || input.body.byteLength > MAX_PACKAGE_BYTES) throw new Error("NICO revenue package size is invalid.");
  const digest = sha256(Buffer.from(input.body));
  if (input.providerDigest !== digest) throw new Error("NICO package provider digest is missing or mismatched.");
  const target = paths(input.stateDirectory, input.artifact.jobId);
  await mkdir(target.directory, { recursive: true, mode: 0o700 });
  await atomicWrite(target.packagePath, input.body);
  const value: RevenueNicoArtifact = validate({ ...input.artifact, state: "package_ready", artifactIdentity: input.artifactIdentity, packageDigest: digest, contentType: input.contentType, updatedAt: input.updatedAt }, input.artifact.jobId);
  try {
    await atomicWrite(target.metadata, `${canonicalJson(value)}\n`);
  } catch (error) {
    await rm(target.packagePath, { force: true });
    throw error;
  }
  return value;
}

export async function readRevenueNicoPackage(stateDirectory: string, jobId: string): Promise<{ artifact: RevenueNicoArtifact; body: Uint8Array }> {
  const artifact = await readRevenueNicoArtifact(stateDirectory, jobId);
  if (!artifact || artifact.state !== "package_ready" || !artifact.packageDigest) throw new Error("Authorized NICO package is not ready.");
  const body = new Uint8Array(await readFile(paths(stateDirectory, jobId).packagePath));
  if (sha256(Buffer.from(body)) !== artifact.packageDigest) throw new Error("NICO revenue package integrity check failed.");
  return { artifact, body };
}
