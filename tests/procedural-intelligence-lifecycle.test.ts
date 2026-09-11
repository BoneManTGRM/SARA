import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ProceduralKnowledgeStore,
  buildReuseContext,
  extractCandidateLesson,
  runProductionProceduralReuseProof,
  type ProceduralPlaybook,
  type ReuseTask,
} from "../src/procedural-intelligence.ts";

const digest = (char: string) => char.repeat(64);

function playbook(version = 1): ProceduralPlaybook {
  return {
    id: "repeatable-repair",
    version,
    knowledgeClass: "PROCEDURAL",
    taskFamily: "repeatable_repair",
    status: "VERIFIED",
    triggers: ["repeatable repair"],
    nonTriggers: [],
    purpose: "Exercise reusable repair knowledge.",
    requiredInputs: ["repository"],
    preconditions: ["identity known"],
    authorityRequired: ["repository_read"],
    prohibitedActions: ["promote_shadow_mutation", "bypass_required_checks"],
    costCeilingUsd: 0,
    tools: ["github"],
    preferredToolOrder: ["github"],
    fallbackToolOrder: [],
    procedure: ["retrieve", "perform variable work", "verify fresh boundary"],
    decisionBranches: [],
    expectedFailureModes: ["stale evidence"],
    negativeLessons: [],
    verificationSteps: ["fresh verify"],
    acceptanceCriteria: ["fresh proof"],
    evidenceRequired: ["receipt"],
    rollback: ["existing path"],
    sideEffects: ["none"],
    provenance: { producerIdentity: "release-engineering", source: "repo" },
    sourceEvidence: ["ci:verified"],
    qualificationStatus: "independently_qualified",
    qualificationDigest: digest("a"),
    evaluatorIdentity: "independent-ci",
    procedureApplicabilityIdentity: { repository: "BoneManTGRM/SARA" },
    evidenceReuseIdentity: { repository: "BoneManTGRM/SARA", sourceRevision: digest("b").slice(0, 40) },
    environmentAssumptions: [],
    dependencyAssumptions: [],
    invalidationConditions: ["SOURCE_CHANGED", "POLICY_CHANGED"],
    lastVerifiedRevision: digest("c").slice(0, 40),
    supersedes: [],
    supersededBy: null,
    createdAt: "2026-09-11T13:00:00.000Z",
    verifiedAt: "2026-09-11T13:01:00.000Z",
    qualificationStrength: 100,
  };
}

function task(): ReuseTask {
  return {
    taskId: "incidental-job-123",
    description: "repeatable repair",
    taskFamily: "repeatable_repair",
    identity: { repository: "BoneManTGRM/SARA", sourceRevision: digest("d").slice(0, 40) },
    requestedActions: ["inspect_repository"],
  };
}

test("candidate lesson stays non-authoritative until independent qualification and publication", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook()]);
  const candidate = extractCandidateLesson({
    id: "repair-failure-lesson",
    taskFamily: "repeatable_repair",
    nature: "NEGATIVE",
    observation: "Attempt 8b967d13-2a8a-4d18-a53c-c95c34355555 failed because source identity changed.",
    inference: "Reuse the procedure but require fresh source-bound verification.",
    confidence: 0.9,
    sourceEvidence: ["ci:failed-source-bound-pass"],
    producerIdentity: "lesson-extractor",
    applicabilityIdentity: { repository: "BoneManTGRM/SARA" },
    invalidationConditions: ["POLICY_CHANGED"],
  });
  assert.equal(candidate.status, "CANDIDATE");
  assert.doesNotMatch(candidate.observation, /8b967d13-2a8a-4d18-a53c-c95c34355555/);
  await store.addCandidateLesson(candidate);
  assert.equal(store.retrieveLessons(task()).length, 0);

  await store.qualifyLesson(candidate.id, candidate.version, {
    evaluatorIdentity: "independent-evaluator",
    sourceEvidence: ["qualification:pass"],
    qualificationDigest: digest("e"),
  });
  assert.equal(store.retrieveLessons(task()).length, 0);

  await store.publishLesson(candidate.id, candidate.version, {
    evaluatorIdentity: "independent-evaluator",
    sourceEvidence: ["publication:pass"],
    qualificationDigest: digest("f"),
  });
  assert.equal(store.retrieveLessons(task()).length, 1);
});

