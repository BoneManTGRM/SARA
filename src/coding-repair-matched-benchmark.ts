import { canonicalJson, sha256 } from "./canonical.ts";
import { digestCodingRepairProposal } from "./coding-repair-artifacts.ts";
import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairLimits, CodingRepairProposal, ProgramVerificationResult } from "./coding-repair-types.ts";
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

function arm(input: {
  verification: ProgramVerificationResult;
  elapsedMilliseconds: number;
  accountedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  cycles: number;
  rollbacks: number;
  changedLines: number;
}) {
  const milliseconds = rounded(input.elapsedMilliseconds);
  const cost = rounded(input.accountedCostUsd);
  const completion = Number(input.verification.passed);
  return {
    verifiedComplete: input.verification.passed,
    score: input.verification.score,
    artifactDigest: input.verification.artifactDigest,
    evidenceDigest: sha256(canonicalJson(input.verification.evidenceDigests)),
    activeExecutionMilliseconds: milliseconds,
    accountedCostUsd: cost,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    modelCalls: input.modelCalls,
    cycles: input.cycles,
    rollbacks: input.rollbacks,
    changedLines: input.changedLines,
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
  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;
  assertNoAuthorityExpansion(limits);
  const contractDigest = sha256(canonicalJson({
    schemaVersion: 1,
    caseId: input.caseId,
    sourceCommit: input.sourceCommit,
    modelRouteKey: input.modelRouteKey,
    environment: input.environment,
    objectiveDigest: sha256(input.objective),
    acceptanceCriteriaDigest: sha256(canonicalJson(input.acceptanceCriteria)),
    constitutionDigest: input.constitutionDigest,
    memoryContextDigest: input.memoryContextDigest,
    baselineDigest: sha256(canonicalJson(input.baseline)),
    limits,
    control: "same_first_luna_proposal_then_stop",
    canary: "same_first_luna_proposal_then_bounded_verify_repair_retain",
  }));

  const models: Array<{ response: ModelResponse; milliseconds: number }> = [];
  const verifications: Array<{ result: ProgramVerificationResult; milliseconds: number }> = [];
  const run = await runCodingRepairController({
    baseline: input.baseline,
    limits,
    verify: async (candidate) => {
      const started = performance.now();
      const result = await input.verify(candidate);
      verifications.push({ result: structuredClone(result), milliseconds: performance.now() - started });
      return result;
    },
    model: {
      propose: async (request) => {
        const started = performance.now();
        const response = await input.model.propose(request);
        models.push({ response: structuredClone(response), milliseconds: performance.now() - started });
        return response;
      },
    },
  });

  const firstModel = models[0];
  const firstReceipt = run.receipts[0];
  const firstVerification = verifications[1];
  if (!firstModel || !firstReceipt || !firstVerification || firstReceipt.outcome === "stopped") {
    throw new Error("Matched benchmark did not produce a first Luna repair trace.");
  }
  const controlPost = await input.verify(applyProposal(input.baseline, firstModel.response.proposal));
  const canaryPost = await input.verify(run.champion);
  const invalidReasons: string[] = [];
  if (
    controlPost.artifactDigest !== firstVerification.result.artifactDigest ||
    controlPost.passed !== firstVerification.result.passed
  ) invalidReasons.push("control_post_verification_changed");
  if (canaryPost.artifactDigest !== run.verification.artifactDigest || canaryPost.passed !== run.verification.passed) {
    invalidReasons.push("canary_post_verification_changed");
  }
  if (run.accountedCostUsd > limits.maximumModelSpendUsd) invalidReasons.push("cost_ceiling_exceeded");

  const control = arm({
    verification: controlPost,
    elapsedMilliseconds: verifications[0].milliseconds + firstModel.milliseconds + firstVerification.milliseconds,
    accountedCostUsd: firstModel.response.accountedCostUsd,
    inputTokens: firstModel.response.inputTokens,
    outputTokens: firstModel.response.outputTokens,
    modelCalls: 1,
    cycles: 1,
    rollbacks: Number(firstReceipt.outcome === "rolled_back"),
    changedLines: firstReceipt.changedLines,
  });
  const canary = arm({
    verification: canaryPost,
    elapsedMilliseconds: run.elapsedMilliseconds,
    accountedCostUsd: run.accountedCostUsd,
    inputTokens: run.receipts.reduce((sum, receipt) => sum + receipt.inputTokens, 0),
    outputTokens: run.receipts.reduce((sum, receipt) => sum + receipt.outputTokens, 0),
    modelCalls: models.length,
    cycles: run.receipts.length,
    rollbacks: run.receipts.filter((receipt) => receipt.outcome === "rolled_back").length,
    changedLines: run.receipts.reduce((sum, receipt) => sum + receipt.changedLines, 0),
  });
  const deltas = {
    verifiedCompletion: Number(canary.verifiedComplete) - Number(control.verifiedComplete),
    activeExecutionMilliseconds: rounded(canary.activeExecutionMilliseconds - control.activeExecutionMilliseconds),
    accountedCostUsd: rounded(canary.accountedCostUsd - control.accountedCostUsd),
    verifiedCompletionsPerActiveSecond: rounded(
      canary.verifiedCompletionsPerActiveSecond - control.verifiedCompletionsPerActiveSecond,
    ),
    verifiedCompletionsPerUsd: rounded(canary.verifiedCompletionsPerUsd - control.verifiedCompletionsPerUsd),
  };
  const sharedFirstProposalDigest = digestCodingRepairProposal(firstModel.response.proposal);
  const evidence = {
    contractDigest,
    sharedFirstProposalDigest,
    control,
    canary,
    physicalSpendUsd: rounded(run.accountedCostUsd),
    deltas,
    invalidReasons,
    receiptsDigest: sha256(canonicalJson(run.receipts)),
  };
  return {
    schemaVersion: 1 as const,
    evidenceLevel: "LAB_SINGLE_MATCHED_TRACE" as const,
    caseId: input.caseId,
    sourceCommit: input.sourceCommit,
    modelRouteKey: input.modelRouteKey,
    contractDigest,
    sharedFirstProposalDigest,
    pairDigest: sha256(canonicalJson(evidence)),
    valid: invalidReasons.length === 0,
    invalidReasons,
    control,
    canary,
    physicalSpendUsd: evidence.physicalSpendUsd,
    deltas,
    conclusion: {
      verifiedCompletionImproved: deltas.verifiedCompletion > 0,
      executionTimeReduced: deltas.activeExecutionMilliseconds < 0,
      costReduced: deltas.accountedCostUsd < 0,
      verifiedVelocityImproved: deltas.verifiedCompletionsPerActiveSecond > 0,
      verifiedCostEfficiencyImproved: deltas.verifiedCompletionsPerUsd > 0,
    },
    generalClaimSupported: false as const,
    authority: {
      maximumCycles: limits.maximumCycles,
      maximumModelSpendUsd: limits.maximumModelSpendUsd,
      repositoryMutation: false as const,
      merge: false as const,
      deploy: false as const,
      promotion: false as const,
    },
  };
}
