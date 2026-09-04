import { canonicalJson } from "./canonical.ts";
import type { SaraKernel } from "./kernel.ts";
import {
  createRevenuePilotTestingJob,
  type RevenuePilotTestingInput,
  type RevenuePilotTestingJob,
} from "./revenue-pilot-testing.ts";
import {
  listRevenuePilotTestingJobs as readStoredTestingJobs,
  persistRevenuePilotTestingJob,
} from "./revenue-pilot-testing-store.ts";

export class RevenuePilotTestingRuntime {
  readonly #kernel: SaraKernel;
  readonly #stateDirectory: string;
  readonly #jobs = new Map<string, RevenuePilotTestingJob>();
  #loaded = false;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(kernel: SaraKernel, stateDirectory: string) {
    this.#kernel = kernel;
    this.#stateDirectory = stateDirectory;
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    const jobs = await readStoredTestingJobs(this.#stateDirectory);
    for (const job of jobs) {
      if (this.#jobs.has(job.id)) throw new Error("Duplicate persisted testing job identity.");
      this.#jobs.set(job.id, structuredClone(job));
    }
    this.#loaded = true;
  }

  async createJob(input: RevenuePilotTestingInput): Promise<RevenuePilotTestingJob> {
    return this.#exclusive(async () => {
      await this.#ensureLoaded();
      const status = await this.#kernel.getStatus();
      if (status.emergencyStopped) {
        throw new Error("No-price testing is frozen by SARA's emergency stop.");
      }
      const availableCapabilities = status.capabilities
        .filter((capability) => capability.status === "available")
        .map((capability) => capability.id);
      const job = createRevenuePilotTestingJob(input, availableCapabilities);
      const existing = this.#jobs.get(job.id);
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(job)) {
          throw new Error("Testing job identity conflicts with existing private state.");
        }
        return structuredClone(existing);
      }
      const persisted = await persistRevenuePilotTestingJob({
        stateDirectory: this.#stateDirectory,
        job,
      });
      this.#jobs.set(persisted.id, structuredClone(persisted));
      return structuredClone(persisted);
    });
  }

  async listJobs(): Promise<RevenuePilotTestingJob[]> {
    return this.#exclusive(async () => {
      await this.#ensureLoaded();
      return [...this.#jobs.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((job) => structuredClone(job));
    });
  }

  async getJob(jobId: string): Promise<RevenuePilotTestingJob | null> {
    return this.#exclusive(async () => {
      await this.#ensureLoaded();
      const job = this.#jobs.get(jobId);
      return job ? structuredClone(job) : null;
    });
  }
}
