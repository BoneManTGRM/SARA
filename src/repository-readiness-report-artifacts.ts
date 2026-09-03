import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { PublicRepositoryEvidenceSnapshot } from "./public-repository-evidence.ts";
import {
  compileRepositoryReadinessReport,
  type RepositoryReadinessReport,
  type RepositoryReadinessReportInput,
} from "./repository-readiness-report.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const DRAFT_KEYS = ["categoryEvidence", "evidenceLimitations", "findings"] as const;

export type RepositoryReadinessReportArtifact = {
  schemaVersion: 1;
  jobId: string;
  sourceOutputDigest: string;
  reportDigest: string;
  report: RepositoryReadinessReport;
  storedAt: string;
};

function assertSafeId(value: string): void {
  if (!SAFE_ID.test(value)) throw new Error("jobId is not a safe identifier.");
}

function reportDirectory(stateDirectory: string): string {
  return join(stateDirectory, "repository-readiness-reports");
}

function reportPath(stateDirectory: string, jobId: string): string {
  assertSafeId(jobId);
  return join(reportDirectory(stateDirectory), `${jobId}.json`);
}

function repairCategoryEvidenceNotes(value: unknown): {
  categoryEvidence: RepositoryReadinessReportInput["categoryEvidence"];
  repairedCount: number;
} {
  if (!Array.isArray(value)) {
    return {
      categoryEvidence: value as RepositoryReadinessReportInput["categoryEvidence"],
      repairedCount: 0,
    };
  }
  let repairedCount = 0;
  const categoryEvidence = value.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;
    const candidate = record as Record<string, unknown>;
    if (typeof candidate.note === "string" && candidate.note.trim()) return record;
    repairedCount += 1;
    return {
      ...candidate,
      note: candidate.status === "unavailable"
        ? "No eligible immutable sampled evidence was available for this category; the model's malformed note was replaced locally."
        : "Reviewed only from the listed immutable sampled evidence; the model's malformed note was replaced locally.",
    };
  });
  return {
    categoryEvidence: categoryEvidence as RepositoryReadinessReportInput["categoryEvidence"],
    repairedCount,
  };
}

function categoryNoteRepairLimitation(repairedCount: number): string {
  return `SARA deterministically replaced ${repairedCount} missing or malformed category evidence ${repairedCount === 1 ? "note" : "notes"}; no evidence URL, finding, priority, confidence, or recommendation was invented.`;
}

function workerDraft(outputText: string): Pick<
  RepositoryReadinessReportInput,
  "categoryEvidence" | "findings" | "evidenceLimitations"
