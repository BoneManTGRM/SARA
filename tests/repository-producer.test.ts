import test from "node:test";
import assert from "node:assert/strict";
import { parseRepositoryAction, runRepositoryProducer, type RepositoryProducerSandbox, type RepositoryAction } from "../src/repository-producer.ts";
import type { RepositoryEnvironment, RepositoryTask } from "../src/repository-executor.ts";
const environment: RepositoryEnvironment = { schemaVersion: 1, repository: "public/project", baseCommit: "a".repeat(40), image: "sha256:" + "b".repeat(64), publicTestCommand: ["npm", "test"], timeoutSeconds: 10 };
const task: RepositoryTask = { instanceId: "issue-1", runId: "run-1", problemStatement: "Correct the issue even when existing tests pass.", arm: "conventional" };
const limits = { maximumModelRequests: 8, maximumToolSteps: 30, maximumPublicTests: 5, maximumOutputBytes: 100000, maximumWallMilliseconds: 10000 };
function sandbox() {
  let content = "original", restores = 0, edits = 0;
  const patch = () => content === "original" ? "" : `diff --git a/src/file.ts b/src/file.ts\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1 @@\n-original\n+${content}\n`;
  const value: RepositoryProducerSandbox = {
    async execute(action) {
      if (action.action === "test") return { exitCode: content === "bad" ? 1 : 0, output: content === "bad" ? "regression" : "passing" };
      if (action.action === "edit") { edits++; if (content !== action.oldText) return { exitCode: 1, output: "ANCHOR_NOT_UNIQUE" }; content = action.newText; }
      return { exitCode: 0, output: content };
    },
    async freezePatch() { return patch(); },
    async restore(p) { restores++; content = p ? "good" : "original"; }, async close() {},
  };
  return { value, state: () => ({ content, restores, edits }) };
}
const edit: RepositoryAction = { action: "edit", path: "src/file.ts", oldText: "original", newText: "bad" };
function model(actions: unknown[]) {
  const prompts: string[] = []; let index = 0;
  return { prompts, async request(input: { prompt: string }) { prompts.push(input.prompt); return { outputText: JSON.stringify(actions[index++] ?? { action: "finish" }), inputTokens: 3, outputTokens: 2, accountedCostUsd: 0.001 }; } };
}
test("public green still dispatches issue-driven model and preserves usage on invalid output", async () => {
  const m = model([{ action: "exec", command: "anything" }, { action: "finish" }]);
  const result = await runRepositoryProducer({ task, environment, limits, model: m, sandbox: sandbox().value, beforeAction() {} });
  assert.equal(result.modelRequests, 2); assert.equal(result.publicTests, 1); assert.equal(result.accountedCostUsd, 0.002);
  assert.match(m.prompts[0]!, /Correct the issue/); assert.equal(result.officialBenchmarkResult, false);
  assert.ok(result.events.some(e => e.kind === "invalid_action"));
});
test("strict actions reject traversal, metadata, extra fields, empty and excessive anchors", () => {
  for (const path of ["../secret", "/host", "a/../../b", ".git/config", "a/.GIT/config", "a\\b", "a//b", "."])
    assert.throws(() => parseRepositoryAction(JSON.stringify({ action: "read", path })));
  for (const action of [{ action: "test", command: "evil" }, { ...edit, oldText: "" }, { ...edit, newText: "x".repeat(40000) }, { action: "finish", hiddenTests: [] }])
    assert.throws(() => parseRepositoryAction(JSON.stringify(action)));
  assert.deepEqual(parseRepositoryAction('{"action":"list","path":""}'), { action: "list", path: "" });
});
test("authority callback prevents dispatch and any subsequent action", async () => {
  let calls = 0; const m = model([edit]); const s = sandbox();
  const result = await runRepositoryProducer({ task, environment, limits, model: m, sandbox: s.value, beforeAction(kind) { calls++; if (kind === "model") throw Error("REVOKED"); } });
  assert.equal(result.reason, "REVOKED"); assert.equal(m.prompts.length, 0); assert.equal(calls, 2); assert.equal(s.state().edits, 0);
});
test("Reparodynamic controller actually rolls back new failures and suppresses duplicate failed edits", async () => {
  const actions = [edit, { action: "test" }, edit, { action: "finish" }];
  const conventional = sandbox(), reparodynamic = sandbox();
  const a = await runRepositoryProducer({ task, environment, limits, model: model(actions), sandbox: conventional.value, beforeAction() {} });
  const b = await runRepositoryProducer({ task: { ...task, arm: "reparodynamic" }, environment, limits, model: model(actions), sandbox: reparodynamic.value, beforeAction() {} });
  assert.equal(conventional.state().restores, 0); assert.equal(reparodynamic.state().restores, 1);
  assert.equal(conventional.state().edits, 2); assert.equal(reparodynamic.state().edits, 1);
  assert.match(a.patch, /\+bad/); assert.equal(b.patch, "");
  assert.ok(b.events.some(e => e.kind === "decision" && JSON.stringify(e.detail).includes("suppress_duplicate")));
});
test("each invocation starts with empty private memory and identical first prompt across arms", async () => {
  const first = model([edit, { action: "test" }, { action: "finish" }]), next = model([{ action: "finish" }]);
  await runRepositoryProducer({ task: { ...task, arm: "reparodynamic" }, environment, limits, model: first, sandbox: sandbox().value, beforeAction() {} });
  await runRepositoryProducer({ task: { ...task, instanceId: "other", arm: "conventional" }, environment, limits, model: next, sandbox: sandbox().value, beforeAction() {} });
  assert.equal(first.prompts[0], next.prompts[0]); assert.doesNotMatch(next.prompts[0]!, /suppress_duplicate|regression/);
});
test("finite limits preserve failed or empty outcomes without additional dispatch", async () => {
  const result = await runRepositoryProducer({ task, environment, limits: { ...limits, maximumModelRequests: 1 }, model: model([edit]), sandbox: sandbox().value, beforeAction() {} });
  assert.equal(result.status, "exhausted"); assert.match(result.patch, /\+bad/);
  await assert.rejects(runRepositoryProducer({ task, environment, limits: { ...limits, maximumModelRequests: Infinity }, model: model([]), sandbox: sandbox().value, beforeAction() {} }), /PRODUCER_LIMITS/);
});
test("repeated observed failure changes actual repair scope to deep", async () => {
  const s = sandbox(); const execute = s.value.execute;
  s.value.execute = async action => action.action === "test" ? { exitCode: 1, output: "existing failure" } : execute(action);
  const actions = [edit, { action: "test" }, { ...edit, oldText: "bad", newText: "stillbad" }, { action: "test" }, { action: "finish" }];
  const result = await runRepositoryProducer({ task: { ...task, arm: "reparodynamic" }, environment, limits, model: model(actions), sandbox: s.value, beforeAction() {} });
  const decisions = result.events.filter(e => e.kind === "strategy").map(e => e.detail as { strategy: string; recurrence: number });
  assert.deepEqual(decisions.map(d => [d.strategy, d.recurrence]), [["surgical", 1], ["deep", 2]]);
  assert.equal(s.state().restores, 0); // No invented regression relative to an already failing baseline.
});
test("wall deadline aborts model and no tool or follow-up is dispatched", async () => {
  const s = sandbox(); let aborted = false;
  const result = await runRepositoryProducer({ task, environment, limits: { ...limits, maximumWallMilliseconds: 20 }, sandbox: s.value, beforeAction() {}, model: {
    request({ signal }) { return new Promise((_, reject) => signal.addEventListener("abort", () => { aborted = true; reject(Error("aborted")); }, { once: true })); },
  } });
  assert.equal(aborted, true); assert.equal(result.status, "exhausted"); assert.equal(result.modelRequests, 1); assert.equal(s.state().edits, 0);
});
test("provider timeout preserves unreconciled exposure and drains sandbox cleanup", async () => {
  let cleaned = false;
  const s = sandbox(); s.value.close = async () => { await new Promise(resolve => setTimeout(resolve, 5)); cleaned = true; };
  const result = await runRepositoryProducer({ task, environment, limits: { ...limits, maximumWallMilliseconds: 15 }, sandbox: s.value, beforeAction() {},
    model: { request() { return new Promise(() => {}); } } });
  assert.equal(cleaned, true); assert.equal(result.accountingComplete, false); assert.equal(result.unreconciledModelRequests, 1);
});
test("concrete sandbox close drains replacement startup and closes late container", async () => {
  const { createRepositoryProducerSandbox } = await import("../src/repository-producer.ts");
  let release!: () => void, starting!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { starting = resolve; });
  let secondClosed = 0, starts = 0;
  function session(second: boolean) { return { async close() { if (second) secondClosed++; }, async run() { return { exitCode: 0, output: "" }; }, async mustRun() { return { exitCode: 0, output: "" }; }, async freezePatch() { return ""; } }; }
  const s = await createRepositoryProducerSandbox(environment, async () => { if (++starts === 2) { starting(); await gate; return session(true); } return session(false); });
  const restoring = s.restore(""); const rejected = assert.rejects(restoring, /PRODUCER_CLOSED/);
  await started;
  let closed = false; const close = s.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false);
  release(); await close; await rejected;
  assert.equal(secondClosed, 1); await s.close(); assert.equal(secondClosed, 1);
  await assert.rejects(s.execute({ action: "test" }), /PRODUCER_CLOSED/);
});
test("invalid registration closes an already allocated sandbox before rejection", async () => {
  const s = sandbox(); let closed = 0; s.value.close = async () => { closed++; };
  await assert.rejects(runRepositoryProducer({ task, environment, limits: { ...limits, maximumModelRequests: Infinity }, model: model([]), sandbox: s.value, beforeAction() {} }), /PRODUCER_LIMITS/);
  assert.equal(closed, 1);
});
test("known pre-dispatch model cap preserves prior charges and ends with complete accounting", async () => {
  const { RepositoryProducerModelLimit } = await import("../src/repository-producer.ts");
  const s = sandbox(); let closed = false, requests = 0;
  s.value.close = async () => { closed = true; };
  const result = await runRepositoryProducer({ task, environment, limits, sandbox: s.value, beforeAction() {}, model: {
    async request() {
      if (++requests === 2) throw new RepositoryProducerModelLimit();
      return { outputText: JSON.stringify({ action: "read", path: "src/file.ts" }), inputTokens: 5, outputTokens: 3, accountedCostUsd: .004 };
    },
  } });
  assert.equal(result.status, "exhausted"); assert.equal(result.reason, "PRODUCER_MODEL_LIMIT");
  assert.equal(result.modelRequests, 2); assert.equal(result.accountedCostUsd, .004);
  assert.equal(result.inputTokens, 5); assert.equal(result.outputTokens, 3);
  assert.equal(result.unreconciledModelRequests, 0); assert.equal(result.accountingComplete, true); assert.equal(closed, true);
});
test("an untyped error with the same text cannot erase unknown dispatch exposure", async () => {
  const result = await runRepositoryProducer({ task, environment, limits, sandbox: sandbox().value, beforeAction() {}, model: {
    async request() { throw Error("PRODUCER_MODEL_LIMIT"); },
  } });
  assert.equal(result.status, "failed"); assert.equal(result.accountingComplete, false); assert.equal(result.unreconciledModelRequests, 1);
});
