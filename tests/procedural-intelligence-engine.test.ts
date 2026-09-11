import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import {
  PROCEDURAL_SEED_PLAYBOOKS,
  ProceduralKnowledgeStore,
  classifyTaskFamily,
  executeVerifiedProcedure,
  retrieveVerifiedLessons,
  transitionTrustState,
  type ProceduralPlaybook,
  type ReusableLesson,
  type ReuseTask,
} from "../src/procedural-intelligence.ts";

const sha = (char: string) => char.repeat(64);
const baseIdentity = {
  repository: "BoneManTGRM/SARA",
  environment: "production",
  requirementDigest: sha("b"),
  policyDigest: sha("c"),
};

function task(overrides: Partial<ReuseTask> = {}): ReuseTask {
  return {
    taskId: "incidental-1",
    description: "qualify the exact GitHub pull request head",
    taskFamily: "github_pr_qualification",
    identity: { ...baseIdentity, sourceRevision: sha("d"), evaluator: "github-actions" },
    requestedActions: ["inspect_repository", "verify_checks"],
    ...overrides,
  };
}

function playbook(overrides: Partial<ProceduralPlaybook> = {}): ProceduralPlaybook {
  return {
    id: "github-pr-qualification",
    version: 1,
    knowledgeClass: "PROCEDURAL",
    taskFamily: "github_pr_qualification",
    status: "VERIFIED",
    triggers: ["pull request", "github pr", "qualify exact head"],
    nonTriggers: ["customer delivery"],
    purpose: "Qualify an exact PR head before merge.",
    requiredInputs: ["repository", "sourceRevision"],
    preconditions: ["repository known"],
    authorityRequired: ["repository_read"],
    prohibitedActions: ["bypass_required_checks", "promote_shadow_mutation"],
    costCeilingUsd: 0,
    tools: ["github"],
    preferredToolOrder: ["github"],
    fallbackToolOrder: [],
    procedure: ["inspect exact head", "verify required checks", "report exact evidence"],
    decisionBranches: [],
    expectedFailureModes: ["head_changed"],
    negativeLessons: [],
    verificationSteps: ["exact head unchanged", "required checks green"],
    acceptanceCriteria: ["exact head verified"],
    evidenceRequired: ["head_sha", "ci_receipt"],
    rollback: ["do not merge"],
    sideEffects: ["none"],
    provenance: { producerIdentity: "sara-release", source: "repository" },
    sourceEvidence: [".github/workflows/ci.yml"],
    qualificationStatus: "independently_qualified",
    qualificationDigest: sha("e"),
    evaluatorIdentity: "github-actions",
    procedureApplicabilityIdentity: baseIdentity,
    evidenceReuseIdentity: { ...baseIdentity, sourceRevision: sha("a"), evaluator: "github-actions" },
    environmentAssumptions: ["GitHub Actions available"],
    dependencyAssumptions: [],
    invalidationConditions: ["REQUIREMENT_CHANGED", "POLICY_CHANGED"],
    lastVerifiedRevision: "96b1f83e0c5e7756696789688552a7028b432cb8",
    supersedes: [],
    supersededBy: null,
    createdAt: "2026-09-11T13:00:00.000Z",
    verifiedAt: "2026-09-11T13:00:00.000Z",
    qualificationStrength: 100,
    ...overrides,
  };
}

function lesson(overrides: Partial<ReusableLesson> = {}): ReusableLesson {
  return {
    id: "lesson-failed-lockfile-reuse",
    version: 1,
    knowledgeClass: "FAILURE_NEGATIVE",
    taskFamily: "github_pr_qualification",
    status: "VERIFIED",
    nature: "NEGATIVE",
    observation: "A stale lockfile caused npm ci to fail.",
    inference: "Regenerate the lockfile only when manifest identity changed.",
    confidence: 0.9,
    sourceEvidence: ["ci:123"],
    producerIdentity: "candidate-generator",
    evaluatorIdentity: "independent-evaluator",
    qualificationDigest: sha("f"),
    applicabilityIdentity: { repository: "BoneManTGRM/SARA", dependencyDigest: sha("1") },
    invalidationConditions: ["DEPENDENCY_CHANGED"],
    createdAt: "2026-09-11T13:00:00.000Z",
    verifiedAt: "2026-09-11T13:01:00.000Z",
    ...overrides,
  };
}