> {
  if (Buffer.byteLength(outputText, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Repository-readiness worker output exceeds 256 KiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("Repository-readiness worker output must be one JSON object without Markdown fences.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Repository-readiness worker output must be one JSON object.");
  }
  const keys = Object.keys(parsed).sort();
  if (keys.length !== DRAFT_KEYS.length || keys.some((key, index) => key !== DRAFT_KEYS[index])) {
    throw new Error(`Repository-readiness worker output must contain exactly: ${DRAFT_KEYS.join(", ")}.`);
  }
  const draft = parsed as Partial<RepositoryReadinessReportInput>;
  const repaired = repairCategoryEvidenceNotes(draft.categoryEvidence);
  const evidenceLimitations = Array.isArray(draft.evidenceLimitations as unknown)
    ? [
      ...(draft.evidenceLimitations as readonly string[]),
      ...(repaired.repairedCount > 0 ? [categoryNoteRepairLimitation(repaired.repairedCount)] : []),
    ]
    : draft.evidenceLimitations as RepositoryReadinessReportInput["evidenceLimitations"];
  return {
    categoryEvidence: repaired.categoryEvidence,
    findings: draft.findings as RepositoryReadinessReportInput["findings"],
    evidenceLimitations,
  };
}

function validateCollectedEvidence(
  report: RepositoryReadinessReport,
  snapshot: PublicRepositoryEvidenceSnapshot,
): void {
  const sampled = new Map(snapshot.sampledFiles.map((file) => [new URL(file.permalink).toString(), file]));
  for (const category of report.categoryEvidence) {
    for (const evidenceUrl of category.evidenceUrls) {
      if (!sampled.has(evidenceUrl)) {
        throw new Error("Report evidence must come from the immutable sampled evidence packet.");
      }
    }
  }
  for (const finding of report.findings) {
    const citation = new URL(finding.evidenceUrl);
    const match = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/u.exec(citation.hash);
    citation.hash = "";
    const file = sampled.get(citation.toString());
    if (!file || !match) throw new Error("Finding evidence must cite a sampled source line.");
    const firstLine = Number(match[1]);
    const lastLine = Number(match[2] ?? match[1]);
    const visibleLineCount = file.sourceText.split(/\r?\n/u).length;
    if (lastLine < firstLine || lastLine > visibleLineCount) {
      throw new Error("Finding evidence line range must exist in the sampled source text.");
    }
  }
}

export function compileRepositoryReadinessWorkerOutput(input: {
  outputText: string;
  snapshot: PublicRepositoryEvidenceSnapshot;
}): RepositoryReadinessReport {
  const draft = workerDraft(input.outputText);
  const report = compileRepositoryReadinessReport({
    repository: input.snapshot.repository,
    immutableCommitSha: input.snapshot.immutableCommitSha,
    categoryEvidence: draft.categoryEvidence,
    findings: draft.findings,
    evidenceLimitations: [
      ...input.snapshot.limitations,
      ...draft.evidenceLimitations,
    ],
  });
  validateCollectedEvidence(report, input.snapshot);
  if (report.status !== "ready_for_owner_review") {
    throw new Error("Repository-readiness report still needs evidence and cannot enter owner review.");
  }
  return report;
}

export async function persistRepositoryReadinessReportArtifact(input: {
  stateDirectory: string;
  jobId: string;
  sourceOutputDigest: string;
  outputText: string;
  snapshot: PublicRepositoryEvidenceSnapshot;
  storedAt?: Date;
}): Promise<RepositoryReadinessReportArtifact> {
  assertSafeId(input.jobId);
  if (!SHA256_HEX.test(input.sourceOutputDigest) || sha256(input.outputText) !== input.sourceOutputDigest) {
    throw new Error("Repository-readiness source output digest mismatch.");
  }
  const report = compileRepositoryReadinessWorkerOutput({ outputText: input.outputText, snapshot: input.snapshot });
  const reportDigest = sha256(canonicalJson(report));
  const artifact: RepositoryReadinessReportArtifact = {
    schemaVersion: 1,
    jobId: input.jobId,
    sourceOutputDigest: input.sourceOutputDigest,
    reportDigest,
    report,
    storedAt: (input.storedAt ?? new Date()).toISOString(),
  };
  const raw = canonicalJson(artifact);
  if (Buffer.byteLength(raw, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Repository-readiness report artifact exceeds 256 KiB.");
  }
  const directory = reportDirectory(input.stateDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = reportPath(input.stateDirectory, input.jobId);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(raw, "utf8");
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

export async function readRepositoryReadinessReportArtifact(input: {
  stateDirectory: string;
  jobId: string;
}): Promise<RepositoryReadinessReportArtifact> {
  const raw = await readFile(reportPath(input.stateDirectory, input.jobId), "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_ARTIFACT_BYTES) throw new Error("Repository-readiness report artifact is oversized.");
  const artifact = JSON.parse(raw) as Partial<RepositoryReadinessReportArtifact>;
  if (
    artifact.schemaVersion !== 1 ||
    artifact.jobId !== input.jobId ||
    typeof artifact.sourceOutputDigest !== "string" ||
    !SHA256_HEX.test(artifact.sourceOutputDigest) ||
    typeof artifact.reportDigest !== "string" ||
    !SHA256_HEX.test(artifact.reportDigest) ||
    !artifact.report ||
    artifact.report.externalDeliveryAuthorized !== false ||
    artifact.report.status !== "ready_for_owner_review" ||
    sha256(canonicalJson(artifact.report)) !== artifact.reportDigest ||
    typeof artifact.storedAt !== "string" ||
    !Number.isFinite(Date.parse(artifact.storedAt))
  ) {
    throw new Error("Repository-readiness report artifact integrity check failed.");
  }
  return artifact as RepositoryReadinessReportArtifact;
}
