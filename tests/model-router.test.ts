import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeWorkerModelTask,
  planWorkerModelTask,
  workerModelRouteKey,
  type WorkerModelClient,
  type WorkerModelRawResult,
} from "../src/model-router.ts";

describe("SARA worker model routing policy", () => {
  it("routes public repository investigation through Luna first with a bounded Gemini fallback", () => {
    // Catches paying the higher Gemini rate before trying the cheaper paid worker.
    const plan = planWorkerModelTask({
      taskKind: "repository_investigation",
      dataClassification: "public",
      maximumTaskCostUsd: 0.1,
      allowGeminiFreeTier: true,
      pricedAt: new Date("2026-09-02T00:00:00.000Z"),
    });

    assert.equal(plan.maximumAttempts, 2);
    assert.ok(plan.worstCaseCostUsd <= 0.1);
    assert.deepEqual(
      plan.routes.map(({ provider, model, billingMode, reasoningLevel }) => ({
        provider,
        model,
        billingMode,
        reasoningLevel,
      })),
      [
        {
          provider: "openai",
          model: "gpt-5.6-luna",
          billingMode: "paid",
          reasoningLevel: "low",
        },
        {
          provider: "google",
          model: "gemini-3.8-flash",
          billingMode: "free",
          reasoningLevel: "medium",
        },
      ],
    );
  });

  it("never sends customer-confidential work through a training-eligible free tier", () => {
    // Catches treating an owner preference for free compute as authority to expose customer data.
    const plan = planWorkerModelTask({
      taskKind: "routine_code",
      dataClassification: "customer_confidential",
      maximumTaskCostUsd: 0.1,
      allowGeminiFreeTier: true,
      pricedAt: new Date("2026-09-02T00:00:00.000Z"),
    });

    assert.equal(plan.routes[0].model, "gpt-5.6-luna");
    assert.equal(plan.routes[1].model, "gemini-3.8-flash");
    assert.equal(plan.routes[1].billingMode, "paid");
    assert.ok(plan.routes.every((route) => route.billingMode !== "free"));
  });

  it("fails closed instead of routing credentials or regulated data to a model", () => {
    // Catches a policy gap that could place protected data into an external prompt.
    for (const dataClassification of ["credentials", "regulated"] as const) {
      assert.throws(
        () => planWorkerModelTask({
          taskKind: "repository_investigation",
          dataClassification,
          maximumTaskCostUsd: 1,
          allowGeminiFreeTier: false,
          pricedAt: new Date("2026-09-02T00:00:00.000Z"),
        }),
        /protected data/i,
      );
    }
  });

  it("uses the price effective on the plan date and rejects a plan whose worst case exceeds its cap", () => {
    // Catches silently retaining introductory Gemini pricing after it expires.
    const introductory = planWorkerModelTask({
      taskKind: "routine_code",
      dataClassification: "customer_confidential",
      maximumTaskCostUsd: 1,
      allowGeminiFreeTier: false,
      pricedAt: new Date("2026-12-31T23:59:59.000Z"),
    });
    const standard = planWorkerModelTask({
      taskKind: "routine_code",
      dataClassification: "customer_confidential",
      maximumTaskCostUsd: 1,
      allowGeminiFreeTier: false,
      pricedAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    assert.ok(standard.routes[1].worstCaseCostUsd > introductory.routes[1].worstCaseCostUsd);
    assert.throws(
      () => planWorkerModelTask({
        taskKind: "routine_code",
        dataClassification: "customer_confidential",
        maximumTaskCostUsd: 0.01,
        allowGeminiFreeTier: false,
        pricedAt: new Date("2027-01-01T00:00:00.000Z"),
      }),
      /cost cap/i,
    );
  });
});

function fakeClient(
  routeKey: string,
  behavior: (input: {
    prompt: string;
    reasoningLevel: "low" | "medium" | "high";
    maximumOutputTokens: number;
  }) => Promise<WorkerModelRawResult>,
  countedInputTokens = 1_000,
): WorkerModelClient {
  return {
    routeKey,
    maximumWallTimeMs: 1_000,
    async countInputTokens() {
      return countedInputTokens;
    },
    execute: behavior,
  };
}

describe("bounded routed model execution", () => {
  it("falls back once, accounts for usage, and keeps prompts out of durable evidence", async () => {
    // Catches unbounded retries, provider self-reported cost, and accidental prompt persistence.
    const plan = planWorkerModelTask({
      taskKind: "repository_investigation",
      dataClassification: "public",
      maximumTaskCostUsd: 0.1,
      allowGeminiFreeTier: true,
      pricedAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    const calls: string[] = [];
    const clients = [
      fakeClient(workerModelRouteKey(plan.routes[0]), async () => {
        calls.push("luna");
        throw new Error("provider unavailable");
      }),
      fakeClient(workerModelRouteKey(plan.routes[1]), async (input) => {
        calls.push(`gemini:${input.maximumOutputTokens}`);
        return { outputText: "verified candidate", inputTokens: 1_000, billableOutputTokens: 200 };
      }),
    ];

    const execution = await executeWorkerModelTask(plan, "PUBLIC_REPOSITORY_PROMPT_SECRET_MARKER", clients);

    assert.deepEqual(calls, ["luna", "gemini:6000"]);
    assert.equal(execution.outputText, "verified candidate");
    assert.equal(execution.evidence.provider, "google");
    assert.equal(execution.evidence.model, "gemini-3.8-flash");
    assert.equal(execution.evidence.attemptCount, 2);
    assert.equal(execution.evidence.accountedCostUsd, 0.0112);
    assert.equal(execution.evidence.outputDigest.length, 64);
    assert.equal(JSON.stringify(execution.evidence).includes("SECRET_MARKER"), false);
  });

  it("refuses generation when preflight input or returned usage exceeds a route ceiling", async () => {
    // Catches a client bypassing the router's input and output token limits.
    const plan = planWorkerModelTask({
      taskKind: "repository_investigation",
      dataClassification: "public",
      maximumTaskCostUsd: 0.1,
      allowGeminiFreeTier: true,
      pricedAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    let generated = 0;
    const clients = [
      fakeClient(workerModelRouteKey(plan.routes[0]), async () => {
        generated += 1;
        return { outputText: "should not run", inputTokens: 1, billableOutputTokens: 1 };
      }, plan.routes[0].maximumInputTokens + 1),
      fakeClient(workerModelRouteKey(plan.routes[1]), async () => {
        generated += 1;
        return {
          outputText: "too large",
          inputTokens: 1_000,
          billableOutputTokens: plan.routes[1].maximumOutputTokens + 1,
        };
      }),
    ];

    await assert.rejects(
      () => executeWorkerModelTask(plan, "bounded prompt", clients),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /all bounded model routes failed/i);
        assert.ok("evidence" in error);
        const evidence = (error as Error & {
          evidence: { failureDigest: string; attemptCount: number; accountedCostUsd: number };
        }).evidence;
        assert.equal(evidence.failureDigest.length, 64);
        assert.equal(evidence.attemptCount, 2);
        assert.equal(evidence.accountedCostUsd, 0);
        assert.equal(JSON.stringify(evidence).includes("bounded prompt"), false);
        return true;
      },
    );
    assert.equal(generated, 1);
  });
});
