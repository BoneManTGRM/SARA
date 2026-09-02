import type { WorkerModelClient } from "./model-router.ts";

export class GeminiInteractionsClient implements WorkerModelClient {
  readonly routeKey: string;
  readonly maximumWallTimeMs: number;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    apiKey: string;
    billingMode: "free" | "paid";
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!options.apiKey.trim()) throw new Error("A Gemini API key is required.");
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new RangeError("Gemini timeoutMs must be an integer between 100 and 120000.");
    }
    this.routeKey = `google:gemini-3.8-flash:${options.billingMode}`;
    this.maximumWallTimeMs = timeoutMs;
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = timeoutMs;
  }

  async countInputTokens(prompt: string): Promise<number> {
    return Buffer.byteLength(prompt, "utf8");
  }

  async execute(input: {
    prompt: string;
    reasoningLevel: "low" | "medium" | "high";
    maximumOutputTokens: number;
  }): Promise<{ outputText: string; inputTokens: number; billableOutputTokens: number }> {
    if (!input.prompt.trim()) throw new Error("A non-empty Gemini prompt is required.");
    if (
      !Number.isInteger(input.maximumOutputTokens) ||
      input.maximumOutputTokens < 1 ||
      input.maximumOutputTokens > 65_536
    ) {
      throw new RangeError("Gemini maximumOutputTokens must be an integer between 1 and 65536.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.#apiKey,
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          input: input.prompt,
          store: false,
          background: false,
          stream: false,
          generation_config: {
            thinking_level: input.reasoningLevel,
            thinking_summaries: "none",
            max_output_tokens: input.maximumOutputTokens,
            tool_choice: "none",
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new Error("Gemini request failed before a response was received.");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}.`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Gemini returned an invalid JSON response.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Gemini returned a malformed response.");
    }
    const body = payload as Record<string, unknown>;
    if (body.status !== "completed") throw new Error("Gemini did not complete the interaction.");
    const steps = Array.isArray(body.steps) ? body.steps : [];
    const text = steps.flatMap((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return [];
      const content = (step as Record<string, unknown>).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object" || Array.isArray(part)) return [];
        const record = part as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
      });
    }).join("\n").trim();
    const usage = body.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
      throw new Error("Gemini response omitted required usage accounting.");
    }
    const usageRecord = usage as Record<string, unknown>;
    const readTokens = (field: string): number => {
      const value = usageRecord[field];
      if (!Number.isInteger(value) || (value as number) < 0) {
        throw new Error("Gemini returned malformed usage accounting.");
      }
      return value as number;
    };
    const inputTokens = readTokens("total_input_tokens");
    const billableOutputTokens =
      readTokens("total_output_tokens") +
      readTokens("total_thought_tokens") +
      readTokens("total_tool_use_tokens");
    if (!text) throw new Error("Gemini returned no text output.");
    return { outputText: text, inputTokens, billableOutputTokens };
  }
}
