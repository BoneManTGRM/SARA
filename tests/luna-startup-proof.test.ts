import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runLunaStartupProof } from "../src/luna-startup-proof.ts";
import type { WorkerModelClient } from "../src/model-router.ts";

describe("one-time bounded Luna startup proof", () => {
  it("persists success without output text and never spends twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-luna-proof-"));
    let calls = 0;
    const client: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens() { return 20; },
      async execute() {
        calls += 1;
        return { outputText: "SARA_LUNA_READY", inputTokens: 20, billableOutputTokens: 40 };
      },
    };
    try {
      const first = await runLunaStartupProof({ client, stateDirectory: directory, enabled: true });
      const second = await runLunaStartupProof({ client, stateDirectory: directory, enabled: true });
      assert.equal(first.status, "succeeded");
      assert.deepEqual(second, first);
      assert.equal(calls, 1);
      assert.equal(JSON.stringify(first).includes("SARA_LUNA_READY"), false);
      assert.ok(first.accountedCostUsd <= 0.01);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes a terminal sanitized failure and does not retry automatically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-luna-proof-failure-"));
    let calls = 0;
    const client: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens() { return 20; },
      async execute() {
        calls += 1;
        throw new Error("SECRET_PROVIDER_FAILURE_BODY");
      },
    };
    try {
      const first = await runLunaStartupProof({ client, stateDirectory: directory, enabled: true });
      const second = await runLunaStartupProof({ client, stateDirectory: directory, enabled: true });
      assert.equal(first.status, "failed");
      assert.deepEqual(second, first);
      assert.equal(calls, 1);
      assert.equal(JSON.stringify(first).includes("SECRET_PROVIDER_FAILURE_BODY"), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records cost but fails closed when the proof response is not exact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-luna-proof-unexpected-"));
    let calls = 0;
    const client: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens() { return 20; },
      async execute() {
        calls += 1;
        return { outputText: "something else", inputTokens: 20, billableOutputTokens: 40 };
      },
    };
    try {
      const first = await runLunaStartupProof({ client, stateDirectory: directory, enabled: true });
      const second = await runLunaStartupProof({ client, stateDirectory: directory, enabled: true });
      assert.equal(first.status, "failed");
      assert.equal(first.failureCode, "unexpected_response");
      assert.ok(first.accountedCostUsd > 0 && first.accountedCostUsd <= 0.01);
      assert.deepEqual(second, first);
      assert.equal(calls, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows only one paid call across simultaneous process starts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-luna-proof-race-"));
    let calls = 0;
    const client: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid",
      maximumWallTimeMs: 1_000,
      async countInputTokens() { return 20; },
      async execute() {
        calls += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return { outputText: "SARA_LUNA_READY", inputTokens: 20, billableOutputTokens: 40 };
      },
    };
    try {
      await Promise.allSettled([
        runLunaStartupProof({ client, stateDirectory: directory, enabled: true }),
        runLunaStartupProof({ client, stateDirectory: directory, enabled: true }),
      ]);
      assert.equal(calls, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
