import { canonicalJson, sha256 } from "./canonical.ts";
import { digestCodingRepairProposal } from "./coding-repair-artifacts.ts";
import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import {
  boundCodingRepairAttemptLessons,
  buildCodingRepairAttemptLesson,
  digestCodingRepairAttemptLessons,
} from "./coding-repair-lessons.ts";
import { INITIAL_CODING_REPAIR_LIMITS, repairYieldPerEnergy } from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import type {
  CodingRepairAttemptLesson,
  CodingRepairLimits,
  CodingRepairProposal,
  CodingRepairReceipt,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

type ModelResponse = Awaited<ReturnType<CodingRepairModel["propose"]>>;
type ControlReceipt = Omit<CodingRepairReceipt, "outcome"> & {
  outcome: "advanced_latest_state" | "verified_complete" | "stopped";
};
type MatchedReceipt = CodingRepairReceipt | ControlReceipt;

const COST_EPSILON = 1e-9;

function assertDigest(value: string, label: string, length: 40 | 64): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) {
    throw new Error(`${label} must be a lowercase hexadecimal digest.`);
  }
}

function assertNoAuthorityExpansion(limits: CodingRepairLimits): void {
  const ceiling = INITIAL_CODING_REPAIR_LIMITS;
  for (const key of [
    "maximumCycles",
    "surgicalFiles",
    "surgicalChangedLines",
    "deepFiles",
    "deepChangedLines",
    "maximumModelSpendUsd",
  ] as const) {
    if (!Number.isFinite(limits[key]) || limits[key] <= 0 || limits[key] > ceiling[key]) {
      throw new Error(`Matched benchmark cannot expand ${key}.`);
    }
  }
  for (const path of ceiling.protectedPaths) {
    if (!limits.protectedPaths.includes(path)) {
      throw new Error("Matched benchmark cannot remove a protected path.");
    }
  }
}

function assertPhysicalSpendLimit(value: number): void {
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd
  ) {
    throw new Error("Matched benchmark cannot expand physical spend.");
  }
}

function changedLineCount(before: string, after: string): number {
  const left = before.split("\n");
  const right = after.split("\n");
  const overlap = Math.min(left.length, right.length);
  let changed = Math.abs(left.length - right.length);
  for (let index = 0; index < overlap; index += 1) if (left[index] !== right[index]) changed += 1;
  return changed;
}

