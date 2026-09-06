/** Scripted cold-wave diagnostic. No provider or injected inference latency. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { DurableCodingRepairMemory } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator } from "../src/reusable-coding-candidate-generator.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { candidate } from "../tests/helpers/repair-memory-fixture.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
const controlRoot = resolve(process.env.SARA_CONTROL_ROOT ?? "");
const out = resolve(process.env.SARA_COLD_EVIDENCE_DIRECTORY ?? "cold-learning-evidence");
assert.equal(sha256(await readFile(join(controlRoot, "src/reusable-coding-candidate-generator.ts"), "utf8")), "2339126843d98cc1b1e6bdf43c671333afe6e3fe57cabe0e2f4d685c63e615d2");
const control = await import(pathToFileURL(join(controlRoot, "src/reusable-coding-candidate-generator.ts")).href);
const controlMemory = await import(pathToFileURL(join(controlRoot, "src/coding-repair-memory.ts")).href);
await mkdir(out); // Never inherit previous learning.
const rows: Array<{ arm: string; expected: number; completed: number; calls: number; hits: number; waits: number; checks: number; elapsedMs: number; artifacts: string[] }> = [];
for (const expected of [17, 38, 59]) {
  for (const arm of expected === 38 ? ["candidate", "control"] : ["control", "candidate"]) {
    const start = performance.now(), root = join(out, `${arm}-${expected}`); await mkdir(root);
    const context = { objective: `Return ${expected}`, acceptanceCriteria: [`Value is ${expected}`], missingCapabilities: [],
      constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
    const baseline = candidate(); baseline.programName = `Authored fixture ${expected}`;
    baseline.files[1].content = `export const value: number = ${expected - 1};\n`;
    baseline.files[2].content = `import { value } from "../src/value.ts";\nif (value !== ${expected}) throw new Error("protected acceptance");\n`;
    let reads = 0, calls = 0, checks = 0, hits = 0, waits = 0;
    let release!: () => void; const allColdReads = new Promise<void>(r => { release = r; });
    const Memory = (arm === "control" ? controlMemory.DurableCodingRepairMemory : DurableCodingRepairMemory) as typeof DurableCodingRepairMemory;
    class ColdMemory extends Memory {
      first = true;
      override async lookup(...args: Parameters<DurableCodingRepairMemory["lookup"]>) {
        const first = this.first; this.first = false;
        const found = await super.lookup(...args);
        if (first) { if (++reads === 4) release(); await allColdReads; }
        return found;
      }
    }
    const model: CodingRepairModel = { async propose(r) {
      calls++;
      return { proposal: { schemaVersion: 1, baseArtifactDigest: r.verification.artifactDigest,
        failureFingerprint: r.verification.failures[0].fingerprint, strategy: r.strategy,
        changes: [{ path: "src/value.ts", expectedContentDigest: sha256(r.candidate.files[1].content),
          replacementText: `export const value: number = ${expected};\n` }], limitations: [] },
        inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
    } };
    const make = (arm === "control" ? control.createReusableCodingCandidateGenerator : createReusableCodingCandidateGenerator) as typeof createReusableCodingCandidateGenerator;
    const results = await Promise.all(Array.from({ length: 4 }, (_, job) => make({
      base: { id: "same-scripted-generator", external: false, maximumCostUsd: 0, generate: async () => structuredClone(baseline) },
      mode: "canary", model, memory: new ColdMemory(root), scope: async () => sha256(canonicalJson(context)),
      verify: async c => { checks++; return verifyGenomeLabProgramCandidate({ candidate: c, ...context }); },
      onRun: async run => { await writeFile(join(root, `job-${job}-run.json`), canonicalJson(run), { flag: "wx" }); },
      onReuse: async summary => { hits += summary.hits; waits += summary.coalescedWaits ?? 0;
        await writeFile(join(root, `job-${job}-reuse.json`), canonicalJson(summary), { flag: "wx" }); },
    }).generate(context)));
    const elapsedMs = performance.now() - start, artifacts = results.map(c => sha256(canonicalJson(c)));
    assert.equal(checks, 12); assert.equal(new Set(artifacts).size, 1);
    assert.equal(calls, arm === "control" ? 4 : 1); assert.equal(hits, arm === "control" ? 0 : 3);
    if (arm === "candidate") assert.equal(waits, 3);
    rows.push({ arm, expected, completed: results.length, calls, hits, waits, checks, elapsedMs, artifacts });
    console.error(JSON.stringify(rows.at(-1)));
  }
  const pair = rows.slice(-2); assert.deepEqual(pair[0].artifacts, pair[1].artifacts);
}
await writeFile(join(out, "results.json"), JSON.stringify({ classification: "OFFLINE_SCRIPTED_COLD_WAVES_NOT_LIVE_SPEED",
  providerCalls: 0, authoredFixtures: 3, jobsPerArm: 12, rows,
  limitations: ["Same instantaneous scripted repair in both arms; no simulated provider latency.",
    "Barriers synchronize empty-memory reads and are included in elapsed time.",
    "Same fresh verifier in both arms; unchanged between releases. No PASS is shared.",
    "Three closely related authored constant-value fixtures, not novel autonomous tasks.",
    "Not a live-model speed or 35x claim; not framework-specific. Kernel HTTP check is separate."] }, null, 2), { flag: "wx" });
