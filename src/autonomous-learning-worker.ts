import type { SaraKernel } from "./kernel.ts";
import type { CandidateGenerator } from "./types.ts";

/** Existing-runtime queue consumer. It neither creates authority nor promotes code. */
export class AutonomousLearningWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(private readonly kernel: SaraKernel, private readonly generator: CandidateGenerator) {
    if (generator.maximumCostUsd !== 0) throw new Error("Learning worker requires a zero-cost generator.");
  }
  async tick() {
    if (this.running) return {status:"blocked" as const};
    this.running = true;
    try {
      const result = await this.kernel.runLearningWorkerTick(this.generator);
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
