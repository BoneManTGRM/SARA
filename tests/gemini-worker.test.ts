import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GeminiInteractionsClient } from "../src/gemini-worker.ts";

describe("Gemini 3.8 Flash interactions transport", () => {
  it("sends a non-stored bounded request and normalizes billed reasoning usage", async () => {
    // Catches enabling server-side storage, omitting the output ceiling, or undercounting thought tokens.
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new GeminiInteractionsClient({
      apiKey: "test-gemini-key",
      billingMode: "paid",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          status: "completed",
          steps: [{ type: "model_output", content: [{ type: "text", text: "bounded output" }] }],
          usage: {
            total_input_tokens: 101,
            total_output_tokens: 20,
            total_thought_tokens: 30,
            total_tool_use_tokens: 4,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await client.execute({
      prompt: "inspect this public repository",
      reasoningLevel: "medium",
      maximumOutputTokens: 500,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    const headers = new Headers(requests[0].init.headers);
    assert.equal(headers.get("x-goog-api-key"), "test-gemini-key");
    const body = JSON.parse(String(requests[0].init.body)) as Record<string, unknown>;
    assert.equal(body.model, "gemini-3.8-flash");
    assert.equal(body.store, false);
    assert.equal(body.background, false);
    assert.deepEqual(body.generation_config, {
      thinking_level: "medium",
      thinking_summaries: "none",
      max_output_tokens: 500,
      tool_choice: "none",
    });
    assert.deepEqual(result, {
      outputText: "bounded output",
      inputTokens: 101,
      billableOutputTokens: 54,
    });
  });

  it("does not expose the API key or provider response body in failures", async () => {
    // Catches secrets or provider-returned customer data leaking into durable error logs.
    const client = new GeminiInteractionsClient({
      apiKey: "super-secret-key",
      billingMode: "free",
      fetchImpl: async () => new Response("customer prompt echoed by provider", { status: 429 }),
    });

    await assert.rejects(async () => client.execute({
      prompt: "customer-private-secret",
      reasoningLevel: "low",
      maximumOutputTokens: 100,
    }), (error: unknown) => {
      const message = String((error as Error).message);
      assert.match(message, /status 429/i);
      assert.equal(message.includes("super-secret-key"), false);
      assert.equal(message.includes("customer prompt"), false);
      return true;
    });
  });
});
