import assert from "node:assert/strict";
import { test } from "node:test";
import * as memoryFabric from "../src/memory-fabric.ts";

const digest = (value: string) => value.repeat(64).slice(0, 64);

function verifiedPlaybook(overrides: Record<string, unknown> = {}) {
  return {
    id: "github-pr-qualification",
    version: 1,
    taskFamily: "github_pr_qualification",
    status: "VERIFIED",
    triggers: ["pull request", "ci qualification"],
    nonTriggers: ["customer delivery"],
    purpose: "Qualify an exact pull-request head before merge.",
    requiredInputs: ["repository", "sourceRevision"],
    preconditions: ["repository identity is known"],
    authorityRequired: ["repository_write"],
    prohibitedActions: ["bypass_required_checks"],
    costCeilingUsd: 0,
    tools: ["github"],
    preferredToolOrder: ["github"],
    fallbackToolOrder: [],
    procedure: ["inspect exact head", "run required checks", "merge only exact verified head"],
    decisionBranches: [],
    expectedFailureModes: ["head_changed"],
    negativeLessons: [],
    verificationSteps: ["required checks green", "head sha unchanged"],
    acceptanceCriteria: ["exact head verified"],
    evidenceRequired: ["head_sha", "ci_receipt"],
    rollback: ["do not merge"],
    sideEffects: ["none until separately authorized merge"],
    provenance: { producerId: "sara-engineering", source: "repo" },
    sourceEvidence: ["tests/post-merge-correctness.test.ts", ".github/workflows/ci.yml"],
    qualificationStatus: "independently_qualified",
    qualificationDigest: digest("a"),
    evaluatorIdentity: "github-actions-existing-evidence",
    procedureApplicabilityIdentity: {
      repository: "BoneManTGRM/SARA",
      environment: "github",
      requirementDigest: digest("b"),
      policyDigest: digest("c"),
    },
    evidenceReuseIdentity: {
      repository: "BoneManTGRM/SARA",
      sourceRevision: "source-a",
      environment: "github",
      requirementDigest: digest("b"),
      evaluator: "github-actions",
    },
    environmentAssumptions: ["github actions available"],
    dependencyAssumptions: [],
    invalidationConditions: ["REQUIREMENT_CHANGED", "POLICY_CHANGED"],
    lastVerifiedRevision: "96b1f83e",
    supersedes: [],
    supersededBy: null,
    createdAt: "2026-09-11T13:00:00.000Z",
    verifiedAt: "2026-09-11T13:00:00.000Z",
    ...overrides,
  };
}

test("known task family plus verified applicable playbook selects that playbook", () => {
  const selectVerifiedProcedure = (memoryFabric as Record<string, unknown>).selectVerifiedProcedure;
  assert.equal(typeof selectVerifiedProcedure, "function", "procedural selection is not implemented yet");
  const selected = (selectVerifiedProcedure as (input: unknown) => any)({
    task: {
      taskFamily: "github_pr_qualification",
      identity: {
        repository: "BoneManTGRM/SARA",
        environment: "github",
        requirementDigest: digest("b"),
        policyDigest: digest("c"),
        sourceRevision: "source-b",
        evaluator: "github-actions",
      },
    },
    playbooks: [verifiedPlaybook()],
  });
  assert.equal(selected.playbook.id, "github-pr-qualification");
  assert.equal(selected.playbook.version, 1);
  assert.equal(selected.procedureApplicable, true);
});

test("candidate or otherwise unqualified playbook cannot be reused authoritatively", () => {
  const selectVerifiedProcedure = (memoryFabric as Record<string, unknown>).selectVerifiedProcedure as (input: unknown) => unknown;
  assert.throws(() => selectVerifiedProcedure({
    task: {
      taskFamily: "github_pr_qualification",
      identity: {
        repository: "BoneManTGRM/SARA",
        environment: "github",
        requirementDigest: digest("b"),
        policyDigest: digest("c"),
      },
    },
    playbooks: [verifiedPlaybook({ status: "CANDIDATE", qualificationStatus: "unqualified" })],
  }), /NO_APPLICABLE_VERIFIED_PLAYBOOK/);
});

test("procedure can remain applicable while changed source invalidates prior execution evidence", () => {
  const selectVerifiedProcedure = (memoryFabric as Record<string, unknown>).selectVerifiedProcedure as (input: unknown) => any;
  const decidePriorEvidenceReuse = (memoryFabric as Record<string, unknown>).decidePriorEvidenceReuse;
  assert.equal(typeof decidePriorEvidenceReuse, "function", "procedure/evidence reuse separation is not implemented yet");

  const playbook = verifiedPlaybook();
  const task = {
    taskFamily: "github_pr_qualification",
    identity: {
      repository: "BoneManTGRM/SARA",
      environment: "github",
      requirementDigest: digest("b"),
      policyDigest: digest("c"),
      sourceRevision: "source-b",
      evaluator: "github-actions",
    },
  };
  const selected = selectVerifiedProcedure({ task, playbooks: [playbook] });
  assert.equal(selected.procedureApplicable, true);
  const evidence = (decidePriorEvidenceReuse as (input: unknown) => any)({
    expectedIdentity: playbook.evidenceReuseIdentity,
    currentIdentity: task.identity,
  });
  assert.equal(evidence.reusable, false);
  assert.deepEqual(evidence.invalidations, [{
    type: "SOURCE_CHANGED",
    field: "sourceRevision",
    previous: "source-a",
    current: "source-b",
    invalidates: ["prior_execution_pass"],
  }]);
});
