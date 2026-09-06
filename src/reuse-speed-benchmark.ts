import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "./canonical.ts";
import { writeBenchmarkAudit, createBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { currentBenchmarkCase, assertCurrentImplementation } from "./current-coding-benchmark.ts";
import { LIVE_CODING_BENCHMARK_PROTECTED_FILES } from "./coding-repair-live-benchmark-case.ts";
import { createReusableCodingCandidateGenerator, type CodingRepairReuseSummary } from "./reusable-coding-candidate-generator.ts";
import { DurableCodingRepairMemory, codingRepairMemoryScope, codingRepairMemoryKey } from "./coding-repair-memory.ts";
import { createLunaCodingRepairModel } from "./luna-coding-repair-model.ts";
import { createAdaptiveCodingRepairModel } from "./adaptive-coding-repair-model.ts";
import { codingTypecheckHost } from "./fresh-typecheck-host.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import { codingRepairCandidateDigest } from "./experimental-v5/coding-repair-verification.ts";
import { OpenAIResponsesClient } from "./openai-worker.ts";
import type { NativeCodingVerifier } from "./native-coding-verifier.ts";
import type { ProgramCandidateProposal, CandidateGenerator } from "./types.ts";
import type { CodingRepairRun, ProgramVerificationResult } from "./coding-repair-types.ts";

export const REUSE_SPEED_ARMS = ["regenerate", "ordinary_memory", "optimized"] as const;
export type ReuseSpeedArm = typeof REUSE_SPEED_ARMS[number];
export const REUSE_SPEED_PROTOCOL = Object.freeze({ schemaVersion: 1, rounds: 4,
  arms: REUSE_SPEED_ARMS, maximumModelCostUsd: 0.15, maximumModelCostUsdPerArm: 0.05,
  maximumGenerationRequestsPerJob: 3, maximumRequestExposureUsd: 0.0156,
  classification: "REPEATED_REPAIR_COMPONENTS_NOT_GENERAL_CODING_MAXIMUM",
  task: "previously_used_freeWindows", initialMemory: "empty_isolated_per_arm",
  measured: "generation,actual durable proposal reuse,controller,fresh loop verification,fresh TS5 final,separate default TS5 verification,job evidence write",
  excluded: "production HTTP/kernel job lifecycle,concurrent jobs,unfamiliar-task generalization; no absolute maximum is claimed",
  control: "All arms share the released repair controller and bounds. Regenerate starts a new proposal store per job. Ordinary memory retains repairs with the released legacy checker. Optimized retains repairs with the native intermediate checker. Each memory arm learns its own live repair.",
  failureRule: "Retain every planned outcome; do not calculate a success speedup unless all compared jobs verify. Uncertain provider dispatch closes the suite. No paid replay.",
});
const MAXIMUM_REQUEST_MICROS = 15600;
const ARM_CAP_MICROS = 50000;

/** Conservative pre-dispatch reservation. Unknown charges retain the reservation
 * and close the suite. Amounts use the same frozen accounting contract as the
 * existing provider adapter; these are estimated exposure, not a billing audit. */
export function createReuseSpeedBudget(input: { directory: string; beforeDispatch(): Promise<void>; fetchImpl?: typeof fetch }) {
  const spent = Object.fromEntries(REUSE_SPEED_ARMS.map(arm => [arm, 0])) as Record<ReuseSpeedArm, number>;
  let reserved = 0, closed = false, inFlight = false, sequence = 0, generations = 0;
  const actualFetch = input.fetchImpl ?? fetch;
  const snapshot = () => ({ estimatedByArmUsd: Object.fromEntries(REUSE_SPEED_ARMS.map(a => [a, spent[a] / 1e6])),
    estimatedTotalUsd: Object.values(spent).reduce((a,b) => a+b, 0) / 1e6,
    unresolvedReservedUsd: reserved / 1e6, closed, generationRequests: generations, providerChargesReconciled: false });
  return { snapshot, fetchFor(arm: ReuseSpeedArm): typeof fetch {
    if (!REUSE_SPEED_ARMS.includes(arm)) throw new Error("REUSE_SPEED_INVALID_ARM");
    return async (resource, init) => {
      if (closed || inFlight) throw new Error("REUSE_SPEED_BUDGET_CLOSED_OR_BUSY");
      const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
      if (!init || init.method !== "POST" || typeof init.body !== "string" ||
        !["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses/input_tokens"].includes(url)) throw new Error("REUSE_SPEED_ENDPOINT_REJECTED");
      const copy = { ...init, body: init.body, headers: new Headers(init.headers), redirect: "error" as const };
      const body = JSON.parse(copy.body);
      const generation = url.endsWith("/responses");
      if (body.model !== "gpt-5.6-luna" || typeof body.input !== "string" || !body.input.trim() ||
        Object.keys(body).some(k => !["model","input","store","max_output_tokens","reasoning","text"].includes(k)) ||
        (generation && (body.max_output_tokens !== 8000 || body.reasoning?.effort !== "medium" || body.store !== false))) throw new Error("REUSE_SPEED_PROVIDER_CONTRACT_CHANGED");
      if (generation && (spent[arm] + MAXIMUM_REQUEST_MICROS > ARM_CAP_MICROS ||
        Object.values(spent).reduce((a,b) => a+b, 0) + MAXIMUM_REQUEST_MICROS > 150000)) throw new Error("REUSE_SPEED_ARM_BUDGET_EXHAUSTED");
      inFlight = true; const number = ++sequence; let dispatched = false;
      try {
        await input.beforeDispatch();
        if (generation) {
          reserved = MAXIMUM_REQUEST_MICROS;
          await writeBenchmarkAudit(input.directory, `reuse-budget-${String(number).padStart(4,"0")}-reservation.json`, {
            arm, reservedUsd: reserved / 1e6, previousEstimateUsd: spent[arm] / 1e6, requestDigest: sha256(copy.body),
            replayAllowed: false, at: new Date().toISOString() });
          generations++;
        }
        await input.beforeDispatch(); dispatched = true;
        const response = await actualFetch(url, copy);
        const raw = await response.clone().text();
        if (Buffer.byteLength(raw) > 1048576) throw new Error("REUSE_SPEED_PROVIDER_RESPONSE_BOUND");
        const data = JSON.parse(raw);
        if (!response.ok) throw new Error("REUSE_SPEED_PROVIDER_HTTP_FAILURE");
        if (generation) {
          const i = data.usage?.input_tokens, o = data.usage?.output_tokens;
          if (data.status !== "completed" || !Number.isSafeInteger(i) || i < 0 || i > 30000 ||
            !Number.isSafeInteger(o) || o < 0 || o > 8000) throw new Error("REUSE_SPEED_PROVIDER_USAGE_UNKNOWN");
          const micros = Math.ceil(i * 0.2 + o * 1.2);
          await writeBenchmarkAudit(input.directory, `reuse-budget-${String(number).padStart(4,"0")}-response.json`, {
            arm, estimatedCostUsd: micros / 1e6, responseDigest: sha256(raw), providerChargesReconciled: false });
          spent[arm] += micros; reserved = 0;
        }
        return response;
      } catch (error) {
        closed = true;
        // Even a failed receipt can leave a durable reservation; never replay.
        if (generation || dispatched) await writeBenchmarkAudit(input.directory,
          `reuse-budget-${String(number).padStart(4,"0")}-error.json`, { arm, unresolvedReservedUsd: reserved / 1e6,
            failureCode: "PROVIDER_OR_EVIDENCE_UNCERTAIN", replayAllowed: false }).catch(() => {});
        throw error;
      } finally { inFlight = false; }
    };
  } };
}

function redact(result: ProgramVerificationResult): ProgramVerificationResult {
  if (!result.failures.some(f => f.file.startsWith("tests/"))) return result;
  const digest = sha256(canonicalJson({ code: "PROTECTED_ACCEPTANCE_FAILURE", artifactDigest: result.artifactDigest }));
  return { ...result, failures: [...result.failures.filter(f => !f.file.startsWith("tests/")), {
    kind: "behavior", code: "PROTECTED_ACCEPTANCE_FAILURE", file: "", line: 0, column: 0,
    severity: "high", existedBeforeRepair: true, evidenceDigest: digest, fingerprint: digest }], evidenceDigests: [digest] };
}
function guard(candidate: ProgramCandidateProposal) {
  const baseline = currentBenchmarkCase().baseline;
  if (candidate.files.length !== baseline.files.length || new Set(candidate.files.map(f => f.path)).size !== baseline.files.length ||
      candidate.files.some(f => !baseline.files.some(b => b.path === f.path))) throw new Error("REUSE_SPEED_FILE_SCOPE");
  for (const file of LIVE_CODING_BENCHMARK_PROTECTED_FILES) if (candidate.files.find(f => f.path === file.path)?.content !== file.content) throw new Error("REUSE_SPEED_PROTECTED_TEST_CHANGED");
}
export type ReuseSpeedRow = { arm: ReuseSpeedArm; round: number; completed: boolean; elapsedMilliseconds: number;
  modelRequests: number; hits: number; verificationCalls: number; finalArtifactDigest: string | null; evidenceSha256: string; errorCode: string | null };

export async function runReuseSpeedBenchmark(input: { directory: string; benchmarkId: string; apiKey: string;
  native: Pick<NativeCodingVerifier,"verify">; executionKind: "live" | "scripted_offline"; beforeDispatch(): Promise<void>; fetchImpl?: typeof fetch }) {
  await assertCurrentImplementation();
  await mkdir(input.directory, { recursive: false, mode: 0o700 }); // Existing run output must never be reused.
  const trace = join(input.directory, "trace");
  const budget = createReuseSpeedBudget({ directory: trace, beforeDispatch: input.beforeDispatch, fetchImpl: input.fetchImpl });
  await writeBenchmarkAudit(trace, "reuse-registration.json", { benchmarkId: input.benchmarkId, protocol: REUSE_SPEED_PROTOCOL,
    protocolDigest: sha256(canonicalJson(REUSE_SPEED_PROTOCOL)), executionKind: input.executionKind, node: process.version });
  const started = performance.now();
  const task = currentBenchmarkCase();
  const context: Parameters<CandidateGenerator["generate"]>[0] = { objective: task.objective,
    acceptanceCriteria: task.acceptanceCriteria, constitutionDigest: sha256(await readFile(new URL("../constitution/constitution.v1.json", import.meta.url))),
    missingCapabilities: [], memoryContext: { memories: [], contextDigest: sha256(canonicalJson(task)) } };
  let observedIdentity: string | null = null;
  const rows: ReuseSpeedRow[] = [];
  try {
    for (let round = 0; round < REUSE_SPEED_PROTOCOL.rounds; round++) {
      const order = [...REUSE_SPEED_ARMS.slice(round % 3), ...REUSE_SPEED_ARMS.slice(0, round % 3)];
      for (const arm of order) {
        await input.beforeDispatch();
        const start = performance.now();
        const label = `${arm}-${round}`;
        const providerDirectory = join(input.directory, "private-provider", label);
        const audit = createBenchmarkAudit({ directory: providerDirectory, method: arm === "optimized" ? "luna_reparodynamic" : "luna",
          beforeDispatch: input.beforeDispatch, fetchImpl: budget.fetchFor(arm),
          onModelIdentity: async identity => { if (observedIdentity !== null && observedIdentity !== identity) throw new Error("REUSE_SPEED_MODEL_CHANGED"); observedIdentity = identity; } });
        const client = new OpenAIResponsesClient({ apiKey: input.apiKey, fetchImpl: audit.fetch });
        const memory = new DurableCodingRepairMemory(join(input.directory, "private-memory", arm === "regenerate" ? label : arm));
        const evidence: Array<{ kind: string; payload: unknown }> = [];
        let reuse: CodingRepairReuseSummary | undefined, run: CodingRepairRun | undefined;
        let verifies = 0, completed = false, finalDigest: string | null = null, errorCode: string | null = null;
        const record = async (kind: string, payload: unknown) => { evidence.push({ kind, payload: structuredClone(payload) }); await audit.record(kind, payload); };
        const verify = async (candidate: ProgramCandidateProposal, phase: "loop" | "final" | "independent") => {
          candidate = structuredClone(candidate); guard(candidate); await input.beforeDispatch(); verifies++;
          const args = { candidate, objective: context.objective, acceptanceCriteria: context.acceptanceCriteria, constitutionDigest: context.constitutionDigest };
          const checked = redact(await (arm === "optimized" && phase === "loop" ? input.native.verify(args, input.beforeDispatch)
            : verifyGenomeLabProgramCandidate({ ...args, ...(phase !== "independent" ? { experimentalCompilerCache: codingTypecheckHost("canary") } : {}) })));
          if (checked.artifactDigest !== codingRepairCandidateDigest(candidate)) throw new Error("REUSE_SPEED_ARTIFACT_MISMATCH");
          await record("verification", { phase, candidate, verification: checked });
          return checked;
        };
        try {
          const generator = createReusableCodingCandidateGenerator({
            base: { id: "owner-supplied-zero-cost-proposal", external: false, maximumCostUsd: 0, async generate() { return structuredClone(task.baseline); } },
            mode: "canary", memory,
            scope: c => codingRepairMemoryScope(`benchmark:${input.benchmarkId}:${arm}`, c),
            model: c => arm === "optimized" ? createAdaptiveCodingRepairModel({ client, context: c,
              onFormat: decision => record("model_request", { phase: "format_intent_before_dispatch", decision }) })
              : createLunaCodingRepairModel({ client, context: c }),
            verify: c => verify(c, "loop"), verifyFinal: c => verify(c, "final"),
            onReceipt: receipt => record("model_response", { controllerReceipt: receipt }),
            onRun: async value => { run = structuredClone(value); await record("model_response", { run: value }); },
            onReuse: async value => { reuse = structuredClone(value); await record("model_response", { reuse: value }); },
          });
          const candidate = await generator.generate(context) as ProgramCandidateProposal;
          const independent = await verify(candidate, "independent");
          completed = independent.passed && reuse?.finalFreshVerification === true;
          finalDigest = independent.artifactDigest;
          if (!completed) {
            errorCode = "UNVERIFIED_RESULT";
            if (run && reuse?.scopeDigest && reuse.learnedRecipeId) await memory.quarantine(
              codingRepairMemoryKey(run.baseline, run.baselineVerification, reuse.scopeDigest), sha256(errorCode));
            for (const hit of reuse?.reusedRecipes ?? []) await memory.quarantine(hit.key, sha256(errorCode));
          }
        } catch (error) { errorCode = error instanceof Error ? error.name + ":" + sha256(error.message) : "UNKNOWN_FAILURE"; }
        let providerEvidence: Array<{path: string; content: string; sha256: string}> = [];
        try { for (const path of (await readdir(providerDirectory)).sort()) {
          const content = await readFile(join(providerDirectory, path), "utf8");
          providerEvidence.push({ path, content, sha256: sha256(content) });
        } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const payload = { arm, round, completed, errorCode, baselineDigest: codingRepairCandidateDigest(task.baseline),
          finalArtifactDigest: finalDigest, verificationCalls: verifies, reuse: reuse ?? null, run: run ?? null, evidence, providerEvidence,
          elapsedBeforeFinalReceiptMilliseconds: performance.now() - start, budget: budget.snapshot() };
        await writeBenchmarkAudit(join(input.directory,"jobs"), `${label}.json`, payload);
        rows.push({ arm, round, completed, errorCode, elapsedMilliseconds: performance.now() - start,
          modelRequests: reuse?.modelRequests ?? 0, hits: reuse?.hits ?? 0, verificationCalls: verifies,
          finalArtifactDigest: finalDigest, evidenceSha256: sha256(canonicalJson(payload)) });
        if (budget.snapshot().closed) throw new Error("REUSE_SPEED_STOPPED_AFTER_UNCERTAIN_DISPATCH");
      }
    }
  } finally {
    const allComplete = rows.length === REUSE_SPEED_PROTOCOL.rounds * 3 && rows.every(r => r.completed);
    const aggregates = Object.fromEntries(REUSE_SPEED_ARMS.map(arm => {
      const group = rows.filter(r => r.arm === arm), warm = group.filter(r => r.round > 0);
      return [arm, { completed: group.filter(r => r.completed).length, planned: REUSE_SPEED_PROTOCOL.rounds,
        totalMilliseconds: group.reduce((s,r) => s+r.elapsedMilliseconds,0),
        warmMilliseconds: warm.reduce((s,r) => s+r.elapsedMilliseconds,0),
        modelRequests: group.reduce((s,r) => s+r.modelRequests,0), hits: group.reduce((s,r) => s+r.hits,0),
        verificationCalls: group.reduce((s,r) => s+r.verificationCalls,0) }];
    }));
    await writeBenchmarkAudit(trace,"reuse-summary.json", { protocol: REUSE_SPEED_PROTOCOL, executionKind: input.executionKind, rows, aggregates, allComplete,
      totalSuiteMilliseconds: performance.now()-started, accounting: budget.snapshot(), observedModelIdentity: observedIdentity,
      populationConfidence: null, absoluteMaximumEstablished: false,
      comparisonAllowed: allComplete, warmRatios: allComplete ? {
        optimizedVersusRegenerate: aggregates.regenerate.warmMilliseconds / aggregates.optimized.warmMilliseconds,
        optimizedVersusOrdinaryMemory: aggregates.ordinary_memory.warmMilliseconds / aggregates.optimized.warmMilliseconds,
      } : null, learningInclusiveRatios: allComplete ? {
        optimizedVersusRegenerate: aggregates.regenerate.totalMilliseconds / aggregates.optimized.totalMilliseconds,
        optimizedVersusOrdinaryMemory: aggregates.ordinary_memory.totalMilliseconds / aggregates.optimized.totalMilliseconds,
      } : null });
  }
  return rows;
}
