import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBenchmarkDispatchBudget, type BenchmarkDispatchBudgetConfig } from "../src/benchmark-dispatch-budget.ts";
import { createObservedReuseBudget } from "../src/observed-reuse-benchmark.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import { CODING_REPAIR_EDITS_OUTPUT_CONTRACT } from "../src/coding-repair-edits.ts";

const url = "https://api.openai.com/v1/responses";
const body = (input = "task") => ({ method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input,
  store: false, reasoning: { effort: "medium" }, max_output_tokens: 100 }) });
const countBody = (input = "task") => ({ method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input }) });
const reply = () => new Response(JSON.stringify({ status: "completed", model: "gpt-5.6-luna", output: "invalid patch", usage: { input_tokens: 100, output_tokens: 100 } }));
const defaults = (directory: string): BenchmarkDispatchBudgetConfig => ({ directory, beforeDispatch: async () => {},
  model: "gpt-5.6-luna", reasoning: "medium", arms: ["conventional", "reparodynamic"],
  attempts: Array.from({ length: 10 }, (_, n) => ["conventional", "reparodynamic"].map(arm => ({ id: `${n}/${arm}`, arm }))).flat(),
  maximumInputTokens: 100, maximumOutputTokens: 100, inputPriceTenthsMicros: 2, outputPriceTenthsMicros: 12,
  totalCapMicros: 2800, armCapMicros: 1400, attemptCapMicros: 280, maximumGenerationRequestsPerAttempt: 2 });
