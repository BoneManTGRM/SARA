import { canonicalJson, sha256 } from "./canonical.ts";
import { digestCodingRepairProposal } from "./coding-repair-artifacts.ts";
import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type {
  CodingRepairLimits,
  CodingRepairProposal,
  CodingRepairReceipt,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

type ModelResponse = Awaited<ReturnType<CodingRepairModel["propose"]>>;

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
    if (!limits.protectedPaths.includes(path)) throw new Error("Matched benchmark cannot remove a protected path.");
  }
}

function applyProposal(baseline: ProgramCandidateProposal, proposal: CodingRepairProposal): ProgramCandidateProposal {
  const replacements = new Map(proposal.changes.map((change) => [change.path, change.replacementText]));
  return {
    ...structuredClone(baseline),
    files: baseline.files.map((file) => ({ ...file, content: replacements.get(file.path) ?? file.content })),
  };
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

function arm(input: {
  baselineVerification: ProgramVerificationResult;
  verification: ProgramVerificationResult;
  elapsedMilliseconds: number;
  accountedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  receipts: CodingRepairReceipt[];
}) {
  const milliseconds = rounded(input.elapsedMilliseconds);
  const cost = rounded(input.accountedCostUsd);
  const completion = Number(input.verification.passed);
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
    changedLines: input.receipts.reduce((sum, receipt) => sum + receipt.changedLines, 0),
    ryeTotal: rounded(input.receipts.reduce((sum, receipt) => sum + receipt.rye, 0)),
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
  assertNoAuthorityExpansion(limits);
  const authority = {
    maximumCycles: limits.maximumCycles,
    maximumModelSpendUsd: limits.maximumModelSpendUsd,
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
    schemaVersion: 1 as const,
    caseId: input.caseId,
    sourceCommit: input.sourceCommit,
    modelRouteKey: input.modelRouteKey,
    environment: Object.fromEntries(environmentEntries),
    objectiveDigest: sha256(input.objective),
    acceptanceCriteriaDigest: sha256(canonicalJson(input.acceptanceCriteria)),
    constitutionDigest: input.constitutionDigest,
    memoryContextDigest: input.memoryContextDigest,
    baselineDigest: sha256(canonicalJson(input.baseline)),
    limits: { ...limits, protectedPaths: [...limits.protectedPaths] },
    controlPolicy: "same_first_luna_proposal_then_stop" as const,
    canaryPolicy: "same_first_luna_proposal_then_bounded_verify_repair_retain" as const,
    costAccounting: "shared_prefix_physical_spend_equals_canary_run_do_not_sum_arm_costs" as const,
    measurement: {
      verifiedCompletion: "independent_post_verification_pass" as const,
      activeExecutionMilliseconds: "monotonic_wall_clock_from_initial_verification_through_policy_stop" as const,
      accountedCostUsd: "provider_usage_accounting_bound_to_receipts" as const,
      directTimeAndCostComparison: "only_when_both_arms_are_verified_complete" as const,
    },
    authority,
  };
  const contractDigest = sha256(canonicalJson(contract));

  const models: ModelResponse[] = [];
  const verifications: ProgramVerificationResult[] = [];
  let firstReceiptElapsedMilliseconds: number | undefined;
  const activeRunStarted = performance.now();
  const run = await runCodingRepairController({
    baseline: input.baseline,
    limits,
    verify: async (candidate) => {
      const result = await input.verify(candidate);
      verifications.push(structuredClone(result));
      return result;
    },
    model: {
      propose: async (request) => {
        const response = await input.model.propose(request);
        models.push(structuredClone(response));
        return response;
      },
    },
    onReceipt: () => {
      firstReceiptElapsedMilliseconds ??= performance.now() - activeRunStarted;
    },
  });
  const canaryActiveExecutionMilliseconds = performance.now() - activeRunStarted;

  const firstModel = models[0];
  const firstReceipt = run.receipts[0];
  const firstVerification = verifications[1];
  if (!firstModel || !firstReceipt || !firstVerification || firstReceiptElapsedMilliseconds === undefined || firstReceipt.outcome === "stopped") {
    throw new Error("Matched benchmark did not produce a first Luna repair trace.");
  }

  const auditStarted = performance.now();
  const controlPost = await input.verify(applyProposal(input.baseline, firstModel.proposal));
  const canaryPost = await input.verify(run.champion);
  const auditVerificationMilliseconds = rounded(performance.now() - auditStarted);
  const invalidReasons: string[] = [];
  if (digestVerification(controlPost) !== digestVerification(firstVerification)) {
    invalidReasons.push("control_post_verification_changed");
  }
  if (digestVerification(canaryPost) !== digestVerification(run.verification)) {
    invalidReasons.push("canary_post_verification_changed");
  }
  const sharedFirstProposalDigest = digestCodingRepairProposal(firstModel.proposal);
  if (firstReceipt.proposalDigest !== sharedFirstProposalDigest) invalidReasons.push("shared_first_proposal_digest_mismatch");
  const modelReceipts = run.receipts.filter((receipt) => receipt.strategy !== "stop");
  if (modelReceipts.length !== models.length) invalidReasons.push("model_receipt_count_mismatch");
  const receiptCostUsd = modelReceipts.reduce((sum, receipt) => sum + receipt.accountedCostUsd, 0);
  if (Math.abs(receiptCostUsd - run.accountedCostUsd) > 1e-9) invalidReasons.push("receipt_cost_mismatch");
  if (run.receipts.length > limits.maximumCycles) invalidReasons.push("cycle_ceiling_exceeded");
  if (run.accountedCostUsd > limits.maximumModelSpendUsd) invalidReasons.push("cost_ceiling_exceeded");

  const controlReceipts = [structuredClone(firstReceipt)];
  const canaryReceipts = structuredClone(run.receipts);
  const control = arm({
    baselineVerification: run.baselineVerification,
    verification: controlPost,
    elapsedMilliseconds: firstReceiptElapsedMilliseconds,
    accountedCostUsd: firstModel.accountedCostUsd,
    inputTokens: firstModel.inputTokens,
    outputTokens: firstModel.outputTokens,
    modelCalls: 1,
    receipts: controlReceipts,
  });
  const canary = arm({
    baselineVerification: run.baselineVerification,
    verification: canaryPost,
    elapsedMilliseconds: canaryActiveExecutionMilliseconds,
    accountedCostUsd: run.accountedCostUsd,
    inputTokens: modelReceipts.reduce((sum, receipt) => sum + receipt.inputTokens, 0),
    outputTokens: modelReceipts.reduce((sum, receipt) => sum + receipt.outputTokens, 0),
    modelCalls: models.length,
    receipts: canaryReceipts,
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
  const timeAndCostComparable = control.verifiedComplete && canary.verifiedComplete;
  const physicalSpendUsd = rounded(run.accountedCostUsd);
  const receiptsDigest = sha256(canonicalJson(canaryReceipts));
  const baselineVerificationDigest = digestVerification(run.baselineVerification);
  const evidence = {
    contractDigest,
    sharedFirstProposalDigest,
    baselineVerificationDigest,
    control,
    canary,
    physicalSpendUsd,
    deltas,
    timeAndCostComparable,
    invalidReasons,
    receipts: canaryReceipts,
    receiptsDigest,
    auditVerificationMilliseconds,
  };
  return {
    schemaVersion: 1 as const,
    evidenceLevel: "LAB_SINGLE_MATCHED_TRACE" as const,
    caseId: input.caseId,
    sourceCommit: input.sourceCommit,
    modelRouteKey: input.modelRouteKey,
    contract,
    contractDigest,
    sharedFirstProposalDigest,
    baselineVerificationDigest,
    pairDigest: sha256(canonicalJson(evidence)),
    valid: invalidReasons.length === 0,
    invalidReasons,
    control,
    canary,
    physicalSpendUsd,
    receipts: canaryReceipts,
    receiptsDigest,
    auditVerificationMilliseconds,
    timeAndCostComparable,
    deltas,
    conclusion: {
      verifiedCompletionImproved: deltas.verifiedCompletion > 0,
      executionTimeReduced: timeAndCostComparable ? deltas.activeExecutionMilliseconds < 0 : null,
      costReduced: timeAndCostComparable ? deltas.accountedCostUsd < 0 : null,
      verifiedVelocityImproved: deltas.verifiedCompletionsPerActiveSecond > 0,
      verifiedCostEfficiencyImproved: deltas.verifiedCompletionsPerUsd > 0,
    },
    generalClaimSupported: false as const,
    authority,
  };
}
