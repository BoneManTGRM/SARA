import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./canonical.ts";
import {
  executeWorkerModelTask,
  planWorkerModelTask,
  WorkerModelExecutionError,
  type WorkerModelClient,
} from "./model-router.ts";

export type LunaStartupProof = {
  schemaVersion: 1;
  status: "disabled" | "running" | "succeeded" | "failed";
  attemptedAt: string | null;
  completedAt: string | null;
  provider: "openai";
  model: "gpt-5.6-luna";
  accountedCostUsd: number;
  outputDigest: string | null;
  failureCode: "model_call_failed" | "unexpected_response" | "unexpected_failure" | null;
};

const PROOF_FILE = "luna-startup-proof.v1.json";

async function writeProof(stateDirectory: string, proof: LunaStartupProof): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const destination = join(stateDirectory, PROOF_FILE);
  const temporary = `${destination}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(canonicalJson(proof), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function claimInitialProof(stateDirectory: string, proof: LunaStartupProof): Promise<boolean> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(join(stateDirectory, PROOF_FILE), "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(canonicalJson(proof), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

async function existingProof(stateDirectory: string): Promise<LunaStartupProof | null> {
  try {
    const parsed = JSON.parse(await readFile(join(stateDirectory, PROOF_FILE), "utf8")) as LunaStartupProof;
    if (parsed.schemaVersion !== 1 || typeof parsed.status !== "string") throw new Error("invalid proof");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return {
      schemaVersion: 1,
      status: "failed",
      attemptedAt: null,
      completedAt: new Date().toISOString(),
      provider: "openai",
      model: "gpt-5.6-luna",
      accountedCostUsd: 0,
      outputDigest: null,
      failureCode: "unexpected_failure",
    };
  }
}

export async function runLunaStartupProof(input: {
  client: WorkerModelClient;
  stateDirectory: string;
  enabled: boolean;
  now?: () => Date;
}): Promise<LunaStartupProof> {
  const prior = await existingProof(input.stateDirectory);
  if (prior) return prior;
  const now = input.now ?? (() => new Date());
  if (!input.enabled) {
    return {
      schemaVersion: 1,
      status: "disabled",
      attemptedAt: null,
      completedAt: null,
      provider: "openai",
      model: "gpt-5.6-luna",
      accountedCostUsd: 0,
      outputDigest: null,
      failureCode: null,
    };
  }

  const attemptedAt = now().toISOString();
  const running: LunaStartupProof = {
    schemaVersion: 1,
    status: "running",
    attemptedAt,
    completedAt: null,
    provider: "openai",
    model: "gpt-5.6-luna",
    accountedCostUsd: 0,
    outputDigest: null,
    failureCode: null,
  };
  // The running sentinel is durable before the paid call. A crash therefore
  // fails closed instead of spending again on the next process start.
  if (!await claimInitialProof(input.stateDirectory, running)) {
    return await existingProof(input.stateDirectory) ?? {
      ...running,
      status: "failed",
      completedAt: now().toISOString(),
      failureCode: "unexpected_failure",
    };
  }
  const plan = planWorkerModelTask({
    taskKind: "opportunity_filter",
    dataClassification: "public",
    maximumTaskCostUsd: 0.01,
    allowGeminiFreeTier: false,
    pricedAt: now(),
  });
  try {
    const result = await executeWorkerModelTask(
      plan,
      "Connectivity proof only. Reply exactly SARA_LUNA_READY and nothing else.",
      [input.client],
    );
    if (result.outputText.trim() !== "SARA_LUNA_READY") {
      const failed: LunaStartupProof = {
        ...running,
        status: "failed",
        completedAt: now().toISOString(),
        accountedCostUsd: result.evidence.accountedCostUsd,
        outputDigest: result.evidence.outputDigest,
        failureCode: "unexpected_response",
      };
      await writeProof(input.stateDirectory, failed);
      return failed;
    }
    const succeeded: LunaStartupProof = {
      ...running,
      status: "succeeded",
      completedAt: now().toISOString(),
      accountedCostUsd: result.evidence.accountedCostUsd,
      outputDigest: result.evidence.outputDigest,
    };
    await writeProof(input.stateDirectory, succeeded);
    return succeeded;
  } catch (error) {
    const failed: LunaStartupProof = {
      ...running,
      status: "failed",
      completedAt: now().toISOString(),
      accountedCostUsd: error instanceof WorkerModelExecutionError ? error.evidence.accountedCostUsd : 0,
      failureCode: error instanceof WorkerModelExecutionError ? "model_call_failed" : "unexpected_failure",
    };
    await writeProof(input.stateDirectory, failed);
    return failed;
  }
}
