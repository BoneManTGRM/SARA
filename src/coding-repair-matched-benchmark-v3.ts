import { canonicalJson, sha256 } from "./canonical.ts";
import { bindCodingRepairBenchmarkAuthority } from "./coding-repair-evidence.ts";
import {
  digestCodingRepairModelAttemptLessons,
  projectCodingRepairAttemptLessonsForModel,
} from "./coding-repair-information-lessons.ts";
import { runMatchedCodingRepairBenchmark } from "./coding-repair-matched-benchmark.ts";

type BaseResult = Awaited<ReturnType<typeof runMatchedCodingRepairBenchmark>>;
type BaseArm = BaseResult["control"];

function enrichArm(arm: BaseArm) {
  const modelAttemptLessons = projectCodingRepairAttemptLessonsForModel(arm.attemptLessons);
  return {
    ...structuredClone(arm),
    modelAttemptLessons,
    modelAttemptLessonsDigest: digestCodingRepairModelAttemptLessons(arm.attemptLessons),
  };
}

export async function runMatchedCodingRepairBenchmarkV3(
  input: Parameters<typeof runMatchedCodingRepairBenchmark>[0],
) {
  const base = await runMatchedCodingRepairBenchmark(input);
  const control = enrichArm(base.control);
  const canary = enrichArm(base.canary);
  const contract = {
    ...structuredClone(base.contract),
    schemaVersion: 3 as const,
    canaryPolicy: "bounded_reparodynamic_information_learning_v3" as const,
    learning: {
      control: "record_only_not_fed_to_model" as const,
      canary: "bounded_information_dense_last_two_lessons_fed_to_model" as const,
      modelProjection: "sanitized_failure_and_ast_tactic_deltas_without_raw_source_or_test_content" as const,
    },
    tgrmGovernance: {
      loop: "measure_repair_validate" as const,
      driftMetric: "negative_independent_verifier_movement_only" as const,
      energyMetric: "max_file_or_changed_line_ratio_against_existing_strategy_ceiling" as const,
      adaptation: "conserve_after_rollback_retreat_on_drift_or_full_blast_radius" as const,
      strategyAuthority: "controller_owned_visible_evidence_only" as const,
      authorityEffect: "selection_only_no_ceiling_expansion" as const,
    },
  };
  const contractDigest = sha256(canonicalJson(contract));
  const learningEvidenceDigest = sha256(canonicalJson({
    control: {
      fullAttemptLessonsDigest: control.attemptLessonsDigest,
      modelAttemptLessonsDigest: control.modelAttemptLessonsDigest,
    },
    canary: {
      fullAttemptLessonsDigest: canary.attemptLessonsDigest,
      modelAttemptLessonsDigest: canary.modelAttemptLessonsDigest,
    },
  }));
  const evidence = {
    contractDigest,
    sharedFirstProposalDigest: base.sharedFirstProposalDigest,
    baselineVerificationDigest: base.baselineVerificationDigest,
    control,
    canary,
    physicalSpendUsd: base.physicalSpendUsd,
    physicalModelCalls: base.physicalModelCalls,
    deltas: base.deltas,
    timeAndCostComparable: base.timeAndCostComparable,
    invalidReasons: base.invalidReasons,
    receiptsDigest: base.receiptsDigest,
    learningEvidenceDigest,
    auditVerificationMilliseconds: base.auditVerificationMilliseconds,
  };
  const result = {
    ...structuredClone(base),
    schemaVersion: 3 as const,
    contract,
    contractDigest,
    control,
    canary,
    modelAttemptLessons: structuredClone(canary.modelAttemptLessons),
    modelAttemptLessonsDigest: canary.modelAttemptLessonsDigest,
    learningEvidenceDigest,
    pairDigest: sha256(canonicalJson(evidence)),
  };
  return bindCodingRepairBenchmarkAuthority(result);
}
