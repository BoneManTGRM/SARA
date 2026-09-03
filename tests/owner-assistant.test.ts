import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { WorkerModelClient } from "../src/model-router.ts";
import { OwnerAssistant } from "../src/owner-assistant.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sara-owner-assistant-"));
  directories.push(directory);
  return directory;
}

function fakeClient(calls: string[], fail = false): WorkerModelClient {
  return {
    routeKey: "openai:gpt-5.6-luna:paid",
    maximumWallTimeMs: 1_000,
    async countInputTokens(prompt) {
      calls.push(prompt);
      return 100;
    },
    async execute() {
      if (fail) throw new Error("provider rejected a private marker");
      return { outputText: "A bounded private analysis.", inputTokens: 100, billableOutputTokens: 50 };
    },
  };
}

describe("bounded Telegram Luna owner analyst", () => {
  it("executes once, accounts cost, and persists no prompt or output", async () => {
    const directory = await stateDirectory();
    const calls: string[] = [];
    const assistant = new OwnerAssistant({ modelClient: fakeClient(calls), stateDirectory: directory, monthlyBudgetUsd: 2 });
    const now = new Date("2026-09-03T01:00:00.000Z");
    const first = await assistant.analyze({ requestId: "telegram:123:luna", text: "PRIVATE_OWNER_MARKER plan the next safe skill" }, now);
    const duplicate = await assistant.analyze({ requestId: "telegram:123:luna", text: "PRIVATE_OWNER_MARKER plan the next safe skill" }, now);

    assert.equal(first.outcome, "succeeded");
    assert.equal(first.model, "gpt-5.6-luna");
    assert.equal(first.accountedCostUsd, 0.00008);
    assert.equal(duplicate.outcome, "already_processed");
    assert.equal(calls.length, 1);
    const receipts = await readFile(join(directory, "owner-assistant-receipts.jsonl"), "utf8");
    assert.equal(receipts.includes("PRIVATE_OWNER_MARKER"), false);
    assert.equal(receipts.includes("bounded private analysis"), false);
    assert.match(receipts, /telegram:123:luna/u);
  });

  it("fails before provider use when the monthly sub-budget cannot cover worst case", async () => {
    const calls: string[] = [];
    const assistant = new OwnerAssistant({ modelClient: fakeClient(calls), stateDirectory: await stateDirectory(), monthlyBudgetUsd: 0.001 });
    await assert.rejects(
      () => assistant.analyze({ requestId: "telegram:budget:luna", text: "analyze this request" }, new Date("2026-09-03T01:00:00.000Z")),
      /sub-budget is exhausted/iu,
    );
    assert.equal(calls.length, 0);
  });

  it("accounts the conservative failure ceiling without persisting provider details", async () => {
    const directory = await stateDirectory();
    const calls: string[] = [];
    const assistant = new OwnerAssistant({ modelClient: fakeClient(calls, true), stateDirectory: directory, monthlyBudgetUsd: 2 });
    await assert.rejects(
      () => assistant.analyze({ requestId: "telegram:failed:luna", text: "PRIVATE_FAILURE_MARKER" }, new Date("2026-09-03T01:00:00.000Z")),
      /bounded model routes failed/iu,
    );
    const receipts = await readFile(join(directory, "owner-assistant-receipts.jsonl"), "utf8");
    assert.equal(receipts.includes("PRIVATE_FAILURE_MARKER"), false);
    assert.equal(receipts.includes("provider rejected"), false);
    assert.match(receipts, /"accountedCostUsd":0\.00152/u);
  });

  it("accounts a completed provider call even when its output is rejected", async () => {
    const directory = await stateDirectory();
    const assistant = new OwnerAssistant({
      stateDirectory: directory,
      monthlyBudgetUsd: 2,
      modelClient: {
        ...fakeClient([]),
        async execute() {
          return { outputText: "I deployed the product.", inputTokens: 100, billableOutputTokens: 50 };
        },
      },
    });
    await assert.rejects(
      () => assistant.analyze({ requestId: "telegram:invalid:luna", text: "analyze without action" }, new Date("2026-09-03T01:00:00.000Z")),
      /unsupported execution claim/iu,
    );
    const receipts = await readFile(join(directory, "owner-assistant-receipts.jsonl"), "utf8");
    assert.match(receipts, /"accountedCostUsd":0\.00008/u);
    assert.equal(receipts.includes("deployed the product"), false);
  });
});
