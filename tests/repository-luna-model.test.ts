import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBenchmarkDispatchBudget } from "../src/benchmark-dispatch-budget.ts";
import { createRepositoryLunaModel } from "../src/repository-luna-model.ts";

test("repository Luna adapter counts exact input, preserves authority checks and accounts provider usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-repository-model-"));
  let authority = 0, omitText = false;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  try {
    const budget = createBenchmarkDispatchBudget({ directory, beforeDispatch: async () => { authority++; },
      model: "gpt-5.6-luna", reasoning: "medium", arms: ["conventional"], attempts: [{ id: "task-1", arm: "conventional" }],
      maximumInputTokens: 1000, maximumOutputTokens: 100, inputPriceTenthsMicros: 2, outputPriceTenthsMicros: 12,
      totalCapMicros: 1000, armCapMicros: 1000, attemptCapMicros: 1000, maximumGenerationRequestsPerAttempt: 2,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return Response.json(String(url).endsWith("input_tokens") ? { input_tokens: 12 } : {
          model: "gpt-5.6-luna", status: "completed", usage: { input_tokens: 12, output_tokens: 5 },
          output: omitText ? [] : [{ type: "message", content: [{ type: "output_text", text: '{"action":"finish"}' }] }],
        });
      },
    });
    const options = { apiKey: "offline-fixture", budget, attemptId: "task-1", maximumOutputTokens: 100 };
    const model = createRepositoryLunaModel(options);
    options.attemptId = "mutated"; options.maximumOutputTokens = 999; options.apiKey = "changed";
    const result = await model.request({ prompt: "Inspect the public repository", signal: new AbortController().signal, deadline: Date.now() + 10000 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.body.input, calls[1]!.body.input);
    assert.equal(result.accountedCostUsd, 9 / 1e6);
    assert.equal(result.outputText, '{"action":"finish"}');
    assert.equal(authority, 6);
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(model.request({ prompt: "never dispatched", signal: stopped.signal, deadline: Date.now() + 10000 }), /DEADLINE/);
    assert.equal(calls.length, 2);
    omitText = true;
    const empty = await model.request({ prompt: "Another public action", signal: new AbortController().signal, deadline: Date.now() + 10000 });
    assert.equal(empty.outputText, "");
    assert.equal(empty.accountedCostUsd, 9 / 1e6);
    assert.equal(empty.inputTokens, 12);
    assert.equal(calls.length, 4);
    assert.equal(budget.snapshot().closed, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
