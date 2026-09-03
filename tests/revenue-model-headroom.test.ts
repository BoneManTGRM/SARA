import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planWorkerModelTask, type WorkerTaskKind } from "../src/model-router.ts";

const READINESS_ROLES: ReadonlyArray<{
  taskKind: WorkerTaskKind;
  maximumTaskCostUsd: number;
}> = [
  { taskKind: "requirements_analysis", maximumTaskCostUsd: 0.05 },
  { taskKind: "repository_investigation", maximumTaskCostUsd: 0.05 },
  { taskKind: "critical_security_verification", maximumTaskCostUsd: 0.10 },
  { taskKind: "customer_deliverable", maximumTaskCostUsd: 0.05 },
];

describe("SARA paid readiness reasoning headroom", () => {
  it("gives Luna 25,000 output tokens while every admitted route remains inside the role budget", () => {
    for (const { taskKind, maximumTaskCostUsd } of READINESS_ROLES) {
      const plan = planWorkerModelTask({
        taskKind,
        dataClassification: "public",
        maximumTaskCostUsd,
        allowGeminiFreeTier: false,
        pricedAt: new Date("2026-09-03T00:00:00.000Z"),
      });

      assert.equal(plan.routes[0].model, "gpt-5.6-luna");
      assert.equal(plan.routes[0].maximumOutputTokens, 25_000);
      assert.ok(plan.worstCaseCostUsd <= maximumTaskCostUsd + Number.EPSILON);
      assert.ok(
        plan.routes.reduce((total, route) => total + route.worstCaseCostUsd, 0)
          <= maximumTaskCostUsd + Number.EPSILON,
        `${taskKind} admitted routes beyond its exact role budget`,
      );
    }
  });
});
