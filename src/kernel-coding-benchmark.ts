import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "./canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "./kernel.ts";
import { createSaraServer } from "./server.ts";
import { OpenAIResponsesClient } from "./openai-worker.ts";
import { CodingDispatchJournal, type DispatchCounters } from "./coding-dispatch-journal.ts";
import { NativeCodingVerifier } from "./native-coding-verifier.ts";
import { createBenchmarkAudit, writeBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { createReuseSpeedBudget, REUSE_SPEED_ARMS, type ReuseSpeedArm } from "./reuse-speed-benchmark.ts";
import { currentBenchmarkCase } from "./current-coding-benchmark.ts";
import { codingRepairCandidateDigest } from "./experimental-v5/coding-repair-verification.ts";
import { verifyGenomeLabArtifact } from "./genome-lab.ts";
import { KERNEL_CODING_BENCHMARK_GRANT } from "./coding-benchmark-readiness.ts";
import { KERNEL_BENCHMARK_PINS } from "./kernel-coding-benchmark-pins.ts";
import type { CodingRepairReuseSummary } from "./reusable-coding-candidate-generator.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export const KERNEL_BENCHMARK_PROTOCOL = Object.freeze({
  schemaVersion: 1, arms: REUSE_SPEED_ARMS, rounds: 4, maximumSpendUsd: .15,
  maximumModelSpendUsdPerArm: .05, providerDeadlineMilliseconds: 45_000,
  maximumSuiteDispatchMilliseconds: 400_000, kernelVerificationWorkers: 0,
  classification: "LIVE_CAPABLE_ISOLATED_HTTP_KERNEL_EXACT_REPEAT_NOT_GENERAL_MAXIMUM",
  primaryTiming: "isolated job authorization and local HTTP self-build through response body; includes fresh kernel acceptance event commits",
  secondaryTiming: "same request plus current job evidence write; setup and authorization separately recorded",
  control: "Same provider/model/reasoning/prompts and guards. Regenerate isolates proposal memory per job; ordinary memory uses legacy loop checking; optimized memory uses native loop checking. Every arm uses the same full hardened HTTP/kernel lifecycle.",
  memory: "empty isolated per arm at start; each arm learns its own real provider solution; no preloaded candidate",
  safety: "No PASS reuse, no production mutation promotion, no replay after uncertain dispatch; keep every failed/unrun job",
  excluded: "public network transit, process/module startup, deployment, CI, reconciliation, unfamiliar task generalization and concurrency",
  syntheticFunding: "Isolated lab ledger only; never production revenue or spending authority. Independent suite budget gates every provider request.",
});
export async function assertKernelBenchmarkImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(KERNEL_BENCHMARK_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error(`KERNEL_BENCHMARK_SOURCE_DRIFT:${path}`);
  }
}
export type KernelBenchmarkRow = {
  arm: ReuseSpeedArm; round: number; result: "passed" | "failed" | "unrun";
  elapsedMilliseconds: number | null; httpElapsedMilliseconds: number | null; withEvidenceMilliseconds: number | null;
  dispatch: DispatchCounters | null; hits: number; finalArtifactDigest: string | null;
  kernelCandidateDigest: string | null; errorDigest: string | null; evidenceSha256: string | null;
};
const zeroDispatch = (): DispatchCounters => ({ generationAttempts: 0, tokenCountAttempts: 0, responsesReceived: 0,
  uncertainAttempts: 0, rejectedBeforeNetwork: 0, closed: false });

