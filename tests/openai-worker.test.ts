import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";

describe("GPT-5.6 Luna Responses transport", () => {
  it("uses the Responses input-token endpoint instead of treating UTF-8 bytes as tokens", async () => {
    // Catches the production defect where an 18 KB work packet was rejected as 18K tokens.
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const prompt = "public repository evidence ".repeat(700);
    assert.ok(Buffer.byteLength(prompt, "utf8") > 10_000);
    const client = new OpenAIResponsesClient({
      apiKey: "test-openai-key",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          object: "response.input_tokens",
          input_tokens: 4_321,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    assert.equal(await client.countInputTokens(prompt), 4_321);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.openai.com/v1/responses/input_tokens");
    const headers = new Headers(requests[0].init.headers);
    assert.equal(headers.get("authorization"), "Bearer test-openai-key");
    const body = JSON.parse(String(requests[0].init.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.input, prompt);
  });

  it("sends a non-stored bounded Luna request and uses normalized response usage", async () => {
    // Catches selecting a costlier model, enabling response storage, or omitting the output ceiling.
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAIResponsesClient({
      apiKey: "test-openai-key",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "low-cost candidate" }],
          }],
          usage: {
            input_tokens: 101,
            output_tokens: 54,
            output_tokens_details: { reasoning_tokens: 30 },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await client.execute({
      prompt: "inspect this public repository",
      reasoningLevel: "low",
      maximumOutputTokens: 500,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
    const headers = new Headers(requests[0].init.headers);
    assert.equal(headers.get("authorization"), "Bearer test-openai-key");
    const body = JSON.parse(String(requests[0].init.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 500);
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.deepEqual(result, {
      outputText: "low-cost candidate",
      inputTokens: 101,
      billableOutputTokens: 54,
    });
  });

  it("does not expose the API key or provider response body in failures", async () => {
    // Catches credentials or customer content escaping through provider error logging.
    const client = new OpenAIResponsesClient({
      apiKey: "super-secret-openai-key",
      fetchImpl: async () => new Response("customer prompt echoed by provider", { status: 429 }),
    });

    await assert.rejects(async () => client.execute({
      prompt: "customer-private-secret",
      reasoningLevel: "low",
      maximumOutputTokens: 100,
    }), (error: unknown) => {
      const message = String((error as Error).message);
      assert.match(message, /status 429/i);
      assert.equal(message.includes("super-secret-openai-key"), false);
      assert.equal(message.includes("customer prompt"), false);
      return true;
    });
  });
});
