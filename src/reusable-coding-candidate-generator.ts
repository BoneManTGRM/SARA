import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "./canonical.ts";
import { assertCodingRepairVerification, codingRepairCandidateDigest } from "./experimental-v5/coding-repair-verification.ts";
import { createReparodynamicCandidateGenerator } from "./reparodynamic-candidate-generator.ts";
import type { DurableCodingRepairMemory, RepairMemoryHit } from "./coding-repair-memory.ts";
import type { CodingRepairModel } from "./coding-repair-controller.ts";
import type { CandidateGenerator } from "./types.ts";

type Options = Parameters<typeof createReparodynamicCandidateGenerator>[0];
export type CodingRepairReuseSummary = { schemaVersion: 1; scopeDigest: string | null; hits: number; misses: number;
  modelRequests: number; quarantines: number; memoryUnavailable: boolean; learnedRecipeId: string | null;
  finalFreshVerification: boolean; reuseMilliseconds: number; totalElapsedMilliseconds: number;
  reusedRecipes: Array<{ cycle: number; recipeId: string; key: string; outcome: string }> };

/** Wrap the normal controller, not the frozen benchmark. Model calls still obey its original limits. */
export function createReusableCodingCandidateGenerator(input: Options & {
  memory: DurableCodingRepairMemory;
  scope(context: Parameters<CandidateGenerator["generate"]>[0]): Promise<string>;
  onReuse(summary: CodingRepairReuseSummary): Promise<void> | void;
}): CandidateGenerator {
  const original = createReparodynamicCandidateGenerator(input);
  if (input.mode !== "canary") return original;
  return { ...original, async generate(context) {
    const started = performance.now();
    context = structuredClone(context);
    const summary: CodingRepairReuseSummary = { schemaVersion: 1, scopeDigest: null, hits: 0, misses: 0, modelRequests: 0,
      quarantines: 0, memoryUnavailable: false, learnedRecipeId: null, finalFreshVerification: false, reuseMilliseconds: 0, totalElapsedMilliseconds: 0, reusedRecipes: [] };
    try { summary.scopeDigest = await input.scope(context); } catch { summary.memoryUnavailable = true; }
    let pending: RepairMemoryHit | null = null;
    const used = new Map<string, RepairMemoryHit>();
    const accepted = new Map<string, RepairMemoryHit>();
    let underlying: CodingRepairModel | undefined;
    const generator = createReparodynamicCandidateGenerator({ ...input,
      model: { async propose(request) {
        if (!summary.memoryUnavailable && summary.scopeDigest) {
          const lookupStarted = performance.now();
          try { pending = await input.memory.lookup(request.candidate, request.verification, summary.scopeDigest, request.strategy); }
          catch { summary.memoryUnavailable = true; pending = null; }
          summary.reuseMilliseconds += performance.now() - lookupStarted;
        }
        if (pending) {
          summary.hits++;
          used.set(pending.key, pending);
          return { proposal: structuredClone(pending.proposal), inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
        }
        summary.misses++;
        underlying ??= typeof input.model === "function" ? input.model(context) : input.model;
        summary.modelRequests++;
        return underlying.propose(request); // Never retry an unknown paid failure outside the controller.
      } },
      onReceipt: async receipt => {
        if (pending) {
          const hit = pending; pending = null;
          summary.reusedRecipes.push({ cycle: receipt.cycle, recipeId: hit.id, key: hit.key, outcome: receipt.outcome });
          if (receipt.outcome !== "verified_complete" || receipt.afterArtifactDigest !== hit.verifiedArtifactDigest) {
            await input.memory.quarantine(hit.key, sha256(canonicalJson(receipt)));
            summary.quarantines++;
          } else accepted.set(hit.key, hit);
        }
        await input.onReceipt?.(receipt);
      },
      onRun: async run => {
        if (run.state === "VERIFIED_CANDIDATE" && run.receipts.length) {
          try {
            const checked = await input.verify(structuredClone(run.champion), context);
            assertCodingRepairVerification(checked);
            if (!checked.passed || checked.artifactDigest !== codingRepairCandidateDigest(run.champion) ||
                checked.artifactDigest !== run.verification.artifactDigest) throw new Error("REPAIR_REUSE_FINAL_VERIFICATION_FAILED");
            run.verification = checked;
            summary.finalFreshVerification = true;
          } catch (error) {
            for (const hit of used.values()) await input.memory.quarantine(hit.key, sha256("REPAIR_REUSE_FINAL_VERIFICATION_FAILED"));
            throw error;
          }
        }
        run.elapsedMilliseconds = performance.now() - started;
        await input.onRun?.(structuredClone(run)); // Mandatory receipts precede learning.
        if (summary.finalFreshVerification && summary.modelRequests && !summary.memoryUnavailable && summary.scopeDigest) {
          const learnStarted = performance.now();
          try {
            summary.learnedRecipeId = await input.memory.learn({ before: run.baseline, beforeVerification: run.baselineVerification,
              after: run.champion, verification: run.verification, scope: summary.scopeDigest });
          } catch { summary.memoryUnavailable = true; } // Capacity/conflict/storage failure never permits reuse.
          summary.reuseMilliseconds += performance.now() - learnStarted;
        }
        // This boundary excludes this last receipt write and the subsequent kernel check.
        summary.totalElapsedMilliseconds = performance.now() - started;
        await input.onReuse(structuredClone(summary));
        // Mandatory callbacks yield to other jobs. Recheck accepted recipes after
        // them; a previously written success summary never authorizes a return.
        // Rolled-back hits are excluded so verified model fallback remains valid.
        if (summary.finalFreshVerification) {
          for (const hit of accepted.values()) await input.memory.assertReusable(hit);
        }
      },
    });
    return generator.generate(context);
  } };
}
