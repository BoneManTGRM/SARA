/** Same-process coordination of cold learning. Carries no source, PASS, tokens, or authorization. */
type Flight = { listeners: Set<(ready: boolean) => void>; settled: boolean; ready: boolean };
export type RepairLearningLeader = { role: "leader"; finish(ready: boolean): void };
export type RepairLearningFollower = { role: "follower"; wait(): Promise<void> };

export class RepairLearningCoordinator {
  #flights = new Map<string, Flight>();
  #waiters = 0;
  readonly #maximumWaitMs: number;
  constructor(maximumWaitMs = 30_000) {
    if (!Number.isSafeInteger(maximumWaitMs) || maximumWaitMs < 1 || maximumWaitMs > 30_000) throw new Error("REPAIR_LEARNING_INVALID_TIMEOUT");
    this.#maximumWaitMs = maximumWaitMs;
  }
  #validate(key: string): void {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("REPAIR_LEARNING_INVALID_KEY");
  }
  follow(key: string): RepairLearningFollower | null {
    this.#validate(key);
    const active = this.#flights.get(key);
    return active ? this.#follower(active) : null;
  }
  claim(key: string): RepairLearningLeader | RepairLearningFollower {
    this.#validate(key);
    const active = this.#flights.get(key);
    if (active) return this.#follower(active);
    if (this.#flights.size >= 32) throw new Error("REPAIR_LEARNING_CAPACITY");
    const flight: Flight = { listeners: new Set(), settled: false, ready: false };
    this.#flights.set(key, flight);
    let finished = false;
    return { role: "leader", finish: ready => {
      if (finished) return;
      finished = true;
      if (this.#flights.get(key) === flight) this.#flights.delete(key);
      flight.settled = true; flight.ready = ready === true;
      for (const notify of flight.listeners) notify(flight.ready);
      flight.listeners.clear();
    } };
  }
  #follower(flight: Flight): RepairLearningFollower {
    let started = false;
    return { role: "follower", wait: async () => {
      if (started) throw new Error("REPAIR_LEARNING_WAIT_REPLAY");
      started = true;
      if (flight.settled) {
        if (!flight.ready) throw new Error("REPAIR_LEARNING_LEADER_NOT_COMMITTED");
        return;
      }
      if (flight.listeners.size >= 32 || this.#waiters >= 128) throw new Error("REPAIR_LEARNING_WAITER_CAPACITY");
      this.#waiters++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let notify!: (ready: boolean) => void;
      try {
        await new Promise<void>((resolve, reject) => {
          notify = ready => ready ? resolve() : reject(new Error("REPAIR_LEARNING_LEADER_NOT_COMMITTED"));
          flight.listeners.add(notify);
          timer = setTimeout(() => reject(new Error("REPAIR_LEARNING_WAIT_TIMEOUT")), this.#maximumWaitMs);
        });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        flight.listeners.delete(notify); this.#waiters--;
      }
      // Timeout/cancellation never clears the leader or starts another model call.
    } };
  }
}
export const repairLearningCoordinator = new RepairLearningCoordinator();
