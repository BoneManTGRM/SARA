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
  proposeSingle(task: CodingMicroBatchTask): Promise<CodingMicroBatchUsage & {
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
  const account = (usage: CodingMicroBatchUsage) => {
    assertUsage(usage);
    if (accountedCostUsd + usage.accountedCostUsd > input.maximumSpendUsd + Number.EPSILON) {
      throw new Error("Coding micro-batch exceeded its configured spend ceiling.");
    }
    accountedCostUsd += usage.accountedCostUsd;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    activeModelMilliseconds += usage.elapsedMilliseconds;
    modelCalls += 1;
  };

  const batch = await input.model.proposeBatch(structuredClone(input.tasks));
  account(batch);
  assertProposalIdentities(input.tasks, batch.proposals);
  const proposalsById = new Map(batch.proposals.map((proposal) => [proposal.id, proposal]));

  const results: CodingMicroBatchResult["results"] = [];
  for (const task of input.tasks) {
    const proposal = proposalsById.get(task.id);
    if (!proposal) throw new Error("Coding micro-batch proposal identities are malformed.");
    const verification = await input.verify(structuredClone(task), proposal.source);
    if (verification.passed) {
      results.push({ id: task.id, passed: true, score: verification.score, attempts: 1 });
      continue;
    }

    const fallback = await input.model.proposeSingle(structuredClone(task));
    account(fallback);
    if (fallback.proposal.id !== task.id) {
      throw new Error("Coding micro-batch fallback proposal identity does not match its task.");
    }
    const fallbackVerification = await input.verify(structuredClone(task), fallback.proposal.source);
    results.push({
      id: task.id,
      passed: fallbackVerification.passed,
      score: fallbackVerification.score,
      attempts: 2,
    });
  }

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
