import assert from "node:assert/strict";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { CODING_REPAIR_EDITS_OUTPUT_CONTRACT } from "../src/coding-repair-edits.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

// Credential-free mechanism simulation. No external model or token-count request is allowed.
globalThis.fetch = async () => { throw new Error("V7 offline simulation forbids network requests."); };
type Fixture = { id: string; objective: string; source: string; find: string; correct: string; wrong: string[]; assertions: string[] };
const fixtures: Fixture[] = [
  { id: "clamp", objective: "Clamp finite numbers to the inclusive range zero through ten.",
    source: "export function run(n: number): number {\n  return Math.min(20, Math.max(0, n));\n}\n",
    find: "20,", correct: "10,", wrong: ["12,", "14,", "16,"],
    assertions: [-3,0,1,9,10,11,12,20].map(n => `eq(run(${n}),${n < 0 ? 0 : n > 10 ? 10 : n});`) },
  { id: "inclusive-count", objective: "Count the integers in inclusive integer endpoints start <= end.",
    source: "export function run(start: number, end: number): number {\n  return end - start;\n}\n",
    find: "return end - start;", correct: "return end - start + 1;",
    wrong: ["return end - start + 2;", "return end - start + 3;", "return end - start + 4;"],
    assertions: [[0,0],[1,1],[0,1],[-3,4],[-9,-2],[4,14]].map(([a,b]) => {
      const points = Array.from({length: b-a+1}, (_,i)=>a+i); return `eq(run(${a},${b}),${points.length});`; }) },
  { id: "batch-count", objective: "Return the number of batches needed for n nonnegative integer items and positive integer capacity.",
    source: "export function run(n: number, capacity: number): number {\n  return Math.floor(n / capacity);\n}\n",
    find: "Math.floor(n / capacity)", correct: "Math.ceil(n / capacity)",
    wrong: ["Math.round(n / capacity)", "Math.ceil(n / capacity) + 1", "Math.floor(n / capacity) + 2"],
    assertions: [[0,3],[1,3],[3,3],[4,3],[8,5],[19,7],[21,7]].map(([n,c]) => {
      let expected = 0; for(let remaining=n;remaining>0;remaining-=c) expected++;
      return `eq(run(${n},${c}),${expected});`; }) },
  { id: "run-length", objective: "Run-length encode consecutive identical Unicode characters without merging separated runs.",
    source: 'export function run(text: string): Array<{value:string;count:number}> {\n  const out: Array<{value:string;count:number}> = [];\n  let active: {value:string;count:number} | undefined;\n  for (const value of text) {\n    if (active && active.value === value) active.count += 2;\n    else { active = {value, count:1}; out.push(active); }\n  }\n  return out;\n}\n',
    find: "active.count += 2", correct: "active.count += 1", wrong: ["active.count += 3", "active.count += 4", "active.count += 5"],
    assertions: ["","a","aa","abbccc","abab","xxxyyxx","ééa"].map(text => {
      const expected = [...text.matchAll(/(.)\1*/gsu)].map(m=>({value:[...m[0]][0],count:[...m[0]].length}));
      return `eq(run(${JSON.stringify(text)}),${JSON.stringify(expected)});`; }) },
  { id: "csv-quote", objective: "Always wrap a CSV cell in double quotes and escape every embedded quote by doubling it.",
    source: `export function run(value: string): string {\n  return '"' + value.replace('"', '""') + '"';\n}\n`,
    find: `value.replace('"', '""')`, correct: `value.replaceAll('"', '""')`,
    wrong: [`value.replaceAll('"', '')`, `value.replaceAll('"', '"""')`, `value.replaceAll('"', '""""')`],
    assertions: ["","abc",'a"b"c','""','a,b','a\nb'].map(text => {
      let expected='"'; for(const char of text) expected += char==='"'?'""':char; expected+='"';
      return `eq(run(${JSON.stringify(text)}),${JSON.stringify(expected)});`; }) },
  { id: "canonical-tags", objective: "Trim, lowercase, deduplicate and lexically sort nonempty tags without mutating input.",
    source: 'export function run(values: readonly string[]): string[] {\n  const normalized = values.map(v=>v.trim().toLowerCase()).filter(v=>v.length>0);\n  return normalized.sort();\n}\n',
    find: "return normalized.sort();", correct: "return [...new Set(normalized)].sort();",
    wrong: ["return normalized.sort().reverse();", "return normalized.slice(1).sort();", "return normalized.slice(0, 1).sort();"],
    assertions: [[" A ","a","B","b"],[],["z","x","x"],["", "  ","k"],["Q","q","p","q"]].map(values => {
      const out: string[]=[]; for(const value of values) {const v=value.trim().toLowerCase(); if(v && !out.includes(v)) out.push(v);}
      return `eq(run(${JSON.stringify(values)}),${JSON.stringify(out.sort())});`; }) },
];
const modes = ["full", "compact_continuations", "compact_first"] as const;
const schedules = ["correct_first", "correct_second", "all_wrong"] as const;
const authority = { ...INITIAL_CODING_REPAIR_LIMITS, repositoryMutation: false, merge: false, deploy: false, promotion: false };
const constitutionDigest = "a".repeat(64);
const contract = { schemaVersion: 1, baselineCommit: "d9a5ef84aa44b809fc8af87a027c5ad3eb059000", modes, schedules,
  fixtures: fixtures.map(f=>({ id:f.id, objective:f.objective, sourceDigest:sha256(f.source), assertionsDigest:sha256(canonicalJson(f.assertions)), assertionCount:f.assertions.length })),
  authority, modelBehavior: "scripted-identical-semantic-candidates-across-formats",
  verification: "original-Genome-Lab-plus-fresh-final-audit-no-cache", futureLiveFirstPromptContractChanged: true,
  claimedCodingSpeedIncrease: null, paidProviderCalls: 0, paidProviderSpendUsd: 0, generalClaimSupported: false };