test("failed lesson qualification is retained but cannot become authoritative", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook()]);
  const candidate = extractCandidateLesson({
    id: "failed-qualification-lesson",
    taskFamily: "repeatable_repair",
    nature: "NEGATIVE",
    observation: "A proposed shortcut failed hidden qualification.",
    inference: "Do not treat the shortcut as verified knowledge.",
    confidence: 0.6,
    sourceEvidence: ["qualification:failure-input"],
    producerIdentity: "lesson-extractor",
    applicabilityIdentity: { repository: "BoneManTGRM/SARA" },
    invalidationConditions: ["REQUIREMENT_CHANGED"],
  });
  await store.addCandidateLesson(candidate);
  await store.recordLessonQualificationFailure(candidate.id, candidate.version, digest("1"), "hidden acceptance case failed");
  const snapshot = store.snapshot();
  assert.equal(snapshot.qualificationFailures.length, 1);
  assert.equal(snapshot.lessons.find((item) => item.id === candidate.id)?.status, "CANDIDATE");
  assert.equal(store.retrieveLessons(task()).length, 0);
});

test("raw secrets are rejected during candidate lesson extraction", () => {
  assert.throws(() => extractCandidateLesson({
    id: "secret-bearing-lesson",
    taskFamily: "repeatable_repair",
    nature: "NEGATIVE",
    observation: "password=secret123 should never be durable knowledge",
    inference: "Never persist raw owner credentials.",
    confidence: 1,
    sourceEvidence: ["synthetic"],
    producerIdentity: "lesson-extractor",
    applicabilityIdentity: { repository: "BoneManTGRM/SARA" },
    invalidationConditions: ["POLICY_CHANGED"],
  }), /RAW_SECRET_IN_REUSABLE_KNOWLEDGE/);
});

test("playbook and lesson retrieval are semantically order-independent", async () => {
  const store = ProceduralKnowledgeStore.inMemory([playbook()]);
  const candidate = extractCandidateLesson({
    id: "positive-reuse-lesson",
    taskFamily: "repeatable_repair",
    nature: "POSITIVE",
    observation: "Fresh verification preserved correctness after reuse.",
    inference: "Procedure reuse and fresh changed-boundary verification can coexist.",
    confidence: 0.95,
    sourceEvidence: ["qualification:source"],
    producerIdentity: "lesson-extractor",
    applicabilityIdentity: { repository: "BoneManTGRM/SARA" },
    invalidationConditions: ["POLICY_CHANGED"],
  });
  await store.addCandidateLesson(candidate);
  await store.qualifyLesson(candidate.id, candidate.version, { evaluatorIdentity: "independent-evaluator", sourceEvidence: ["qualification:pass"], qualificationDigest: digest("2") });
  await store.publishLesson(candidate.id, candidate.version, { evaluatorIdentity: "independent-evaluator", sourceEvidence: ["publication:pass"], qualificationDigest: digest("3") });
  const first = await buildReuseContext(store, task(), "PLAYBOOK_FIRST");
  const second = await buildReuseContext(store, task(), "LESSONS_FIRST");
  assert.equal(first.semanticDigest, second.semanticDigest);
});

test("verified playbook versions can be superseded without erasing audit history", async () => {
  const oldVersion = playbook(1);
  const newVersion = { ...playbook(2), createdAt: "2026-09-11T13:02:00.000Z", verifiedAt: "2026-09-11T13:03:00.000Z" };
  const store = ProceduralKnowledgeStore.inMemory([oldVersion, newVersion]);
  await store.supersedePlaybook(oldVersion.id, 1, newVersion.id, 2, "verified replacement");
  const snapshot = store.snapshot();
  assert.equal(snapshot.playbooks.find((item) => item.version === 1)?.status, "SUPERSEDED");
  assert.equal(snapshot.playbooks.find((item) => item.version === 1)?.supersededBy, `${newVersion.id}@2`);
  assert.ok(snapshot.playbooks.find((item) => item.version === 2)?.supersedes.includes(`${oldVersion.id}@1`));
  assert.equal(store.select(task()).playbook.version, 2);
});

test("production-shaped proof classifies the task, invalidates stale prior PASS, and preserves fresh verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-production-reuse-proof-"));
  const currentSource = "d".repeat(40);
  const result = await runProductionProceduralReuseProof({
    stateDirectory: root,
    sourceRevision: currentSource,
    deploymentId: "deployment-proof-1234",
    grantedAuthorities: ["runtime_read"],
  });
  assert.equal(result.classification.taskFamily, "railway_exact_sha_deployment_verification");
  assert.equal(result.playbook.id, "railway-exact-sha-deployment-verification");
  assert.equal(result.applicability.applicable, true);
  assert.equal(result.priorEvidence.reusable, false);
  assert.ok(result.priorEvidence.invalidations.some((item: { type: string }) => item.type === "SOURCE_CHANGED"));
  assert.equal(result.freshVerification.passed, true);
  assert.ok(result.efficiency.operationsAvoided.includes("derive_procedure"));
  assert.equal(result.efficiency.verificationReduced, false);
});
