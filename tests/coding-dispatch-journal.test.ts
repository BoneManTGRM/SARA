import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingDispatchJournal } from "../src/coding-dispatch-journal.ts";
const url = "https://api.openai.com/v1/responses";
const init = () => ({ method: "POST", headers: { authorization: "Bearer PRIVATE_TEST_SECRET" }, body: '{"input":"PRIVATE_PROMPT"}' });
async function setup(fn: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-dispatch-"));
  try { await fn(root, join(root, "run")); } finally { await rm(root, { recursive: true, force: true }); }
}
test("actual attempted generation survives timeout before any downstream reuse callback", () => setup(async (_, directory) => {
  let calls = 0;
  const journal = new CodingDispatchJournal({ directory, beforeDispatch: async () => {}, fetchImpl: async () => {
    calls++; throw new Error("PRIVATE_PROVIDER_ERROR");
  } });
  await assert.rejects(journal.fetch(url, init()));
  assert.equal(journal.snapshot().generationAttempts, 1); assert.equal(journal.snapshot().uncertainAttempts, 1);
  await assert.rejects(journal.fetch(url, init()), /CLOSED/); assert.equal(calls, 1);
  const files = await readdir(directory); assert.equal(files.length, 2);
  const text = (await Promise.all(files.map(f => readFile(join(directory, f), "utf8")))).join();
  assert.doesNotMatch(text, /PRIVATE_TEST_SECRET|PRIVATE_PROMPT|PRIVATE_PROVIDER_ERROR/);
  const failure = JSON.parse(await readFile(join(directory, files.find(f => f.endsWith("-failure.json"))!), "utf8"));
  assert.equal(failure.payload.state, "uncertain"); assert.equal(failure.payload.networkAttemptedInProcess, true);
}));
test("intent is durable before fetch and a response receipt is not billing or acceptance", () => setup(async (_, directory) => {
  const journal = new CodingDispatchJournal({ directory, beforeDispatch: async () => {}, fetchImpl: async () => {
    const files = await readdir(directory); assert.equal(files.length, 1); assert(files[0].endsWith("-intent.json"));
    return new Response('{"status":"completed","usage":{"input_tokens":1}}', { headers: { "x-request-id": "req_unit-01" } });
  } });
  const response = await journal.fetch(url, init()); assert.equal(response.status, 200);
  assert.equal(journal.snapshot().generationAttempts, 1); assert.equal(journal.snapshot().responsesReceived, 1);
  const file = (await readdir(directory)).find(f => f.endsWith("-response.json"))!;
  const value = JSON.parse(await readFile(join(directory, file), "utf8")).payload;
  assert.equal(value.state, "response_received"); assert.equal(value.acceptanceOrBillingEstablished, false);
  assert.equal(value.providerRequestId, "req_unit-01");
}));
test("second authority rejection after intent never increments network attempt count", () => setup(async (_, directory) => {
  let checks = 0, calls = 0;
  const j = new CodingDispatchJournal({ directory, beforeDispatch: async () => { if (++checks === 2) throw Error("stop"); },
    fetchImpl: async () => { calls++; return new Response("{}"); } });
  await assert.rejects(j.fetch(url, init())); assert.equal(calls, 0); assert.equal(j.snapshot().generationAttempts, 0);
  const f = (await readdir(directory)).find(f => f.endsWith("-failure.json"))!;
  assert.equal(JSON.parse(await readFile(join(directory, f), "utf8")).payload.state, "not_sent");
}));
test("pre-aborted signal produces no network dispatch", () => setup(async (_, directory) => {
  let calls = 0; const c = new AbortController(); c.abort();
  const j = new CodingDispatchJournal({ directory, beforeDispatch: async () => {}, fetchImpl: async () => { calls++; return new Response("{}"); } });
  await assert.rejects(j.fetch(url, { ...init(), signal: c.signal })); assert.equal(calls, 0);
}));
test("duplicate journal directory cannot append to or replay the original journal", () => setup(async (_, directory) => {
  let calls = 0;
  const opts = { directory, beforeDispatch: async () => {}, fetchImpl: async () => { calls++; return new Response("{}"); } };
  await new CodingDispatchJournal(opts).fetch(url, init()); const before = await readdir(directory);
  await assert.rejects(new CodingDispatchJournal(opts).fetch(url, init()), { code: "EEXIST" });
  assert.deepEqual(await readdir(directory), before); assert.equal(calls, 1);
}));
test("request body and headers are snapshotted before asynchronous authority admission", () => setup(async (_, directory) => {
  const request = init(); let checks = 0;
  const j = new CodingDispatchJournal({ directory, beforeDispatch: async () => {
    if (++checks === 1) { request.body = "MUTATED"; request.headers.authorization = "MUTATED"; }
  }, fetchImpl: async (_, value) => {
    assert.equal(value?.body, '{"input":"PRIVATE_PROMPT"}'); assert.equal(new Headers(value?.headers).get("authorization"), "Bearer PRIVATE_TEST_SECRET");
    return new Response("{}");
  } });
  await j.fetch(url, request);
}));
test("token counts are separately recorded and do not inflate generation count", () => setup(async (_, directory) => {
  const j = new CodingDispatchJournal({ directory, beforeDispatch: async () => {}, fetchImpl: async () => new Response("{}") });
  await j.fetch(`${url}/input_tokens`, init()); assert.equal(j.snapshot().tokenCountAttempts, 1);
  assert.equal(j.snapshot().generationAttempts, 0);
}));
test("journal rejects nonapproved endpoint and overlapping dispatch without starting extra work", () => setup(async (_, directory) => {
  let release!: () => void; const wait = new Promise<void>(r => { release = r; }); let calls = 0;
  const j = new CodingDispatchJournal({ directory, beforeDispatch: async () => { await wait; }, fetchImpl: async () => { calls++; return new Response("{}"); } });
  await assert.rejects(j.fetch("https://example.invalid/provider", init()), /ENDPOINT/);
  const first = j.fetch(url, init()); await assert.rejects(j.fetch(url, init()), /BUSY/);
  release(); await first; assert.equal(calls, 1);
}));
test("oversized response closes observer without returning successful completion", () => setup(async (_, directory) => {
  const j = new CodingDispatchJournal({ directory, beforeDispatch: async () => {}, fetchImpl: async () => new Response("x".repeat(1_048_577)) });
  await assert.rejects(j.fetch(url, init()), /RESPONSE_BOUND/); assert(j.snapshot().closed);
  assert.equal(j.snapshot().responsesReceived, 0); assert.equal(j.snapshot().generationAttempts, 1);
}));
