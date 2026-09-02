import type { WorkerModelClient } from "./model-router.ts";

export class OpenAIResponsesClient implements WorkerModelClient {
  readonly routeKey = "openai:gpt-5.6-luna:paid";
  readonly maximumWallTimeMs: number;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!options.apiKey.trim()) throw new Error("An OpenAI API key is required.");
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new RangeError("OpenAI timeoutMs must be an integer between 100 and 120000.");
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = timeoutMs;
    this.maximumWallTimeMs = timeoutMs;
  }

  async countInputTokens(prompt: string): Promise<number> {
    return Buffer.byteLength(prompt, "utf8");
  }

  async execute(input: {
    prompt: string;
    reasoningLevel: "low" | "medium" | "high";
    maximumOutputTokens: number;
  }): Promise<{ outputText: string; inputTokens: number; billableOutputTokens: number }> {
    if (!input.prompt.trim()) throw new Error("A non-empty OpenAI prompt is required.");
    if (!Number.isInteger(input.maximumOutputTokens) || input.maximumOutputTokens < 1) {
      throw new RangeError("OpenAI maximumOutputTokens must be a positive integer.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: input.prompt,
          store: false,
          max_output_tokens: input.maximumOutputTokens,
          reasoning: { effort: input.reasoningLevel },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new Error("OpenAI request failed before a response was received.");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}.`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("OpenAI returned an invalid JSON response.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("OpenAI returned a malformed response.");
    }
    const body = payload as Record<string, unknown>;
    if (body.status !== "completed") throw new Error("OpenAI did not complete the response.");
    const output = Array.isArray(body.output) ? body.output : [];
    const text = output.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object" || Array.isArray(part)) return [];
        const record = part as Record<string, unknown>;
        return record.type === "output_text" && typeof record.text === "string" ? [record.text] : [];
      });
    }).join("\n").trim();
    const usage = body.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
      throw new Error("OpenAI response omitted required usage accounting.");
    }
    const usageRecord = usage as Record<string, unknown>;
    const inputTokens = usageRecord.input_tokens;
    const billableOutputTokens = usageRecord.output_tokens;
    if (
      !Number.isInteger(inputTokens) ||
      (inputTokens as number) < 0 ||
      !Number.isInteger(billableOutputTokens) ||
      (billableOutputTokens as number) < 0
    ) {
      throw new Error("OpenAI returned malformed usage accounting.");
    }
    if (!text) throw new Error("OpenAI returned no text output.");
    return {
      outputText: text,
      inputTokens: inputTokens as number,
      billableOutputTokens: billableOutputTokens as number,
    };
  }
}
