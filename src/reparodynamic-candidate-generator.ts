import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairRun, ProgramVerificationResult, ReparodynamicCodingMode } from "./coding-repair-types.ts";
import type { CandidateGenerator, CandidateProposal, ProgramCandidateProposal } from "./types.ts";

function isProgram(proposal: CandidateProposal): proposal is ProgramCandidateProposal {
  return "candidateKind" in proposal && proposal.candidateKind === "typescript_program";
}

export function parseReparodynamicCodingMode(value: string | undefined): ReparodynamicCodingMode {
  if (!value) return "off";
  if (value === "off" || value === "shadow" || value === "canary") return value;
  throw new Error("SARA_REPARODYNAMIC_CODING_MODE must be off, shadow, or canary.");
}

export function createReparodynamicCandidateGenerator(input: {
  base: CandidateGenerator;
  mode: ReparodynamicCodingMode;
  model: CodingRepairModel;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  onRun?: (run: CodingRepairRun) => Promise<void> | void;
}): CandidateGenerator {
  return {
    id: `${input.base.id}-reparodynamic-${input.mode}`,
    external: input.base.external,
    maximumCostUsd: input.base.maximumCostUsd + (input.mode === "off" ? 0 : INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd),
    async generate(context): Promise<CandidateProposal> {
      const baseline = await input.base.generate(context);
      if (input.mode === "off" || !isProgram(baseline)) return baseline;
      const run = await runCodingRepairController({ baseline, verify: input.verify, model: input.model });
      await input.onRun?.(structuredClone(run));
      if (input.mode === "shadow") return baseline;
      if (run.state !== "VERIFIED_CANDIDATE") throw new Error("Reparodynamic CANARY candidate did not pass deterministic verification.");
      return run.champion;
    },
  };
}
