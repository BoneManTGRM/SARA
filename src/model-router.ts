import { canonicalJson, sha256 } from "./canonical.ts";

export type WorkerTaskKind =
  | "opportunity_filter"
  | "requirements_analysis"
  | "routine_code"
  | "test_repair"
  | "repository_investigation"
  | "documentation"
  | "customer_deliverable"
  | "complex_architecture"
  | "critical_security_verification";

export type WorkerDataClassification =
  | "public"
  | "customer_confidential"
  | "regulated"
  | "credentials";

export type WorkerModelRoute = {
  provider: "google" | "openai";
  model: "gemini-3.8-flash" | "gpt-5.6-luna";
  billingMode: "free" | "paid";
  reasoningLevel: "low" | "medium" | "high";
  maximumInputTokens: number;
  maximumOutputTokens: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  worstCaseCostUsd: number;
};

export type WorkerModelPlan = {
  schemaVersion: 1;
  taskKind: WorkerTaskKind;
  dataClassification: WorkerDataClassification;
  maximumTaskCostUsd: number;
  maximumAttempts: number;
  worstCaseCostUsd: number;
  requiresIndependentVerification: boolean;
  routes: WorkerModelRoute[];
};

export type WorkerModelRawResult = {
  outputText: string;
  inputTokens: number;
  billableOutputTokens: number;
};

export type WorkerModelClient = {
  routeKey: string;
  maximumWallTimeMs: number;
  countInputTokens(prompt: string): Promise<number>;
  execute(input: {
    prompt: string;
    reasoningLevel: WorkerModelRoute["reasoningLevel"];
    maximumOutputTokens: number;
  }): Promise<WorkerModelRawResult>;
};

export type WorkerModelAttempt = {
  provider: WorkerModelRoute["provider"];
  model: WorkerModelRoute["model"];
  billingMode: WorkerModelRoute["billingMode"];
  outcome: "succeeded" | "failed" | "unavailable" | "rejected";
  accountedCostUsd: number;
};

export type WorkerModelExecutionEvidence = {
  schemaVersion: 1;
  taskKind: WorkerTaskKind;
  provider: WorkerModelRoute["provider"];
  model: WorkerModelRoute["model"];
  billingMode: WorkerModelRoute["billingMode"];
  reasoningLevel: WorkerModelRoute["reasoningLevel"];
  inputTokens: number;
  billableOutputTokens: number;
  attemptCount: number;
  accountedCostUsd: number;
  outputDigest: string;
  attempts: WorkerModelAttempt[];
};

export type WorkerModelExecution = {
  outputText: string;
  evidence: WorkerModelExecutionEvidence;
};

export type WorkerModelFailureEvidence = {
  schemaVersion: 1;
  taskKind: WorkerTaskKind;
  attemptCount: number;
  accountedCostUsd: number;
  failureDigest: string;
  attempts: WorkerModelAttempt[];
};

export class WorkerModelExecutionError extends Error {
  constructor(readonly evidence: WorkerModelFailureEvidence) {
    super("All bounded model routes failed without a verified worker output.");
    this.name = "WorkerModelExecutionError";
  }
}

export type WorkerModelPlanInput = {
  taskKind: WorkerTaskKind;
  dataClassification: WorkerDataClassification;
  maximumTaskCostUsd: number;
  allowGeminiFreeTier: boolean;
  pricedAt?: Date;
};

type TaskProfile = {
  maximumInputTokens: number;
  maximumOutputTokens: number;
  geminiReasoning: WorkerModelRoute["reasoningLevel"];
  primary: WorkerModelRoute["model"];
  requiresIndependentVerification: boolean;
};

const TASK_PROFILES: Record<WorkerTaskKind, TaskProfile> = {
  opportunity_filter: {
    maximumInputTokens: 5_000,
    maximumOutputTokens: 1_000,
    geminiReasoning: "low",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: false,
  },
  requirements_analysis: {
    maximumInputTokens: 10_000,
    maximumOutputTokens: 3_000,
    geminiReasoning: "medium",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: false,
  },
  routine_code: {
    maximumInputTokens: 30_000,
    maximumOutputTokens: 8_000,
    geminiReasoning: "medium",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: true,
  },
  test_repair: {
    maximumInputTokens: 30_000,
    maximumOutputTokens: 8_000,
    geminiReasoning: "medium",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: true,
  },
  repository_investigation: {
    maximumInputTokens: 20_000,
    maximumOutputTokens: 6_000,
    geminiReasoning: "medium",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: true,
  },
  documentation: {
    maximumInputTokens: 12_000,
    maximumOutputTokens: 4_000,
    geminiReasoning: "low",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: false,
  },
  customer_deliverable: {
    maximumInputTokens: 20_000,
    maximumOutputTokens: 6_000,
    geminiReasoning: "medium",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: true,
  },
  complex_architecture: {
    maximumInputTokens: 40_000,
    maximumOutputTokens: 12_000,
    geminiReasoning: "high",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: true,
  },
  critical_security_verification: {
    maximumInputTokens: 30_000,
    maximumOutputTokens: 8_000,
    geminiReasoning: "high",
    primary: "gpt-5.6-luna",
    requiresIndependentVerification: true,
  },
};

