import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileExecutorHandoff } from "../src/handoff.ts";
import type { Job } from "../src/types.ts";

describe("SARA coding-executor handoff", () => {
  it("produces a zero-cost, sandbox-only, provider-neutral work packet", () => {
    const job: Job = {
      id: "job-1",
      kind: "self_development",
      status: "authorized",
      workCard: {
        id: "card-1",
        objective: "Implement one bounded capability",
        expectedOwnerValue: 1,
        requiredCapabilities: ["code"],
        missingCapabilities: ["code"],
        acceptanceCriteria: ["A falsifiable test passes."],
        maximumBudgetUsd: 0,
        prohibitedActions: ["constitution_change", "money_transfer"],
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    };
    const handoff = compileExecutorHandoff(job, "a".repeat(64));
    assert.equal(handoff.maximumBudgetUsd, 0);
    assert.equal(handoff.role, "sandboxed_coding_executor");
    assert.ok(handoff.requiredProcess.some((step) => step.includes("Do not promote")));
    assert.ok(handoff.prohibitedActions.includes("money_transfer"));
  });
});
