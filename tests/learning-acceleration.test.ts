import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deterministicOutputNormalizer,
  learningAttemptBudgeter,
  learningFailureTriage,
  qualificationReadinessCheck,
  skillFailureMemorySelector,
  targetedRepairPlanner,
} from "../src/learning-acceleration.ts";
import { sha256 } from "../src/canonical.ts";
import type { MemoryRecord } from "../src/types.ts";

const digest = "a".repeat(64);

test("learning failure triage separates provider and candidate failures", () => {
  assert.deepEqual(learningFailureTriage(new Error("Cloudflare inference failed with HTTP 408.")), {
    failureClass: "provider_transient", nextAction: "retry_same_reservation", evidenceCode: "provider_transient:408",
  });
  assert.equal(learningFailureTriage(new Error("temporary connection interruption")).failureClass, "provider_transient");
  assert.equal(learningFailureTriage(new Error("Cloudflare inference failed with HTTP 401.")).failureClass, "provider_terminal");
  assert.equal(learningFailureTriage(new Error("Generated skill failed TypeScript verification with 1 error(s). TS18046 at skill.ts:3:2")).failureClass, "typescript_failure");
  assert.equal(learningFailureTriage(new Error("Behavioral verification mismatches: [one]")).failureClass, "behavioral_failure");
  assert.equal(learningFailureTriage(new Error("Independent acceptance failed; hidden answers withheld.")).failureClass, "independent_acceptance_failure");
  assert.equal(learningFailureTriage(new Error("Learning mandate changed before dispatch.")).failureClass, "policy_failure");
});

test("targeted repair uses measured local evidence and safely diversifies after independent rejection", () => {
  const base = { contractDigest: digest, candidateDigest: "b".repeat(64), publicCriteria: ["Alphabetize output."], measuredMemory: "" };
  const plan = targetedRepairPlanner({ ...base, failureClass: "behavioral_failure", measuredFeedback: "Behavioral verification mismatches: ordering mismatch" });
  assert.equal(plan.outcome, "TARGETED_REPAIR");
  assert.match(plan.directive ?? "", /ordering/iu);
  assert.equal(targetedRepairPlanner({ ...base, failureClass: "unknown", measuredFeedback: "something failed" }).outcome, "STOP_OR_REGENERATE_BY_POLICY");
  const independent = targetedRepairPlanner({ ...base, failureClass: "independent_acceptance_failure", measuredFeedback: "Independent acceptance failed; hidden answers withheld." });
  assert.equal(independent.outcome, "TARGETED_REPAIR");
  assert.match(independent.directive ?? "", /materially different deterministic implementation/);
  assert.match(independent.directive ?? "", /Do not infer, request, or encode hidden qualification answers/);
});

test("learning attempt budgeter is bounded and reduces former 8192-token worst case", () => {
  const small = learningAttemptBudgeter({ objectiveLength: 180, publicCriteriaCount: 4, publicBehavioralTestCount: 4, previousCompletionTokens: 8192, providerMaximumCompletionTokens: 8192 });
  assert.equal(small.completionTokenBudget, 2048);
  assert.ok(small.completionTokenBudget < 8192);
  assert.equal("maximumCostUsd" in small, false);
  assert.equal("maximumRequests" in small, false);
  const repair = learningAttemptBudgeter({ objectiveLength: 500, publicCriteriaCount: 8, publicBehavioralTestCount: 8, priorFailureClass: "typescript_failure", previousCandidateSourceBytes: 5000 });
  const independentRepair = learningAttemptBudgeter({ objectiveLength: 500, publicCriteriaCount: 8, publicBehavioralTestCount: 8, priorFailureClass: "independent_acceptance_failure", previousCandidateSourceBytes: 5000 });
  assert.equal(independentRepair.attemptMode, "repair");
  assert.equal(independentRepair.includePriorCandidateRepairContext, true);
  assert.equal(repair.attemptMode, "repair");
  assert.equal(repair.includePriorCandidateRepairContext, true);
  assert.ok(repair.relevantMemoryMaximum <= 4);
  assert.ok(repair.completionTokenBudget <= 4096);
});

function memory(id: string, objective: string, statement: string, extras: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id, category: "failure", scope: "global", source: `sara://learning-failure/${sha256(objective)}/${id}`,
    statement, confidence: 1, verification: "measured", observedAt: "2026-09-10T00:00:00.000Z", lastValidatedAt: "2026-09-10T00:00:00.000Z",
    dependencies: [], tags: [], status: "active", ...extras,
  };
}

test("failure memory selection is deterministic, relevant, deduplicated, and bounded", () => {
  const objective = "Normalize CI file paths.";
  const exact = memory("exact", objective, "Behavioral verification mismatches: ordering mismatch", {
    dependencies: [`contract:${digest}`, "capability:ci-surface-triage"], tags: ["capability:ci-surface-triage", "failure-class:behavioral_failure"],
  });
  const duplicate = { ...exact, id: "duplicate" };
  const unrelated = memory("other", "Unrelated objective", "UNRELATED_PRIVATE_EVIDENCE");
  const stale = memory("stale", objective, "stale", { status: "superseded" });
  const selected = skillFailureMemorySelector({ memories: [unrelated, stale, duplicate, exact], capabilityId: "ci-surface-triage", objective, contractDigest: digest, failureClass: "behavioral_failure", maximumCount: 2, maximumCharacters: 300 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0]!.id, "duplicate");
  assert.doesNotMatch(JSON.stringify(selected), /UNRELATED_PRIVATE_EVIDENCE/);
  assert.ok(selected.reduce((sum, item) => sum + item.statement.length, 0) <= 300);
});

test("qualification readiness is prerequisite-only and cannot claim independent qualification", () => {
  const ready = qualificationReadinessCheck({
    candidateExists: true, candidateDigest: digest, artifactIntegrityValid: true, sourcePolicyPassed: true,
    typeScriptVerificationPassed: true, producerBehavioralVerificationPassed: true, contractId: "contract", contractDigest: digest,
    qualificationEnvironmentDigest: "b".repeat(64), publicContractPresent: true,
  });
  assert.equal(ready.status, "READY_FOR_INDEPENDENT_QUALIFICATION");
  assert.equal("qualified" in ready, false);
  const blocked = qualificationReadinessCheck({
    candidateExists: true, candidateDigest: digest, artifactIntegrityValid: false, sourcePolicyPassed: false,
    typeScriptVerificationPassed: false, producerBehavioralVerificationPassed: false, contractId: "contract", contractDigest: digest,
    qualificationEnvironmentDigest: "b".repeat(64), publicContractPresent: true, unresolvedPrerequisiteFailure: true,
  });
  assert.equal(blocked.status, "NOT_READY");
  assert.deepEqual(blocked.prerequisiteFailures, ["artifact_integrity_not_verified", "source_policy_not_passed", "typescript_verification_not_passed", "producer_behavioral_verification_not_passed", "unresolved_prerequisite_failure"]);
});

test("deterministic output normalizer obeys alphabetical and preserve-input contracts", () => {
  assert.deepEqual(deterministicOutputNormalizer(["b", "a", "b"], { ordering: "alphabetical", deduplicate: true, caseNormalization: "preserve" }), ["a", "b"]);
  assert.deepEqual(deterministicOutputNormalizer(["B", "a", "B"], { ordering: "preserve_input", deduplicate: true, caseNormalization: "lower" }), ["b", "a"]);
  assert.deepEqual(deterministicOutputNormalizer([{ z: 1, a: 2 }, { a: 2, z: 1 }], { ordering: "preserve_input", deduplicate: true }), [{ a: 2, z: 1 }]);
});
