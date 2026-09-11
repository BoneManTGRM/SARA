import { SARA_PRINCIPAL, type SaraKernel } from "./kernel.ts";
import type { CandidateGenerator } from "./types.ts";

/** Existing-runtime queue consumer. It neither creates authority nor promotes code. */
export class AutonomousLearningWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(private readonly kernel: SaraKernel, private readonly generator: CandidateGenerator) {
    if (generator.maximumCostUsd !== 0) throw new Error("Learning worker requires a zero-cost generator.");
  }

  /**
   * When task-derived gaps are exhausted, seed exactly one still-missing capability
   * from the already owner-approved frozen campaign. This creates no new authority:
   * the normal kernel selector still binds the exact frozen contract and every
   * reservation, qualification, promotion, daily-limit and emergency-stop gate.
   */
  private async seedNextApprovedCurriculumGap(): Promise<boolean> {
    const learning = await this.kernel.learningCampaignStatus();
    const campaign = learning.campaign;
    if (!campaign || campaign.remaining === 0 || learning.emergencyStopped) return false;

    const selected = new Set(learning.selections.flatMap(selection => {
      if (typeof selection !== "object" || selection === null) return [];
      const value = selection as { campaignId?: unknown; capabilityId?: unknown };
      return value.campaignId === campaign.id && typeof value.capabilityId === "string"
        ? [value.capabilityId]
        : [];
    }));
    const state = await this.kernel.getStatus();
    const available = new Set(state.capabilities.filter(capability => capability.status === "available").map(capability => capability.id));
    const alreadyQueued = new Set(state.jobs
      .filter(job => !job.learningCampaignId && ["authorized", "running"].includes(job.status))
      .flatMap(job => job.workCard.missingCapabilities));
    const next = campaign.contracts.find(contract =>
      !selected.has(contract.capabilityId) &&
      !available.has(contract.capabilityId) &&
      !alreadyQueued.has(contract.capabilityId));
    if (!next) return false;

    const source = await this.kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: `Continue the owner-approved frozen learning curriculum for ${next.capabilityId}.`,
      expectedOwnerValue: 1,
      requiredCapabilities: [next.capabilityId],
      acceptanceCriteria: [
        `Route ${next.capabilityId} only through frozen learning contract ${next.contractDigest}; do not alter its acceptance oracle.`,
      ],
      maximumBudgetUsd: 0,
    });
    return source.workCard.missingCapabilities.includes(next.capabilityId);
  }

  async tick() {
    if (this.running) return {status:"blocked" as const};
    this.running = true;
    try {
      let result = await this.kernel.runLearningWorkerTick(this.generator);
      if (result.status === "idle" && await this.seedNextApprovedCurriculumGap()) {
        result = await this.kernel.runLearningWorkerTick(this.generator);
      }
      console.info(JSON.stringify({event:"sara_learning_tick",result,snapshot:await this.kernel.learningOperationalSnapshot()}));
      return result;
    } finally { this.running = false; }
  }
  start() {
    if (this.timer) return;
    void this.kernel.learningOperationalSnapshot().then(snapshot => console.info(JSON.stringify({event:"sara_learning_startup",snapshot}))).catch(() => {});
    const tick = () => { void this.tick().catch(() => {
      // Unknown reservations remain consumed. Never restart a failed request here.
      console.error("SARA learning queue stopped this tick; retained state requires inspection.");
    }); };
    this.timer = setInterval(tick,60_000);
    this.timer.unref();
    tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
