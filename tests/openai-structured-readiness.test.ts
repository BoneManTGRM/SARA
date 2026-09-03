import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";

const DELIVERY_CONTRACT = "OUTPUT CONTRACT: Return only one JSON object without Markdown fences.";

describe("SARA readiness Structured Output transport", () => {
  it("binds the delivery contract to a strict JSON schema in both token counting and generation", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = new OpenAIResponsesClient({
      apiKey: "test-openai-key",
      fetchImpl: async (url, init) => {
        const target = String(url);
        requests.push({ url: target, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        if (target.endsWith("/input_tokens")) {
          return new Response(JSON.stringify({ input_tokens: 321 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
          usage: { input_tokens: 321, output_tokens: 1 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const prompt = `${DELIVERY_CONTRACT}\nWORK_PACKET_JSON: {}`;

    assert.equal(await client.countInputTokens(prompt), 321);
    await client.execute({ prompt, reasoningLevel: "medium", maximumOutputTokens: 25_000 });

    assert.equal(requests.length, 2);
    for (const request of requests) {
      const text = request.body.text as { format?: Record<string, unknown> } | undefined;
      assert.equal(text?.format?.type, "json_schema");
      assert.equal(text?.format?.name, "sara_repository_readiness_report_v1");
      assert.equal(text?.format?.strict, true);
      const schema = text?.format?.schema as Record<string, unknown>;
      assert.deepEqual(schema.required, ["categoryEvidence", "findings", "evidenceLimitations"]);
      assert.equal(schema.additionalProperties, false);
      const properties = schema.properties as Record<string, unknown>;
      assert.ok(properties.categoryEvidence);
      assert.ok(properties.findings);
      assert.ok(properties.evidenceLimitations);
    }
  });
});
