import { expandCodingRepairEdits } from "./coding-repair-edits.ts";
import { buildCodingRepairPrompt, validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairModel } from "./coding-repair-controller.ts";
import type { CodingRepairProposal } from "./coding-repair-types.ts";
import {
  executeWorkerModelTask,
  planWorkerModelTask,
  type WorkerModelClient,
} from "./model-router.ts";
import type { CandidateGenerator } from "./types.ts";

export class CodingRepairOutputError extends Error {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly accountedCostUsd: number;
  constructor(usage: { inputTokens: number; billableOutputTokens: number; accountedCostUsd: number }) {
    super("Luna repair output failed the bounded proposal contract.");
    this.name = "CodingRepairOutputError";
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.billableOutputTokens;
    this.accountedCostUsd = usage.accountedCostUsd;
  }
}

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
  compactRepairContinuations?: boolean;
  /** Experiment only. Changes the first-call contract; never enabled by existing callers. */
  experimentalCompactFirstProposal?: boolean;
}): CodingRepairModel {
  if (input.experimentalCompactFirstProposal === true && input.compactRepairContinuations !== true) {
    throw new Error("experimentalCompactFirstProposal requires compactRepairContinuations.");
  }
  return {
    async propose(request) {
      const maximumTaskCostUsd = Math.floor(request.remainingCostUsd * 100) / 100;
      if (maximumTaskCostUsd < 0.01) throw new Error("Insufficient remaining coding repair budget.");
      // Existing callers retain their byte-identical first request. A distinct experiment
      // may test compact output from cycle one; old matched contracts must not enable it.
      const compactEdits = input.compactRepairContinuations === true &&
        (request.cycle > 1 || input.experimentalCompactFirstProposal === true);
      const prompt = buildCodingRepairPrompt({
        compactEdits,
        objective: input.context.objective,
        acceptanceCriteria: input.context.acceptanceCriteria,
        candidate: request.candidate,
        artifactDigest: request.verification.artifactDigest,
        failures: request.verification.failures,
        previouslyPassingChecks: request.verification.completedChecks.filter((check) => {
          if (check === "syntax") return !request.verification.failures.some((failure) => failure.kind === "syntax");
          if (check === "typecheck") return !request.verification.failures.some((failure) => failure.kind === "type");
          if (check === "behavior_tests") {
            return !request.verification.failures.some((failure) => failure.kind === "test" || failure.kind === "behavior");
          }
          return true;
        }),
        remainingCycles: INITIAL_CODING_REPAIR_LIMITS.maximumCycles - request.cycle + 1,
        remainingCostUsd: request.remainingCostUsd,
        verifiedLessons: input.context.memoryContext.memories.map((memory) => memory.statement),
        constitutionDigest: input.context.constitutionDigest,
        limits: INITIAL_CODING_REPAIR_LIMITS,
        strategy: request.strategy,
        attemptLessons: request.attemptLessons ?? [],
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
      let proposal: CodingRepairProposal;
      try {
        proposal = compactEdits ? expandCodingRepairEdits({
          value: JSON.parse(execution.outputText),
          candidate: request.candidate,
          artifactDigest: request.verification.artifactDigest,
          failureFingerprints: new Set(request.verification.failures.map(failure => failure.fingerprint)),
          strategy: request.strategy,
          limits: INITIAL_CODING_REPAIR_LIMITS,
        }) : parseProposal(execution.outputText);
        if (compactEdits) validateCodingRepairProposal({
          proposal,
          candidate: request.candidate,
          artifactDigest: request.verification.artifactDigest,
          failureFingerprints: new Set(request.verification.failures.map(failure => failure.fingerprint)),
          limits: INITIAL_CODING_REPAIR_LIMITS,
          expectedStrategy: request.strategy,
        });
      } catch {
        // Accounted usage survives invalid output; raw provider text and parse errors do not.
        throw new CodingRepairOutputError(execution.evidence);
      }
      return {
        proposal: { ...proposal, strategy: request.strategy },
        inputTokens: execution.evidence.inputTokens,
        outputTokens: execution.evidence.billableOutputTokens,
        accountedCostUsd: execution.evidence.accountedCostUsd,
      };
    },
  };
}
