import { buildCodingRepairPrompt } from "./coding-repair-prompt.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairModel } from "./coding-repair-controller.ts";
import type { CodingRepairProposal } from "./coding-repair-types.ts";
import {
  executeWorkerModelTask,
  planWorkerModelTask,
  type WorkerModelClient,
} from "./model-router.ts";
import type { CandidateGenerator } from "./types.ts";

function parseProposal(value: string): CodingRepairProposal {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Luna coding repair output must be one JSON object.");
  }
  return parsed as CodingRepairProposal;
}

export function createLunaCodingRepairModel(input: {
  client: WorkerModelClient;
  context: Parameters<CandidateGenerator["generate"]>[0];
}): CodingRepairModel {
  return {
    async propose(request) {
      const maximumTaskCostUsd = Math.floor(request.remainingCostUsd * 100) / 100;
      if (maximumTaskCostUsd < 0.01) throw new Error("Insufficient remaining coding repair budget.");
      const prompt = buildCodingRepairPrompt({
        objective: input.context.objective,
        acceptanceCriteria: input.context.acceptanceCriteria,
        candidate: request.candidate,
        artifactDigest: request.verification.artifactDigest,
        failures: request.verification.failures,
        previouslyPassingChecks: request.verification.completedChecks.filter((check) => {
          if (check === "syntax") return !request.verification.failures.some((failure) => failure.kind === "syntax");
          if (check === "typecheck") return !request.verification.failures.some((failure) => failure.kind === "type");
          if (check === "behavior_tests") return !request.verification.failures.some((failure) => failure.kind === "test" || failure.kind === "behavior");
          return true;
        }),
        remainingCycles: INITIAL_CODING_REPAIR_LIMITS.maximumCycles - request.cycle + 1,
        remainingCostUsd: request.remainingCostUsd,
        verifiedLessons: input.context.memoryContext.memories.map((memory) => memory.statement),
        constitutionDigest: input.context.constitutionDigest,
        limits: INITIAL_CODING_REPAIR_LIMITS,
        strategy: request.strategy,
      });
      const execution = await executeWorkerModelTask(
        planWorkerModelTask({
          taskKind: "test_repair",
          dataClassification: "public",
          maximumTaskCostUsd,
          allowGeminiFreeTier: false,
        }),
        prompt,
        [input.client],
      );
      return {
        proposal: parseProposal(execution.outputText),
        inputTokens: execution.evidence.inputTokens,
        outputTokens: execution.evidence.billableOutputTokens,
        accountedCostUsd: execution.evidence.accountedCostUsd,
      };
    },
  };
}