const records: unknown[]=[];
for (const fixture of fixtures) {
  const objective=fixture.objective, acceptanceCriteria=[objective];
  const hiddenTests = 'import {run} from "../src/index.ts";\nimport {deepStrictEqual as eq} from "node:assert/strict";\n// PRIVATE_V7_TEST_SENTINEL\n' + fixture.assertions.join("\n") + "\n";
  const baseline: ProgramCandidateProposal={ schemaVersion:1,candidateKind:"typescript_program",programName:fixture.id.replaceAll("-"," "),
    summary:"Offline representation experiment",limitations:[],files:[
      {path:"src/index.ts",content:'export {run} from "./value.ts";\n'},
      {path:"src/value.ts",content:fixture.source}, {path:"tests/value.test.ts",content:hiddenTests}] };
  const reference=structuredClone(baseline); reference.files[1].content=fixture.source.replace(fixture.find,fixture.correct);
  const verify=async (candidate:ProgramCandidateProposal)=>{
    assert.equal(candidate.files.find(f=>f.path.startsWith("tests/"))?.content,hiddenTests);
    return verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});
  };
  assert((await verify(reference)).passed,`reference failed: ${fixture.id}`);
  assert(!(await verify(baseline)).passed,`baseline unexpectedly passed: ${fixture.id}`);
  for(const schedule of schedules) {
    const comparisons: Array<{artifact:string;proposals:string[];passed:boolean;calls:number}>=[];
    for(const mode of modes) {
      let calls=0, verificationCalls=0;
      const wireBytes:number[]=[], promptBytes:number[]=[], promptDigests:string[]=[];
      const client:WorkerModelClient={routeKey:"openai:gpt-5.6-luna:paid",maximumWallTimeMs:1000,
        async countInputTokens(prompt){
          assert(!prompt.includes("PRIVATE_V7_TEST_SENTINEL")); promptBytes.push(Buffer.byteLength(prompt)); promptDigests.push(sha256(prompt));
          return 100; // Synthetic accounting only; not a tokenizer estimate.
        },
        async execute(input) {
          assert.equal(input.reasoningLevel,"medium"); assert.equal(input.maximumOutputTokens,8000);
          const facts=JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
          const visible=facts.files.find((f:{path:string})=>f.path==="src/value.ts");
          const correct=schedule==="correct_first" || (schedule==="correct_second"&&calls>0);
          const replacement=correct?fixture.correct:fixture.wrong[calls]; calls++;
          assert.equal(visible.content,fixture.source);
          const compact=input.prompt.startsWith(CODING_REPAIR_EDITS_OUTPUT_CONTRACT);
          const output={schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,
            strategy:facts.requiredStrategy,changes:[{path:"src/value.ts",expectedContentDigest:sha256(visible.content),
              ...(compact?{edits:[{find:fixture.find,replace:replacement}]}:{replacementText:fixture.source.replace(fixture.find,replacement)})}],limitations:[]};
          const outputText=JSON.stringify(output); wireBytes.push(Buffer.byteLength(outputText));
          return {outputText,inputTokens:100,billableOutputTokens:50};
        }};
      const start=performance.now();
      const run=await runCodingRepairController({baseline,verify:async c=>{verificationCalls++;return verify(c);},
        model:createLunaCodingRepairModel({client,context:{objective,acceptanceCriteria,constitutionDigest,missingCapabilities:[],memoryContext:{contextDigest:sha256("[]"),memories:[]}},
          compactRepairContinuations:mode!=="full",experimentalCompactFirstProposal:mode==="compact_first"})});
      const final=await verify(run.champion);verificationCalls++;
      assert.equal(final.passed,schedule!=="all_wrong"); assert.equal(final.artifactDigest,run.verification.artifactDigest);
      assert.equal(calls,schedule==="correct_first"?1:schedule==="correct_second"?2:3);
      assert(run.accountedCostUsd<=0.15); assert.equal(baseline.files[1].content,fixture.source);
      const record={caseId:fixture.id,schedule,mode,verifiedComplete:final.passed,score:final.score,calls,
        verificationCalls,wireBytes,promptBytes,promptDigests,
        finalArtifactDigest:final.artifactDigest,proposalDigests:run.receipts.map(r=>r.proposalDigest),
        changedLines:run.receipts.reduce((n,r)=>n+r.changedLines,0),rollbacks:run.receipts.filter(r=>r.outcome==="rolled_back").length,
        localScriptedExecutionMilliseconds:performance.now()-start,syntheticAccountingUsd:run.accountedCostUsd};
      records.push(record);comparisons.push({artifact:record.finalArtifactDigest,proposals:record.proposalDigests,passed:final.passed,calls});
      console.error(JSON.stringify({caseId:fixture.id,schedule,mode,passed:final.passed,calls}));
    }
    assert.deepEqual(comparisons[0],comparisons[1]);assert.deepEqual(comparisons[0],comparisons[2]);
  }
}
const evidence={contract,contractDigest:sha256(canonicalJson(contract)),records,
  summary:{fixtureCount:fixtures.length,scenarioCount:fixtures.length*schedules.length,controllerExecutions:records.length,
    expectedCompleted:fixtures.length*2*modes.length,expectedUncompleted:fixtures.length*modes.length,
    semanticParityAcrossFormats:true,protectedTestsUnchangedAndHidden:true},
  providerCalls:0,providerSpendUsd:0,providerLatencyMeasured:false,modelAccuracyMeasured:false,
  outputBytesAreNotTokens:true,generalClaimSupported:false};
console.log(JSON.stringify({...evidence,evidenceDigest:sha256(canonicalJson(evidence))},null,2));
