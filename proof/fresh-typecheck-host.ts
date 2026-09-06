/** Offline matched verification/repair measurement. No provider calls or injected delay. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "../src/types.ts";
import type { CodingRepairRun, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { CodingRepairReuseSummary } from "../src/reusable-coding-candidate-generator.ts";
import { createReusableCodingCandidateGenerator } from "../src/reusable-coding-candidate-generator.ts";
import { DurableCodingRepairMemory, codingRepairMemoryScope } from "../src/coding-repair-memory.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { codingTypecheckHost } from "../src/fresh-typecheck-host.ts";

const beforeRoot = resolve(process.argv[2] ?? ""), output = resolve(process.argv[3] ?? ""), stage = process.argv[4];
assert(process.argv[2] && process.argv[3] && (stage === "controls" || stage === "workflow"), "Pass base directory, NEW output directory, and controls|workflow");
for (const k of ["OPENAI_API_KEY", "SARA_OWNER_TOKEN", "ANTHROPIC_API_KEY"]) assert(!process.env[k], "Credential-free proof required");
const beforeVerifier = await import(pathToFileURL(join(beforeRoot, "src/genome-lab-verifier.ts")).href) as typeof import("../src/genome-lab-verifier.ts");
const beforeWrapper = await import(pathToFileURL(join(beforeRoot, "src/reusable-coding-candidate-generator.ts")).href) as typeof import("../src/reusable-coding-candidate-generator.ts");
const beforeMemory = await import(pathToFileURL(join(beforeRoot, "src/coding-repair-memory.ts")).href) as typeof import("../src/coding-repair-memory.ts");
const contexts: Parameters<CandidateGenerator["generate"]>[0][] = [];
function fixture(name: string, good: string, bad: string, tests: string, requirement: string) {
  contexts.push({ objective: requirement, acceptanceCriteria: [requirement], missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: {contextDigest: "b".repeat(64), memories: []} });
  const make = (code: string): ProgramCandidateProposal => ({schemaVersion: 1, candidateKind: "typescript_program", programName: name, summary: requirement, limitations: [], files: [
    {path: "src/index.ts", content: 'export { solve } from "./solve.ts";\n'}, {path: "src/solve.ts", content: code}, {path: "tests/solve.test.ts", content: tests}]});
  return {name, good: make(good), bad: make(bad), typeError: make(good + '\nexport const invalid: number = "bad";\n')};
}
const fixtures = [
  fixture("Positive totals", '/** Sum the finite positive inputs. */\nexport function solve(values: readonly number[]): number {\n  let total = 0;\n  for (const value of values) if (Number.isFinite(value) && value > 0) total += value;\n  return total;\n}\n',
    'export function solve(values: readonly number[]): number {\n  let total = 0;\n  for (const value of values) if (Number.isFinite(value) && value > 0) total += value;\n  return total + 1;\n}\n',
    'import assert from "node:assert/strict";\nimport { solve } from "../src/solve.ts";\nassert.equal(solve([]), 0);\nassert.equal(solve([1,-4,3,0,2.5,Infinity]), 6.5);\nassert.equal(solve([-1,NaN]), 0);\n', "Sum only finite positive numbers without mutating input"),
  fixture("Unique words", '/** Trim, remove empty strings, deduplicate and sort. */\nexport function solve(words: readonly string[]): string[] {\n  return [...new Set(words.map(w => w.trim()).filter(w => w.length > 0))].sort();\n}\n',
    'export function solve(words: readonly string[]): string[] {\n  return words.map(w => w.trim()).sort();\n}\n',
    'import assert from "node:assert/strict";\nimport { solve } from "../src/solve.ts";\nconst words = [" beta ", "alpha", "", "alpha"];\nassert.deepEqual(solve(words), ["alpha", "beta"]);\nassert.deepEqual(solve([]), []);\nassert.deepEqual(words, [" beta ", "alpha", "", "alpha"]);\n', "Return trimmed sorted unique nonempty words without mutating input"),
  fixture("Balanced parentheses", '/** Count nesting, ignore non-parentheses, reject premature closing. */\nexport function solve(text: string): boolean {\n  let depth = 0;\n  for (const char of text) {\n    if (char === "(") depth++;\n    if (char === ")" && --depth < 0) return false;\n  }\n  return depth === 0;\n}\n',
    'export function solve(text: string): boolean {\n  let depth = 0;\n  for (const char of text) {\n    if (char === "(") depth++;\n    if (char === ")" && --depth < 0) return false;\n  }\n  return true;\n}\n',
    'import assert from "node:assert/strict";\nimport { solve } from "../src/solve.ts";\nassert.equal(solve("(a(b)c)"), true);\nassert.equal(solve("("), false);\nassert.equal(solve(")("), false);\nassert.equal(solve("no parentheses"), true);\n', "Check balanced parentheses with no premature closing")
];
await mkdir(output, {recursive: false});
const protocol = {classification: "OFFLINE_SCRIPTED_FRESH_TYPECHECK_HOST", stage, authoredFixtures: fixtures.map(f => ({name:f.name,good:sha256(canonicalJson(f.good)),bad:sha256(canonicalJson(f.bad))})),
  providerRequests: 0, injectedDelay: false, node: process.version,
  description: "All source guards, fresh Program/checker, behavioral executions and output verification remain. Only canary host documentation parsing differs. Fourth workflow verifier is unoptimized independent post-return diagnostic, not a kernel execution. Existing local HTTP/kernel test separately covers the actual route.",
  limitations: "Three small authored fixtures, scripted generation, one host. Timings are not live inference or general coding/35x evidence. Include all paired trials, cold and warm, no timing-based selection."};
