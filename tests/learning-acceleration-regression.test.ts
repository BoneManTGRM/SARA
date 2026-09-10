import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";

const ownerToken = "learning-acceleration-owner";

async function setup(directory: string) {
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(ownerToken) });
  const owner = kernel.authenticateOwnerToken(ownerToken);
  const now = Date.now();
  await kernel.activateStandingMandate(owner, {
    id: "learning-acceleration-test",
    ownerId: owner.id,
    allowedActions: ["business_candidate_development"],
    allowedChannels: ["internal"],
    allowedServiceIds: ["skill-learning"],
    maximumCostPerActionUsd: 0,
    maximumConcurrentActions: 1,
    maximumDailyActions: 2,
    startsAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
  }, {
    approvalId: "learning-acceleration-approval",
    ownerId: owner.id,
    action: "required_owner_approval_change",
    targetId: "standing-mandate:learning-acceleration-test",
    approvedAt: new Date(now).toISOString(),
  });
  await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
    objective: "Return the supplied value unchanged.",
    expectedOwnerValue: 1,
    requiredCapabilities: ["autonomous-learning", "transport-retry-fixture"],
    acceptanceCriteria: ["Return the supplied value unchanged."],
    maximumBudgetUsd: 0,
  });
  return kernel;
}

test("eligible HTTP 408 receives one same-reservation retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-learning-transport-retry-"));
  try {
    const kernel = await setup(directory);
    let calls = 0;
    const result = await kernel.runNextAutonomousLearningCycle({
      id: "transport-retry-fixture",
      external: true,
      maximumCostUsd: 0,
      async generate() {
        calls += 1;
        if (calls === 1) throw new Error("Cloudflare inference failed with HTTP 408.");
        return {
          schemaVersion: 1 as const,
          skillName: "Transport retry fixture",
          summary: "Echo the input.",
          source: "export function runSkill(input: unknown): unknown { return input; }",
          tests: [
            { name: "one", input: 1, expected: 1 },
            { name: "object", input: { a: 1 }, expected: { a: 1 } },
          ],
          limitations: ["Regression fixture only."],
        };
      },
    });
    const audit = await kernel.inspectAudit();
    if (result.status !== "verified_shadow") {
      const state = await kernel.state();
      const evidence = {
        result,
        calls,
        jobs: state.jobs.map((job) => ({ id: job.id, status: job.status, reason: job.reason })),
        mutations: state.mutations.map((mutation) => ({ id: mutation.id, stage: mutation.stage, candidateDigest: mutation.candidateDigest })),
        events: audit.slice(-24).map((event) => ({ type: event.type, data: event.data })),
      };
      assert.fail(`retry regression evidence: ${JSON.stringify(evidence)}`);
    }
    assert.equal(calls, 2);
    assert.equal(audit.filter((event) => event.type === "autonomous_learning_reserved").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
