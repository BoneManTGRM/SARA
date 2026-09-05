import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingBenchmarkMethod } from "./coding-repair-benchmark.ts";

// This is private benchmark evidence, never a replacement for the kernel ledger.
// The existing irreversible execution claim reserves the whole matched grant.
// Individual dispatch receipts retain conservative exposure until reconciled.
export async function writeBenchmarkAudit(directory: string, name: string, payload: unknown): Promise<void> {
  if (!/^[a-z0-9_-]+\.json$/u.test(name)) throw new Error("Unsafe benchmark audit filename.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(join(directory, name), "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, payload, payloadDigest: sha256(canonicalJson(payload)) })}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  const parent = await open(directory, "r");
  try { await parent.sync(); } finally { await parent.close(); }
}

const INPUT_LIMIT = 30_000;
const OUTPUT_LIMIT = 8_000;
const MAXIMUM_REQUEST_USD = 0.0156; // 30K input * $0.20/M + 8K output * $1.20/M.
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/u.test(value) ? value : null;
}

export function createBenchmarkAudit(input: {
  directory: string;
  method: CodingBenchmarkMethod;
  beforeDispatch(): Promise<void>;
  fetchImpl?: typeof fetch;
  onModelIdentity?: (model: string) => Promise<void>;
}): { fetch: typeof fetch; record(kind: string, payload: unknown): Promise<void> } {
  if (!["luna", "luna_reparodynamic"].includes(input.method)) throw new Error("Invalid benchmark arm.");
  let generations = 0;
  let tokenCounts = 0;
  let events = 0;
  let closed = false;
  let inFlight = false;
  const method = input.method;
  const directory = input.directory;
  const beforeDispatch = input.beforeDispatch;
  const onModelIdentity = input.onModelIdentity;
  const realFetch = input.fetchImpl ?? fetch;
  const write = (name: string, payload: unknown) => writeBenchmarkAudit(directory, `${method}-${name}.json`, payload);
  return {
    async record(kind, payload) {
      if (!/^[a-z_]{1,40}$/u.test(kind)) throw new Error("Invalid benchmark evidence kind.");
      await write(`event-${String(++events).padStart(4, "0")}-${kind}`, payload);
    },
    fetch: async (resource, init) => {
      if (closed) throw new Error("Benchmark audit is closed after a failed or uncertain dispatch.");
      if (inFlight) throw new Error("Benchmark concurrent dispatch rejected; requests are never queued.");
      const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
      const isGeneration = url === "https://api.openai.com/v1/responses";
      if ((!isGeneration && url !== "https://api.openai.com/v1/responses/input_tokens") || init?.method !== "POST" || typeof init.body !== "string") {
        throw new Error("Benchmark worker attempted an unapproved provider endpoint.");
      }
      const requestBody = init.body;
      // Copy mutable request inputs before any asynchronous admission or I/O.
      const requestInit: RequestInit = { ...init, body: requestBody, headers: new Headers(init.headers), redirect: "error" };
      const body = object(JSON.parse(requestBody));
      if (body.model !== "gpt-5.6-luna" || typeof body.input !== "string" || !body.input.trim()
        || Object.keys(body).some(key => !["model", "input", "store", "max_output_tokens", "reasoning", "text"].includes(key))) {
        throw new Error("Benchmark request changed the frozen provider contract.");
      }
      if (isGeneration && (body.max_output_tokens !== OUTPUT_LIMIT || object(body.reasoning).effort !== "medium" || body.store !== false)) {
        throw new Error("Benchmark request changed the frozen reasoning or output ceiling.");
      }
      if (isGeneration ? generations >= 3 : tokenCounts >= 3) throw new Error("Benchmark request attempt ceiling reached.");
      // Admit synchronously. Same-instance overlap must not pass the ceiling
      // check while another invocation is suspended in beforeDispatch.
      inFlight = true;
      const index = isGeneration ? ++generations : ++tokenCounts;
      const prefix = `${isGeneration ? "" : "count-"}${String(index).padStart(4, "0")}`;
      let reservationWritten = false;
      const started = performance.now();
      try {
        await beforeDispatch();
        // An exclusive, fsynced receipt precedes fetch. A collision or failed write
        // is fatal; no expiry, missing-response recovery, or automatic resend exists.
        await write(`${prefix}-reservation`, {
          method, operation: isGeneration ? "generation" : "input_token_count",
          requestedAt: new Date().toISOString(), requestDigest: sha256(requestBody), promptDigest: sha256(body.input),
          model: body.model, reasoning: isGeneration ? "medium" : null,
          maximumInputTokens: INPUT_LIMIT, maximumOutputTokens: isGeneration ? OUTPUT_LIMIT : 0,
          maximumReservedUsd: isGeneration ? MAXIMUM_REQUEST_USD : null,
          accounting: isGeneration ? "conservative_maximum_not_invoice" : "not_a_generation_request",
        });
        reservationWritten = true;
        // Recheck after durable storage so a stop activated during I/O blocks dispatch.
        await beforeDispatch();
        const response = await realFetch(url, requestInit);
        const raw = await response.clone().text();
        if (Buffer.byteLength(raw, "utf8") > 1_048_576) throw new Error("Benchmark response exceeded evidence bound.");
        let value: Record<string, unknown> = {};
        try { value = object(JSON.parse(raw)); } catch { /* Original worker rejects malformed responses. */ }
        const usage = object(value.usage);
        const inputTokens = count(usage.input_tokens);
        const outputTokens = count(usage.output_tokens);
        const output = Array.isArray(value.output) ? value.output : [];
        const content = output.filter(item => object(item).type === "message").flatMap(item => {
          const parts = object(item).content; return Array.isArray(parts) ? parts.map(object) : [];
        });
        const usageValid = inputTokens !== null && inputTokens <= INPUT_LIMIT && outputTokens !== null && outputTokens <= OUTPUT_LIMIT;
        await write(`${prefix}-response`, {
          method, receivedAt: new Date().toISOString(), elapsedMilliseconds: performance.now() - started,
          httpStatus: response.status, providerRequestId: identifier(response.headers.get("x-request-id")),
          responseId: identifier(value.id), model: identifier(value.model), status: identifier(value.status),
          inputTokens, billableOutputTokens: outputTokens,
          estimatedCostUsd: isGeneration && usageValid ? Math.ceil((inputTokens * 0.2 + outputTokens * 1.2)) / 1_000_000 : null,
          chargeReconciled: false, responseDigest: sha256(raw),
          refused: content.some(part => part.type === "refusal"),
          outputText: content.filter(part => part.type === "output_text" && typeof part.text === "string").map(part => part.text).join("\n"),
          countedInputTokens: isGeneration ? null : count(value.input_tokens),
        });
        if (isGeneration && (typeof value.model !== "string" || !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/u.test(value.model))) {
          // Preserve the response but do not allow a success without actual identity.
          throw new Error("Benchmark provider identity unavailable or changed.");
        }
        if (isGeneration) await onModelIdentity?.(value.model as string);
        if (isGeneration && (!response.ok || !usageValid || value.status !== "completed" || typeof value.model !== "string" || !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/u.test(value.model))) {
          closed = true;
        }
        return response;
      } catch (error) {
        closed = true;
        if (!reservationWritten) throw error;
        await write(`${prefix}-error`, { method, failureCode: "PROVIDER_OR_EVIDENCE_FAILURE", estimatedCostUsd: null, reservationRetained: true, elapsedMilliseconds: performance.now() - started });
        throw new Error("Benchmark provider or evidence failed; no replay permitted.");
      } finally {
        inFlight = false;
      }
    },
  };
}

export function benchmarkSpendExposure(costs: readonly (number | null)[], maximumArmSpendUsd: number) {
  if (!Number.isFinite(maximumArmSpendUsd) || maximumArmSpendUsd <= 0 || maximumArmSpendUsd > 0.075
      || costs.length > 2 || costs.some(cost => cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > maximumArmSpendUsd))) {
    throw new Error("Invalid equal-arm benchmark exposure.");
  }
  const knownEstimateMicros = costs.reduce<number>((sum, cost) => sum + (cost === null ? 0 : Math.ceil(cost * 1_000_000)), 0);
  const unresolvedMicros = costs.filter(cost => cost === null).length * Math.ceil(maximumArmSpendUsd * 1_000_000);
  return { knownEstimatedCostUsd: knownEstimateMicros / 1_000_000,
    accountedCostUsd: unresolvedMicros > 0 ? null : knownEstimateMicros / 1_000_000,
    unresolvedReservedUsd: unresolvedMicros / 1_000_000,
    totalExposureUsd: (knownEstimateMicros + unresolvedMicros) / 1_000_000,
  };
}
