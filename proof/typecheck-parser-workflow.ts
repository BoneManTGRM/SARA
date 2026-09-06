/** Offline matched full-workflow measurement. Scripted generation, no provider calls or delays. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { DurableCodingRepairMemory, codingRepairMemoryScope } from "../src/coding-repair-memory.ts";
import { createReusableCodingCandidateGenerator, type CodingRepairReuseSummary } from "../src/reusable-coding-candidate-generator.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { verifyCanaryProgramCandidate } from "../src/verification-typecheck-host.ts";
import type { CodingRepairRun } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const baselineRoot = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: <baseline checkout> <new output directory>");
for (const name of ["OPENAI_API_KEY", "SARA_OWNER_TOKEN", "ANTHROPIC_API_KEY"]) assert(!process.env[name], "credential-free only");
await mkdir(output, { recursive: false });
const baseline = {
  memory: await import(pathToFileURL(join(baselineRoot, "src/coding-repair-memory.ts")).href) as typeof import("../src/coding-repair-memory.ts"),
  generator: await import(pathToFileURL(join(baselineRoot, "src/reusable-coding-candidate-generator.ts")).href) as typeof import("../src/reusable-coding-candidate-generator.ts"),
  verifier: await import(pathToFileURL(join(baselineRoot, "src/genome-lab-verifier.ts")).href) as typeof import("../src/genome-lab-verifier.ts"),
};

function fixture(name: string, before: string, after: string, tests: string) {
  const make = (source: string): ProgramCandidateProposal => ({ schemaVersion: 1, candidateKind: "typescript_program",
    programName: name, summary: "Authored offline fixture with a supplied repair, not an autonomous task", limitations: [],
    files: [{ path: "src/index.ts", content: 'export * from "./task.ts";\n' }, { path: "src/task.ts", content: source },
      { path: "tests/task.test.ts", content: tests }] });
  return { name, before: make(before), after: make(after) };
}
const sum = '/** Sum all values without changing the input. */\nexport function sum(values: readonly number[]): number {\n  return values.reduce((total, value) => total + value, 0);\n}\n';
const intervals = '/** Merge overlapping and touching half-open intervals. */\nexport type Interval = { start: number; end: number };\nexport function merge(values: readonly Interval[]): Interval[] {\n  const sorted = values.map(v => ({...v})).sort((a,b) => a.start-b.start);\n  const result: Interval[] = [];\n  for (const value of sorted) {\n    const last = result.at(-1);\n    if (!last || value.start > last.end) result.push(value);\n    else last.end = Math.max(last.end, value.end);\n  }\n  return result;\n}\n';
const priority = '/** Lowest priority first; equal priorities preserve input order. */\nexport function takeNext(items: readonly {name:string;priority:number}[]): string {\n  return [...items].sort((a,b) => a.priority-b.priority).at(0)?.name ?? "";\n}\n';
const fixtures = [
  fixture("Sum values", sum.replace('value, 0)', 'value, 1)'), sum,
    'import {sum} from "../src/task.ts";\nif (sum([])!==0 || sum([1,-4,9])!==6) throw new Error("sum acceptance");\n'),
  fixture("Merge intervals", intervals.replace('value.start > last.end', 'value.start >= last.end'), intervals,
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport {merge} from "../src/task.ts";\ntest("intervals", () => {\nassert.deepEqual(merge([{start:4,end:9},{start:1,end:4},{start:15,end:17}]),[{start:1,end:9},{start:15,end:17}]);\nassert.deepEqual(merge([]),[]);\n});\n'),
  fixture("Select priority", priority.replace('a.priority-b.priority', 'b.priority-a.priority'), priority,
    'import {takeNext} from "../src/task.ts";\nif (takeNext([])!=="" || takeNext([{name:"a",priority:2},{name:"b",priority:1}])!=="b" || takeNext([{name:"a",priority:1},{name:"b",priority:1}])!=="a") throw new Error("priority acceptance");\n'),
];
const protocol = { classification: "OFFLINE_SCRIPTED_TYPECHECK_PARSER_WORKFLOW", fixtures: fixtures.map(f => ({
  name: f.name, before: f.before, after: f.after })), rounds: 4, jobsPerArm: 12, expectedGenerationCallsPerArm: 3,
  expectedFreshVerifierCallsPerArm: 48, baselineRoot, node: process.version,
  arms: "Base uses unchanged default parser for all four checks. Candidate uses the type-error parser for three canary checks; its fourth independent post-return check uses the unchanged default verifier.",
  timing: "Each job includes scope hashing, memory I/O, initial and repaired verification, extra final verification, required receipts, and the independent post-return verification. Paired order alternates; first cold samples retained.",
  limitations: "Three authored programs with prewritten one-line repairs. No provider delay or model inference. Post-return check is a diagnostic, not a live kernel. No live/general/35x or unique Reparodynamics claim." };
await writeFile(join(output, "protocol.json"), JSON.stringify(protocol, null, 2), { mode: 0o600 });
const root = await mkdtemp(join(tmpdir(), "sara-parser-workflow-"));
const rows: Array<{ round: number; fixture: string; arm: string; milliseconds: number; modelCalls: number; hits: number; checks: number; digest: string }> = [];
try {
  for (let round = 0; round < 4; round++) for (const [index, f] of fixtures.entries()) {
    const digests: string[] = [];
    for (const arm of (round * 3 + index) % 2 ? ["candidate", "base"] : ["base", "candidate"]) {
      const context = { objective: f.name, acceptanceCriteria: ["Unchanged fixture assertions pass"], missingCapabilities: [],
        constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
      let modelCalls = 0, checks = 0, summary: CodingRepairReuseSummary | undefined, run: CodingRepairRun | undefined;
      const prefix = `${round}-${index}-${arm}`;
      const started = performance.now();
      const scope = await (arm === "base" ? baseline.memory.codingRepairMemoryScope : codingRepairMemoryScope)("offline-parser-owner", context);
      const Memory = arm === "base" ? baseline.memory.DurableCodingRepairMemory : DurableCodingRepairMemory;
      const memory = new Memory(join(root, arm, String(index)));
      const create = arm === "base" ? baseline.generator.createReusableCodingCandidateGenerator : createReusableCodingCandidateGenerator;
      const verifier = arm === "base" ? baseline.verifier.verifyGenomeLabProgramCandidate : verifyCanaryProgramCandidate;
      const generator = create({ mode: "canary", memory, scope: async () => scope,
        base: { id: "offline-supplied-repair", external: false, maximumCostUsd: 0, generate: async () => structuredClone(f.before) },
        verify: async c => { checks++; return verifier({ candidate: c, ...context }); },
        model: { async propose(request) {
          modelCalls++;
          return { proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
            failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
            changes: [{ path: "src/task.ts", expectedContentDigest: sha256(request.candidate.files[1].content), replacementText: f.after.files[1].content }], limitations: [] },
            inputTokens: 0, outputTokens: 0, accountedCostUsd: 0 };
        } },
        onRun: async value => { run = value; await writeFile(join(output, `${prefix}-run.json`), JSON.stringify(value), { mode: 0o600 }); },
        onReuse: async value => { summary = value; await writeFile(join(output, `${prefix}-reuse.json`), JSON.stringify(value), { mode: 0o600 }); },
      });
      const result = await generator.generate(context);
      checks++;
      const final = await verifyGenomeLabProgramCandidate({ candidate: result as ProgramCandidateProposal, ...context });
      const milliseconds = performance.now() - started;
      assert(final.passed); assert.equal(run?.state, "VERIFIED_CANDIDATE"); assert.equal(checks, 4);
      assert.equal(modelCalls, round === 0 ? 1 : 0); assert.equal(summary?.hits, round === 0 ? 0 : 1);
      assert.equal(canonicalJson((result as ProgramCandidateProposal).files), canonicalJson(f.after.files));
      digests.push(final.artifactDigest);
      rows.push({ round, fixture: f.name, arm, milliseconds, modelCalls, hits: summary!.hits, checks, digest: final.artifactDigest });
      await writeFile(join(output, `${prefix}-final.json`), JSON.stringify(final), { mode: 0o600 });
    }
    assert.equal(digests[0], digests[1]);
    await writeFile(join(output, "partial.json"), JSON.stringify(rows, null, 2));
  }
  const totals = Object.fromEntries(["base", "candidate"].map(arm => {
    const values = rows.filter(r => r.arm === arm);
    return [arm, { jobs: values.length, milliseconds: values.reduce((n,r) => n+r.milliseconds,0),
      warmMilliseconds: values.filter(r=>r.round>0).reduce((n,r)=>n+r.milliseconds,0),
      modelCalls: values.reduce((n,r)=>n+r.modelCalls,0), hits: values.reduce((n,r)=>n+r.hits,0), checks: values.reduce((n,r)=>n+r.checks,0) }];
  }));
  for (const value of Object.values(totals)) { assert.equal(value.jobs, 12); assert.equal(value.modelCalls, 3); assert.equal(value.checks, 48); }
  const result = { classification: protocol.classification, completed: true, totals, rows,
    observedRatio: totals.base.milliseconds / totals.candidate.milliseconds,
    observedWarmRatio: totals.base.warmMilliseconds / totals.candidate.warmMilliseconds, limitations: protocol.limitations };
  await writeFile(join(output, "result.json"), JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
} finally { await rm(root, { recursive: true, force: true }); }
