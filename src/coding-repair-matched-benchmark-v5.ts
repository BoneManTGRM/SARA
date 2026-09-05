import { canonicalJson, sha256 } from "./canonical.ts";
import { bindCodingRepairBenchmarkAuthority } from "./coding-repair-evidence.ts";
import { digestCodingRepairAttemptLessons } from "./coding-repair-lessons.ts";
import { runMatchedCodingRepairBenchmarkV3 } from "./coding-repair-matched-benchmark-v3.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import {
  buildCodingRepairGovernanceSignals,
  digestCodingRepairGovernanceSignals,
  summarizeCodingRepairGovernanceTrend,
} from "./coding-repair-tgrm-governance.ts";
import type { CodingRepairAttemptLesson } from "./coding-repair-types.ts";

export async function runMatchedCodingRepairBenchmarkV5(
  input: Parameters<typeof runMatchedCodingRepairBenchmarkV3>[0],
) {
  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;
  const buildHorizonDecision = (cycle: number, lessons: readonly CodingRepairAttemptLesson[]) => {
    const inputLessons = structuredClone(lessons.slice(-2));
    const remainingCyclesAtFinalCall = limits.maximumCycles - cycle + 1;
    const signals = buildCodingRepairGovernanceSignals({
      lessons: inputLessons,
      limits,
    });
    return {
      schemaVersion: 1 as const,
      finalModelCycle: cycle,
      remainingCyclesAtFinalCall,
      inputLessonsDigest: digestCodingRepairAttemptLessons(inputLessons),
      signalsDigest: digestCodingRepairGovernanceSignals(signals),
      trend: summarizeCodingRepairGovernanceTrend(signals, {
        remainingCycles: remainingCyclesAtFinalCall,
      }),
    };
  };

  let lastCanaryHorizonDecision: ReturnType<typeof buildHorizonDecision> | undefined;
  const base = await runMatchedCodingRepairBenchmarkV3({
    ...input,
    model: {
      propose: async (request) => {
        if ((request.attemptLessons?.length ?? 0) > 0) {
          lastCanaryHorizonDecision = buildHorizonDecision(
            request.cycle,
            request.attemptLessons ?? [],
          );
        }
        return input.model.propose(request);
      },
    },
  });
  const horizonDecision = lastCanaryHorizonDecision ?? buildHorizonDecision(1, []);
  const horizonGovernance = {
    horizonSource: "controller_owned_remaining_cycles_within_existing_three_cycle_ceiling" as const,
    finalOpportunity: "remaining_cycles_equals_one" as const,
    diversifyTrigger: "prior_verified_gain_plus_latest_evidence_backed_no_gain_rejection" as const,
    missingTacticEvidence: "conserve_without_invented_novelty" as const,
    tacticFamilyRule: "disallow_latest_rejected_family_only_for_diversify_rethink_or_retreat" as const,
    authorityEffect: "selection_only_no_cycle_budget_or_mutation_ceiling_expansion" as const,
  };
  const contract = {
    ...structuredClone(base.contract),
    schemaVersion: 5 as const,
    canaryPolicy: "bounded_reparodynamic_horizon_learning_v5" as const,
    learning: {
      ...structuredClone(base.contract.learning),
      canary: "bounded_information_dense_horizon_aware_last_two_lessons_fed_to_model" as const,
    },
    tgrmGovernance: {
      ...structuredClone(base.contract.tgrmGovernance),
      adaptation: "retain_gain_conserve_after_rejection_and_diversify_on_final_evidence_backed_opportunity" as const,
    },
    horizonGovernance,
  };
  const contractDigest = sha256(canonicalJson(contract));
  const evidence = {
    contractDigest,
    sharedFirstProposalDigest: base.sharedFirstProposalDigest,
    baselineVerificationDigest: base.baselineVerificationDigest,
    control: base.control,
    canary: base.canary,
    physicalSpendUsd: base.physicalSpendUsd,
    physicalModelCalls: base.physicalModelCalls,
    deltas: base.deltas,
    timeAndCostComparable: base.timeAndCostComparable,
    invalidReasons: base.invalidReasons,
    receiptsDigest: base.receiptsDigest,
    learningEvidenceDigest: base.learningEvidenceDigest,
    horizonDecision,
    auditVerificationMilliseconds: base.auditVerificationMilliseconds,
  };
  const result = {
    ...structuredClone(base),
    schemaVersion: 5 as const,
    contract,
    contractDigest,
    horizonDecision,
    pairDigest: sha256(canonicalJson(evidence)),
  };
  return bindCodingRepairBenchmarkAuthority(result);
}
