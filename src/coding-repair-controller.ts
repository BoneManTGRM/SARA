import { canonicalJson, sha256 } from "./canonical.ts";
import { assertReceiptChain, digestCodingRepairProposal } from "./coding-repair-artifacts.ts";
import {
  boundCodingRepairAttemptLessons,
  buildCodingRepairAttemptLesson,
  digestCodingRepairAttemptLessons,
  passingVerificationChecks,
} from "./coding-repair-lessons.ts";
import { chooseCodingRepairStrategy, INITIAL_CODING_REPAIR_LIMITS, repairYieldPerEnergy } from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import { summarizeCodingRepairSourceChanges } from "./coding-repair-source-signals.ts";
import {
  assessCodingRepairTacticNovelty,
  buildCodingRepairGovernanceSignals,
  summarizeCodingRepairGovernanceTrend,
} from "./coding-repair-tgrm-governance.ts";
import type {
  CodingRepairAttemptLesson,
  CodingRepairLimits,
  CodingRepairProposal,
  CodingRepairReceipt,
  CodingRepairRun,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export type CodingRepairModel = {
  propose(input: {
    candidate: ProgramCandidateProposal;
    verification: ProgramVerificationResult;
    strategy: "surgical" | "deep";
    cycle: number;
    remainingCostUsd: number;
    attemptLessons?: readonly CodingRepairAttemptLesson[];
  }): Promise<{
    proposal: CodingRepairProposal;
    inputTokens: number;
    outputTokens: number;
    accountedCostUsd: number;
  }>;
};

function changedLineCount(before: string, after: string): number {
  const left = before.split("\n");
  const right = after.split("\n");
  const overlap = Math.min(left.length, right.length);
  let changed = Math.abs(left.length - right.length);
  for (let index = 0; index < overlap; index += 1) if (left[index] !== right[index]) changed += 1;
  return changed;
}

function applyProposal(candidate: ProgramCandidateProposal, proposal: CodingRepairProposal): {
  candidate: ProgramCandidateProposal;
  changedLines: number;
} {
  const replacements = new Map(proposal.changes.map((change) => [change.path, change.replacementText]));
  let changedLines = 0;
  const files = candidate.files.map((file) => {
    const replacement = replacements.get(file.path);
    if (replacement === undefined) return file;
    changedLines += changedLineCount(file.content, replacement);
    return { path: file.path, content: replacement };
  });
  return { candidate: { ...candidate, files }, changedLines };
}

function hasRegression(before: ProgramVerificationResult, after: ProgramVerificationResult): boolean {
  const beforePassing = passingVerificationChecks(before);
  const afterPassing = new Set(passingVerificationChecks(after));
  if (beforePassing.some((check) => !afterPassing.has(check))) return true;
  return after.failures.some((failure) => (
    failure.severity === "critical" ||
    failure.kind === "security" ||
    failure.kind === "timeout" ||
    failure.kind === "unknown"
  ));
}

function appendAttemptLesson(
  lessons: readonly CodingRepairAttemptLesson[],
  lesson: CodingRepairAttemptLesson,
): CodingRepairAttemptLesson[] {
  return boundCodingRepairAttemptLessons([...lessons, lesson]);
}

function runResult(input: {
  baseline: ProgramCandidateProposal;
  baselineVerification: ProgramVerificationResult;
  champion: ProgramCandidateProposal;
  state: CodingRepairRun["state"];
  verification: ProgramVerificationResult;
  receipts: CodingRepairReceipt[];
  attemptLessons: CodingRepairAttemptLesson[];
  accountedCostUsd: number;
  runStarted: number;
}): CodingRepairRun {
  const attemptLessons = boundCodingRepairAttemptLessons(input.attemptLessons);
  return {
    baseline: input.baseline,
    baselineVerification: input.baselineVerification,
    champion: input.champion,
    state: input.state,
    verification: input.verification,
    receipts: input.receipts,
    attemptLessons,
    attemptLessonsDigest: digestCodingRepairAttemptLessons(attemptLessons),
    accountedCostUsd: input.accountedCostUsd,
    elapsedMilliseconds: performance.now() - input.runStarted,
  };
}

export async function runCodingRepairController(input: {
  baseline: ProgramCandidateProposal;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits?: CodingRepairLimits;
  onReceipt?: (receipt: CodingRepairReceipt) => Promise<void> | void;
}): Promise<CodingRepairRun> {
  const runStarted = performance.now();
  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;
  let champion = structuredClone(input.baseline);
  let verification = await input.verify(champion);
  const baselineVerification = structuredClone(verification);
  let state: CodingRepairRun["state"] = verification.passed ? "VERIFIED_CANDIDATE" : "BASELINE";
  const receipts: CodingRepairReceipt[] = [];
  let attemptLessons: CodingRepairAttemptLesson[] = [];
  const recurrence = new Map<string, number>();
  const attemptedProposalKeys = new Set<string>();
  let accountedCostUsd = 0;

  if (verification.passed) {
    return runResult({
      baseline: input.baseline,
      baselineVerification,
      champion,
      state,
      verification,
      receipts,
      attemptLessons,
      accountedCostUsd,
      runStarted,
    });
  }

  for (let cycle = 1; cycle <= limits.maximumCycles; cycle += 1) {
    const target = verification.failures[0];
    if (!target) break;
    const seen = (recurrence.get(target.fingerprint) ?? 0) + 1;
    recurrence.set(target.fingerprint, seen);
    const decision = chooseCodingRepairStrategy({
      failures: verification.failures,
      cycle: cycle - 1,
      spentUsd: accountedCostUsd,
      recurrence: seen,
      limits,
    });
    if (decision.strategy === "stop") {
      const receipt: CodingRepairReceipt = {
        cycle,
        beforeArtifactDigest: verification.artifactDigest,
        failureFingerprint: target.fingerprint,
        proposalDigest: sha256(canonicalJson({ decision })),
        afterArtifactDigest: null,
        strategy: "stop",
        changedFiles: 0,
        changedLines: 0,
        verifierEvidenceDigests: verification.evidenceDigests,
        inputTokens: 0,
        outputTokens: 0,
        accountedCostUsd: 0,
        rye: 0,
        outcome: "stopped",
        reasonCode: decision.reasonCode,
      };
      receipts.push(receipt);
      await input.onReceipt?.(structuredClone(receipt));
      state = "STOPPED";
      break;
    }

    const modelStrategy = decision.strategy === "luna_deep" ? "deep" : "surgical";
    const response = await input.model.propose({
      candidate: structuredClone(champion),
      verification: structuredClone(verification),
      strategy: modelStrategy,
      cycle,
      remainingCostUsd: decision.remainingCostUsd,
      attemptLessons: structuredClone(attemptLessons),
    });
    if (
      !Number.isFinite(response.accountedCostUsd) ||
      response.accountedCostUsd < 0 ||
      response.accountedCostUsd > decision.remainingCostUsd
    ) {
      throw new Error("Coding repair model exceeded or malformed its accounted cost.");
    }
    accountedCostUsd += response.accountedCostUsd;
    validateCodingRepairProposal({
      proposal: response.proposal,
      candidate: champion,
      artifactDigest: verification.artifactDigest,
      failureFingerprints: new Set(verification.failures.map((failure) => failure.fingerprint)),
      limits,
      expectedStrategy: modelStrategy,
    });
    const applied = applyProposal(champion, response.proposal);
    const lineLimit = modelStrategy === "surgical" ? limits.surgicalChangedLines : limits.deepChangedLines;
    if (applied.changedLines > lineLimit) {
      throw new Error("Coding repair proposal exceeds its changed-line limit.");
    }

    const proposalDigest = digestCodingRepairProposal(response.proposal);
    const proposalKey = sha256(canonicalJson({
      championArtifactDigest: verification.artifactDigest,
      failureFingerprint: target.fingerprint,
      proposalDigest,
    }));
    if (attemptedProposalKeys.has(proposalKey)) {
      const receipt: CodingRepairReceipt = {
        cycle,
        beforeArtifactDigest: verification.artifactDigest,
        failureFingerprint: target.fingerprint,
        proposalDigest,
        afterArtifactDigest: null,
        strategy: decision.strategy,
        changedFiles: response.proposal.changes.length,
        changedLines: applied.changedLines,
        verifierEvidenceDigests: verification.evidenceDigests,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        accountedCostUsd: response.accountedCostUsd,
        rye: 0,
        outcome: "duplicate_rejected",
        reasonCode: "duplicate_proposal",
      };
      receipts.push(receipt);
      attemptLessons = appendAttemptLesson(attemptLessons, buildCodingRepairAttemptLesson({
        cycle,
        requestedStrategy: modelStrategy,
        proposalDigest,
        championArtifactDigest: verification.artifactDigest,
        proposedArtifactDigest: null,
        changedPaths: response.proposal.changes.map((change) => change.path),
        changedFiles: response.proposal.changes.length,
        changedLines: applied.changedLines,
        before: verification,
        after: verification,
        beforeCandidate: champion,
        afterCandidate: applied.candidate,
        outcome: "duplicate_rejected",
        reasonCode: receipt.reasonCode,
        rye: 0,
      }));
      await input.onReceipt?.(structuredClone(receipt));
      continue;
    }
    attemptedProposalKeys.add(proposalKey);

    const governanceTrend = summarizeCodingRepairGovernanceTrend(
      buildCodingRepairGovernanceSignals({ lessons: attemptLessons, limits }),
    );
    const proposedSourceChanges = summarizeCodingRepairSourceChanges({
      before: champion,
      after: applied.candidate,
      changedPaths: response.proposal.changes.map((change) => change.path),
    });
    const novelty = assessCodingRepairTacticNovelty({
      trend: governanceTrend,
      sourceChanges: proposedSourceChanges,
    });
    if (!novelty.allowed) {
      const receipt: CodingRepairReceipt = {
        cycle,
        beforeArtifactDigest: verification.artifactDigest,
        failureFingerprint: target.fingerprint,
        proposalDigest,
        afterArtifactDigest: null,
        strategy: decision.strategy,
        changedFiles: response.proposal.changes.length,
        changedLines: applied.changedLines,
        verifierEvidenceDigests: verification.evidenceDigests,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        accountedCostUsd: response.accountedCostUsd,
        rye: 0,
        outcome: "duplicate_rejected",
        reasonCode: "semantic_tactic_repeat",
      };
      receipts.push(receipt);
      attemptLessons = appendAttemptLesson(attemptLessons, buildCodingRepairAttemptLesson({
        cycle,
        requestedStrategy: modelStrategy,
        proposalDigest,
        championArtifactDigest: verification.artifactDigest,
        proposedArtifactDigest: null,
        changedPaths: response.proposal.changes.map((change) => change.path),
        changedFiles: response.proposal.changes.length,
        changedLines: applied.changedLines,
        before: verification,
        after: verification,
        beforeCandidate: champion,
        afterCandidate: applied.candidate,
        outcome: "duplicate_rejected",
        reasonCode: receipt.reasonCode,
        rye: 0,
      }));
      await input.onReceipt?.(structuredClone(receipt));
      continue;
    }

    const beforeVerification = verification;
    const started = performance.now();
    const nextVerification = await input.verify(applied.candidate);
    const verificationMilliseconds = performance.now() - started;
    const improved = nextVerification.score > beforeVerification.score && !hasRegression(beforeVerification, nextVerification);
    const outcome: CodingRepairReceipt["outcome"] = nextVerification.passed
      ? "verified_complete"
      : improved
        ? "accepted_improvement"
        : "rolled_back";
    const accepted = improved || nextVerification.passed;
    const rye = repairYieldPerEnergy({
      verificationGain: nextVerification.score - beforeVerification.score,
      costUsd: response.accountedCostUsd,
      changedLines: applied.changedLines,
      verificationMilliseconds,
    });
    const receipt: CodingRepairReceipt = {
      cycle,
      beforeArtifactDigest: beforeVerification.artifactDigest,
      failureFingerprint: target.fingerprint,
      proposalDigest,
      afterArtifactDigest: accepted ? nextVerification.artifactDigest : null,
      strategy: decision.strategy,
      changedFiles: response.proposal.changes.length,
      changedLines: applied.changedLines,
      verifierEvidenceDigests: nextVerification.evidenceDigests,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      accountedCostUsd: response.accountedCostUsd,
      rye,
      outcome,
      reasonCode: accepted
        ? (nextVerification.passed ? "verified_clean" : "monotonic_improvement")
        : "regression_or_no_progress",
    };
    receipts.push(receipt);
    if (!nextVerification.passed) {
      attemptLessons = appendAttemptLesson(attemptLessons, buildCodingRepairAttemptLesson({
        cycle,
        requestedStrategy: modelStrategy,
        proposalDigest,
        championArtifactDigest: beforeVerification.artifactDigest,
        proposedArtifactDigest: nextVerification.artifactDigest,
        changedPaths: response.proposal.changes.map((change) => change.path),
        changedFiles: response.proposal.changes.length,
        changedLines: applied.changedLines,
        before: beforeVerification,
        after: nextVerification,
        beforeCandidate: champion,
        afterCandidate: applied.candidate,
        outcome: outcome === "accepted_improvement" ? "accepted_improvement" : "rolled_back",
        reasonCode: receipt.reasonCode,
        rye,
      }));
    }
    await input.onReceipt?.(structuredClone(receipt));
    if (accepted) {
      champion = applied.candidate;
      verification = nextVerification;
      state = nextVerification.passed ? "VERIFIED_CANDIDATE" : "PROVISIONAL_CHAMPION";
    }
    if (nextVerification.passed) break;
  }

  if (state !== "VERIFIED_CANDIDATE" && receipts.length >= limits.maximumCycles) state = "STOPPED";
  assertReceiptChain(receipts);
  return runResult({
    baseline: input.baseline,
    baselineVerification,
    champion,
    state,
    verification,
    receipts,
    attemptLessons,
    accountedCostUsd,
    runStarted,
  });
}