test("trust states reject illegal promotion and self-certification", () => {
  assert.throws(() => transitionTrustState("DRAFT", "VERIFIED", {
    producerIdentity: "same",
    evaluatorIdentity: "same",
    sourceEvidence: ["x"],
    qualificationDigest: sha("a"),
  }), /ILLEGAL_TRUST_TRANSITION|INDEPENDENT_EVALUATOR_REQUIRED/);
  assert.throws(() => transitionTrustState("QUALIFIED", "VERIFIED", {
    producerIdentity: "same",
    evaluatorIdentity: "same",
    sourceEvidence: ["x"],
    qualificationDigest: sha("a"),
  }), /INDEPENDENT_EVALUATOR_REQUIRED/);
  assert.equal(transitionTrustState("CANDIDATE", "QUALIFIED", {
    producerIdentity: "generator",
    evaluatorIdentity: "independent",
    sourceEvidence: ["receipt"],
    qualificationDigest: sha("a"),
  }), "QUALIFIED");
});

test("task classification is deterministic and rejects material ambiguity", () => {
  const exact = playbook();
  assert.equal(classifyTaskFamily("qualify the exact GitHub pull request head", [exact]).taskFamily, "github_pr_qualification");
  const conflicting = playbook({ id: "same-specificity", taskFamily: "other_family", triggers: [...exact.triggers] });
  assert.throws(() => classifyTaskFamily("qualify the exact GitHub pull request head", [exact, conflicting]), /TASK_FAMILY_CONFLICT/);
});

test("incidental task ids do not defeat procedure reuse", () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook()]);
  const first = store.select(task({ taskId: "attempt-a" }));
  const second = store.select(task({ taskId: "attempt-b" }));
  assert.equal(first.playbook.id, second.playbook.id);
  assert.equal(first.selectionDigest, second.selectionDigest);
});

test("invalidated, incompatible, and unqualified knowledge is never authoritative", () => {
  assert.throws(() => ProceduralKnowledgeStore.inMemory([playbook({ status: "INVALIDATED" })]).select(task()), /NO_APPLICABLE_VERIFIED_PLAYBOOK/);
  assert.throws(() => ProceduralKnowledgeStore.inMemory([playbook({ taskFamily: "railway_deployment_verification" })]).select(task()), /NO_APPLICABLE_VERIFIED_PLAYBOOK/);
  assert.throws(() => ProceduralKnowledgeStore.inMemory([playbook({ status: "CANDIDATE" })]).select(task()), /NO_APPLICABLE_VERIFIED_PLAYBOOK/);
  assert.throws(() => ProceduralKnowledgeStore.inMemory([playbook({ qualificationStatus: "unqualified" })]), /PROCEDURAL_VERIFIED_REQUIRES_INDEPENDENT_QUALIFICATION/);
});

test("multiple matching verified playbooks choose stronger exact evidence, but an unresolved tie fails safely", () => {
  const weak = playbook({ id: "weak", qualificationStrength: 90 });
  const strong = playbook({ id: "strong", qualificationStrength: 100 });
  assert.equal(ProceduralKnowledgeStore.inMemory([weak, strong]).select(task()).playbook.id, "strong");
  const tieA = playbook({ id: "tie-a" });
  const tieB = playbook({ id: "tie-b" });
  assert.throws(() => ProceduralKnowledgeStore.inMemory([tieA, tieB]).select(task()), /PROCEDURAL_KNOWLEDGE_CONFLICT/);
});

test("negative lessons apply only under matching relevant identity and never replay failed actions", () => {
  const current = { repository: "BoneManTGRM/SARA", dependencyDigest: sha("1") };
  const matched = retrieveVerifiedLessons([lesson()], "github_pr_qualification", current);
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.nature, "NEGATIVE");
  const changed = retrieveVerifiedLessons([lesson()], "github_pr_qualification", { ...current, dependencyDigest: sha("2") });
  assert.equal(changed.length, 0);
});

