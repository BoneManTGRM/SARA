import { canonicalJson, sha256 } from "./canonical.ts";
import { assertReceiptChain, digestCodingRepairProposal } from "./coding-repair-artifacts.ts";
import { chooseCodingRepairStrategy, INITIAL_CODING_REPAIR_LIMITS, repairYieldPerEnergy } from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import type {
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
  const previouslyPassingKinds = new Set(["syntax", "type", "policy", "security", "integrity", "test", "behavior"]);
  for (const failure of before.failures) previouslyPassingKinds.delete(failure.kind);
  return after.failures.some((failure) => previouslyPassingKinds.has(failure.kind));
}

export async function runCodingRepairController(input: {
  baseline: ProgramCandidateProposal;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits?: CodingRepairLimits;
}): Promise<CodingRepairRun> {
  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;
  let champion = structuredClone(input.baseline);
  let verification = await input.verify(champion);
  let state: CodingRepairRun["state"] = verification.passed ? "VERIFIED_CANDIDATE" : "BASELINE";
  const receipts: CodingRepairReceipt[] = [];
  const recurrence = new Map<string, number>();
  let accountedCostUsd = 0;
  if (verification.passed) return { baseline: input.baseline, champion, state, verification, receipts, accountedCostUsd };

  for (let cycle = 1; cycle <= limits.maximumCycles; cycle += 1) {
    const target = verification.failures[0];
    if (!target) break;
    const seen = (recurrence.get(target.fingerprint) ?? 0) + 1;
    recurrence.set(target.fingerprint, seen);
    const decision = chooseCodingRepairStrategy({ failures: verification.failures, cycle: cycle - 1, spentUsd: accountedCostUsd, recurrence: seen, limits });
    if (decision.strategy === "stop") {
      receipts.push({
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
      });
      state = "STOPPED";
      break;
    }
    const modelStrategy = decision.strategy === "luna_deep" ? "deep" : "surgical";
    const response = await input.model.propose({ candidate: structuredClone(champion), verification, strategy: modelStrategy, cycle, remainingCostUsd: decision.remainingCostUsd });
    if (!Number.isFinite(response.accountedCostUsd) || response.accountedCostUsd < 0 || response.accountedCostUsd > decision.remainingCostUsd) {
      throw new Error("Coding repair model exceeded or malformed its accounted cost.");
    }
    accountedCostUsd += response.accountedCostUsd;
    validateCodingRepairProposal({
      proposal: response.proposal,
      candidate: champion,
      artifactDigest: verification.artifactDigest,
      failureFingerprints: new Set(verification.failures.map((failure) => failure.fingerprint)),
      limits,
    });
    const applied = applyProposal(champion, response.proposal);
    const lineLimit = modelStrategy === "surgical" ? limits.surgicalChangedLines : limits.deepChangedLines;
    if (applied.changedLines > lineLimit) throw new Error("Coding repair proposal exceeds its changed-line limit.");
    const started = performance.now();
    const nextVerification = await input.verify(applied.candidate);
    const verificationMilliseconds = performance.now() - started;
    const improved = nextVerification.score > verification.score && !hasRegression(verification, nextVerification);
    const outcome: CodingRepairReceipt["outcome"] = nextVerification.passed
      ? "verified_complete"
      : improved
        ? "accepted_improvement"
        : "rolled_back";
    const accepted = improved || nextVerification.passed;
    const receipt: CodingRepairReceipt = {
      cycle,
      beforeArtifactDigest: verification.artifactDigest,
      failureFingerprint: target.fingerprint,
      proposalDigest: digestCodingRepairProposal(response.proposal),
      afterArtifactDigest: accepted ? nextVerification.artifactDigest : null,
      strategy: decision.strategy,
      changedFiles: response.proposal.changes.length,
      changedLines: applied.changedLines,
      verifierEvidenceDigests: nextVerification.evidenceDigests,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      accountedCostUsd: response.accountedCostUsd,
      rye: repairYieldPerEnergy({ verificationGain: nextVerification.score - verification.score, costUsd: response.accountedCostUsd, changedLines: applied.changedLines, verificationMilliseconds }),
      outcome,
      reasonCode: accepted ? (nextVerification.passed ? "verified_clean" : "monotonic_improvement") : "regression_or_no_progress",
    };
    receipts.push(receipt);
    if (accepted) {
      champion = applied.candidate;
      verification = nextVerification;
      state = nextVerification.passed ? "VERIFIED_CANDIDATE" : "PROVISIONAL_CHAMPION";
    }
    if (nextVerification.passed) break;
  }
  if (state !== "VERIFIED_CANDIDATE" && receipts.length >= limits.maximumCycles) state = "STOPPED";
  assertReceiptChain(receipts);
  return { baseline: input.baseline, champion, state, verification, receipts, accountedCostUsd };
}
