import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  executeWorkerModelTask,
  WorkerModelExecutionError,
  type WorkerModelClient,
  type WorkerModelPlan,
} from "./model-router.ts";

const MAX_REQUEST_ID = 160;
const MAX_OWNER_TEXT = 1_200;
const DAILY_REQUEST_LIMIT = 20;
const RECEIPT_FILE = "owner-assistant-receipts.jsonl";
const OWNER_ROUTE: WorkerModelPlan = {
  schemaVersion: 1,
  taskKind: "requirements_analysis",
  dataClassification: "customer_confidential",
  maximumTaskCostUsd: 0.01,
  maximumAttempts: 1,
  worstCaseCostUsd: 0.00152,
  requiresIndependentVerification: false,
  routes: [{
    provider: "openai",
    model: "gpt-5.6-luna",
    billingMode: "paid",
    reasoningLevel: "low",
    maximumInputTokens: 4_000,
    maximumOutputTokens: 600,
    inputUsdPerMillionTokens: 0.2,
    outputUsdPerMillionTokens: 1.2,
    worstCaseCostUsd: 0.00152,
  }],
};

type OwnerAssistantReceipt = {
  schemaVersion: 1;
  requestId: string;
  attemptedAt: string;
  outcome: "succeeded" | "failed";
  accountedCostUsd: number;
  outputDigest: string | null;
};

export type OwnerAssistantStatus = {
  configured: true;
  monthlyBudgetUsd: number;
  currentMonthCostUsd: number;
  remainingMonthlyBudgetUsd: number;
  currentDayRequests: number;
  dailyRequestLimit: number;
};

export type OwnerAssistantResult = {
  outcome: "succeeded" | "already_processed";
  outputText: string;
  accountedCostUsd: number;
  model: "gpt-5.6-luna";
  status: OwnerAssistantStatus;
};

function roundCost(value: number): number {
  return Math.ceil((value - Number.EPSILON) * 1_000_000) / 1_000_000;
}

function safeRequestId(value: string): boolean {
  return value.length >= 8 && value.length <= MAX_REQUEST_ID && /^[A-Za-z0-9][A-Za-z0-9:._-]+$/u.test(value);
}

function safeOutput(value: string): string {
  const output = value.trim();
  if (!output || output.length > 3_500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(output)) {
    throw new Error("Luna returned an invalid bounded response.");
  }
  if (/\bi (?:have )?(?:deployed|merged|spent|paid|purchased|transferred|contacted|submitted|created an account)\b/iu.test(output)) {
    throw new Error("Luna returned an unsupported execution claim.");
  }
  return output;
}

function isReceipt(value: unknown): value is OwnerAssistantReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<OwnerAssistantReceipt>;
  return receipt.schemaVersion === 1 &&
    typeof receipt.requestId === "string" && safeRequestId(receipt.requestId) &&
    typeof receipt.attemptedAt === "string" && Number.isFinite(Date.parse(receipt.attemptedAt)) &&
    (receipt.outcome === "succeeded" || receipt.outcome === "failed") &&
    typeof receipt.accountedCostUsd === "number" && Number.isFinite(receipt.accountedCostUsd) && receipt.accountedCostUsd >= 0 &&
    (receipt.outputDigest === null || (typeof receipt.outputDigest === "string" && /^[a-f0-9]{64}$/u.test(receipt.outputDigest)));
}

