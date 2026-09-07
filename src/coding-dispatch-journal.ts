import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { writeBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { sha256 } from "./canonical.ts";

type Phase = "token_count" | "generation";
export type DispatchCounters = { generationAttempts: number; tokenCountAttempts: number; responsesReceived: number;
  uncertainAttempts: number; rejectedBeforeNetwork: number; closed: boolean };

/** Observes the actual fetch boundary, not a later successful reuse callback.
 * This does NOT grant spending authority or replace the surrounding budget.
 * Request/response bodies and credentials are never written to this journal.
 * A durable intent proves possible dispatch, not provider acceptance. */
export class CodingDispatchJournal {
  readonly #directory: string;
  readonly #fetch: typeof fetch;
  readonly #beforeDispatch: () => Promise<void>;
  #ready?: Promise<void>;
  #owned = false;
  #sequence = 0;
  #busy = false;
  #stats: DispatchCounters = { generationAttempts: 0, tokenCountAttempts: 0, responsesReceived: 0,
    uncertainAttempts: 0, rejectedBeforeNetwork: 0, closed: false };
  constructor(input: { directory: string; beforeDispatch(): Promise<void>; fetchImpl?: typeof fetch }) {
    this.#directory = input.directory; this.#fetch = input.fetchImpl ?? fetch; this.#beforeDispatch = input.beforeDispatch;
  }
  snapshot(): DispatchCounters { return structuredClone(this.#stats); }
  readonly fetch: typeof fetch = async (resource, init) => {
    if (this.#stats.closed || this.#busy) throw new Error("CODING_DISPATCH_CLOSED_OR_BUSY");
    const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
    if (init?.method !== "POST" || typeof init.body !== "string" || Buffer.byteLength(init.body) > 1_048_576 ||
        !["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses/input_tokens"].includes(url)) {
      throw new Error("CODING_DISPATCH_ENDPOINT_REJECTED");
    }
    const phase: Phase = url.endsWith("/input_tokens") ? "token_count" : "generation";
    const copy = { ...init, headers: new Headers(init.headers), body: init.body, redirect: "error" as const };
    if (this.#sequence >= 32) throw new Error("CODING_DISPATCH_REQUEST_LIMIT");
    this.#busy = true;
    const id = randomUUID(), sequence = ++this.#sequence, started = performance.now();
    const name = `${String(sequence).padStart(4, "0")}-${id}`;
    let attempted = false;
    const controller = new AbortController();
    copy.signal = copy.signal ? AbortSignal.any([copy.signal, controller.signal]) : controller.signal;
    try {
      // The run directory must not be reused after restart. Persistent intents
      // from an interrupted journal remain untouched; recovery is read-only.
      this.#ready ??= mkdir(this.#directory, { recursive: false, mode: 0o700 }).then(() => { this.#owned = true; });
      await this.#ready;
      await this.#beforeDispatch();
      copy.signal.throwIfAborted();
      await writeBenchmarkAudit(this.#directory, `${name}-intent.json`, { schemaVersion: 1, id, sequence, phase,
        state: "dispatch_intent", requestDigest: sha256(copy.body), recordedAt: new Date().toISOString(), replayAllowed: false });
      await this.#beforeDispatch();
      copy.signal.throwIfAborted();
      // This counts fetch invocation, not a completed model result. It survives
      // any later controller/reuse callback failure within this process.
      attempted = true;
      if (phase === "generation") this.#stats.generationAttempts++; else this.#stats.tokenCountAttempts++;
      const response = await this.#fetch(url, copy);
      const reader = response.clone().body?.getReader();
      let size = 0; const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 1_048_576) { controller.abort(); void reader.cancel().catch(() => {}); throw new Error("CODING_DISPATCH_RESPONSE_BOUND"); }
          chunks.push(chunk.value);
        }
      }
      const requestId = response.headers.get("x-request-id");
      await writeBenchmarkAudit(this.#directory, `${name}-response.json`, { schemaVersion: 1, id, sequence, phase,
        state: "response_received", status: response.status, responseDigest: sha256(Buffer.concat(chunks)), responseBytes: size,
        providerRequestId: requestId && /^[a-zA-Z0-9._:-]{1,200}$/u.test(requestId) ? requestId : null,
        elapsedMilliseconds: performance.now() - started, acceptanceOrBillingEstablished: false, replayAllowed: false });
      this.#stats.responsesReceived++;
      return response;
    } catch (error) {
      this.#stats.closed = true;
      if (attempted) this.#stats.uncertainAttempts++; else this.#stats.rejectedBeforeNetwork++;
      // Receipt write failure itself leaves intent/reservation uncertain. Never
      // clear another budget's hold, blindly retry, or expose raw provider errors.
      if (this.#owned) await writeBenchmarkAudit(this.#directory, `${name}-failure.json`, { schemaVersion: 1, id, sequence, phase,
        state: attempted ? "uncertain" : "not_sent", networkAttemptedInProcess: attempted,
        elapsedMilliseconds: performance.now() - started, replayAllowed: false }).catch(() => {});
      throw error;
    } finally { this.#busy = false; }
  };
}