function applyProposal(
  baseline: ProgramCandidateProposal,
  proposal: CodingRepairProposal,
): { candidate: ProgramCandidateProposal; changedLines: number } {
  const replacements = new Map(proposal.changes.map((change) => [change.path, change.replacementText]));
  let changedLines = 0;
  const files = baseline.files.map((file) => {
    const replacement = replacements.get(file.path);
    if (replacement === undefined) return { ...file };
    changedLines += changedLineCount(file.content, replacement);
    return { ...file, content: replacement };
  });
  return { candidate: { ...structuredClone(baseline), files }, changedLines };
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function digestVerification(verification: ProgramVerificationResult): string {
  return sha256(canonicalJson({
    passed: verification.passed,
    score: verification.score,
    artifactDigest: verification.artifactDigest,
    failures: verification.failures,
    completedChecks: verification.completedChecks,
    evidenceDigests: verification.evidenceDigests,
  }));
}

function validateModelCost(response: ModelResponse, maximumCostUsd: number, label: string): void {
  if (
    !Number.isFinite(response.accountedCostUsd) ||
    response.accountedCostUsd < 0 ||
    response.accountedCostUsd - maximumCostUsd > COST_EPSILON
  ) {
    throw new Error(`${label} exceeded or malformed its accounted cost.`);
  }
}

function arm(input: {
  baselineVerification: ProgramVerificationResult;
  verification: ProgramVerificationResult;
  elapsedMilliseconds: number;
  accountedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  receipts: MatchedReceipt[];
  attemptLessons: readonly CodingRepairAttemptLesson[];
}) {
  const milliseconds = rounded(input.elapsedMilliseconds);
  const cost = rounded(input.accountedCostUsd);
  const completion = Number(input.verification.passed);
  const attemptLessons = boundCodingRepairAttemptLessons(input.attemptLessons);
  return {
    verifiedComplete: input.verification.passed,
    score: input.verification.score,
    verificationGain: rounded(input.verification.score - input.baselineVerification.score),
    artifactDigest: input.verification.artifactDigest,
    verificationDigest: digestVerification(input.verification),
    evidenceDigest: sha256(canonicalJson(input.verification.evidenceDigests)),
    activeExecutionMilliseconds: milliseconds,
    accountedCostUsd: cost,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    modelCalls: input.modelCalls,
    cycles: input.receipts.length,
    rollbacks: input.receipts.filter((receipt) => receipt.outcome === "rolled_back").length,
    acceptedImprovements: input.receipts.filter((receipt) => receipt.outcome === "accepted_improvement").length,
    duplicateRejections: input.receipts.filter((receipt) => receipt.outcome === "duplicate_rejected").length,
    changedLines: input.receipts.reduce((sum, receipt) => sum + receipt.changedLines, 0),
    ryeTotal: rounded(input.receipts.reduce((sum, receipt) => sum + receipt.rye, 0)),
    receipts: structuredClone(input.receipts),
    attemptLessons,
    attemptLessonsDigest: digestCodingRepairAttemptLessons(attemptLessons),
    verifiedCompletionsPerActiveSecond: milliseconds > 0 ? rounded(completion * 1_000 / milliseconds) : 0,
    verifiedCompletionsPerUsd: cost > 0 ? rounded(completion / cost) : 0,
  };
}

export async function runMatchedCodingRepairBenchmark(input: {
  caseId: string;
  sourceCommit: string;
  modelRouteKey: string;
  environment: Record<string, string>;
  objective: string;
  acceptanceCriteria: string[];
  constitutionDigest: string;
  memoryContextDigest: string;
  baseline: ProgramCandidateProposal;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits?: CodingRepairLimits;
  physicalMaximumSpendUsd?: number;
}) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(input.caseId)) throw new Error("caseId is malformed.");
  assertDigest(input.sourceCommit, "sourceCommit", 40);
  assertDigest(input.constitutionDigest, "constitutionDigest", 64);
  assertDigest(input.memoryContextDigest, "memoryContextDigest", 64);
  if (!input.modelRouteKey.trim() || !input.objective.trim() || !input.acceptanceCriteria.length) {
    throw new Error("Matched benchmark model, objective, and acceptance criteria are required.");
  }
  const environmentEntries = Object.entries(input.environment).sort(([left], [right]) => left.localeCompare(right));
  if (!environmentEntries.length || environmentEntries.some(([key, value]) => !key.trim() || !value.trim())) {
    throw new Error("Matched benchmark environment must be explicit and non-empty.");
  }

  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;
  const physicalMaximumSpendUsd = input.physicalMaximumSpendUsd
    ?? INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd;
  assertNoAuthorityExpansion(limits);
  assertPhysicalSpendLimit(physicalMaximumSpendUsd);

  const normalizedLimits = { ...limits, protectedPaths: [...limits.protectedPaths] };
  const reasoningSchedule = Array.from(
    { length: limits.maximumCycles },
    () => "medium" as const,
  );
  const authority = {
    maximumCycles: limits.maximumCycles,
    maximumModelSpendUsd: limits.maximumModelSpendUsd,
    physicalMaximumSpendUsd,
    surgicalFiles: limits.surgicalFiles,
    surgicalChangedLines: limits.surgicalChangedLines,
    deepFiles: limits.deepFiles,
    deepChangedLines: limits.deepChangedLines,
    protectedPathsDigest: sha256(canonicalJson([...limits.protectedPaths].sort())),
    repositoryMutation: false as const,
    merge: false as const,
    deploy: false as const,
    promotion: false as const,
  };
  const contract = {
    schemaVersion: 2 as const,
    caseId: input.caseId,
    sourceCommit: input.sourceCommit,
    modelRouteKey: input.modelRouteKey,
    environment: Object.fromEntries(environmentEntries),
    objectiveDigest: sha256(input.objective),
    acceptanceCriteriaDigest: sha256(canonicalJson(input.acceptanceCriteria)),
    constitutionDigest: input.constitutionDigest,
    memoryContextDigest: input.memoryContextDigest,
    baselineDigest: sha256(canonicalJson(input.baseline)),
    controlPolicy: "bounded_latest_state_luna_retry" as const,
    canaryPolicy: "bounded_reparodynamic_rollback_learning_v2" as const,
    sharedFirstProposal: true as const,
    armLimits: {
      control: structuredClone(normalizedLimits),
      canary: structuredClone(normalizedLimits),
    },
    reasoningSchedule: {
      control: [...reasoningSchedule],
      canary: [...reasoningSchedule],
    },
    learning: {
      control: "record_only_not_fed_to_model" as const,
      canary: "bounded_last_two_lessons_fed_to_model" as const,
    },
    physicalMaximumSpendUsd,
    physicalBudgetAllocation: "one_shared_first_call_then_equal_continuation_reserves" as const,
    costAccounting: "shared_first_call_counts_once_physically_and_once_logically_per_arm" as const,
    executionOrder: "control_then_canary_with_first_proposal_replay" as const,
    measurement: {
      verifiedCompletion: "independent_post_verification_pass" as const,
      activeExecutionMilliseconds: "initial_verification_through_independent_post_verification" as const,
      accountedCostUsd: "provider_usage_accounting_bound_to_arm_receipts" as const,
      directTimeAndCostComparison: "only_when_both_arms_are_verified_complete" as const,
    },
    authority,
  };
  const contractDigest = sha256(canonicalJson(contract));

  let physicalSpendUsd = 0;
  let physicalModelCalls = 0;
  let sharedFirstProposalMilliseconds = 0;
  let sharedFirstResponse: ModelResponse | undefined;
  let continuationPhysicalLimitPerArm = 0;
  let controlContinuationSpendUsd = 0;
  let canaryContinuationSpendUsd = 0;

  const callPhysicalModel = async (
    request: Parameters<CodingRepairModel["propose"]>[0],
    physicalAllowanceUsd: number,
    label: string,
  ): Promise<{ response: ModelResponse; elapsedMilliseconds: number }> => {
    const physicalRemainingUsd = Math.max(0, physicalMaximumSpendUsd - physicalSpendUsd);
    const maximumCostUsd = Math.min(request.remainingCostUsd, physicalAllowanceUsd, physicalRemainingUsd);
    if (maximumCostUsd < 0.01) {
      throw new Error(`${label} has insufficient matched physical spend remaining.`);
    }
    const started = performance.now();
    const response = await input.model.propose({ ...request, remainingCostUsd: maximumCostUsd });
    const elapsedMilliseconds = performance.now() - started;
    validateModelCost(response, maximumCostUsd, label);
    physicalSpendUsd += response.accountedCostUsd;
    physicalModelCalls += 1;
    return { response, elapsedMilliseconds };
  };

  const controlStarted = performance.now();
  const controlBaselineVerification = await input.verify(structuredClone(input.baseline));
  if (controlBaselineVerification.failures.some(failure => failure.kind === "policy" && failure.code === "GENOME_LAB_INVALID_STRUCTURE")) {
    throw new Error("Matched benchmark baseline has invalid candidate structure.");
  }
  let controlCandidate = structuredClone(input.baseline);
  let controlVerification = structuredClone(controlBaselineVerification);
  let controlAccountedCostUsd = 0;
  let controlInputTokens = 0;
  let controlOutputTokens = 0;
  let controlModelCalls = 0;
  const controlReceipts: ControlReceipt[] = [];
  let controlAttemptLessons: CodingRepairAttemptLesson[] = [];

  for (let cycle = 1; cycle <= limits.maximumCycles && !controlVerification.passed; cycle += 1) {
    const target = controlVerification.failures[0];
    if (!target) throw new Error("Matched control verifier returned no actionable failure.");
    const logicalRemainingCostUsd = Math.max(0, limits.maximumModelSpendUsd - controlAccountedCostUsd);
    if (logicalRemainingCostUsd < 0.01) break;

    const request: Parameters<CodingRepairModel["propose"]>[0] = {
      candidate: structuredClone(controlCandidate),
      verification: structuredClone(controlVerification),
      strategy: "surgical",
      cycle,
      remainingCostUsd: logicalRemainingCostUsd,
      attemptLessons: [],
    };
    let response: ModelResponse;
    if (cycle === 1) {
      const physical = await callPhysicalModel(request, physicalMaximumSpendUsd, "Shared first Luna proposal");
      response = physical.response;
      sharedFirstProposalMilliseconds = physical.elapsedMilliseconds;
      sharedFirstResponse = structuredClone(response);
      continuationPhysicalLimitPerArm = Math.max(0, (physicalMaximumSpendUsd - physicalSpendUsd) / 2);
    } else {
      const remainingContinuationUsd = Math.max(0, continuationPhysicalLimitPerArm - controlContinuationSpendUsd);
      const physical = await callPhysicalModel(request, remainingContinuationUsd, "Matched control Luna continuation");
      response = physical.response;
      controlContinuationSpendUsd += response.accountedCostUsd;
    }
    validateModelCost(response, logicalRemainingCostUsd, "Matched control Luna");
    validateCodingRepairProposal({
      proposal: response.proposal,
      candidate: controlCandidate,
      artifactDigest: controlVerification.artifactDigest,
      failureFingerprints: new Set(controlVerification.failures.map((failure) => failure.fingerprint)),
      limits,
      expectedStrategy: "surgical",
    });
    const applied = applyProposal(controlCandidate, response.proposal);
    if (applied.changedLines > limits.surgicalChangedLines) {
      throw new Error("Matched control proposal exceeds its changed-line limit.");
    }
    const beforeVerification = controlVerification;
    const verificationStarted = performance.now();
    const nextVerification = await input.verify(applied.candidate);
    const verificationMilliseconds = performance.now() - verificationStarted;
    const rye = repairYieldPerEnergy({
      verificationGain: nextVerification.score - beforeVerification.score,
      costUsd: response.accountedCostUsd,
      changedLines: applied.changedLines,
      verificationMilliseconds,
    });
    const proposalDigest = digestCodingRepairProposal(response.proposal);
    const receipt: ControlReceipt = {
      cycle,
      beforeArtifactDigest: beforeVerification.artifactDigest,
      failureFingerprint: target.fingerprint,
      proposalDigest,
      afterArtifactDigest: nextVerification.artifactDigest,
      strategy: "luna_surgical",
      changedFiles: response.proposal.changes.length,
      changedLines: applied.changedLines,
      verifierEvidenceDigests: nextVerification.evidenceDigests,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      accountedCostUsd: response.accountedCostUsd,
      rye,
      outcome: nextVerification.passed ? "verified_complete" : "advanced_latest_state",
      reasonCode: nextVerification.passed ? "verified_clean" : "latest_state_retry",
    };
    controlReceipts.push(receipt);
    if (!nextVerification.passed) {
      controlAttemptLessons = boundCodingRepairAttemptLessons([
        ...controlAttemptLessons,
        buildCodingRepairAttemptLesson({
          cycle,
          requestedStrategy: "surgical",
          proposalDigest,
          championArtifactDigest: beforeVerification.artifactDigest,
          proposedArtifactDigest: nextVerification.artifactDigest,
          changedPaths: response.proposal.changes.map((change) => change.path),
          changedFiles: response.proposal.changes.length,
          changedLines: applied.changedLines,
          before: beforeVerification,
          after: nextVerification,
          outcome: "advanced_latest_state",
          reasonCode: receipt.reasonCode,
          rye,
        }),
      ]);
    }
    controlCandidate = applied.candidate;
    controlVerification = nextVerification;
    controlAccountedCostUsd += response.accountedCostUsd;
    controlInputTokens += response.inputTokens;
    controlOutputTokens += response.outputTokens;
    controlModelCalls += 1;
  }
  const controlInternalMilliseconds = performance.now() - controlStarted;
  if (!sharedFirstResponse || !controlReceipts.length) {
    throw new Error("Matched benchmark did not produce a shared first Luna proposal.");
  }

  let replayedFirstProposal = false;
  let replayMilliseconds = 0;
  const canaryStarted = performance.now();
  const canaryRun = await runCodingRepairController({
    baseline: input.baseline,
    limits,
    verify: (candidate) => input.verify(candidate),
    model: {
      propose: async (request) => {
        if (!replayedFirstProposal) {
          const replayStarted = performance.now();
          replayedFirstProposal = true;
          const replay = structuredClone(sharedFirstResponse);
          replayMilliseconds += performance.now() - replayStarted;
          return replay;
        }
        const remainingContinuationUsd = Math.max(0, continuationPhysicalLimitPerArm - canaryContinuationSpendUsd);
        const physical = await callPhysicalModel(
          request,
          remainingContinuationUsd,
          "Matched Reparodynamic Luna continuation",
        );
        canaryContinuationSpendUsd += physical.response.accountedCostUsd;
        return physical.response;
      },
    },
  });
  const canaryInternalMilliseconds = Math.max(
    0,
    performance.now() - canaryStarted + sharedFirstProposalMilliseconds - replayMilliseconds,
  );
  if (!replayedFirstProposal) {
    throw new Error("Matched canary did not consume the shared first Luna proposal.");
  }

  const controlAuditStarted = performance.now();
  const controlPost = await input.verify(structuredClone(controlCandidate));
  const controlAuditMilliseconds = performance.now() - controlAuditStarted;
  const canaryAuditStarted = performance.now();
  const canaryPost = await input.verify(structuredClone(canaryRun.champion));
  const canaryAuditMilliseconds = performance.now() - canaryAuditStarted;
  const auditVerificationMilliseconds = rounded(controlAuditMilliseconds + canaryAuditMilliseconds);

  const invalidReasons: string[] = [];
  if (digestVerification(controlPost) !== digestVerification(controlVerification)) {
    invalidReasons.push("control_post_verification_changed");
  }
  if (digestVerification(canaryPost) !== digestVerification(canaryRun.verification)) {
    invalidReasons.push("canary_post_verification_changed");
  }
  if (digestVerification(controlBaselineVerification) !== digestVerification(canaryRun.baselineVerification)) {
    invalidReasons.push("baseline_verification_changed");
  }

  const sharedFirstProposalDigest = digestCodingRepairProposal(sharedFirstResponse.proposal);
  if (controlReceipts[0]?.proposalDigest !== sharedFirstProposalDigest) {
    invalidReasons.push("control_shared_first_proposal_digest_mismatch");
  }
  if (canaryRun.receipts[0]?.proposalDigest !== sharedFirstProposalDigest) {
    invalidReasons.push("canary_shared_first_proposal_digest_mismatch");
  }
  if (controlReceipts.length > limits.maximumCycles || canaryRun.receipts.length > limits.maximumCycles) {
    invalidReasons.push("cycle_ceiling_exceeded");
  }
  if (
    controlAccountedCostUsd - limits.maximumModelSpendUsd > COST_EPSILON ||
    canaryRun.accountedCostUsd - limits.maximumModelSpendUsd > COST_EPSILON
  ) {
    invalidReasons.push("arm_cost_ceiling_exceeded");
  }
  if (physicalSpendUsd - physicalMaximumSpendUsd > COST_EPSILON) {
    invalidReasons.push("physical_cost_ceiling_exceeded");
  }

  const control = arm({
    baselineVerification: controlBaselineVerification,
    verification: controlPost,
    elapsedMilliseconds: controlInternalMilliseconds + controlAuditMilliseconds,
    accountedCostUsd: controlAccountedCostUsd,
    inputTokens: controlInputTokens,
    outputTokens: controlOutputTokens,
    modelCalls: controlModelCalls,
    receipts: controlReceipts,
    attemptLessons: controlAttemptLessons,
  });
  const canaryModelReceipts = canaryRun.receipts.filter((receipt) => receipt.strategy !== "stop");
  const canary = arm({
    baselineVerification: canaryRun.baselineVerification,
    verification: canaryPost,
    elapsedMilliseconds: canaryInternalMilliseconds + canaryAuditMilliseconds,
    accountedCostUsd: canaryRun.accountedCostUsd,
    inputTokens: canaryModelReceipts.reduce((sum, receipt) => sum + receipt.inputTokens, 0),
    outputTokens: canaryModelReceipts.reduce((sum, receipt) => sum + receipt.outputTokens, 0),
    modelCalls: canaryModelReceipts.length,
    receipts: canaryRun.receipts,
    attemptLessons: canaryRun.attemptLessons,
  });
  const deltas = {
    verifiedCompletion: Number(canary.verifiedComplete) - Number(control.verifiedComplete),
    verificationScore: rounded(canary.score - control.score),
    activeExecutionMilliseconds: rounded(canary.activeExecutionMilliseconds - control.activeExecutionMilliseconds),
    accountedCostUsd: rounded(canary.accountedCostUsd - control.accountedCostUsd),
    verifiedCompletionsPerActiveSecond: rounded(
      canary.verifiedCompletionsPerActiveSecond - control.verifiedCompletionsPerActiveSecond,
    ),
    verifiedCompletionsPerUsd: rounded(canary.verifiedCompletionsPerUsd - control.verifiedCompletionsPerUsd),
  };
  const valid = invalidReasons.length === 0;
  const timeAndCostComparable = valid && control.verifiedComplete && canary.verifiedComplete;
  const receiptsDigest = sha256(canonicalJson({
    control: control.receipts,
    canary: canary.receipts,
  }));
  const learningEvidenceDigest = sha256(canonicalJson({
    control: control.attemptLessons,
    canary: canary.attemptLessons,
  }));
  const baselineVerificationDigest = digestVerification(controlBaselineVerification);
  const evidence = {
    contractDigest,
    sharedFirstProposalDigest,
    baselineVerificationDigest,
    control,
    canary,
    physicalSpendUsd: rounded(physicalSpendUsd),
    physicalModelCalls,
    deltas,
    timeAndCostComparable,
    invalidReasons,
    receiptsDigest,
    learningEvidenceDigest,
    auditVerificationMilliseconds,
  };
  return {
    schemaVersion: 2 as const,
    evidenceLevel: "LAB_SINGLE_MATCHED_TRACE" as const,
    caseId: input.caseId,
    sourceCommit: input.sourceCommit,
    modelRouteKey: input.modelRouteKey,
    contract,
    contractDigest,
    sharedFirstProposalDigest,
    baselineVerificationDigest,
    pairDigest: sha256(canonicalJson(evidence)),
    valid,
    invalidReasons,
    control,
    canary,
    physicalSpendUsd: evidence.physicalSpendUsd,
    physicalModelCalls,
    receipts: structuredClone(canaryRun.receipts),
    attemptLessons: structuredClone(canaryRun.attemptLessons),
    attemptLessonsDigest: canaryRun.attemptLessonsDigest,
    receiptsDigest,
    learningEvidenceDigest,
    auditVerificationMilliseconds,
    timeAndCostComparable,
    deltas,
    conclusion: {
      verifiedCompletionImproved: valid ? deltas.verifiedCompletion > 0 : null,
      executionTimeReduced: timeAndCostComparable ? deltas.activeExecutionMilliseconds < 0 : null,
      costReduced: timeAndCostComparable ? deltas.accountedCostUsd < 0 : null,
      verifiedVelocityImproved: valid ? deltas.verifiedCompletionsPerActiveSecond > 0 : null,
      verifiedCostEfficiencyImproved: valid ? deltas.verifiedCompletionsPerUsd > 0 : null,
    },
    generalClaimSupported: false as const,
    authority,
  };
}
