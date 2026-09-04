import type { WorkerModelClient } from "./model-router.ts";

const SAFE_RESPONSE_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "in_progress",
  "incomplete",
  "queued",
]);
const SAFE_INCOMPLETE_REASONS = new Set(["content_filter", "max_output_tokens"]);
const READINESS_DELIVERY_CONTRACT = "OUTPUT CONTRACT: Return only one JSON object without Markdown fences.";
const CODING_REPAIR_CONTRACT = "OUTPUT CONTRACT: SARA_CODING_REPAIR_V1";

const REPOSITORY_READINESS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["categoryEvidence", "findings", "evidenceLimitations"],
  properties: {
    categoryEvidence: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "status", "evidenceFileIndexes", "note"],
        properties: {
          category: {
            type: "string",
            enum: ["code", "dependencies", "secret_exposure", "release_controls"],
          },
          status: { type: "string", enum: ["reviewed", "unavailable"] },
          evidenceFileIndexes: {
            type: "array",
            maxItems: 8,
            items: { type: "integer", minimum: 0, maximum: 63 },
          },
          note: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "category",
          "priority",
          "confidence",
          "title",
          "observation",
          "recommendation",
          "evidenceFileIndex",
          "evidenceLineStart",
          "evidenceLineEnd",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" },
          category: {
            type: "string",
            enum: ["code", "dependencies", "secret_exposure", "release_controls"],
          },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
          confidence: { type: "string", enum: ["confirmed", "supported", "tentative"] },
          title: { type: "string", minLength: 1, maxLength: 500 },
          observation: { type: "string", minLength: 1, maxLength: 500 },
          recommendation: { type: "string", minLength: 1, maxLength: 500 },
          evidenceFileIndex: { type: "integer", minimum: 0, maximum: 63 },
          evidenceLineStart: { type: "integer", minimum: 1, maximum: 100000 },
          evidenceLineEnd: { type: "integer", minimum: 1, maximum: 100000 },
        },
      },
    },
    evidenceLimitations: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
} as const;

type OpenAITextFormat = {
  format: {
    type: "json_schema";
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
};

const CODING_REPAIR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "baseArtifactDigest", "failureFingerprint", "strategy", "changes", "limitations"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    baseArtifactDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    failureFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
    strategy: { type: "string", enum: ["surgical", "deep"] },
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "expectedContentDigest", "replacementText"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 240 },
          expectedContentDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          replacementText: { type: "string", minLength: 1, maxLength: 16384 },
        },
      },
    },
    limitations: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
  },
} as const;

function responseTextFormat(prompt: string): OpenAITextFormat | undefined {
  if (prompt.includes(CODING_REPAIR_CONTRACT)) {
    return {
      format: {
        type: "json_schema",
        name: "sara_coding_repair_v1",
        strict: true,
        schema: CODING_REPAIR_JSON_SCHEMA,
      },
    };
  }
  if (!prompt.includes(READINESS_DELIVERY_CONTRACT)) return undefined;
  return {
    format: {
      type: "json_schema",
      name: "sara_repository_readiness_report_v2",
      strict: true,
      schema: REPOSITORY_READINESS_JSON_SCHEMA,
    },
  };
}

function safeResponseCompletionError(body: Record<string, unknown>): Error {
  const status = typeof body.status === "string" && SAFE_RESPONSE_STATUSES.has(body.status)
    ? body.status
    : "unknown";
  let reason: string | null = null;
  if (
    status === "incomplete" &&
    body.incomplete_details &&
    typeof body.incomplete_details === "object" &&
    !Array.isArray(body.incomplete_details)
  ) {
    const candidate = (body.incomplete_details as Record<string, unknown>).reason;
    if (typeof candidate === "string" && SAFE_INCOMPLETE_REASONS.has(candidate)) reason = candidate;
  }
  return new Error(`OpenAI response ended with status ${status}${reason ? `: ${reason}` : ""}.`);
}

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
    if (!prompt.trim()) throw new Error("A non-empty OpenAI prompt is required for token counting.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      const text = responseTextFormat(prompt);
      response = await this.#fetch("https://api.openai.com/v1/responses/input_tokens", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: prompt,
          ...(text ? { text } : {}),
        }),
        signal: controller.signal,
      });
    } catch {
      throw new Error("OpenAI token count request failed before a response was received.");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`OpenAI token count request failed with status ${response.status}.`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("OpenAI returned an invalid token count response.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("OpenAI returned a malformed token count response.");
    }
    const inputTokens = (payload as Record<string, unknown>).input_tokens;
    if (!Number.isInteger(inputTokens) || (inputTokens as number) < 0) {
      throw new Error("OpenAI returned malformed input token accounting.");
    }
    return inputTokens as number;
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
      const text = responseTextFormat(input.prompt);
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
          ...(text ? { text } : {}),
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
    if (body.status !== "completed") throw safeResponseCompletionError(body);
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
