import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairRun, ProgramVerificationResult, ReparodynamicCodingMode } from "./coding-repair-types.ts";
import type { CandidateGenerator, CandidateProposal, ProgramCandidateProposal } from "./types.ts";

function isProgram(proposal: CandidateProposal): proposal is ProgramCandidateProposal {
  return "candidateKind" in proposal && proposal.candidateKind === "typescript_program";
}

export type ReparodynamicCodingFallbackEvent = {
  mode: Exclude<ReparodynamicCodingMode, "off">;
  reasonCode: "unverified_candidate" | "repair_controller_error";
};

async function recordFallback(
  callback: ((event: ReparodynamicCodingFallbackEvent) => Promise<void> | void) | undefined,
  event: ReparodynamicCodingFallbackEvent,
): Promise<void> {
  try {
    await callback?.(event);
  } catch {
    // A telemetry failure may not prevent the already-generated baseline fallback.
  }
}

export function parseReparodynamicCodingMode(value: string | undefined): ReparodynamicCodingMode {
  if (!value) return "off";
  if (value === "off" || value === "shadow" || value === "canary") return value;
  throw new Error("SARA_REPARODYNAMIC_CODING_MODE must be off, shadow, or canary.");
}

export function createReparodynamicCandidateGenerator(input: {
  base: CandidateGenerator;
  mode: ReparodynamicCodingMode;
  model: CodingRepairModel | ((context: Parameters<CandidateGenerator["generate"]>[0]) => CodingRepairModel);
  verify(
    candidate: ProgramCandidateProposal,
    context: Parameters<CandidateGenerator["generate"]>[0],
  ): Promise<ProgramVerificationResult>;
  onReceipt?: Parameters<typeof runCodingRepairController>[0]["onReceipt"];
  onRun?: (run: CodingRepairRun) => Promise<void> | void;
  onFallback?: (event: ReparodynamicCodingFallbackEvent) => Promise<void> | void;
}): CandidateGenerator {
  return {
    id: `${input.base.id}-reparodynamic-${input.mode}`,
    external: input.mode === "off" ? input.base.external : true,
    maximumCostUsd: input.base.maximumCostUsd + (input.mode === "off" ? 0 : INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd),
    async generate(context): Promise<CandidateProposal> {
      const baseline = await input.base.generate(context);
      if (input.mode === "off" || !isProgram(baseline)) return baseline;
      try {
        const model = typeof input.model === "function" ? input.model(context) : input.model;
        const run = await runCodingRepairController({
          baseline,
          verify: (candidate) => input.verify(candidate, context),
          model,
          ...(input.onReceipt ? { onReceipt: input.onReceipt } : {}),
        });
        await input.onRun?.(structuredClone(run));
        if (input.mode === "shadow") return baseline;
        if (run.state !== "VERIFIED_CANDIDATE") {
          await recordFallback(input.onFallback, { mode: "canary", reasonCode: "unverified_candidate" });
          return baseline;
        }
        return run.champion;
      } catch {
        await recordFallback(input.onFallback, { mode: input.mode, reasonCode: "repair_controller_error" });
        return baseline;
      }
    },
  };
}