await writeFile(join(output, "protocol.json"), JSON.stringify(protocol, null, 2));
const rows: Record<string, unknown>[] = [];
const temporary = await mkdtemp(join(tmpdir(), "sara-fresh-typecheck-proof-"));
try {
  if (stage === "controls") {
    for(let round=0;round<3;round++) for(let f=0;f<fixtures.length;f++) for(const state of ["good", "bad", "typeError"] as const) {
      const results: ProgramVerificationResult[] = [];
      for(const arm of (round+f)%2 ? ["candidate","base"] : ["base","candidate"]) {
        const start = performance.now(), c = structuredClone(fixtures[f][state]);
        const result = arm === "base" ? await beforeVerifier.verifyGenomeLabProgramCandidate({candidate:c,...contexts[f]})
          : await verifyGenomeLabProgramCandidate({candidate:c,...contexts[f],experimentalCompilerCache:codingTypecheckHost("canary")});
        const ms=performance.now()-start;results.push(result); assert.equal(result.passed,state === "good");
        rows.push({round,fixture:fixtures[f].name,state,arm,milliseconds:ms,result});
      }
      assert.deepEqual(results[0],results[1]);
      await writeFile(join(output,"partial.json"),JSON.stringify({completed:false,rows},null,2));
    }
  } else {
    for(let job=0;job<4;job++) for(let f=0;f<fixtures.length;f++) {
      const results: ProgramVerificationResult[]=[];
      for(const arm of (job+f)%2 ? ["candidate","base"] : ["base","candidate"]) {
        const dir=join(temporary,`${arm}-${f}`), before=fixtures[f].bad, expected=fixtures[f].good, context=contexts[f];
        let checks=0,calls=0,run:CodingRepairRun|undefined,summary:CodingRepairReuseSummary|undefined;
        const start=performance.now();
        const memory=arm === "base" ? new beforeMemory.DurableCodingRepairMemory(dir) : new DurableCodingRepairMemory(dir);
        const scope=await (arm === "base" ? beforeMemory.codingRepairMemoryScope : codingRepairMemoryScope)("offline-matched-owner",context);
        const verify=async (candidate:ProgramCandidateProposal)=>{checks++; return arm === "base"
          ? beforeVerifier.verifyGenomeLabProgramCandidate({candidate,...context})
          : verifyGenomeLabProgramCandidate({candidate,...context,experimentalCompilerCache:codingTypecheckHost("canary")});};
        const generate=arm === "base" ? beforeWrapper.createReusableCodingCandidateGenerator : createReusableCodingCandidateGenerator;
        const generator=generate({base:{id:"instantaneous-scripted-fixture",external:false,maximumCostUsd:0,generate:async()=>structuredClone(before)},
          mode:"canary",memory,scope:async()=>scope,verify,model:{async propose(request){calls++;assert.equal(job,0);
            return {proposal:{schemaVersion:1,baseArtifactDigest:request.verification.artifactDigest,failureFingerprint:request.verification.failures[0].fingerprint,
              strategy:request.strategy,changes:[{path:"src/solve.ts",expectedContentDigest:sha256(before.files[1].content),replacementText:expected.files[1].content}],limitations:[]},inputTokens:0,outputTokens:0,accountedCostUsd:0};}},
          onRun:async r=>{run=structuredClone(r);await writeFile(join(output,`${arm}-${f}-${job}-run.json`),JSON.stringify(r,null,2));},
          onReuse:async s=>{summary=structuredClone(s);await writeFile(join(output,`${arm}-${f}-${job}-reuse.json`),JSON.stringify(s,null,2));}});
        const proposal=await generator.generate(context);
        // Keep the independent final diagnostic on the unchanged default verifier,
        // just as the production kernel remains unoptimized and authoritative.
        const final=await verifyGenomeLabProgramCandidate({candidate:proposal as ProgramCandidateProposal,...context});checks++;
        const ms=performance.now()-start;
        assert(final.passed);assert.equal(checks,4);assert.equal(calls,job===0?1:0);assert.equal(run?.state,"VERIFIED_CANDIDATE");
        assert.equal(summary?.hits,job===0?0:1);assert.equal(canonicalJson((proposal as ProgramCandidateProposal).files),canonicalJson(expected.files));
        results.push(final);rows.push({arm,fixture:fixtures[f].name,job,milliseconds:ms,checks,calls,hits:summary!.hits,result:final});
      }
      assert.deepEqual(results[0],results[1]);await writeFile(join(output,"partial.json"),JSON.stringify({completed:false,rows},null,2));
    }
  }
  const totals=Object.fromEntries(["base","candidate"].map(arm=>[arm,rows.filter(r=>r.arm===arm).reduce<{milliseconds:number;checks:number;calls:number;rows:number}>((t,r)=>({milliseconds:t.milliseconds+Number(r.milliseconds),checks:t.checks+Number(r.checks??1),calls:t.calls+Number(r.calls??0),rows:t.rows+1}),{milliseconds:0,checks:0,calls:0,rows:0})]));
  const warm=stage === "workflow" ? Object.fromEntries(["base","candidate"].map(arm=>[arm,rows.filter(r=>r.arm===arm && Number(r.job)>0).reduce((s,r)=>s+Number(r.milliseconds),0)])) : null;
  const result={...protocol,completed:true,rows,totals,warmMilliseconds:warm,observedProcessingRatio:totals.base.milliseconds/totals.candidate.milliseconds};
  await writeFile(join(output,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify({completed:true,stage,totals,warm,ratio:result.observedProcessingRatio},null,2));
} finally {await rm(temporary,{recursive:true,force:true});}
