import type { SaraKernel } from "./kernel.ts";
import {
  createRevenuePilotTestingJob,
  type RevenuePilotTestingInput,
  type RevenuePilotTestingJob,
} from "./revenue-pilot-testing.ts";

export class RevenuePilotTestingRuntime {
  readonly #kernel: SaraKernel;
  readonly #jobs = new Map<string, RevenuePilotTestingJob>();

  constructor(kernel: SaraKernel) {
    this.#kernel = kernel;
  }

  async createJob(input: RevenuePilotTestingInput): Promise<RevenuePilotTestingJob> {
    const status = await this.#kernel.getStatus();
    if (status.emergencyStopped) {
      throw new Error("No-price testing is frozen by SARA's emergency stop.");
    }
    const availableCapabilities = status.capabilities
      .filter((capability) => capability.status === "available" || capability.status === "production")
      .map((capability) => capability.id);
    const job = createRevenuePilotTestingJob(input, availableCapabilities);
    this.#jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }

  listJobs(): RevenuePilotTestingJob[] {
    return [...this.#jobs.values()].map((job) => structuredClone(job));
  }

  getJob(jobId: string): RevenuePilotTestingJob | null {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }
}
