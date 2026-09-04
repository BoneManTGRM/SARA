export type CodingMicroBatchTask = {
  id: string;
  objective: string;
  source: string;
};

export type CodingMicroBatchProposal = {
  id: string;
  source: string;
};

export type CodingMicroBatchUsage = {
  accountedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMilliseconds: number;
};

export type CodingMicroBatchModel = {
  proposeBatch(tasks: readonly CodingMicroBatchTask[]): Promise<CodingMicroBatchUsage & {
    proposals: CodingMicroBatchProposal[];
  }>;
  proposeSingle(task: CodingMicroBatchTask, maximumSpendUsd?: number): Promise<CodingMicroBatchUsage & {
    proposal: CodingMicroBatchProposal;
  }>;
};

export type CodingMicroBatchVerification = {
  passed: boolean;
  score: number;
};

export type CodingMicroBatchResult = {
  schemaVersion: 1;
  evidenceLevel: "DETERMINISTIC_MICROBATCH_MECHANISM";
  verifiedComplete: number;
  totalTasks: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  accountedCostUsd: number;
  activeModelMilliseconds: number;
  modelCallThroughputRatio: number | null;
  modelCallThroughputIncreasePercent: number | null;
  accuracyPreserved: boolean;
  results: Array<{
    id: string;
    passed: boolean;
    score: number;
    attempts: number;
  }>;
  generalClaimSupported: false;
};

const MAX_BATCH_TASKS = 4;
const MAX_EXPERIMENT_SPEND_USD = 0.15;

function assertUsage(usage: CodingMicroBatchUsage): void {
  if (
    !Number.isFinite(usage.accountedCostUsd) || usage.accountedCostUsd < 0 ||
    !Number.isFinite(usage.inputTokens) || usage.inputTokens < 0 ||
    !Number.isFinite(usage.outputTokens) || usage.outputTokens < 0 ||
    !Number.isFinite(usage.elapsedMilliseconds) || usage.elapsedMilliseconds < 0
  ) {
    throw new Error("Coding micro-batch returned malformed usage accounting.");
  }
}

function assertProposalIdentities(
  tasks: readonly CodingMicroBatchTask[],
  proposals: readonly CodingMicroBatchProposal[],
): void {
  const expected = new Set(tasks.map((task) => task.id));
  const actual = new Set(proposals.map((proposal) => proposal.id));
  if (actual.size !== proposals.length || actual.size !== expected.size) {
    throw new Error("Coding micro-batch proposal identities are malformed.");
  }
  for (const id of actual) {
    if (!expected.has(id)) throw new Error("Coding micro-batch proposal identities are malformed.");
  }
}

