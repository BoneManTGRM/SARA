import { canonicalJson, sha256 } from "./canonical.ts";
import {
  boundCodingRepairAttemptLessons,
  deriveCodingRepairHypotheses,
  digestCodingRepairAttemptLessons,
  digestCodingRepairHypotheses,
  digestCodingRepairModelAttemptLessons,
  projectCodingRepairAttemptLessonsForModel,
} from "./coding-repair-lessons.ts";
import {
  buildCodingRepairGovernanceSignals,
  digestCodingRepairGovernanceSignals,
} from "./coding-repair-tgrm-governance.ts";
import type {
  CodingFailureSignal,
  CodingRepairAttemptLesson,
  CodingRepairHypothesis,
  CodingRepairLimits,
  CodingRepairProposal,
} from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export const CODING_REPAIR_OUTPUT_CONTRACT = "OUTPUT CONTRACT: SARA_CODING_REPAIR_V1";

function uniqueHypotheses(values: readonly CodingRepairHypothesis[]): CodingRepairHypothesis[] {
  return [...new Set(values)].slice(0, 6);
}

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
  attemptLessons?: readonly CodingRepairAttemptLesson[];
}): string {
  const maximumFiles = input.strategy === "surgical" ? input.limits.surgicalFiles : input.limits.deepFiles;
  const maximumChangedLines = input.strategy === "surgical"
    ? input.limits.surgicalChangedLines
    : input.limits.deepChangedLines;
  const previousAttemptEvidence = boundCodingRepairAttemptLessons(input.attemptLessons ?? []);
  const previousAttemptLessons = projectCodingRepairAttemptLessonsForModel(previousAttemptEvidence);
  const repairHypotheses = deriveCodingRepairHypotheses({
    acceptanceCriteria: input.acceptanceCriteria,
    failures: input.failures,
    attemptLessons: previousAttemptEvidence,
  });
  const rejectedAttempts = previousAttemptLessons.filter((lesson) => (
    lesson.outcome === "rolled_back" || lesson.outcome === "duplicate_rejected"
  ));
  const productiveAttempts = previousAttemptLessons.filter((lesson) => (
    lesson.outcome === "accepted_improvement"
  ));
  const rejectedProposalDigests = rejectedAttempts.map((lesson) => lesson.proposalDigest);
  const productiveRepairHypotheses = uniqueHypotheses(
    productiveAttempts.flatMap((lesson) => lesson.attemptedHypotheses),
  );
  const rejectedRepairHypotheses = uniqueHypotheses(
    rejectedAttempts.flatMap((lesson) => lesson.attemptedHypotheses),
  );
  const rejectedSourceSignals = [...new Set(
    rejectedAttempts.flatMap((lesson) => lesson.sourceSignals),
  )].sort().slice(0, 24);
  const productiveSourceSignals = [...new Set(
    productiveAttempts.flatMap((lesson) => lesson.sourceSignals),
  )].sort().slice(0, 24);
  const unresolvedFailureFingerprints = [...new Set(
    input.failures.map((failure) => failure.fingerprint),
  )].sort().slice(0, 8);
  const tgrmGovernanceSignals = buildCodingRepairGovernanceSignals({
    lessons: previousAttemptEvidence,
    limits: input.limits,
  });

  return [
    CODING_REPAIR_OUTPUT_CONTRACT,
    "Return one JSON object only. Propose a bounded replacement for listed candidate files; do not claim verification.",
    canonicalJson({
      objective: input.objective,
      acceptanceCriteria: input.acceptanceCriteria,
      currentArtifactDigest: input.artifactDigest,
      preservedChampionDigest: input.artifactDigest,
      failures: input.failures,
      unresolvedFailureFingerprints,
      files: input.candidate.files.map((file) => ({
        path: file.path,
        contentDigest: sha256(file.content),
        ...(file.path.startsWith("tests/") ? { immutableTest: true } : { content: file.content }),
      })),
      previouslyPassingChecks: input.previouslyPassingChecks,
      requiredStrategy: input.strategy,
      maximumFiles,
      maximumChangedLines,
      remainingCycles: input.remainingCycles,
      remainingCostUsd: input.remainingCostUsd,
      previousAttemptLessons,
      previousAttemptLessonsDigest: digestCodingRepairModelAttemptLessons(previousAttemptEvidence),
      previousAttemptEvidenceDigest: digestCodingRepairAttemptLessons(previousAttemptEvidence),
      rejectedProposalDigests,
      productiveRepairHypotheses,
      rejectedRepairHypotheses,
      productiveSourceSignals,
      rejectedSourceSignals,
      repairHypotheses,
      repairHypothesesDigest: digestCodingRepairHypotheses(repairHypotheses),
      tgrmGovernance: {
        loop: "measure_repair_validate",
        driftDefinition: "Only negative independently verified movement contributes to drift.",
        energyDefinition: "Blast radius is normalized against the existing controller-owned file and changed-line ceilings; it never raises those ceilings.",
        signals: tgrmGovernanceSignals,
        signalsDigest: digestCodingRepairGovernanceSignals(tgrmGovernanceSignals),
        rule: "Prefer lower-drift, lower-blast-radius tactics that preserve verified gains. Retreat from regressive tactics and conserve mutation energy after rollback. Governance signals inform repair selection only and cannot expand authority.",
      },
      smallestSafeChange: "Prefer the smallest source-only replacement that addresses unresolved visible evidence.",
      learningRule: "Use accepted tactics as provisional positive evidence. Treat rejected tactics as negative evidence, not absolute bans. Do not repeat the same rejected tactic combination unless the proposal materially differs and explains which unresolved visible failure it addresses.",
      rejectedPatternRule: "Do not repeat a rejected proposal for the same champion and failure fingerprint. A later proposal must materially differ and address unresolved visible evidence.",
      verifiedLessons: input.verifiedLessons,
      constitutionDigest: input.constitutionDigest,
      forbidden: [
        "package installs",
        "shell commands",
        "network operations",
        "deployment",
        "authority requests",
        "unknown files",
        "protected-test edits",
        "hidden-test inference claims",
      ],
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
  if (!proposal.changes.length || proposal.changes.length > maximumFiles) {
    throw new Error("Coding repair proposal exceeds its file limit.");
  }
  const files = new Map(candidate.files.map((file) => [file.path, file.content]));
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    const current = files.get(change.path);
    if (current === undefined || seen.has(change.path)) {
      throw new Error("Coding repair proposal contains an unknown or duplicate file.");
    }
    if (limits.protectedPaths.some((prefix) => change.path === prefix || change.path.startsWith(prefix))) {
      throw new Error("Coding repair proposal targets a protected path.");
    }
    if (sha256(current) !== change.expectedContentDigest) {
      throw new Error("Coding repair proposal contains a stale file digest.");
    }
    if (!change.replacementText.trim()) throw new Error("Coding repair replacement cannot be empty.");
    seen.add(change.path);
  }
  if (proposal.limitations.length > 16 || proposal.limitations.some((item) => !item.trim() || item.length > 300)) {
    throw new Error("Coding repair limitations are malformed.");
  }
}