function boundedAmount(value: number, label: string): void {
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 3 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-9
  ) {
    throw new RangeError(`${label} must be greater than $0 and no more than the $3 revenue-pilot job cap.`);
  }
}

function rateFor(
  model: WorkerModelRoute["model"],
  billingMode: WorkerModelRoute["billingMode"],
  pricedAt: Date,
): { input: number; output: number } {
  if (billingMode === "free") return { input: 0, output: 0 };
  if (model === "gpt-5.6-luna") return { input: 0.2, output: 1.2 };
  const standardPricing = pricedAt.getTime() >= Date.parse("2027-01-01T00:00:00.000Z");
  return standardPricing ? { input: 1.5, output: 7.5 } : { input: 0.75, output: 3.75 };
}

function route(
  model: WorkerModelRoute["model"],
  profile: TaskProfile,
  dataClassification: WorkerDataClassification,
  allowGeminiFreeTier: boolean,
  pricedAt: Date,
): WorkerModelRoute {
  const provider = model === "gemini-3.8-flash" ? "google" : "openai";
  const billingMode = model === "gemini-3.8-flash" && dataClassification === "public" && allowGeminiFreeTier
    ? "free"
    : "paid";
  const rates = rateFor(model, billingMode, pricedAt);
  const worstCaseCostUsd = Math.ceil((
    profile.maximumInputTokens * rates.input / 1_000_000 +
    profile.maximumOutputTokens * rates.output / 1_000_000
  ) * 1_000_000) / 1_000_000;
  return {
    provider,
    model,
    billingMode,
    reasoningLevel: model === "gemini-3.8-flash" ? profile.geminiReasoning : "low",
    maximumInputTokens: profile.maximumInputTokens,
    maximumOutputTokens: profile.maximumOutputTokens,
    inputUsdPerMillionTokens: rates.input,
    outputUsdPerMillionTokens: rates.output,
    worstCaseCostUsd,
  };
}

export function planWorkerModelTask(input: WorkerModelPlanInput): WorkerModelPlan {
  boundedAmount(input.maximumTaskCostUsd, "maximumTaskCostUsd");
  if (input.dataClassification === "credentials" || input.dataClassification === "regulated") {
    throw new Error("Protected data may not be routed to an external model worker.");
  }
  const pricedAt = input.pricedAt ?? new Date();
  if (!Number.isFinite(pricedAt.getTime())) throw new Error("pricedAt must be a valid timestamp.");
  const profile = TASK_PROFILES[input.taskKind];
  if (!profile) throw new Error("taskKind is not recognized.");

  const fallbackModel: WorkerModelRoute["model"] = profile.primary === "gemini-3.8-flash"
    ? "gpt-5.6-luna"
    : "gemini-3.8-flash";
  const routes = [profile.primary, fallbackModel].map((model) => route(
    model,
    profile,
    input.dataClassification,
    input.allowGeminiFreeTier,
    pricedAt,
  ));
  const worstCaseCostUsd = Math.ceil(
    routes.reduce((total, candidate) => total + candidate.worstCaseCostUsd, 0) * 1_000_000,
  ) / 1_000_000;
  if (worstCaseCostUsd > input.maximumTaskCostUsd) {
    throw new RangeError(
      `The bounded model route could cost $${worstCaseCostUsd.toFixed(6)}, exceeding the $${input.maximumTaskCostUsd.toFixed(6)} task cost cap.`,
    );
  }
  return {
    schemaVersion: 1,
    taskKind: input.taskKind,
    dataClassification: input.dataClassification,
    maximumTaskCostUsd: input.maximumTaskCostUsd,
    maximumAttempts: routes.length,
    worstCaseCostUsd,
    requiresIndependentVerification: profile.requiresIndependentVerification,
    routes,
  };
}

export function workerModelRouteKey(route: Pick<WorkerModelRoute, "provider" | "model" | "billingMode">): string {
  return `${route.provider}:${route.model}:${route.billingMode}`;
}