async function fixture(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-budget-"));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test("exact count is bound to input, model and attempt before any generation fetch", () => fixture(async directory => {
  let generations = 0;
  const budget = createBenchmarkDispatchBudget({ ...defaults(directory), fetchImpl: async resource => {
    if (String(resource).endsWith("input_tokens")) return new Response('{"input_tokens":100}');
    generations++; return reply();
  } });
  const request = budget.fetchFor("0/conventional");
  await assert.rejects(request(url, body()), /INPUT_TOKEN_BOUND_REQUIRED/);
  await request(url + "/input_tokens", countBody());
  await assert.rejects(request(url, body("changed")), /INPUT_TOKEN_BOUND_REQUIRED/);
  await assert.rejects(budget.fetchFor("1/conventional")(url, body()), /INPUT_TOKEN_BOUND_REQUIRED/);
  assert.equal(generations, 0);
  await request(url, body());
  assert.equal(generations, 1);
  assert.equal(budget.snapshot().estimatedTotalUsd, .00014);
  assert.equal(budget.snapshot().completedGenerationRequestsByAttempt["0/conventional"], 1);
  assert.equal(budget.snapshot().providerChargesReconciled, false);
}));
test("caps block fetch across attempts and count every completed invalid output", () => fixture(async directory => {
  let calls = 0;
  const budget = createBenchmarkDispatchBudget({ ...defaults(directory), armCapMicros: 280, fetchImpl: async resource => {
    if (String(resource).endsWith("input_tokens")) return new Response('{"input_tokens":100}');
    calls++; return reply();
  } });
  for (const id of ["0/conventional", "1/conventional", "2/conventional"]) {
    const request = budget.fetchFor(id);
    await request(url + "/input_tokens", countBody());
    if (id.startsWith("2/")) await assert.rejects(request(url, body()), /ARM_BUDGET_EXHAUSTED/);
    else await request(url, body());
  }
  assert.equal(calls, 2);
  assert.equal(budget.snapshot().estimatedByArmUsd.conventional, .00028);
}));
test("per-attempt request count cannot be borrowed from another task", () => fixture(async directory => {
  let calls = 0;
  const budget = createBenchmarkDispatchBudget({ ...defaults(directory), maximumGenerationRequestsPerAttempt: 1,
    fetchImpl: async resource => {
      if (String(resource).endsWith("input_tokens")) return new Response('{"input_tokens":100}');
      calls++; return reply();
    } });
  const request = budget.fetchFor("0/conventional");
  await request(url + "/input_tokens", countBody()); await request(url, body());
  await assert.rejects(request(url, body()), /ATTEMPT_BUDGET_EXHAUSTED/);
  assert.equal(calls, 1);
}));
test("total cap spans arms and fractional microdollars round upward", () => fixture(async directory => {
  let calls = 0;
  const budget = createBenchmarkDispatchBudget({ ...defaults(directory), totalCapMicros: 141, fetchImpl: async resource => {
    if (String(resource).endsWith("input_tokens")) return new Response('{"input_tokens":1}');
    calls++; return new Response('{"status":"completed","model":"gpt-5.6-luna","usage":{"input_tokens":1,"output_tokens":1}}');
  } });
  const first = budget.fetchFor("0/conventional"), second = budget.fetchFor("0/reparodynamic");
  await first(url + "/input_tokens", countBody()); await first(url, body());
  assert.equal(budget.snapshot().estimatedTotalUsd, .000002);
  await second(url + "/input_tokens", countBody());
  await assert.rejects(second(url, body()), /ARM_BUDGET_EXHAUSTED/);
  assert.equal(calls, 1);
}));
test("unknown response retains full reservation and prevents dispatch in other arms", () => fixture(async directory => {
  const budget = createBenchmarkDispatchBudget({ ...defaults(directory), fetchImpl: async resource =>
    String(resource).endsWith("input_tokens") ? new Response('{"input_tokens":100}') : new Response('{"status":"incomplete","model":"gpt-5.6-luna"}') });
  const request = budget.fetchFor("0/conventional");
  await request(url + "/input_tokens", countBody());
  await assert.rejects(request(url, body()), /USAGE_UNKNOWN/);
  const snapshot = budget.snapshot();
  assert.equal(snapshot.unresolvedReservedUsd, .00014);
  assert.equal(snapshot.unresolvedReservedByAttemptUsd["0/conventional"], .00014);
  assert.equal(snapshot.generationRequests, 1);
  snapshot.generationRequestsByAttempt["0/conventional"] = 99;
  assert.equal(budget.snapshot().generationRequestsByAttempt["0/conventional"], 1);
  await assert.rejects(budget.fetchFor("0/reparodynamic")(url, body()), /CLOSED/);
}));
test("historical short direct prompts remain supported but UTF-8 oversized prompts never fetch", () => fixture(async directory => {
  let calls = 0;
  const budget = createObservedReuseBudget({ directory, beforeDispatch: async () => {}, fetchImpl: async (_resource, init) => {
    calls++; assert.equal(init?.redirect, "error"); return reply();
  } });
  const request = budget.fetchFor("optimized");
  const legacyBody = (input: string) => ({ method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input,
    store: false, reasoning: { effort: "medium" }, max_output_tokens: 8000 }) });
  await assert.rejects(request(url, legacyBody("🙂".repeat(8000))), /INPUT_TOKEN_BOUND_REQUIRED/);
  assert.equal(calls, 0);
  await request(url, legacyBody("bounded")); assert.equal(calls, 1);
}));
test("invalid numeric configurations and duplicate identities fail before dispatch", () => {
  for (const field of ["maximumInputTokens", "maximumOutputTokens", "inputPriceTenthsMicros", "outputPriceTenthsMicros",
    "totalCapMicros", "armCapMicros", "attemptCapMicros", "maximumGenerationRequestsPerAttempt"] as const) {
    for (const value of [NaN, Infinity, -1, 0, .5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createBenchmarkDispatchBudget({ ...defaults("unused"), [field]: value }), /INVALID_CONFIG/);
    }
  }
  const config = defaults("unused");
  assert.throws(() => createBenchmarkDispatchBudget({ ...config, arms: ["conventional", "conventional"] }), /INVALID_CONFIG/);
  assert.throws(() => createBenchmarkDispatchBudget({ ...config, attempts: [config.attempts[0], config.attempts[0]] }), /INVALID_CONFIG/);
  assert.throws(() => createBenchmarkDispatchBudget({ ...config, beforeDispatch: undefined as never }), /INVALID_CONFIG/);
});
test("strict provider contract prevents tools, altered reasoning and redirects", () => fixture(async directory => {
  let calls = 0;
  const budget = createBenchmarkDispatchBudget({ ...defaults(directory), fetchImpl: async () => { calls++; return reply(); } });
  const request = budget.fetchFor("0/conventional");
  for (const extra of [{ tools: [] }, { reasoning: { effort: "medium", summary: "auto" } }, { max_output_tokens: 101 }, { model: "other" }]) {
    await assert.rejects(request(url, { method: "POST", body: JSON.stringify({ ...JSON.parse(body().body), ...extra }) }), /CONTRACT_CHANGED/);
  }
  await assert.rejects(request(url + "?redirect=1", body()), /ENDPOINT_REJECTED/);
  assert.equal(calls, 0);
}));
test("historical client structured token-count request preserves its actual schema contract", () => fixture(async directory => {
  let counted = false;
  const budget = createObservedReuseBudget({ directory, beforeDispatch: async () => {}, fetchImpl: async (resource, init) => {
    assert.equal(String(resource), url + "/input_tokens");
    const request = JSON.parse(init!.body as string);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.name, "sara_coding_repair_edits_v1");
    assert.equal(request.text.format.strict, true);
    assert.equal(init!.redirect, "error"); counted = true;
    return new Response('{"input_tokens":100}');
  } });
  const client = new OpenAIResponsesClient({ apiKey: "OFFLINE_ONLY", fetchImpl: budget.fetchFor("optimized") });
  assert.equal(await client.countInputTokens(CODING_REPAIR_EDITS_OUTPUT_CONTRACT + "fixture"), 100);
  assert.equal(counted, true);
}));
test("missing, wrong, or switched model identity retains reservation and closes future fetches", async () => {
  for (const bad of [undefined, "other-model", "gpt-5.6-luna-2026-09-02"]) await fixture(async directory => {
    let generations = 0;
    const budget = createBenchmarkDispatchBudget({ ...defaults(directory), fetchImpl: async resource => {
      if (String(resource).endsWith("input_tokens")) return new Response('{"input_tokens":100}');
      generations++;
      return new Response(JSON.stringify({ status: "completed", model: generations === 1 ? "gpt-5.6-luna-2026-09-01" : bad,
        usage: { input_tokens: 100, output_tokens: 100 } }));
    } });
    const first = budget.fetchFor("0/conventional"), second = budget.fetchFor("0/reparodynamic");
    await first(url + "/input_tokens", countBody()); await first(url, body());
    await second(url + "/input_tokens", countBody());
    await assert.rejects(second(url, body()), /PROVIDER_MODEL_CHANGED/);
    assert.equal(budget.snapshot().observedModelIdentity, "gpt-5.6-luna-2026-09-01");
    assert.equal(budget.snapshot().unresolvedReservedUsd, .00014);
    assert.equal(budget.snapshot().estimatedTotalUsd, .00014);
    await assert.rejects(first(url, body()), /CLOSED/);
    assert.equal(generations, 2);
  });
});