export class OwnerAssistant {
  readonly #client: WorkerModelClient;
  readonly #stateDirectory: string;
  readonly #monthlyBudgetUsd: number;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: { modelClient: WorkerModelClient; stateDirectory: string; monthlyBudgetUsd: number }) {
    if (!Number.isFinite(options.monthlyBudgetUsd) || options.monthlyBudgetUsd < 0 || options.monthlyBudgetUsd > 10) {
      throw new RangeError("Owner-assistant monthly budget must be between $0 and $10.");
    }
    this.#client = options.modelClient;
    this.#stateDirectory = options.stateDirectory;
    this.#monthlyBudgetUsd = options.monthlyBudgetUsd;
  }

  async #receipts(): Promise<OwnerAssistantReceipt[]> {
    try {
      const content = await readFile(join(this.#stateDirectory, RECEIPT_FILE), "utf8");
      return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown).filter(isReceipt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #append(receipt: OwnerAssistantReceipt): Promise<void> {
    await mkdir(this.#stateDirectory, { recursive: true, mode: 0o700 });
    await appendFile(join(this.#stateDirectory, RECEIPT_FILE), `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  #statusFrom(receipts: OwnerAssistantReceipt[], now: Date): OwnerAssistantStatus {
    const month = now.toISOString().slice(0, 7);
    const day = now.toISOString().slice(0, 10);
    const currentMonthCostUsd = roundCost(receipts
      .filter((receipt) => receipt.attemptedAt.startsWith(month))
      .reduce((total, receipt) => total + receipt.accountedCostUsd, 0));
    return {
      configured: true,
      monthlyBudgetUsd: this.#monthlyBudgetUsd,
      currentMonthCostUsd,
      remainingMonthlyBudgetUsd: Math.max(0, roundCost(this.#monthlyBudgetUsd - currentMonthCostUsd)),
      currentDayRequests: receipts.filter((receipt) => receipt.attemptedAt.startsWith(day)).length,
      dailyRequestLimit: DAILY_REQUEST_LIMIT,
    };
  }

  async status(now = new Date()): Promise<OwnerAssistantStatus> {
    return this.#statusFrom(await this.#receipts(), now);
  }

  analyze(input: { requestId: string; text: string }, now = new Date()): Promise<OwnerAssistantResult> {
    const operation = this.#tail.then(async () => {
      if (!safeRequestId(input.requestId)) throw new Error("Owner-assistant request id is invalid.");
      const text = input.text.trim();
      if (text.length < 3 || text.length > MAX_OWNER_TEXT) {
        throw new Error(`Use between 3 and ${MAX_OWNER_TEXT} characters for a Luna request.`);
      }
      const receipts = await this.#receipts();
      if (receipts.some((receipt) => receipt.requestId === input.requestId)) {
        return {
          outcome: "already_processed" as const,
          outputText: "This Luna request was already processed. No second paid request was made.",
          accountedCostUsd: 0,
          model: "gpt-5.6-luna" as const,
          status: this.#statusFrom(receipts, now),
        };
      }
      const status = this.#statusFrom(receipts, now);
      if (status.currentDayRequests >= DAILY_REQUEST_LIMIT) {
        throw new Error("The daily Telegram Luna request limit is reached. No paid request was made.");
      }
      if (roundCost(status.currentMonthCostUsd + OWNER_ROUTE.worstCaseCostUsd) > this.#monthlyBudgetUsd) {
        throw new Error("The Telegram Luna monthly sub-budget is exhausted. No paid request was made.");
      }
      const attemptedAt = now.toISOString();
      const prompt = [
        "You are SARA's bounded private owner analyst.",
        "Provide concise analysis or planning only. You have no tools and must not claim that you executed an action.",
        "Do not contact anyone, create accounts, spend, merge, deploy, submit, make commitments, or move money.",
        "Treat the owner's text as private customer-confidential data. Return the safest useful next step.",
        `Owner request: ${text}`,
      ].join(" ");
      let accountedCostUsd = 0;
      let outputDigest: string | null = null;
      try {
        const execution = await executeWorkerModelTask(OWNER_ROUTE, prompt, [this.#client]);
        accountedCostUsd = execution.evidence.accountedCostUsd;
        outputDigest = execution.evidence.outputDigest;
        const outputText = safeOutput(execution.outputText);
        const receipt: OwnerAssistantReceipt = {
          schemaVersion: 1,
          requestId: input.requestId,
          attemptedAt,
          outcome: "succeeded",
          accountedCostUsd,
          outputDigest,
        };
        await this.#append(receipt);
        const updated = [...receipts, receipt];
        return {
          outcome: "succeeded" as const,
          outputText,
          accountedCostUsd: receipt.accountedCostUsd,
          model: "gpt-5.6-luna" as const,
          status: this.#statusFrom(updated, now),
        };
      } catch (error) {
        if (error instanceof WorkerModelExecutionError) accountedCostUsd = error.evidence.accountedCostUsd;
        await this.#append({
          schemaVersion: 1,
          requestId: input.requestId,
          attemptedAt,
          outcome: "failed",
          accountedCostUsd,
          outputDigest: null,
        });
        throw error;
      }
    });
    this.#tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