async function readJsonDirectory(directory: string) {
  const rows: Array<{ path: string; content: string; sha256: string }> = [];
  try {
    const names = (await readdir(directory)).sort();
    if (names.length > 64) throw new Error("KERNEL_BENCHMARK_PRIVATE_EVIDENCE_BOUND");
    for (const name of names) {
      if (!/^[A-Za-z0-9._-]+\.json$/u.test(name)) throw new Error("KERNEL_BENCHMARK_PRIVATE_EVIDENCE_PATH");
      const content = await readFile(join(directory, name), "utf8");
      if (Buffer.byteLength(content) > 1_048_576) throw new Error("KERNEL_BENCHMARK_PRIVATE_EVIDENCE_BOUND");
      rows.push({ path: name, content, sha256: sha256(content) });
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return rows;
}

/** Runs the deployed server and kernel in isolated lab state on the operator host.
 * It does not create customer jobs or grant a model access to production state.
 * Only the CLI owns live authorization. Test injection never supplies real credentials. */
export async function runKernelCodingBenchmark(input: {
  directory: string; benchmarkId: string; apiKey: string;
  executionKind: "live" | "scripted_offline"; beforeDispatch(): Promise<void>; fetchImpl?: typeof fetch;
}) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(input.benchmarkId)) throw new Error("KERNEL_BENCHMARK_ID");
  if ((input.executionKind === "scripted_offline" && !input.fetchImpl) ||
      (input.executionKind === "live" && (input.fetchImpl || input.benchmarkId !== KERNEL_CODING_BENCHMARK_GRANT.benchmarkId))) throw new Error("KERNEL_BENCHMARK_EXECUTION_KIND");
  await assertKernelBenchmarkImplementation();
  await input.beforeDispatch();
  await mkdir(input.directory, { recursive: false, mode: 0o700 });
  const suiteStarted = performance.now();
  const trace = join(input.directory, "trace"), task = currentBenchmarkCase();
  const rows: KernelBenchmarkRow[] = [];
  let currentJournal: CodingDispatchJournal | null = null;
  const authority = async () => {
    if (performance.now() - suiteStarted > KERNEL_BENCHMARK_PROTOCOL.maximumSuiteDispatchMilliseconds) throw new Error("KERNEL_BENCHMARK_SUITE_DEADLINE");
    await input.beforeDispatch();
  };
  const budget = createReuseSpeedBudget({ directory: trace, beforeDispatch: authority,
    fetchImpl: (url, init) => { if (!currentJournal) throw new Error("KERNEL_BENCHMARK_NO_DISPATCH_JOURNAL"); return currentJournal.fetch(url, init); } });
  const states: Partial<Record<ReuseSpeedArm, { kernel: SaraKernel; root: string; token: string }>> = {};
  let observedModel: string | null = null, fatal: unknown = null;
  let setupMilliseconds = 0;
  const native = await NativeCodingVerifier.create();
  if (!native) throw new Error("KERNEL_BENCHMARK_NATIVE_REQUIRED");
  try {
    await writeBenchmarkAudit(trace, "kernel-registration.json", { benchmarkId: input.benchmarkId,
      protocol: KERNEL_BENCHMARK_PROTOCOL, task, taskDigest: sha256(canonicalJson(task)), sourcePins: KERNEL_BENCHMARK_PINS,
      executionKind: input.executionKind, runtime: { node: process.version, platform: process.platform, arch: process.arch } });
    for (const arm of REUSE_SPEED_ARMS) {
      const root = join(input.directory, "private-state", arm), token = randomUUID() + randomUUID();
      const kernel = await SaraKernel.boot({ stateDirectory: root, ownerTokenSha256: sha256(token), selfBuildVerificationWorkers: 0 });
      states[arm] = { kernel, root, token };
      // Explicitly synthetic, separate from production ledger and real provider allowance.
      await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(token), { kind: "revenue", source: "customer",
        amountUsd: 100, realized: true, recurringMonthly: false,
        description: "SYNTHETIC ISOLATED BENCHMARK FUNDING; NOT REAL REVENUE OR PROVIDER AUTHORIZATION", occurredAt: "2026-09-06T00:00:00.000Z" });
    }
    setupMilliseconds = performance.now() - suiteStarted;
    for (let round = 0; round < KERNEL_BENCHMARK_PROTOCOL.rounds; round++) {
      const order = [...REUSE_SPEED_ARMS.slice(round % 3), ...REUSE_SPEED_ARMS.slice(0, round % 3)];
      for (const arm of order) {
        await authority();
        const jobSetupStarted = performance.now();
        const { kernel, root, token } = states[arm]!;
        const label = `${arm}-${round}`;
        const memoryRoot = join(root, "repairs", arm === "regenerate" ? String(round) : "persistent");
        await mkdir(join(memoryRoot, "coding-dispatch"), { recursive: true, mode: 0o700 });
        const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: task.objective,
          acceptanceCriteria: task.acceptanceCriteria, requiredCapabilities: [], expectedOwnerValue: 1, maximumBudgetUsd: .15 });
        const beforeEvents = await kernel.inspectAudit();
        const providerDirectory = join(input.directory, "private-provider", label);
        const providerAudit = createBenchmarkAudit({ directory: providerDirectory,
          method: arm === "optimized" ? "luna_reparodynamic" : "luna", beforeDispatch: authority, fetchImpl: budget.fetchFor(arm),
          onModelIdentity: async identity => { if (observedModel !== null && observedModel !== identity) throw new Error("KERNEL_BENCHMARK_MODEL_DRIFT"); observedModel = identity; } });
        let runId: string | null = null, journal: CodingDispatchJournal | null = null;
        const noFallback = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 45_000,
          countInputTokens: async () => { throw new Error("KERNEL_BENCHMARK_FACTORY_REQUIRED"); },
          execute: async () => { throw new Error("KERNEL_BENCHMARK_FACTORY_REQUIRED"); } };
        const server = createSaraServer(kernel, { ownerTokenSha256: sha256(token), stateDirectory: root,
          reparodynamicCoding: { mode: "canary", modelClient: noFallback, stateDirectory: memoryRoot,
            ...(arm === "optimized" ? { nativeVerifier: native } : {}),
            modelClientForRun: id => {
              if (runId !== null) throw new Error("KERNEL_BENCHMARK_ONE_HTTP_ATTEMPT");
              runId = id;
              journal = new CodingDispatchJournal({ directory: join(memoryRoot, "coding-dispatch", id),
                beforeDispatch: async () => {
                  await authority(); const status = await kernel.getStatus();
                  if (status.emergencyStopped || !status.constitution.verified) throw new Error("KERNEL_BENCHMARK_AUTHORITY_REVOKED");
                }, fetchImpl: input.fetchImpl });
              currentJournal = journal;
              return new OpenAIResponsesClient({ apiKey: input.apiKey, timeoutMs: 45_000, fetchImpl: providerAudit.fetch });
            } } });
        let completed = false, responseBody: unknown = null, status: number | null = null, errorDigest: string | null = null;
        let finalArtifactDigest: string | null = null, kernelCandidateDigest: string | null = null;
        let elapsedMilliseconds = 0, auditMilliseconds = 0;
        let reuse: CodingRepairReuseSummary | null = null;
        let run: { state: string; verifiedComplete: boolean; finalArtifactDigest: string; cycles: number } | null = null;
        let finalCandidate: ProgramCandidateProposal | null = null;
        let kernelManifest: unknown = null, kernelVerification: unknown = null;
        try {
          await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
          const address = server.address() as AddressInfo;
          const jobSetupMilliseconds = performance.now() - jobSetupStarted;
          const started = performance.now();
          try {
            const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs/${job.id}/self-build`, {
              method: "POST", redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ proposal: task.baseline }), signal: AbortSignal.timeout(190_000) });
            const raw = await response.text(); elapsedMilliseconds = performance.now() - started;
            status = response.status; responseBody = JSON.parse(raw);
            if (status !== 201) throw new Error("KERNEL_BENCHMARK_JOB_REJECTED");
            const value = responseBody as Awaited<ReturnType<SaraKernel["runSelfBuildCycle"]>>;
            assert.equal(value.job.id, job.id); assert.equal(value.job.status, "verified");
            assert.equal(value.mutation.stage, "SHADOW"); assert.equal(value.evidence.attestation, "kernel_executed");
            assert(value.timing.totalMilliseconds <= elapsedMilliseconds); assert.equal(value.timing.pooled, false);
            kernelCandidateDigest = value.mutation.candidateDigest;
            if (!runId) throw new Error("KERNEL_BENCHMARK_RUN_ID_MISSING");
            run = JSON.parse(await readFile(join(memoryRoot, "coding-repair-receipts", runId, "run.json"), "utf8"));
            reuse = JSON.parse(await readFile(join(memoryRoot, "coding-repair-receipts", runId, "reuse.json"), "utf8")).summary;
            if (!run || !reuse) throw new Error("KERNEL_BENCHMARK_RECEIPTS_MISSING");
            assert.equal(reuse.finalFreshVerification, true); assert.equal(run.state, "VERIFIED_CANDIDATE");
            finalCandidate = structuredClone(task.baseline);
            for (const file of finalCandidate.files) file.content = await readFile(join(root, value.artifactRelativePath, "project", file.path), "utf8");
            for (const f of task.baseline.files.filter(f => f.path.startsWith("tests/"))) assert.equal(finalCandidate.files.find(c => c.path === f.path)?.content, f.content);
            finalArtifactDigest = codingRepairCandidateDigest(finalCandidate);
            assert.equal(finalArtifactDigest, run.finalArtifactDigest);
            kernelManifest = JSON.parse(await readFile(join(root, value.artifactRelativePath, "manifest.json"), "utf8"));
            kernelVerification = JSON.parse(await readFile(join(root, value.artifactRelativePath, "verification.json"), "utf8"));
            await verifyGenomeLabArtifact(root, value.artifactRelativePath, value.mutation.candidateDigest);
            const after = await kernel.getStatus();
            assert(after.mutations.some(m => m.id === value.mutation.id && m.stage === "SHADOW"));
            assert((await kernel.inspectAudit()).slice(beforeEvents.length).some(e => e.type === "self_build_cycle_completed"));
            await authority();
            completed = true;
          } catch (error) {
            elapsedMilliseconds ||= performance.now() - started;
            errorDigest = sha256(error instanceof Error ? error.name + ":" + error.message : "UNKNOWN");
            fatal = error; // Do not choose a replacement trial for any failed job.
          }
          const evidenceStarted = performance.now();
          const receipts = runId ? await readJsonDirectory(join(memoryRoot, "coding-repair-receipts", runId)) : [];
          const dispatchFiles = runId ? await readJsonDirectory(join(memoryRoot, "coding-dispatch", runId)) : [];
          const providerFiles = await readJsonDirectory(providerDirectory);
          const dispatch = journal ? (journal as CodingDispatchJournal).snapshot() : zeroDispatch();
          const afterEvents = await kernel.inspectAudit();
          const payload = { arm, round, status, completed, jobId: job.id, runId, executionKind: input.executionKind,
            response: responseBody, run, reuse, finalCandidate, kernelManifest, kernelVerification, dispatch, dispatchFiles, receipts, providerFiles,
            jobEvents: afterEvents.slice(beforeEvents.length), finalArtifactDigest, kernelCandidateDigest,
            errorDigest, jobSetupMilliseconds, httpElapsedMilliseconds: elapsedMilliseconds,
            checks: { authoritativeFinalFresh: completed && reuse?.finalFreshVerification === true,
              independentKernelFresh: completed, unchangedProtectedTests: completed }, budget: budget.snapshot() };
          await writeBenchmarkAudit(join(input.directory, "jobs"), `${label}.json`, payload);
          auditMilliseconds = performance.now() - evidenceStarted;
          rows.push({ arm, round, result: completed ? "passed" : "failed", elapsedMilliseconds: jobSetupMilliseconds + elapsedMilliseconds,
            httpElapsedMilliseconds: elapsedMilliseconds, withEvidenceMilliseconds: performance.now() - jobSetupStarted, dispatch, hits: reuse?.hits ?? 0,
            finalArtifactDigest, kernelCandidateDigest, errorDigest, evidenceSha256: sha256(canonicalJson(payload)) });
        } finally {
          // Await any still-running local handler/verification; never abandon it then retry.
          await new Promise<void>(resolve => server.close(() => resolve())); currentJournal = null;
        }
        if (fatal || budget.snapshot().closed) throw fatal ?? new Error("KERNEL_BENCHMARK_UNCERTAIN_DISPATCH");
      }
    }
  } catch (error) { fatal ??= error; }
  finally {
    for (const state of Object.values(states)) await state.kernel.closeVerificationWorkers();
    for (let round = 0; round < KERNEL_BENCHMARK_PROTOCOL.rounds; round++) for (const arm of REUSE_SPEED_ARMS) {
      if (!rows.some(row => row.arm === arm && row.round === round)) rows.push({ arm, round, result: "unrun",
        elapsedMilliseconds: null, httpElapsedMilliseconds: null, withEvidenceMilliseconds: null, dispatch: null, hits: 0,
        finalArtifactDigest: null, kernelCandidateDigest: null, errorDigest: null, evidenceSha256: null });
    }
    const aggregates = Object.fromEntries(REUSE_SPEED_ARMS.map(arm => {
      const group = rows.filter(r => r.arm === arm), warm = group.filter(r => r.round > 0);
      return [arm, { completed: group.filter(r => r.result === "passed").length, attempted: group.filter(r => r.result !== "unrun").length,
        planned: KERNEL_BENCHMARK_PROTOCOL.rounds, totalMilliseconds: group.reduce((n,r) => n + (r.elapsedMilliseconds ?? 0),0),
        warmMilliseconds: warm.reduce((n,r) => n+(r.elapsedMilliseconds ?? 0),0),
        generationAttempts: group.reduce((n,r) => n+(r.dispatch?.generationAttempts ?? 0),0),
        tokenCountAttempts: group.reduce((n,r) => n+(r.dispatch?.tokenCountAttempts ?? 0),0),
        uncertainAttempts: group.reduce((n,r) => n+(r.dispatch?.uncertainAttempts ?? 0),0), hits: group.reduce((n,r) => n+r.hits,0) }];
    }));
    const allComplete = rows.length === 12 && rows.every(r => r.result === "passed");
    const summary = { protocol: KERNEL_BENCHMARK_PROTOCOL, benchmarkId: input.benchmarkId, executionKind: input.executionKind,
      rows, aggregates, allComplete, comparisonAllowed: allComplete, sourcePins: KERNEL_BENCHMARK_PINS,
      setupMilliseconds, totalSuiteMilliseconds: performance.now() - suiteStarted,
      fatalDigest: fatal ? sha256(fatal instanceof Error ? fatal.name + ":" + fatal.message : "UNKNOWN") : null,
      accounting: budget.snapshot(), observedModelIdentity: observedModel, absoluteMaximumEstablished: false,
      warmRatios: allComplete ? { optimizedVersusRegenerate: aggregates.regenerate.warmMilliseconds / aggregates.optimized.warmMilliseconds,
        optimizedVersusOrdinaryMemory: aggregates.ordinary_memory.warmMilliseconds / aggregates.optimized.warmMilliseconds } : null,
      learningInclusiveRatios: allComplete ? { optimizedVersusRegenerate: aggregates.regenerate.totalMilliseconds / aggregates.optimized.totalMilliseconds,
        optimizedVersusOrdinaryMemory: aggregates.ordinary_memory.totalMilliseconds / aggregates.optimized.totalMilliseconds } : null };
    await writeBenchmarkAudit(trace, "kernel-summary.json", summary);
  }
  if (fatal) throw new Error("KERNEL_BENCHMARK_INCOMPLETE_NO_REPLAY");
  return rows;
}