test("equally qualified contradictory lessons fail safely instead of silently choosing", () => {
  const first = lesson({ id: "lesson-a", claimKey: "lockfile-rule", inference: "Regenerate the lockfile.", qualificationStrength: 90 });
  const second = lesson({ id: "lesson-b", claimKey: "lockfile-rule", inference: "Never regenerate the lockfile.", qualificationStrength: 90 });
  assert.throws(() => retrieveVerifiedLessons([first, second], "github_pr_qualification", { repository: "BoneManTGRM/SARA", dependencyDigest: sha("1") }), /VERIFIED_LESSON_CONFLICT/);
});

test("candidate lessons and failed qualifications remain non-authoritative", () => {
  assert.equal(retrieveVerifiedLessons([lesson({ status: "CANDIDATE" })], "github_pr_qualification", { repository: "BoneManTGRM/SARA", dependencyDigest: sha("1") }).length, 0);
  assert.equal(retrieveVerifiedLessons([lesson({ status: "QUALIFIED", qualificationDigest: sha("9") })], "github_pr_qualification", { repository: "BoneManTGRM/SARA", dependencyDigest: sha("1") }).length, 0);
});

test("durable verified knowledge survives restart and malformed state fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-procedural-"));
  const store = await ProceduralKnowledgeStore.open(root, [playbook()]);
  assert.equal(store.select(task()).playbook.id, "github-pr-qualification");
  const restarted = await ProceduralKnowledgeStore.open(root, []);
  assert.equal(restarted.select(task()).playbook.id, "github-pr-qualification");

  const statePath = restarted.statePath;
  await writeFile(statePath, "{ malformed", { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => ProceduralKnowledgeStore.open(root, []), /PROCEDURAL_STATE_CORRUPT/);
});

test("malformed audit records fail closed even when the outer state digest is recomputed", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-procedural-audit-corrupt-"));
  const store = await ProceduralKnowledgeStore.open(root, [playbook()]);
  const envelope = JSON.parse(await readFile(store.statePath, "utf8")) as { state: any; digest: string };
  envelope.state.outcomes.push({
    taskFamily: "github_pr_qualification",
    taskReferenceDigest: sha("1"),
    playbookId: "github-pr-qualification",
    playbookVersion: 1,
    selectionDigest: sha("2"),
    applicabilityReason: "synthetic malformed audit record",
    priorEvidenceReusable: false,
    invalidations: [],
    freshVerificationEvidence: [],
    outcome: "VERIFIED",
    operations: ["fresh_verify"],
    operationsAvoided: [],
    createdAt: "not-a-timestamp",
  });
  envelope.digest = sha256(canonicalJson(envelope.state));
  await writeFile(store.statePath, canonicalJson(envelope), { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => ProceduralKnowledgeStore.open(root, []), /PROCEDURAL_STATE_CORRUPT/);
});

test("an interrupted pending write cannot replace the last committed authoritative state", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-procedural-interrupted-"));
  const store = await ProceduralKnowledgeStore.open(root, [playbook()]);
  const before = await readFile(store.statePath, "utf8");
  const pending = `${store.statePath}.pending.synthetic`;
  await writeFile(pending, "{ partial", { encoding: "utf8", mode: 0o600 });
  const restarted = await ProceduralKnowledgeStore.open(root, []);
  assert.equal(restarted.select(task()).playbook.id, "github-pr-qualification");
  assert.equal(await readFile(store.statePath, "utf8"), before);
});

test("procedure knowledge cannot create authority, budget, or SHADOW promotion permission", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook({ authorityRequired: ["repository_write"], costCeilingUsd: 0 })]);
  await assert.rejects(() => executeVerifiedProcedure({
    store,
    task: task({ requestedActions: ["promote_shadow_mutation"] }),
    grantedAuthorities: ["repository_write"],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    variableWork: async () => ({ ok: true }),
    freshVerify: async () => ({ passed: true, evidence: ["fresh"] }),
  }), /PROHIBITED_ACTION/);
  await assert.rejects(() => executeVerifiedProcedure({
    store,
    task: task(),
    grantedAuthorities: [],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    variableWork: async () => ({ ok: true }),
    freshVerify: async () => ({ passed: true, evidence: ["fresh"] }),
  }), /AUTHORITY_REQUIRED/);
  await assert.rejects(() => executeVerifiedProcedure({
    store,
    task: task(),
    grantedAuthorities: ["repository_write"],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: undefined,
    variableWork: async () => ({ ok: true }),
    freshVerify: async () => ({ passed: true, evidence: ["fresh"] }),
  }), /UNKNOWN_COST_NOT_ZERO/);
});

