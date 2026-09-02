import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { WorkerModelExecutionEvidence } from "./model-router.ts";
import type { RevenuePilotLease } from "./revenue-pilot.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 256 * 1024;

export type RevenuePilotArtifact = {
  schemaVersion: 1;
  jobId: string;
  role: RevenuePilotLease["role"];
  outputDigest: string;
  outputText: string;
  modelExecution: WorkerModelExecutionEvidence;
  storedAt: string;
};

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is not a safe identifier.`);
}

function artifactDirectory(stateDirectory: string): string {
  return join(stateDirectory, "revenue-pilot-artifacts");
}

function artifactPath(stateDirectory: string, jobId: string, role: RevenuePilotLease["role"]): string {
  assertSafeId(jobId, "jobId");
  assertSafeId(role, "role");
  return join(artifactDirectory(stateDirectory), `${jobId}.${role}.json`);
}

export async function persistRevenuePilotArtifact(input: {
  stateDirectory: string;
  jobId: string;
  role: RevenuePilotLease["role"];
  outputDigest: string;
  outputText: string;
  modelExecution: WorkerModelExecutionEvidence;
  storedAt?: Date;
}): Promise<RevenuePilotArtifact> {
  if (!SHA256_HEX.test(input.outputDigest)) throw new Error("outputDigest must be a SHA-256 digest.");
  if (!input.outputText.trim()) throw new Error("A non-empty private output is required.");
  if (Buffer.byteLength(input.outputText, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Private output exceeds the 256 KiB artifact limit.");
  }
  if (sha256(input.outputText) !== input.outputDigest) throw new Error("Private output digest mismatch.");
  const directory = artifactDirectory(input.stateDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const artifact: RevenuePilotArtifact = {
    schemaVersion: 1,
    jobId: input.jobId,
    role: input.role,
    outputDigest: input.outputDigest,
    outputText: input.outputText,
    modelExecution: structuredClone(input.modelExecution),
    storedAt: (input.storedAt ?? new Date()).toISOString(),
  };
  const destination = artifactPath(input.stateDirectory, input.jobId, input.role);
  const temporary = `${destination}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(canonicalJson(artifact), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return structuredClone(artifact);
}

export async function readRevenuePilotArtifact(input: {
  stateDirectory: string;
  jobId: string;
  role: RevenuePilotLease["role"];
  expectedDigest: string;
}): Promise<RevenuePilotArtifact> {
  const raw = await readFile(artifactPath(input.stateDirectory, input.jobId, input.role), "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_ARTIFACT_BYTES + 2_048) throw new Error("Private artifact is oversized.");
  const artifact = JSON.parse(raw) as Partial<RevenuePilotArtifact>;
  if (
    artifact.schemaVersion !== 1 ||
    artifact.jobId !== input.jobId ||
    artifact.role !== input.role ||
    artifact.outputDigest !== input.expectedDigest ||
    typeof artifact.outputText !== "string" ||
    sha256(artifact.outputText) !== input.expectedDigest ||
    !artifact.modelExecution ||
    artifact.modelExecution.schemaVersion !== 1 ||
    artifact.modelExecution.outputDigest !== input.expectedDigest ||
    !Number.isFinite(artifact.modelExecution.accountedCostUsd) ||
    artifact.modelExecution.accountedCostUsd < 0 ||
    typeof artifact.storedAt !== "string" ||
    !Number.isFinite(Date.parse(artifact.storedAt))
  ) {
    throw new Error("Private artifact integrity check failed.");
  }
  return artifact as RevenuePilotArtifact;
}

export async function readPendingRevenuePilotArtifact(input: {
  stateDirectory: string;
  jobId: string;
  role: RevenuePilotLease["role"];
}): Promise<RevenuePilotArtifact | null> {
  try {
    const raw = await readFile(artifactPath(input.stateDirectory, input.jobId, input.role), "utf8");
    const parsed = JSON.parse(raw) as Partial<RevenuePilotArtifact>;
    if (typeof parsed.outputDigest !== "string") throw new Error("Private artifact integrity check failed.");
    return await readRevenuePilotArtifact({ ...input, expectedDigest: parsed.outputDigest });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
