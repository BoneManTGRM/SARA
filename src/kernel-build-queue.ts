import { performance } from "node:perf_hooks";
type Task = { run(): Promise<unknown>; resolve(value: unknown): void; reject(error: Error): void;
  submitted: number; timer: ReturnType<typeof setTimeout>; cancelled: boolean };
/** Bounded overlap of existing main-thread verification and isolated child I/O.
 * Not CPU parallelism and never a result cache. The caller retains acceptance authority. */
export class KernelBuildQueue {
  readonly #queue: Task[] = [];
  #active = 0;
  #closed = false;
  readonly #drainers: Array<() => void> = [];
  readonly #waitMs: number;
  constructor(maximumQueueWaitMs = 30_000) {
    if (!Number.isSafeInteger(maximumQueueWaitMs) || maximumQueueWaitMs < 1 || maximumQueueWaitMs > 30_000) throw new Error("KERNEL_BUILD_QUEUE_OPTIONS");
    this.#waitMs = maximumQueueWaitMs;
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("KERNEL_BUILD_QUEUE_CLOSED"));
    if (this.#queue.length >= 32 && this.#active >= 2) return Promise.reject(new Error("KERNEL_BUILD_QUEUE_CAPACITY"));
    return new Promise<T>((resolve, reject) => {
      const task: Task = { run: operation, resolve: value => resolve(value as T), reject,
        submitted: performance.now(), cancelled: false, timer: undefined as unknown as ReturnType<typeof setTimeout> };
      task.timer = setTimeout(() => {
        const index = this.#queue.indexOf(task);
        if (index >= 0) { this.#queue.splice(index, 1); task.cancelled = true; task.reject(new Error("KERNEL_BUILD_QUEUE_DEADLINE")); }
      }, this.#waitMs);
      this.#queue.push(task); this.#pump();
    });
  }
  #pump(): void {
    while (!this.#closed && this.#active < 2 && this.#queue.length) {
      const task = this.#queue.shift()!; clearTimeout(task.timer);
      if (task.cancelled) continue;
      if (performance.now() - task.submitted >= this.#waitMs) { task.reject(new Error("KERNEL_BUILD_QUEUE_DEADLINE")); continue; }
      this.#active++;
      void Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
        this.#active--; this.#pump();
      });
    }
    if (this.#closed && this.#active === 0) for (const done of this.#drainers.splice(0)) done();
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const task of this.#queue.splice(0)) { clearTimeout(task.timer); task.cancelled = true; task.reject(new Error("KERNEL_BUILD_QUEUE_CLOSED")); }
    if (!this.#active) return;
    await new Promise<void>(resolve => this.#drainers.push(resolve));
  }
  snapshot() { return { active: this.#active, queued: this.#queue.length, closed: this.#closed, maximumActive: 2 }; }
}
