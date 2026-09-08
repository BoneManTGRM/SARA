import { OpenAIResponsesClient } from "./openai-worker.ts";
import type { createBenchmarkDispatchBudget } from "./benchmark-dispatch-budget.ts";
import type { RepositoryProducerModel } from "./repository-producer.ts";

/** Host-only adapter. Its mandatory budget owns dispatch accounting; the
 * budget's authority callback must also check the kernel's current permit.
 * Neither this adapter nor an API key constitutes a spending grant. */
export function createRepositoryLunaModel(input: {
  apiKey: string;
  attemptId: string;
  budget: ReturnType<typeof createBenchmarkDispatchBudget>;
  maximumOutputTokens: number;
}): RepositoryProducerModel {
  const { apiKey, attemptId, budget, maximumOutputTokens } = input;
  const boundedFetch = budget.fetchFor(attemptId);
  return {
    async request({ prompt, signal, deadline }) {
      const remaining = deadline - Date.now();
      if (signal.aborted || remaining < 100) throw new Error("REPOSITORY_MODEL_DEADLINE");
      const before = budget.snapshot().estimatedByAttemptUsd[attemptId] ?? 0;
      let accountedGeneration: { inputTokens: number; billableOutputTokens: number } | null = null;
      const client = new OpenAIResponsesClient({ apiKey,
        timeoutMs: Math.min(120000, remaining),
        fetchImpl: async (resource, init) => {
          const response = await boundedFetch(resource, { ...init,
            signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
          if (String(resource) === "https://api.openai.com/v1/responses") {
            // The budget has already validated identity/completion/usage and
            // durably settled this response, even if it contains no text.
            const payload = await response.clone().json() as { usage: { input_tokens: number; output_tokens: number } };
            accountedGeneration = { inputTokens: payload.usage.input_tokens,
              billableOutputTokens: payload.usage.output_tokens };
          }
          return response;
        } });
      await client.countInputTokens(prompt);
      // A count is not a generation permit; recheck both deadline and authority
      // at the subsequent budget dispatch boundary.
      if (signal.aborted || Date.now() >= deadline) throw new Error("REPOSITORY_MODEL_DEADLINE");
      let response;
      try { response = await client.execute({ prompt, reasoningLevel: "medium", maximumOutputTokens }); }
      catch (error) {
        if (!accountedGeneration) throw error;
        // Refusal/empty text is an invalid producer action with known charges,
        // not a claim that the provider request was free or unaccounted.
        response = { outputText: "", ...accountedGeneration as { inputTokens: number; billableOutputTokens: number } };
      }
      const after = budget.snapshot().estimatedByAttemptUsd[attemptId] ?? 0;
      return { outputText: response.outputText, inputTokens: response.inputTokens,
        outputTokens: response.billableOutputTokens, accountedCostUsd: Math.max(0, after - before) };
    },
  };
}
