import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boundedCandidateFailureFeedback, CLOUDFLARE_FREE_MODEL, cloudflareQualificationReasoningEffort, cloudflareQualificationThinkingMode } from "./cloudflare-free-generator.ts";
import type { SkillCandidateProposal } from "./types.ts";

const MAX_PROPOSAL_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = MAX_PROPOSAL_BYTES + 1024;
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export type LearningProposalReceipt = { proposalSha256: string; sourceSha256: string; sourceBytes: number };

async function writeEvidence(directory: string, attempt: number, kind: string, value: unknown): Promise<void> {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) throw new Error("Learning evidence attempt must be 1 or 2.");
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) throw new Error("Learning evidence record exceeds its bounded envelope.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Exclusive creation preserves the original evidence even on accidental reuse.
  await writeFile(join(directory, `attempt-${attempt}-${kind}.json`), serialized, {
    encoding: "utf8", mode: 0o600, flag: "wx",
  });
}

export async function recordLearningCall(directory: string, attempt: number, objective: string, reasoningEffort?: "low", thinkingMode?: "disabled"): Promise<void> {
  if (!objective.trim() || objective.length > 1000) throw new Error("Learning evidence objective must contain 1–1,000 characters.");
  const selected = cloudflareQualificationReasoningEffort(reasoningEffort);
  const selectedThinking = cloudflareQualificationThinkingMode(thinkingMode);
  await writeEvidence(directory, attempt, "call", {
    schemaVersion: 1, attempt, event: "generator_call_entered", model: CLOUDFLARE_FREE_MODEL,
    objectiveSha256: digest(objective), recordedAt: new Date().toISOString(),
    maximumCompletionTokens: 8192, usage: "unknown_until_provider_evidence",
    ...(selected ? { reasoningEffort: selected } : {}),
    ...(selectedThinking ? { requestedThinkingMode: selectedThinking } : {}),
  });
}

export async function recordLearningProposal(
  directory: string, attempt: number, proposal: SkillCandidateProposal,
): Promise<LearningProposalReceipt> {
  // Only parsed candidate fields cross this boundary, never a transport envelope.
  const snapshot = structuredClone({ schemaVersion: proposal.schemaVersion, skillName: proposal.skillName,
    summary: proposal.summary, source: proposal.source, tests: proposal.tests, limitations: proposal.limitations });
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROPOSAL_BYTES) throw new Error("Learning evidence proposal exceeds 64 KiB.");
  const receipt = { proposalSha256: digest(serialized), sourceSha256: digest(snapshot.source),
    sourceBytes: Buffer.byteLength(snapshot.source, "utf8") };
  await writeEvidence(directory, attempt, "proposal", {
    schemaVersion: 1, attempt, status: "untrusted_generated_proposal", ...receipt, proposal: snapshot,
  });
  return receipt;
}

function safeFailure(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 8192);
  if (/^Cloudflare inference failed with HTTP [1-5][0-9]{2}\.$/u.test(message)) return message;
  if (/^Cloudflare returned no candidate content\. finish_reason=(?:stop|length|content_filter|tool_calls|function_call|unknown); prompt_tokens=(?:[0-9]{1,7}|unknown); completion_tokens=(?:[0-9]{1,7}|unknown)\.$/u.test(message)) return message;
  return boundedCandidateFailureFeedback(error);
}

export async function recordLearningOutcome(
  directory: string, attempt: number, result: { status: "verified_shadow" | "rejected";
    proposal?: LearningProposalReceipt; candidateDigest?: string; error?: unknown },
): Promise<void> {
  if (result.candidateDigest !== undefined && !/^[a-f0-9]{64}$/u.test(result.candidateDigest)) {
    throw new Error("Learning evidence candidate digest is invalid.");
  }
  const proposal = result.proposal ? { proposalSha256: result.proposal.proposalSha256,
    sourceSha256: result.proposal.sourceSha256, sourceBytes: result.proposal.sourceBytes } : undefined;
  if (proposal && (!/^[a-f0-9]{64}$/u.test(proposal.proposalSha256) || !/^[a-f0-9]{64}$/u.test(proposal.sourceSha256)
    || !Number.isInteger(proposal.sourceBytes) || proposal.sourceBytes < 0 || proposal.sourceBytes > MAX_PROPOSAL_BYTES)) {
    throw new Error("Learning evidence proposal receipt is invalid.");
  }
  if (result.status === "verified_shadow" && (!proposal || !result.candidateDigest)) {
    throw new Error("Verified learning evidence requires its proposal and candidate digests.");
  }
  await writeEvidence(directory, attempt, "outcome", {
    schemaVersion: 1, attempt, status: result.status, recordedAt: new Date().toISOString(),
    ...(proposal ? { proposal } : {}),
    ...(result.candidateDigest ? { candidateDigest: result.candidateDigest } : {}),
    ...(result.status === "rejected" ? { evidence: safeFailure(result.error) } : {}),
    productionAuthority: false,
  });
}
