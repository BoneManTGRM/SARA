import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutorHandoff } from "../src/handoff.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { PolicyDeniedError } from "../src/policy.ts";

const stateDirectory = await mkdtemp(join(tmpdir(), "sara-bootstrap-proof-"));

try {
  const kernel = await SaraKernel.boot({ stateDirectory });
  await kernel.registerCapability(SARA_PRINCIPAL, {
    id: "tgrm",
    name: "TGRM verification",
    status: "available",
    evidence: ["tests/tgrm.test.ts"],
    limitations: [],
  });
  await kernel.recordMemory(SARA_PRINCIPAL, {
    category: "constitutional",
    statement: "Only build enough bootstrap machinery for safe self-development.",
    source: "owner-directive:2026-09-01",
    observedAt: "2026-09-01T00:00:00.000Z",
    confidence: 1,
    verification: "measured",
    scope: "sara-bootstrap",
    dependencies: ["constitution-v1"],
    lastValidatedAt: "2026-09-01T00:00:00.000Z",
  });
  const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
    objective: "Build the narrowly scoped GitHub App executor needed for the next self-development card.",
    expectedOwnerValue: 100,
    requiredCapabilities: ["tgrm", "github-app-executor"],
    acceptanceCriteria: [
      "The executor can create a candidate branch and PR but cannot bypass protected branches or approve itself.",
    ],
    maximumBudgetUsd: 0,
  });
  assert.deepEqual(job.workCard.missingCapabilities, ["github-app-executor"]);
  const handoff = compileExecutorHandoff(job, kernel.constitutionDigest);
  assert.equal(handoff.maximumBudgetUsd, 0);
  assert.equal(handoff.role, "sandboxed_coding_executor");
  assert.ok(handoff.prohibitedActions.includes("money_transfer"));

  const execution = await kernel.executeDeterministicSkillScaffold(SARA_PRINCIPAL, job.id);
  const mutation = execution.mutation;
  assert.equal(execution.evidence.attestation, "kernel_executed");
  assert.match(execution.artifactRelativePath, /^genome-lab[/\\]/);
  await kernel.promoteMutation(SARA_PRINCIPAL, mutation.id, "SHADOW");
  await assert.rejects(
    () => kernel.promoteMutation(SARA_PRINCIPAL, mutation.id, "CANARY"),
    (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
  );

  const restarted = await SaraKernel.boot({ stateDirectory });
  const status = await restarted.getStatus();
  assert.equal(status.constitution.verified, true);
  assert.equal(restarted.constitution.ownerAuthority.bootstrapOwnerFundedRecurringMonthlyTargetUsd, 0);
  assert.equal(restarted.constitution.ownerAuthority.unearnedExpansionBudgetUsd, 0);
  assert.equal(status.ownerFundedRecurringMonthlyUsd, 0);
  assert.equal(status.memoryCount, 37);
  assert.equal(status.jobs.length, 1);
  assert.equal(status.mutations.length, 1);
  assert.equal(status.mutations[0].stage, "SHADOW");
  assert.ok(status.audit.eventCount >= 10);
  assert.match(status.audit.headHash ?? "", /^[a-f0-9]{64}$/);

  console.log(
    JSON.stringify(
      {
        proof: "SARA_BOOTSTRAP_TRACER",
        result: "PASS",
        constitutionVerified: status.constitution.verified,
        bootstrapOwnerFundedTargetUsd: 0,
        currentOwnerFundedRecurringUsd: status.ownerFundedRecurringMonthlyUsd,
        missingCapability: job.workCard.missingCapabilities[0],
        codingExecutor: "DETERMINISTIC_SKILL_SCAFFOLD",
        candidateEvidence: execution.evidence.attestation,
        mutationStage: status.mutations[0].stage,
        unapprovedProductionPromotion: "DENIED",
        durableReload: "PASS",
        auditEvents: status.audit.eventCount,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
