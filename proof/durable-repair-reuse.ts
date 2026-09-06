/** Credential-free component/workflow proof, NOT an autonomous coding benchmark.
 * No simulated provider latency, canned live receipts, or cached verifier PASS.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { createReparodynamicCandidateGenerator } from "../src/reparodynamic-candidate-generator.ts";
import { DurableRepairReuseStore, RepairReuseSession, repairReuseScope, persistRepairReuseEvents } from "../src/coding-repair-reuse.ts";
import { persistCodingRepairReceipt, persistCodingRepairRun } from "../src/coding-repair-receipt-store.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { CodingRepairProposal } from "../src/coding-repair-types.ts";

if (["OPENAI_API_KEY", "SARA_OWNER_TOKEN", "RAILWAY_ENVIRONMENT_ID"].some(k => process.env[k])) throw new Error("Proof requires a credential-free, nonproduction environment.");
const output = process.env.SARA_REUSE_PROOF_OUTPUT ?? await mkdtemp(join(tmpdir(), "sara-reuse-proof-"));
if (process.env.SARA_REUSE_PROOF_OUTPUT) await mkdir(output, { recursive: false, mode: 0o700 });
const arms = ["fresh_scripted_generation", "ordinary_memory", "durable_verified_reuse"] as const;
type Arm = typeof arms[number];
const ordinary = new Map<string, CodingRepairProposal["changes"]>();
const rows: Array<{ arm: Arm; round: number; fixture: number; elapsedMilliseconds: number; modelStubCalls: number; memoryHits: number; verificationCalls: number; artifactDigest: string }> = [];
const targetDigests = new Map<number, string>();
function fixture(target: number): ProgramCandidateProposal {
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: `Fixture ${target}`, summary: "Exact repeated fixture", limitations: [], files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: `export const value: number = ${target - 1};\n` },
    { path: "tests/value.test.ts", content: `import { value } from "../src/value.ts";\nif (value !== ${target}) throw new Error("acceptance mismatch");\n` },
  ] };
}
for (let round = 0; round < 3; round++) {
  for (const [index, target] of [7, 42, 99].entries()) {
    // Rotate execution order to avoid always timing the treatment last.
    const offset = (round + index) % arms.length;
    for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
      const begin = performance.now(); let calls = 0, hits = 0, checks = 0;
      const root = join(output, arm), runId = randomUUID(), baseline = fixture(target);
      const context = { objective: `Return ${target}`, acceptanceCriteria: [`Return exactly ${target}`], missingCapabilities: [],
        constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
      const scope = await repairReuseScope(context, "scripted-fixture");
      const key = sha256(canonicalJson({ baseline, scope }));
      const verify = async (candidate: ProgramCandidateProposal) => { checks++; return verifyGenomeLabProgramCandidate({ candidate, ...context }); };
      const model: CodingRepairModel = { async propose(request) {
        const cached = arm === "ordinary_memory" ? ordinary.get(key) : undefined;
        if (cached) hits++; else calls++;
        return { proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
          failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
          changes: cached ? structuredClone(cached) : [{ path: "src/value.ts", expectedContentDigest: sha256(request.candidate.files[1].content), replacementText: `export const value: number = ${target};\n` }], limitations: [] },
          inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
      } };
      const recorder = persistRepairReuseEvents(root, runId);
      const generator = createReparodynamicCandidateGenerator({ base: { id: "scripted-fixture", external: false, maximumCostUsd: 0, generate: async () => structuredClone(baseline) },
        mode: "canary", model, verify,
        ...(arm === "durable_verified_reuse" ? { reuse: async () => new RepairReuseSession(new DurableRepairReuseStore(root), scope, verify, async event => {
          if (event.event === "recipe_hit") hits++; await recorder(event);
        }) } : {}),
        onReceipt: receipt => persistCodingRepairReceipt({ stateDirectory: root, runId, receipt }),
        onRun: async run => {
          // Give BOTH controls the same fresh final-verification obligation.
          if (arm !== "durable_verified_reuse") assert((await verify(run.champion)).passed);
          await persistCodingRepairRun({ stateDirectory: root, runId, run });
          if (arm === "ordinary_memory") ordinary.set(key, [{ path: "src/value.ts", expectedContentDigest: sha256(baseline.files[1].content), replacementText: run.champion.files[1].content }]);
        },
      });
      const champion = await generator.generate(context) as ProgramCandidateProposal;
      const final = await verify(champion); // Additional fresh kernel-boundary equivalent; HTTP test executes the real kernel.
      assert(final.passed); assert.equal(checks, 4);
      if (targetDigests.has(target)) assert.equal(final.artifactDigest, targetDigests.get(target));
      else targetDigests.set(target, final.artifactDigest);
      rows.push({ arm, round, fixture: target, elapsedMilliseconds: performance.now() - begin,
        modelStubCalls: calls, memoryHits: hits, verificationCalls: checks, artifactDigest: final.artifactDigest });
      await writeFile(join(output, "partial-results.json"), JSON.stringify(rows, null, 2));
    }
  }
}
const totals = arms.map(arm => {
  const subset = rows.filter(row => row.arm === arm);
  return { arm, verifiedJobs: subset.length, modelStubCalls: subset.reduce((n, r) => n + r.modelStubCalls, 0), memoryHits: subset.reduce((n, r) => n + r.memoryHits, 0),
    verificationCalls: subset.reduce((n, r) => n + r.verificationCalls, 0), totalMillisecondsIncludingLearning: subset.reduce((n, r) => n + r.elapsedMilliseconds, 0),
    coldMilliseconds: subset.filter(r => r.round === 0).reduce((n, r) => n + r.elapsedMilliseconds, 0),
    warmMilliseconds: subset.filter(r => r.round > 0).reduce((n, r) => n + r.elapsedMilliseconds, 0) };
});
assert.deepEqual(totals.map(t => t.modelStubCalls), [9, 3, 3]);
assert.deepEqual(totals.map(t => t.memoryHits), [0, 6, 6]);
const result = { classification: "OFFLINE_SCRIPTED_WORKFLOW_NOT_LIVE_MODEL_SPEED", realProviderCalls: 0, simulatedLatencyMilliseconds: 0,
  fixtureCount: 3, repeatRounds: 3, totals, rows,
  limitations: ["Three authored fixtures, not novel model-solved tasks.", "No inference latency is included or simulated.", "Ordinary memory avoids the same six model-stub calls.",
    "All learning, cache I/O, failures (if any), and four fresh verifications per job are inside timings.", "No general speedup or 35x claim; the paired HTTP test separately verifies the actual owner/kernel route."] };
await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ output, classification: result.classification, totals }, null, 2));
