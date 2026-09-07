import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createObservedReuseBudget, runObservedReuseBenchmark } from "../src/observed-reuse-benchmark.ts";
import { readBoundedProviderBody } from "../src/bounded-provider-body.ts";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
const url = "https://api.openai.com/v1/responses";
const init = (): RequestInit => ({ method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "bounded fixture", store: false, max_output_tokens: 8000, reasoning: { effort: "medium" } }) });
const reply = () => new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 100, output_tokens: 100 } }));
async function directory(fn: (root: string) => Promise<void>) { const root = await mkdtemp(join(tmpdir(), "observed-dispatch-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }

test("dispatched failed request is counted, held and never retried", () => directory(async root => {
  let calls = 0;
  const budget = createObservedReuseBudget({ directory: root, beforeDispatch: async () => {}, fetchImpl: async () => { calls++; throw Error("provider unavailable"); } });
  await assert.rejects(budget.fetchFor("optimized")(url, init()));
  assert.equal(calls, 1); assert.equal(budget.snapshot().generationRequests, 1);
  assert.equal(budget.snapshot().generationRequestsByArm.optimized, 1);
  assert.equal(budget.snapshot().completedGenerationRequestsByArm.optimized, 0);
  assert.equal(budget.snapshot().unresolvedReservedUsd, .0156); assert(budget.snapshot().closed);
  await assert.rejects(budget.fetchFor("ordinary_memory")(url, init()), /CLOSED/); assert.equal(calls, 1);
}));
for (const stopAt of [1, 2, 3]) test(`revoked authority at boundary ${stopAt} counts no network invocation`, () => directory(async root => {
  let checks = 0, calls = 0;
  const budget = createObservedReuseBudget({ directory: root, beforeDispatch: async () => { if (++checks === stopAt) throw Error("revoked"); }, fetchImpl: async () => { calls++; return reply(); } });
  await assert.rejects(budget.fetchFor("optimized")(url, init()));
  assert.equal(calls, 0); assert.equal(budget.snapshot().generationRequests, 0); assert.equal(budget.snapshot().generationRequestsByArm.optimized, 0);
}));
test("already aborted request cannot increment dispatch count", () => directory(async root => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const budget = createObservedReuseBudget({ directory: root, beforeDispatch: async () => {}, fetchImpl: async () => { calls++; return reply(); } });
  await assert.rejects(budget.fetchFor("optimized")(url, { ...init(), signal: controller.signal }), /ABORTED/);
  assert.equal(calls, 0); assert.equal(budget.snapshot().generationRequests, 0);
}));
test("successful accounting snapshots cannot be mutated and counts distinguish tokenization", () => directory(async root => {
  const budget = createObservedReuseBudget({ directory: root, beforeDispatch: async () => {}, fetchImpl: async address => String(address).endsWith("/input_tokens") ? new Response('{"input_tokens":100}') : reply() });
  await budget.fetchFor("ordinary_memory")(url + "/input_tokens", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", input: "code" }) });
  await budget.fetchFor("ordinary_memory")(url, init());
  const s = budget.snapshot(); s.generationRequestsByArm.ordinary_memory = 100;
  assert.equal(budget.snapshot().generationRequestsByArm.ordinary_memory, 1);
  assert.equal(budget.snapshot().tokenCountRequestsByArm.ordinary_memory, 1);
  assert.equal(budget.snapshot().completedGenerationRequestsByArm.ordinary_memory, 1);
  assert.equal(budget.snapshot().unresolvedReservedUsd, 0);
  const intent = (await readdir(root)).find(p => p.endsWith("dispatch-intent.json"))!;
  assert.equal(JSON.parse(await readFile(join(root,intent),"utf8")).payload.providerAcceptanceKnown, false);
}));
test("body bound rejects while streaming rather than after unlimited allocation", async () => {
  await assert.rejects(readBoundedProviderBody(new Response("x".repeat(1025)), undefined, 1024), /BOUND/);
  await assert.rejects(readBoundedProviderBody(new Response(new Uint8Array([0xff]))), /encoded|encoding/i);
});
test("body stalled after headers retains uncertainty and closes budget on deadline", () => directory(async root => {
  const controller = new AbortController(); let calls = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const budget = createObservedReuseBudget({ directory: root, beforeDispatch: async () => {}, fetchImpl: async () => { calls++; setTimeout(() => controller.abort(), 20); return new Response(stream); } });
  await assert.rejects(budget.fetchFor("optimized")(url, {...init(),signal:controller.signal}), /ABORTED/);
  assert.equal(calls,1); assert.equal(budget.snapshot().generationRequestsByArm.optimized,1);
  assert.equal(budget.snapshot().unresolvedReservedUsd,.0156); assert(budget.snapshot().closed); assert(cancelled);
}));
test("concurrent invocation cannot pass the existing reservation lock", () => directory(async root => {
  let release!:()=>void; const wait = new Promise<void>(r=>{release=r;}); let calls=0;
  const budget=createObservedReuseBudget({directory:root,beforeDispatch:async()=>{await wait;},fetchImpl:async()=>{calls++;return reply();}});
  const first=budget.fetchFor("regenerate")(url,init());
  await assert.rejects(budget.fetchFor("optimized")(url,init()),/BUSY/); release();await first;assert.equal(calls,1);
}));
test("failed first model request remains in the actual benchmark row without a reuse callback", () => directory(async root => {
  const native = await NativeCodingVerifier.create(); assert(native); let calls=0;
  await assert.rejects(runObservedReuseBenchmark({directory:join(root,"trial"),benchmarkId:"fault-fixture",apiKey:"OFFLINE_ONLY",native,
    executionKind:"scripted_offline",beforeDispatch:async()=>{},fetchImpl:async address=>{
      if(String(address).endsWith("/input_tokens"))return new Response('{"input_tokens":100}');
      calls++;throw Error("uncertain fixture dispatch");
    }}), /STOPPED_AFTER_UNCERTAIN_DISPATCH/);
  const summary=JSON.parse(await readFile(join(root,"trial/trace/reuse-summary.json"),"utf8")).payload;
  assert.equal(calls,1);assert.equal(summary.rows.length,1);assert.equal(summary.rows[0].modelRequests,1);
  assert.equal(summary.rows[0].completed,false);assert.equal(summary.rows[0].hits,0);
  assert.equal(summary.comparisonAllowed,false);assert.equal(summary.warmRatios,null);
  assert.equal(summary.accounting.generationRequests,1);assert.equal(summary.accounting.unresolvedReservedUsd,.0156);
}));