export async function executeWorkerModelTask(
  plan: WorkerModelPlan,
  prompt: string,
  clients: readonly WorkerModelClient[],
): Promise<WorkerModelExecution> {
  if (!prompt.trim()) throw new Error("A non-empty worker prompt is required.");
  if (plan.routes.length === 0 || plan.routes.length > plan.maximumAttempts || plan.maximumAttempts > 2) {
    throw new Error("The worker plan has an invalid attempt boundary.");
  }
  const clientMap = new Map<string, WorkerModelClient>();
  for (const client of clients) {
    if (clientMap.has(client.routeKey)) throw new Error(`Duplicate model client ${client.routeKey}.`);
    clientMap.set(client.routeKey, client);
  }

  const attempts: WorkerModelAttempt[] = [];
  let accountedCostUsd = 0;
  const addCost = (value: number): void => {
    accountedCostUsd = Math.ceil((accountedCostUsd + value) * 1_000_000) / 1_000_000;
    if (accountedCostUsd > plan.maximumTaskCostUsd) {
      throw new RangeError("Model execution exceeded its task cost cap.");
    }
  };

  for (const route of plan.routes.slice(0, plan.maximumAttempts)) {
    const client = clientMap.get(workerModelRouteKey(route));
    if (!client) {
      attempts.push({
        provider: route.provider,
        model: route.model,
        billingMode: route.billingMode,
        outcome: "unavailable",
        accountedCostUsd: 0,
      });
      continue;
    }

    let countedInputTokens: number;
    try {
      countedInputTokens = await client.countInputTokens(prompt);
    } catch {
      attempts.push({
        provider: route.provider,
        model: route.model,
        billingMode: route.billingMode,
        outcome: "unavailable",
        accountedCostUsd: 0,
      });
      continue;
    }
    if (!Number.isInteger(countedInputTokens) || countedInputTokens < 0 || countedInputTokens > route.maximumInputTokens) {
      attempts.push({
        provider: route.provider,
        model: route.model,
        billingMode: route.billingMode,
        outcome: "rejected",
        accountedCostUsd: 0,
      });
      continue;
    }

    let result: WorkerModelRawResult;
    try {
      result = await client.execute({
        prompt,
        reasoningLevel: route.reasoningLevel,
        maximumOutputTokens: route.maximumOutputTokens,
      });
    } catch {
      addCost(route.worstCaseCostUsd);
      attempts.push({
        provider: route.provider,
        model: route.model,
        billingMode: route.billingMode,
        outcome: "failed",
        accountedCostUsd: route.worstCaseCostUsd,
      });
      continue;
    }

    const usageIsValid =
      Number.isInteger(result.inputTokens) &&
      result.inputTokens >= 0 &&
      Number.isInteger(result.billableOutputTokens) &&
      result.billableOutputTokens >= 0;
    const actualCostUsd = usageIsValid
      ? Math.ceil((
        result.inputTokens * route.inputUsdPerMillionTokens / 1_000_000 +
        result.billableOutputTokens * route.outputUsdPerMillionTokens / 1_000_000
      ) * 1_000_000) / 1_000_000
      : route.worstCaseCostUsd;
    addCost(actualCostUsd);
    if (
      !usageIsValid ||
      result.inputTokens > route.maximumInputTokens ||
      result.billableOutputTokens > route.maximumOutputTokens ||
      !result.outputText.trim()
    ) {
      attempts.push({
        provider: route.provider,
        model: route.model,
        billingMode: route.billingMode,
        outcome: "rejected",
        accountedCostUsd: actualCostUsd,
      });
      continue;
    }

    attempts.push({
      provider: route.provider,
      model: route.model,
      billingMode: route.billingMode,
      outcome: "succeeded",
      accountedCostUsd: actualCostUsd,
    });
    return {
      outputText: result.outputText,
      evidence: {
        schemaVersion: 1,
        taskKind: plan.taskKind,
        provider: route.provider,
        model: route.model,
        billingMode: route.billingMode,
        reasoningLevel: route.reasoningLevel,
        inputTokens: result.inputTokens,
        billableOutputTokens: result.billableOutputTokens,
        attemptCount: attempts.length,
        accountedCostUsd,
        outputDigest: sha256(result.outputText),
        attempts,
      },
    };
  }

  const safeFailure = {
    schemaVersion: 1 as const,
    taskKind: plan.taskKind,
    attemptCount: attempts.length,
    accountedCostUsd,
    attempts,
  };
  throw new WorkerModelExecutionError({
    ...safeFailure,
    failureDigest: sha256(canonicalJson(safeFailure)),
  });
}
