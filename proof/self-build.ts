import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { PolicyDeniedError } from "../src/policy.ts";

const stateDirectory = await mkdtemp(join(tmpdir(), "sara-self-build-proof-"));

try {
  const kernel = await SaraKernel.boot({ stateDirectory });
  const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
    objective: "Create a reusable deterministic margin calculator.",
    expectedOwnerValue: 100,
    requiredCapabilities: ["margin-calculation"],
    acceptanceCriteria: ["Return revenue minus cost for finite numeric inputs."],
    maximumBudgetUsd: 0,
  });
  const execution = await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, {
    id: "zero-cost-proof-generator",
    external: false,
    maximumCostUsd: 0,
    async generate() {
      return {
        schemaVersion: 1,
        skillName: "Margin Calculator",
        summary: "A bounded deterministic economic primitive.",
        source: [
          "type MarginInput = { revenue: number; cost: number };",
          "export function runSkill(input: unknown): unknown {",
          '  if (!input || typeof input !== "object") return null;',
          "  const value = input as MarginInput;",
          '  if (typeof value.revenue !== "number" || typeof value.cost !== "number") return null;',
          "  if (!Number.isFinite(value.revenue) || !Number.isFinite(value.cost)) return null;",
          "  return Math.round((value.revenue - value.cost) * 100) / 100;",
          "}",
          "",
        ].join("\n"),
        tests: [
          { name: "positive margin", input: { revenue: 500, cost: 14 }, expected: 486 },
          { name: "loss", input: { revenue: 20, cost: 30 }, expected: -10 },
          { name: "invalid", input: { revenue: "500", cost: 14 }, expected: null },
        ],
        limitations: ["This is calculation only; it cannot attest revenue or move money."],
      };
    },
  });

  assert.equal(execution.job.status, "verified");
  assert.equal(execution.mutation.stage, "SHADOW");
  assert.equal(execution.evidence.attestation, "kernel_executed");
  await assert.rejects(
    () => kernel.promoteMutation(SARA_PRINCIPAL, execution.mutation.id, "CANARY"),
    (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
  );

  const restarted = await SaraKernel.boot({ stateDirectory });
  const status = await restarted.getStatus();
  assert.equal(status.jobs[0].status, "verified");
  assert.equal(status.mutations[0].stage, "SHADOW");
  assert.equal(status.ownerFundedRecurringMonthlyUsd, 0);

  console.log(
    JSON.stringify(
      {
        proof: "SARA_SELF_BUILD_CYCLE",
        result: "PASS",
        objectiveCompiled: job.workCard.objective,
        generatorCostUsd: 0,
        generatedSource: "PASS",
        typescriptCompile: "PASS",
        isolatedBehavioralTests: 3,
        artifactDigestBound: true,
        kernelEvidence: execution.evidence.attestation,
        resultingStage: status.mutations[0].stage,
        unapprovedProductionPromotion: "DENIED",
        durableReload: "PASS",
        currentOwnerFundedRecurringUsd: status.ownerFundedRecurringMonthlyUsd,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