export async function runVerifiedCodingMicroBatch(input: {
  tasks: readonly CodingMicroBatchTask[];
  maximumSpendUsd: number;
  model: CodingMicroBatchModel;
  verify(task: CodingMicroBatchTask, candidateSource: string): Promise<CodingMicroBatchVerification>;
}): Promise<CodingMicroBatchResult> {
  if (input.tasks.length < 1 || input.tasks.length > MAX_BATCH_TASKS) {
    throw new Error(`Coding micro-batch requires between 1 and ${MAX_BATCH_TASKS} tasks.`);
  }
  const ids = new Set<string>();
  for (const task of input.tasks) {
    if (!task.id.trim() || ids.has(task.id)) throw new Error("Coding micro-batch task ids must be unique and non-empty.");
    ids.add(task.id);
  }
  if (
    !Number.isFinite(input.maximumSpendUsd) ||
    input.maximumSpendUsd <= 0 ||
    input.maximumSpendUsd > MAX_EXPERIMENT_SPEND_USD
  ) {
    throw new Error("Coding micro-batch spend ceiling is invalid or exceeds $0.15.");
  }

  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let accountedCostUsd = 0;
  let activeModelMilliseconds = 0;

  const batch = await input.model.proposeBatch(structuredClone(input.tasks));
  assertUsage(batch);
  if (batch.accountedCostUsd > input.maximumSpendUsd + Number.EPSILON) {
    throw new Error("Coding micro-batch exceeded its configured spend ceiling.");
  }
  accountedCostUsd = batch.accountedCostUsd;
  inputTokens = batch.inputTokens;
  outputTokens = batch.outputTokens;
  activeModelMilliseconds = batch.elapsedMilliseconds;
  modelCalls = 1;

  assertProposalIdentities(input.tasks, batch.proposals);
  const proposalsById = new Map(batch.proposals.map((proposal) => [proposal.id, proposal]));
  const resultsById = new Map<string, CodingMicroBatchResult["results"][number]>();
  const failedTasks: CodingMicroBatchTask[] = [];

  for (const task of input.tasks) {
    const proposal = proposalsById.get(task.id);
    if (!proposal) throw new Error("Coding micro-batch proposal identities are malformed.");
    const verification = await input.verify(structuredClone(task), proposal.source);
    if (verification.passed) {
      resultsById.set(task.id, { id: task.id, passed: true, score: verification.score, attempts: 1 });
    } else {
      failedTasks.push(structuredClone(task));
    }
  }

  if (failedTasks.length > 0) {
    const remainingSpendUsd = input.maximumSpendUsd - accountedCostUsd;
    if (remainingSpendUsd <= 0) {
      throw new Error("Coding micro-batch has no remaining spend for failed-member fallback.");
    }
    const perFallbackSpendCeilingUsd = remainingSpendUsd / failedTasks.length;
    const fallbacks = await Promise.all(failedTasks.map(async (task) => {
      const response = await input.model.proposeSingle(structuredClone(task), perFallbackSpendCeilingUsd);
      assertUsage(response);
      if (response.accountedCostUsd > perFallbackSpendCeilingUsd + Number.EPSILON) {
        throw new Error("Coding micro-batch fallback exceeded its reserved spend ceiling.");
      }
      if (response.proposal.id !== task.id) {
        throw new Error("Coding micro-batch fallback proposal identity does not match its task.");
      }
      return { task, response };
    }));

    const fallbackCostUsd = fallbacks.reduce((sum, entry) => sum + entry.response.accountedCostUsd, 0);
    if (accountedCostUsd + fallbackCostUsd > input.maximumSpendUsd + Number.EPSILON) {
      throw new Error("Coding micro-batch exceeded its configured spend ceiling.");
    }
    accountedCostUsd += fallbackCostUsd;
    inputTokens += fallbacks.reduce((sum, entry) => sum + entry.response.inputTokens, 0);
    outputTokens += fallbacks.reduce((sum, entry) => sum + entry.response.outputTokens, 0);
    activeModelMilliseconds += Math.max(...fallbacks.map((entry) => entry.response.elapsedMilliseconds));
    modelCalls += fallbacks.length;

    await Promise.all(fallbacks.map(async ({ task, response }) => {
      const fallbackVerification = await input.verify(structuredClone(task), response.proposal.source);
      resultsById.set(task.id, {
        id: task.id,
        passed: fallbackVerification.passed,
        score: fallbackVerification.score,
        attempts: 2,
      });
    }));
  }

  const results = input.tasks.map((task) => {
    const result = resultsById.get(task.id);
    if (!result) throw new Error("Coding micro-batch did not produce a verification result for every task.");
    return result;
  });
  const verifiedComplete = results.filter((result) => result.passed).length;
  const accuracyPreserved = verifiedComplete === input.tasks.length;
  const modelCallThroughputRatio = accuracyPreserved ? verifiedComplete / modelCalls : null;
  const modelCallThroughputIncreasePercent = modelCallThroughputRatio === null
    ? null
    : (modelCallThroughputRatio - 1) * 100;

  return {
    schemaVersion: 1,
    evidenceLevel: "DETERMINISTIC_MICROBATCH_MECHANISM",
    verifiedComplete,
    totalTasks: input.tasks.length,
    modelCalls,
    inputTokens,
    outputTokens,
    accountedCostUsd,
    activeModelMilliseconds,
    modelCallThroughputRatio,
    modelCallThroughputIncreasePercent,
    accuracyPreserved,
    results,
    generalClaimSupported: false,
  };
}
