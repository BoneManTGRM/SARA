import { readBoundedProviderBody } from "./bounded-provider-body.ts";
import { writeBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { sha256 } from "./canonical.ts";

export interface BenchmarkDispatchBudgetConfig {
  directory: string;
  beforeDispatch(): Promise<void>;
  fetchImpl?: typeof fetch;
  model: "gpt-5.6-luna";
  reasoning: "medium";
  arms: string[];
  attempts: Array<{ id: string; arm: string }>;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  /** Frozen price snapshot, in tenths of one microdollar per token. */
  inputPriceTenthsMicros: number;
  outputPriceTenthsMicros: number;
  totalCapMicros: number;
  armCapMicros: number;
  attemptCapMicros: number;
  maximumGenerationRequestsPerAttempt: number;
  inputBound?: "exact_token_count" | "utf8_bytes_with_framing_reserve";
  allowStructuredText?: boolean;
  errorPrefix?: string;
  auditPrefix?: string;
}

/** Exposure accounting only. The caller's existing durable execution claim and
 * kernel/owner permit remain the sole spending authority. No retries or grants.
 * All arithmetic is integer microdollars, rounded upward per request. */
export function createBenchmarkDispatchBudget(config: BenchmarkDispatchBudgetConfig) {
  const c = { ...config, arms: [...config.arms], attempts: config.attempts.map(a => ({ ...a })) };
  const error = (suffix: string) => new Error(`${c.errorPrefix ?? "BENCHMARK_DISPATCH"}_${suffix}`);
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  const label = (s: string) => typeof s === "string" && /^[a-zA-Z0-9._:/-]{1,240}$/u.test(s);
  if (typeof c.beforeDispatch !== "function" || c.model !== "gpt-5.6-luna" || c.reasoning !== "medium" ||
    !c.arms.length || c.arms.some(a => !label(a)) || new Set(c.arms).size !== c.arms.length ||
    !c.attempts.length || c.attempts.some(a => !label(a.id) || !c.arms.includes(a.arm)) ||
    new Set(c.attempts.map(a => a.id)).size !== c.attempts.length ||
    c.arms.some(a => !c.attempts.some(t => t.arm === a)) ||
    ![c.maximumInputTokens, c.maximumOutputTokens, c.inputPriceTenthsMicros, c.outputPriceTenthsMicros,
      c.totalCapMicros, c.armCapMicros, c.attemptCapMicros, c.maximumGenerationRequestsPerAttempt].every(positive) ||
    (c.inputBound !== undefined && !["exact_token_count", "utf8_bytes_with_framing_reserve"].includes(c.inputBound)) ||
    (c.allowStructuredText && c.inputBound !== "utf8_bytes_with_framing_reserve") ||
    !/^[a-z0-9_-]+$/u.test(c.auditPrefix ?? "benchmark-budget")) throw error("INVALID_CONFIG");
  const cost = (i: number, o: number) => (BigInt(i) * BigInt(c.inputPriceTenthsMicros) + BigInt(o) * BigInt(c.outputPriceTenthsMicros) + 9n) / 10n;
  const maximum = cost(c.maximumInputTokens, c.maximumOutputTokens);
  if (maximum > BigInt(Number.MAX_SAFE_INTEGER)) throw error("INVALID_CONFIG");
  const maximumRequestMicros = Number(maximum);
  const record = (labels: string[]) => Object.fromEntries(labels.map(a => [a, 0]));
  const ids = c.attempts.map(a => a.id);
  const spent = record(c.arms), spentAttempt = record(ids), dispatched = record(c.arms), counted = record(c.arms), completed = record(c.arms);
  const dispatchedAttempt = record(ids), countedAttempt = record(ids), completedAttempt = record(ids), reservedAttempt = record(ids);
  let total = 0, reserved = 0, closed = false, inFlight = false, sequence = 0, generations = 0;
  let observedModelIdentity: string | null = null;
  const counts = new Map<string, number>();
  const actualFetch = c.fetchImpl ?? fetch;
  const usd = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([k,v]) => [k,v / 1e6]));
  const snapshot = () => ({ estimatedByArmUsd: usd(spent), estimatedByAttemptUsd: usd(spentAttempt), estimatedTotalUsd: total / 1e6,
    unresolvedReservedUsd: reserved / 1e6, unresolvedReservedByAttemptUsd: usd(reservedAttempt), closed,
    unresolvedReservedByArmUsd: Object.fromEntries(c.arms.map(arm => [arm,
      c.attempts.filter(a => a.arm === arm).reduce((sum, a) => sum + reservedAttempt[a.id], 0) / 1e6])),
    generationRequests: generations, generationRequestsByArm: { ...dispatched }, generationRequestsByAttempt: { ...dispatchedAttempt },
    tokenCountRequestsByArm: { ...counted }, tokenCountRequestsByAttempt: { ...countedAttempt },
    completedGenerationRequestsByArm: { ...completed }, completedGenerationRequestsByAttempt: { ...completedAttempt },
    providerChargesReconciled: false, spendingAuthority: false, observedModelIdentity });
  return { snapshot, fetchFor(attemptId: string): typeof fetch {
    const attempt = c.attempts.find(a => a.id === attemptId);
    if (!attempt) throw error("INVALID_ATTEMPT");
    const arm = attempt.arm;
    return async (resource, init) => {
      if (closed || inFlight) throw error("BUDGET_CLOSED_OR_BUSY");
      const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
      if (!init || init.method !== "POST" || typeof init.body !== "string" ||
        !["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses/input_tokens"].includes(url)) throw error("ENDPOINT_REJECTED");
      const copy = { ...init, body: init.body, headers: new Headers(init.headers), redirect: "error" as const };
      let body: Record<string, unknown>;
      try { body = JSON.parse(copy.body); } catch { throw error("PROVIDER_CONTRACT_CHANGED"); }
      const generation = url.endsWith("/responses");
      const reasoning = body?.reasoning as Record<string, unknown> | undefined;
      const text = body?.text as Record<string, unknown> | undefined;
      const format = text?.format as Record<string, unknown> | undefined;
      if (!body || Array.isArray(body) || body.model !== c.model || typeof body.input !== "string" || !body.input.trim() ||
        Object.keys(body).some(k => !(generation ? ["model","input","store","max_output_tokens","reasoning", ...(c.allowStructuredText ? ["text"] : [])] : ["model","input", ...(c.allowStructuredText ? ["text"] : [])]).includes(k)) ||
        (generation && (body.max_output_tokens !== c.maximumOutputTokens || reasoning?.effort !== c.reasoning ||
          Object.keys(reasoning).length !== 1 || body.store !== false))) throw error("PROVIDER_CONTRACT_CHANGED");
      if (text !== undefined && (!text || Array.isArray(text) || Object.keys(text).some(k => k !== "format") ||
        !format || Array.isArray(format) || Object.keys(format).some(k => !["type", "name", "strict", "schema"].includes(k)) ||
        format.type !== "json_schema" || typeof format.name !== "string" || format.strict !== true ||
        !format.schema || typeof format.schema !== "object" || Array.isArray(format.schema))) throw error("PROVIDER_CONTRACT_CHANGED");
      // For the historical text-only request contract: byte-level tokenization
      // cannot produce more text tokens than UTF-8 bytes; reserve 1024 additional
      // framing tokens and include the ENTIRE body (also any JSON schema).
      // Repository calls instead require the successful exact model/input count.
      const countKey = sha256(JSON.stringify([attemptId, c.model, body.input, body.text ?? null]));
      const bound = c.inputBound === "utf8_bytes_with_framing_reserve" ? Buffer.byteLength(copy.body, "utf8") + 1024 : counts.get(countKey);
      if (generation && (bound === undefined || bound > c.maximumInputTokens)) throw error("INPUT_TOKEN_BOUND_REQUIRED");
      if (generation && (maximumRequestMicros > c.armCapMicros - spent[arm] || maximumRequestMicros > c.totalCapMicros - total)) throw error("ARM_BUDGET_EXHAUSTED");
      if (generation && (maximumRequestMicros > c.attemptCapMicros - spentAttempt[attemptId] ||
        dispatchedAttempt[attemptId] >= c.maximumGenerationRequestsPerAttempt)) throw error("ATTEMPT_BUDGET_EXHAUSTED");
      inFlight = true; const number = ++sequence; let didDispatch = false;
      const audit = (kind: string, payload: object) => writeBenchmarkAudit(c.directory,
        `${c.auditPrefix ?? "benchmark-budget"}-${String(number).padStart(4,"0")}-${kind}.json`, { arm, attemptId, ...payload });
      try {
        await c.beforeDispatch();
        if (generation) {
          reserved = maximumRequestMicros; reservedAttempt[attemptId] = reserved;
          await audit("reservation", { reservedUsd: reserved / 1e6, previousEstimateUsd: spent[arm] / 1e6,
            requestDigest: sha256(copy.body), inputBound: c.inputBound ?? "exact_token_count", inputTokenBound: bound,
            maximumInputTokens: c.maximumInputTokens, maximumOutputTokens: c.maximumOutputTokens,
            inputPriceTenthsMicros: c.inputPriceTenthsMicros, outputPriceTenthsMicros: c.outputPriceTenthsMicros,
            spendingAuthority: false, replayAllowed: false, at: new Date().toISOString() });
        }
        await c.beforeDispatch();
        if (copy.signal?.aborted) throw new Error("PROVIDER_ABORTED_BEFORE_DISPATCH");
        await audit("dispatch-intent", { operation: generation ? "generation" : "token_count", requestDigest: sha256(copy.body),
          state: "dispatch_intent", providerAcceptanceKnown: false, replayAllowed: false });
        await c.beforeDispatch();
        if (copy.signal?.aborted) throw new Error("PROVIDER_ABORTED_BEFORE_DISPATCH");
        didDispatch = true;
        if (generation) { generations++; dispatched[arm]++; dispatchedAttempt[attemptId]++; } else { counted[arm]++; countedAttempt[attemptId]++; }
        const response = await actualFetch(url, copy);
        const raw = await readBoundedProviderBody(response, copy.signal);
        if (Buffer.byteLength(raw) > 1048576) throw error("PROVIDER_RESPONSE_BOUND");
        const data = JSON.parse(raw);
        if (!response.ok) throw error("PROVIDER_HTTP_FAILURE");
        if (generation) {
          if (typeof data.model !== "string" || !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/u.test(data.model) ||
            (observedModelIdentity !== null && data.model !== observedModelIdentity)) throw error("PROVIDER_MODEL_CHANGED");
          observedModelIdentity = data.model;
          const i = data.usage?.input_tokens, o = data.usage?.output_tokens;
          if (data.status !== "completed" || !Number.isSafeInteger(i) || i < 0 || i > c.maximumInputTokens ||
            !Number.isSafeInteger(o) || o < 0 || o > c.maximumOutputTokens) throw error("PROVIDER_USAGE_UNKNOWN");
          // Account every completed charged response, even malformed model output.
          const micros = Number(cost(i, o));
          await audit("response", { estimatedCostUsd: micros / 1e6, responseDigest: sha256(raw), observedModelIdentity, providerChargesReconciled: false });
          spent[arm] += micros; spentAttempt[attemptId] += micros; total += micros;
          reserved = 0; reservedAttempt[attemptId] = 0; completed[arm]++; completedAttempt[attemptId]++;
        } else {
          if (!Number.isSafeInteger(data.input_tokens) || data.input_tokens < 0 || data.input_tokens > c.maximumInputTokens) throw error("INPUT_TOKEN_BOUND_REQUIRED");
          await audit("response", { inputTokens: data.input_tokens, requestDigest: sha256(copy.body), responseDigest: sha256(raw) });
          counts.set(countKey, data.input_tokens);
        }
        return new Response(raw, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (failure) {
        closed = true;
        if (generation || didDispatch) await audit("error", { unresolvedReservedUsd: reserved / 1e6,
          failureCode: didDispatch ? "PROVIDER_OR_EVIDENCE_UNCERTAIN" : "NOT_DISPATCHED", networkInvoked: didDispatch, replayAllowed: false }).catch(() => {});
        throw failure;
      } finally { inFlight = false; }
    };
  } };
}
