import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairRun, ProgramVerificationResult, ReparodynamicCodingMode } from "./coding-repair-types.ts";
import type { CandidateGenerator, CandidateProposal, ProgramCandidateProposal } from "./types.ts";

function isProgram(proposal: CandidateProposal): proposal is ProgramCandidateProposal {
  return "candidateKind" in proposal && proposal.candidateKind === "typescript_program";
}

export type ReparodynamicCodingFallbackEvent = {
  mode: Exclude<ReparodynamicCodingMode, "off">;
  reasonCode: "unverified_candidate" | "pre_dispatch_error";
};

async function recordFallback(
  callback: ((event: ReparodynamicCodingFallbackEvent) => Promise<void> | void) | undefined,
  event: ReparodynamicCodingFallbackEvent,
): Promise<void> {
  try { await callback?.(event); } catch {
    // Only optional telemetry is best-effort. Durable receipts must never be swallowed.
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
      let modelInvoked = false;
      let receiptPersistenceFailed = false;
      let run: CodingRepairRun;
      try {
        const model = typeof input.model === "function" ? input.model(context) : input.model;
        run = await runCodingRepairController({
          baseline,
          verify: (candidate) => input.verify(candidate, context),
          model: {
            async propose(request) {
              // Crossing this boundary can spend money, even if no response is received.
              modelInvoked = true;
              return model.propose(request);
            },
          },
          ...(input.onReceipt ? { onReceipt: async (receipt: Parameters<NonNullable<typeof input.onReceipt>>[0]) => {
            try { await input.onReceipt!(receipt); } catch (error) {
              receiptPersistenceFailed = true;
              throw error;
            }
          } } : {}),
        });
      } catch (error) {
        if (modelInvoked || receiptPersistenceFailed) throw error;
        await recordFallback(input.onFallback, { mode: input.mode, reasonCode: "pre_dispatch_error" });
        return baseline;
      }
      // Mandatory run persistence is outside the recoverable controller boundary.
      await input.onRun?.(structuredClone(run));
      if (input.mode === "shadow") return baseline;
      if (run.state !== "VERIFIED_CANDIDATE") {
        await recordFallback(input.onFallback, { mode: "canary", reasonCode: "unverified_candidate" });
        // This remains a proposal. The unchanged kernel independently verifies it.
        return baseline;
      }
      return run.champion;
    },
  };
}
