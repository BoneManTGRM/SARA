import type { Principal } from "./types.ts";

export type StoredEvent<T = unknown> = {
  id: string;
  sequence: number;
  occurredAt: string;
  type: string;
  actor: Principal;
  data: T;
  previousHash: string;
  hash: string;
};

export class EventStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventStoreIntegrityError";
  }
}

// The write-capable store deliberately lives as a non-exported implementation
// inside kernel.ts. This module exposes only the immutable event shape and the
// integrity error needed by callers. There is no policy-bypassing append API.
