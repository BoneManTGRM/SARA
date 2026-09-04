import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingFailureSignal, CodingRepairLimits, CodingRepairProposal } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export const CODING_REPAIR_OUTPUT_CONTRACT = "OUTPUT CONTRACT: SARA_CODING_REPAIR_V1";

export function buildCodingRepairPrompt(input: {
  objective: string;
  acceptanceCriteria: string[];
  candidate: ProgramCandidateProposal;
  artifactDigest: string;
  failures: CodingFailureSignal[];
  previouslyPassingChecks: string[];
  remainingCycles: number;
  remainingCostUsd: number;
  verifiedLessons: string[];
  constitutionDigest: string;
  limits: CodingRepairLimits;
  strategy: "surgical" | "deep";
}): string {
  const maximumFiles = input.strategy === "surgical" ? input.limits.surgicalFiles : input.limits.deepFiles;
  const maximumChangedLines = input.strategy === "surgical" ? input.limits.surgicalChangedLines : input.limits.deepChangedLines;
  return [
    CODING_REPAIR_OUTPUT_CONTRACT,
    "Return one JSON object only. The strategy field must exactly equal requiredStrategy. Propose a bounded replacement for listed candidate files; do not claim verification.",
    canonicalJson({
      objective: input.objective,
      acceptanceCriteria: input.acceptanceCriteria,
      currentArtifactDigest: input.artifactDigest,
      requiredStrategy: input.strategy,
      failures: input.failures,
      files: input.candidate.files.map((file) => ({
        path: file.path,
        contentDigest: sha256(file.content),
        ...(file.path.startsWith("tests/") ? { immutableTest: true } : { content: file.content }),
      })),
      previouslyPassingChecks: input.previouslyPassingChecks,
      maximumFiles,
      maximumChangedLines,
      remainingCycles: input.remainingCycles,
      remainingCostUsd: input.remainingCostUsd,
      verifiedLessons: input.verifiedLessons,
      constitutionDigest: input.constitutionDigest,
      forbidden: ["package installs", "shell commands", "network operations", "deployment", "authority requests", "unknown files"],
    }),
  ].join("\n");
}

export function validateCodingRepairProposal(input: {
  proposal: CodingRepairProposal;
  candidate: ProgramCandidateProposal;
  artifactDigest: string;
  failureFingerprints: ReadonlySet<string>;
  limits: CodingRepairLimits;
  expectedStrategy: "surgical" | "deep";
}): void {
  const { proposal, candidate, artifactDigest, failureFingerprints, limits, expectedStrategy } = input;
  if (proposal.schemaVersion !== 1) throw new Error("Coding repair schema version is unsupported.");
  if (proposal.baseArtifactDigest !== artifactDigest) throw new Error("Coding repair proposal targets a stale artifact.");
  if (!failureFingerprints.has(proposal.failureFingerprint)) throw new Error("Coding repair proposal targets an unknown failure.");
  if (proposal.strategy !== expectedStrategy) throw new Error("Coding repair proposal attempted a strategy escalation.");
  const maximumFiles = expectedStrategy === "surgical" ? limits.surgicalFiles : limits.deepFiles;
  if (!proposal.changes.length || proposal.changes.length > maximumFiles) throw new Error("Coding repair proposal exceeds its file limit.");
  const files = new Map(candidate.files.map((file) => [file.path, file.content]));
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    const current = files.get(change.path);
    if (current === undefined || seen.has(change.path)) throw new Error("Coding repair proposal contains an unknown or duplicate file.");
    if (limits.protectedPaths.some((prefix) => change.path === prefix || change.path.startsWith(prefix))) {
      throw new Error("Coding repair proposal targets a protected path.");
    }
    if (sha256(current) !== change.expectedContentDigest) throw new Error("Coding repair proposal contains a stale file digest.");
    if (!change.replacementText.trim()) throw new Error("Coding repair replacement cannot be empty.");
    seen.add(change.path);
  }
  if (proposal.limitations.length > 16 || proposal.limitations.some((item) => !item.trim() || item.length > 300)) {
    throw new Error("Coding repair limitations are malformed.");
  }
}
