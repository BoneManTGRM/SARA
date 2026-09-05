import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type {
  RevenuePilotTestingJob,
  RevenuePilotTestingStatus,
} from "./revenue-pilot-testing.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_JOB_FILE_BYTES = 512 * 1024;
const MAX_STORED_JOBS = 1_000;
const TESTING_STATUSES = new Set<RevenuePilotTestingStatus>([
  "testing_ready",
  "testing_review",
  "queued",
  "running",
  "failed",
  "testing_complete",
]);

type StoredRevenuePilotTestingJob = {
  schemaVersion: 1;
  job: RevenuePilotTestingJob;
  jobDigest: string;
};

function jobsDirectory(stateDirectory: string): string {
  return join(stateDirectory, "revenue-pilot-testing-jobs");
}

function jobPath(stateDirectory: string, jobId: string): string {
  if (!SAFE_ID.test(jobId)) throw new Error("Testing job id is not a safe identifier.");
  return join(jobsDirectory(stateDirectory), `${jobId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function assertRevenuePilotTestingJobIntegrity(
  value: unknown,
): asserts value is RevenuePilotTestingJob {
  if (!isRecord(value) || typeof value.id !== "string" || !SAFE_ID.test(value.id)) {
    throw new Error("Testing job integrity check failed: invalid identity.");
  }
  if (!isRecord(value.input) || !isRecord(value.plan)) {
    throw new Error("Testing job integrity check failed: invalid input or plan.");
  }
  if (Object.hasOwn(value.input, "customerBudgetUsd") || Object.hasOwn(value.plan, "priceUsd")) {
    throw new Error("Testing job integrity check failed: commercial price fields are prohibited.");
  }
  if (
    value.plan.billingMode !== "testing_no_charge" ||
    value.plan.externalDeliveryAllowed !== false ||
    value.plan.revenueRecognitionAllowed !== false
  ) {
    throw new Error("Testing job integrity check failed: no-charge boundary changed.");
  }
  if (
    value.revenueEvidenceId !== null ||
    value.externalDeliveryAuthorized !== false ||
    value.deliveryApprovalId !== null ||
    value.deliveredAt !== null
  ) {
    throw new Error("Testing job integrity check failed: revenue or delivery authority is present.");
  }
  if (typeof value.status !== "string" || !TESTING_STATUSES.has(value.status as RevenuePilotTestingStatus)) {
    throw new Error("Testing job integrity check failed: invalid status.");
  }
  if (!Array.isArray(value.completedRoles) || !Array.isArray(value.receipts)) {
    throw new Error("Testing job integrity check failed: invalid execution records.");
  }
  if (
    typeof value.actualExecutionCostUsd !== "number" ||
    !Number.isFinite(value.actualExecutionCostUsd) ||
    value.actualExecutionCostUsd < 0
  ) {
    throw new Error("Testing job integrity check failed: invalid execution cost.");
  }
  const roles = new Set(["work_director", "specialist_worker", "independent_verifier", "delivery_operator"]);
  if (value.activeLease !== null) {
    const lease = value.activeLease;
    if (!isRecord(lease) || typeof lease.id !== "string" || !SAFE_ID.test(lease.id) ||
        typeof lease.workerId !== "string" || !SAFE_ID.test(lease.workerId) ||
        typeof lease.role !== "string" || !roles.has(lease.role) || lease.role !== value.nextRole ||
        !hasValidTimestamp(lease.claimedAt) || !hasValidTimestamp(lease.expiresAt) ||
        Date.parse(lease.expiresAt) <= Date.parse(lease.claimedAt) || value.status !== "running") {
      throw new Error("Testing job integrity check failed: invalid unresolved lease.");
    }
  } else if (value.status === "running") {
    throw new Error("Testing job integrity check failed: running job has no durable lease.");
  }
  for (const receipt of value.receipts) {
    if (!isRecord(receipt) || typeof receipt.role !== "string" || !roles.has(receipt.role) ||
        typeof receipt.costUsd !== "number" || !Number.isFinite(receipt.costUsd) || receipt.costUsd < 0 ||
        !hasValidTimestamp(receipt.completedAt)) {
      throw new Error("Testing job integrity check failed: invalid accounted receipt.");
    }
  }
  if (!hasValidTimestamp(value.createdAt) || !hasValidTimestamp(value.updatedAt)) {
    throw new Error("Testing job integrity check failed: invalid timestamps.");
  }
  if (
    value.testingAuthorizationId !== null &&
    (typeof value.testingAuthorizationId !== "string" || !SAFE_ID.test(value.testingAuthorizationId))
  ) {
    throw new Error("Testing job integrity check failed: invalid testing authorization.");
  }
  if (value.status === "testing_ready" && value.plan.decision !== "offer_ready") {
    throw new Error("Testing job integrity check failed: testing-ready state is not offer-ready.");
  }
  if (value.status === "testing_review" && value.plan.decision !== "owner_review") {
    throw new Error("Testing job integrity check failed: testing-review state has no review decision.");
  }
  if (
    (value.status === "queued" || value.status === "running" || value.status === "testing_complete") &&
    value.testingAuthorizationId === null
  ) {
    throw new Error("Testing job integrity check failed: executable state lacks owner test authorization.");
  }
}

export async function persistRevenuePilotTestingJob(input: {
  stateDirectory: string;
  job: RevenuePilotTestingJob;
}): Promise<RevenuePilotTestingJob> {
  assertRevenuePilotTestingJobIntegrity(input.job);
  const directory = jobsDirectory(input.stateDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const job = structuredClone(input.job);
  const envelope: StoredRevenuePilotTestingJob = {
    schemaVersion: 1,
    job,
    jobDigest: sha256(canonicalJson(job)),
  };
  const serialized = canonicalJson(envelope);
  if (Buffer.byteLength(serialized, "utf8") > MAX_JOB_FILE_BYTES) {
    throw new Error("Testing job exceeds the 512 KiB private-state limit.");
  }
  const destination = jobPath(input.stateDirectory, job.id);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
    // Dispatch follows this method. Persist the directory entry as well as file
    // bytes so a returned durable claim is not only a rename in volatile metadata.
    for (const parent of [directory, input.stateDirectory]) {
      const directoryHandle = await open(parent, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return structuredClone(job);
}

export async function readRevenuePilotTestingJob(input: {
  stateDirectory: string;
  jobId: string;
}): Promise<RevenuePilotTestingJob | null> {
  let raw: Buffer;
  try {
    raw = await readFile(jobPath(input.stateDirectory, input.jobId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (raw.length > MAX_JOB_FILE_BYTES) throw new Error("Stored testing job is oversized.");
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.job)) {
    throw new Error("Stored testing job integrity check failed.");
  }
  assertRevenuePilotTestingJobIntegrity(parsed.job);
  if (
    typeof parsed.jobDigest !== "string" ||
    !SHA256_HEX.test(parsed.jobDigest) ||
    parsed.jobDigest !== sha256(canonicalJson(parsed.job)) ||
    parsed.job.id !== input.jobId
  ) {
    throw new Error("Stored testing job integrity check failed.");
  }
  return structuredClone(parsed.job);
}

export async function listRevenuePilotTestingJobs(
  stateDirectory: string,
): Promise<RevenuePilotTestingJob[]> {
  let entries;
  try {
    entries = await readdir(jobsDirectory(stateDirectory), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (filenames.length > MAX_STORED_JOBS) {
    throw new Error("Stored testing job count exceeds the 1,000-job limit.");
  }
  const jobs: RevenuePilotTestingJob[] = [];
  for (const filename of filenames) {
    const jobId = filename.slice(0, -".json".length);
    const job = await readRevenuePilotTestingJob({ stateDirectory, jobId });
    if (!job) throw new Error("Stored testing job disappeared during enumeration.");
    jobs.push(job);
  }
  return jobs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
