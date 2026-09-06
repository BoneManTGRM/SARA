/** Offline/scripted experiment. No provider requests, simulated latencies, sleeps or old benchmark grants. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { DurableCodingRepairMemory, codingRepairMemoryScope } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator, type CodingRepairReuseSummary } from "../src/reusable-coding-candidate-generator.ts";
import { createReparodynamicCandidateGenerator } from "../src/reparodynamic-candidate-generator.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const root = await mkdtemp(join(tmpdir(), "sara-reuse-proof-"));
const rows: Array<Record<string, unknown>> = [];
let controlCalls = 0, reuseCalls = 0;
const started = performance.now();
try {
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const expected of [17, 38, 59]) {
      const context = { objective: `Return the accepted value ${expected}`, acceptanceCriteria: [`Value is ${expected}`],
        missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
      const baseline: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: `Repeat fixture ${expected}`,
        summary: "Authored deterministic fixture, not a live model task", limitations: [], files: [
          { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
          { path: "src/value.ts", content: `export const value: number = ${expected - 1};\n` },
          { path: "tests/value.test.ts", content: `import { value } from "../src/value.ts";\nif (value !== ${expected}) throw new Error("acceptance failed");\n` }] };
      const outputs: string[] = [];
      for (const arm of (repeat + expected) % 2 ? ["reuse", "control"] : ["control", "reuse"]) {
        let verifications = 0;
        let summary: CodingRepairReuseSummary | undefined;
        const model: CodingRepairModel = { async propose(request) {
          if (arm === "control") controlCalls++; else reuseCalls++;
          return { proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
            failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
            changes: [{ path: "src/value.ts", expectedContentDigest: sha256(request.candidate.files[1].content),
              replacementText: `export const value: number = ${expected};\n` }], limitations: [] },
            inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
        } };
        const verify = async (candidate: ProgramCandidateProposal) => {
          verifications++; return verifyGenomeLabProgramCandidate({ candidate, ...context });
        };
        const common = { base: { id: "scripted-no-provider", external: false, maximumCostUsd: 0, generate: async () => structuredClone(baseline) },
          mode: "canary" as const, model, verify };
        const t = performance.now();
        const generator = arm === "reuse" ? createReusableCodingCandidateGenerator({ ...common,
          memory: new DurableCodingRepairMemory(root), scope: c => codingRepairMemoryScope("proof-owner", c),
          onReuse: s => { summary = s; } }) : createReparodynamicCandidateGenerator({ ...common,
          onRun: async run => { const final = await verify(run.champion); assert(final.passed); assert.equal(final.artifactDigest, run.verification.artifactDigest); } });
        const result = await generator.generate(context);
        const milliseconds = performance.now() - t;
        const artifact = sha256(canonicalJson(result)); outputs.push(artifact);
        assert.equal(verifications, 3);
        if (arm === "reuse") { assert(summary); assert.equal(summary.hits, repeat ? 1 : 0); }
        rows.push({ arm, expected, repeat, milliseconds, verifications, artifact,
          learnedRecipeId: summary?.learnedRecipeId ?? null, hits: summary?.hits ?? 0, modelRequests: summary?.modelRequests ?? 1,
          memoryMilliseconds: summary?.reuseMilliseconds ?? 0 });
        console.error(JSON.stringify({ event: "measurement", ...rows.at(-1) }));
      }
      assert.equal(outputs[0], outputs[1]);
    }
  }
  assert.equal(controlCalls, 15); assert.equal(reuseCalls, 3);
  const total = (arm: string, warm: boolean) => rows.filter(r => r.arm === arm && (!warm || Number(r.repeat) > 0)).reduce((n, r) => n + Number(r.milliseconds), 0);
  console.log(JSON.stringify({ classification: "OFFLINE_SCRIPTED_REPAIR_REUSE_NO_PROVIDER", providerRequests: 0,
    scriptedControlCalls: controlCalls, scriptedReuseCalls: reuseCalls, avoidedScriptedGenerationCalls: controlCalls - reuseCalls,
    freshVerifications: rows.reduce((n, r) => n + Number(r.verifications), 0), tasksPerArm: 15, distinctAuthoredFixtures: 3,
    controlTotalMs: total("control", false), reuseTotalMs: total("reuse", false),
    inclusiveProcessingRatio: total("control", false) / total("reuse", false),
    warmControlMs: total("control", true), warmReuseMs: total("reuse", true),
    elapsedMs: performance.now() - started,
    limitations: ["Identical scripted model source on both sides; no provider latency or invented sleeps.",
      "Cold learning and scope/storage work are included. Both sides perform three fresh verifications.",
      "No end-to-end live speed or framework-specific multiplier is established. Exact-source repetitions only."], rows }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
