import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { sha256 } from "./canonical.ts";

export type SelfBuildHttpTiming = Readonly<{
  schemaVersion: 1;
  observationId: string;
  sourceRevision: string | null;
  jobIdDigest: string;
  startedAt: string;
  elapsedMilliseconds: number;
  statusCode: number;
  outcome: "response_finished" | "connection_closed_before_finish";
  boundary: "request_event_to_response_finish_or_close";
  kernelAcceptanceInferredFrom201: boolean;
  telemetryOnly: true;
}>;
const attached = new WeakSet<Server>();

/** Observe the OUTER HTTP boundary, not the earlier reuse callback timer.
 * No body, authorization header, prompt, source or raw job ID is inspected.
 * This is optional telemetry, not acceptance authority or a second durable ledger.
 * `finish` means response bytes were handed to the OS, not received by a client.
 */
export function observeSelfBuildHttp(server: Server, options: {
  sourceRevision?: string;
  emit(value: SelfBuildHttpTiming): void;
  onTelemetryFailure?(): void;
}): void {
  if (attached.has(server)) throw new Error("SELF_BUILD_TIMING_ALREADY_ATTACHED");
  if (options.sourceRevision !== undefined && !/^[a-f0-9]{40}$/u.test(options.sourceRevision)) {
    throw new Error("SELF_BUILD_TIMING_INVALID_SOURCE");
  }
  attached.add(server);
  const revision = options.sourceRevision ?? null;
  server.prependListener("request", (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || typeof request.url !== "string" || request.url.length > 1024) return;
    const match = request.url.match(/^\/api\/jobs\/([a-zA-Z0-9-]{1,128})\/self-build(?:\?[^#]*)?$/u);
    if (!match) return;
    const start = performance.now(), startedAt = new Date().toISOString(), observationId = randomUUID();
    const jobIdDigest = sha256(match[1]);
    let recorded = false;
    const finish = () => {
      if (recorded) return;
      recorded = true;
      response.off("finish", finish); response.off("close", finish);
      const finished = response.writableFinished;
      const value: SelfBuildHttpTiming = Object.freeze({ schemaVersion: 1, observationId,
        sourceRevision: revision, jobIdDigest, startedAt,
        elapsedMilliseconds: Math.max(0, performance.now() - start), statusCode: response.statusCode,
        outcome: finished ? "response_finished" : "connection_closed_before_finish",
        boundary: "request_event_to_response_finish_or_close",
        kernelAcceptanceInferredFrom201: finished && response.statusCode === 201, telemetryOnly: true });
      try { options.emit(value); }
      catch { try { options.onTelemetryFailure?.(); } catch { /* Optional telemetry cannot change a completed response. */ } }
    };
    response.once("finish", finish); response.once("close", finish);
  });
}