test("invalidation after retrieval but before execution forces a fresh re-check", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook()]);
  await assert.rejects(() => executeVerifiedProcedure({
    store,
    task: task(),
    grantedAuthorities: ["repository_read"],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    beforeExecute: async (selection) => store.invalidate(selection.playbook.id, selection.playbook.version, "POLICY_CHANGED", "synthetic reordering check"),
    variableWork: async () => ({ ok: true }),
    freshVerify: async () => ({ passed: true, evidence: ["fresh"] }),
  }), /KNOWLEDGE_CHANGED_BEFORE_EXECUTION/);
});

test("retrieval failure falls back safely without executing variable work", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-procedural-unavailable-"));
  const stateDir = join(root, "procedural-intelligence-v1");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "knowledge.json"), "not-json", { encoding: "utf8", mode: 0o600 });
  let executed = false;
  const result = await executeVerifiedProcedure({
    store: async () => ProceduralKnowledgeStore.open(root, []),
    task: task(),
    grantedAuthorities: ["repository_read"],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    variableWork: async () => { executed = true; return { ok: true }; },
    freshVerify: async () => ({ passed: true, evidence: ["fresh"] }),
  });
  assert.equal(result.mode, "EXISTING_AUTHORIZED_PATH_REQUIRED");
  assert.equal(executed, false);
});

test("task-family classification mismatch falls back safely before variable work", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook()]);
  let executed = false;
  const result = await executeVerifiedProcedure({
    store,
    task: task({ description: "customer delivery request" }),
    grantedAuthorities: ["repository_read"],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    variableWork: async () => { executed = true; return { ok: true }; },
    freshVerify: async () => ({ passed: true, evidence: ["fresh"] }),
  });
  assert.equal(result.mode, "EXISTING_AUTHORIZED_PATH_REQUIRED");
  assert.equal(result.authoritativeReuse, false);
  assert.equal(executed, false);
});

test("fixed-condition reuse avoids procedure reconstruction but preserves fresh verification", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook({ authorityRequired: ["repository_read"] })]);
  const reuse = await executeVerifiedProcedure({
    store,
    task: task(),
    grantedAuthorities: ["repository_read"],
    authorizedCostCeilingUsd: 0,
    estimatedCostUsd: 0,
    baselineOperations: ["classify_task", "reconstruct_procedure", "check_authority", "perform_variable_work", "fresh_verify"],
    variableWork: async () => ({ exactHead: sha("d") }),
    freshVerify: async () => ({ passed: true, evidence: ["fresh-head-check"] }),
  });
  assert.equal(reuse.outcome, "VERIFIED");
  assert.ok(reuse.efficiency.operationsAvoided.includes("reconstruct_procedure"));
  assert.ok(reuse.operations.includes("fresh_verify"));
  assert.equal(reuse.efficiency.verificationReduced, false);
});

test("seed library is bounded, verified, evidence-backed, and cannot authorize actions", () => {
  assert.ok(PROCEDURAL_SEED_PLAYBOOKS.length >= 5 && PROCEDURAL_SEED_PLAYBOOKS.length <= 8);
  for (const seed of PROCEDURAL_SEED_PLAYBOOKS) {
    assert.equal(seed.status, "VERIFIED");
    assert.equal(seed.qualificationStatus, "independently_qualified");
    assert.ok(seed.sourceEvidence.length > 0);
    assert.ok(seed.prohibitedActions.includes("promote_shadow_mutation"));
    assert.ok(seed.prohibitedActions.includes("bypass_required_checks"));
  }
});
