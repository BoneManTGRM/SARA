import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingBenchmarkCorpus } from "./coding-repair-benchmark-corpus.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import { sanitizeProtectedVerifierFailures, type ProtectedBenchmarkFile } from "./coding-repair-live-benchmark-case.ts";
import type { ProgramVerificationResult } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

// New task for the separately authorized grant. Not a replay of the ledger/V8 task.
const brokenSource = `export type Window = Readonly<{ start: number; end: number }>;

export function findFreeWindows(
  bookings: readonly unknown[], horizonStart: number, horizonEnd: number, minimumDuration = 1,
): Window[] {
  const windows: Window[] = [];
  let cursor = horizonStart;
  for (const item of bookings) {
    const booking = item as Window;
    if (booking.start > cursor) windows.push({ start: cursor, end: booking.start });
    cursor = booking.end;
  }
  if (cursor < horizonEnd) windows.push({ start: cursor, end: horizonEnd });
  return windows.filter(window => window.end - window.start > minimumDuration);
}
`;

const hiddenTests = `import assert from "node:assert/strict";
import { test } from "node:test";
import { findFreeWindows } from "../src/free-windows.ts";

const examples: Array<{name: string; bookings: unknown[]; start: number; end: number; min?: number; expected: Array<{start: number; end: number}>}> = [
  {name: "empty calendar", bookings: [], start: 0, end: 20, expected: [{start:0,end:20}]},
  {name: "exact minimum is included", bookings: [], start: 8, end: 11, min:3, expected: [{start:8,end:11}]},
  {name: "short interval excluded", bookings: [], start: 8, end: 11, min:4, expected: []},
  {name: "unsorted and nested", bookings:[{start:12,end:14},{start:3,end:10},{start:5,end:8}], start:0,end:20,expected:[{start:0,end:3},{start:10,end:12},{start:14,end:20}]},
  {name: "overlap chain", bookings:[{start:8,end:13},{start:2,end:6},{start:5,end:9}],start:0,end:16,expected:[{start:0,end:2},{start:13,end:16}]},
  {name: "touching bookings",bookings:[{start:4,end:7},{start:7,end:12}],start:0,end:16,expected:[{start:0,end:4},{start:12,end:16}]},
  {name: "clip both ends",bookings:[{start:-10,end:4},{start:15,end:99}],start:2,end:20,expected:[{start:4,end:15}]},
  {name: "outside bookings",bookings:[{start:-10,end:0},{start:20,end:30}],start:0,end:20,expected:[{start:0,end:20}]},
  {name: "covered horizon",bookings:[{start:-1,end:30}],start:0,end:20,expected:[]},
  {name: "duplicate bookings",bookings:[{start:4,end:9},{start:4,end:9}],start:0,end:12,expected:[{start:0,end:4},{start:9,end:12}]},
  {name: "minimum filters after complement",bookings:[{start:2,end:4},{start:7,end:9}],start:0,end:15,min:3,expected:[{start:4,end:7},{start:9,end:15}]},
  {name: "ignore malformed records",bookings:[null,undefined,1,"x",[],{}, {start:"1",end:3},{start:1.5,end:2},{start:2,end:2},{start:5,end:2},{start:NaN,end:3},{start:2,end:Infinity},{start:1,end:Number.MAX_SAFE_INTEGER+1},{start:4,end:6}],start:0,end:10,expected:[{start:0,end:4},{start:6,end:10}]},
  {name: "bounded upper horizon",bookings:[{start:999992,end:999995}],start:999990,end:1000000,min:2,expected:[{start:999990,end:999992},{start:999995,end:1000000}]},
  {name: "extreme valid outside endpoints",bookings:[{start:-Number.MAX_SAFE_INTEGER,end:2},{start:8,end:Number.MAX_SAFE_INTEGER}],start:0,end:10,expected:[{start:2,end:8}]},
];
for (const item of examples) test(item.name, () => {
  const before=structuredClone(item.bookings);
  const output = item.min === undefined ? findFreeWindows(item.bookings,item.start,item.end) : findFreeWindows(item.bookings,item.start,item.end,item.min);
  assert.deepEqual(output,item.expected);
  assert.deepEqual(item.bookings,before);
});
for (const [start,end,min] of [[-1,10,1],[4,4,1],[5,3,1],[0,1000001,1],[0.5,10,1],[0,9.5,1],[NaN,10,1],[0,Infinity,1],[0,10,0],[0,10,-1],[0,10,1.5],[0,10,NaN],[0,10,Infinity],[0,10,1000001]]) {
  test("invalid horizon or minimum " + String(start)+"/"+String(end)+"/"+String(min), () => assert.deepEqual(findFreeWindows([],start!,end!,min!),[]));
}
test("non-array runtime calendar rejected without throwing", () => {
  for (const value of [null,undefined,{},"",17]) assert.deepEqual(findFreeWindows(value as unknown as unknown[],0,10),[]);
});
test("readonly input and sparse records do not mutate or throw", () => {
  const bookings: readonly unknown[] = [{start:7,end:9},{start:2,end:4}];
  const original=structuredClone(bookings);
  assert.deepEqual(findFreeWindows(bookings,0,12),[{start:0,end:2},{start:4,end:7},{start:9,end:12}]);
  assert.deepEqual(bookings,original);
  const sparse = new Array<unknown>(2);sparse.push({start:4,end:6});
  assert.deepEqual(findFreeWindows(sparse,0,10),[{start:0,end:4},{start:6,end:10}]);
});
test("deterministic independent occupancy oracle across 96 seeded calendars", () => {
  let seed=4781;
  const next = () => {seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed;};
  for(let caseIndex=0;caseIndex<96;caseIndex++) {
    const start=next()%5,end=start+12+next()%16,min=1+next()%5;
    const bookings:Array<{start:number;end:number}>=[];
    for(let j=0;j<9;j++){const a=Number(next()%40)-8,b=Number(next()%40)-8; bookings.push({start:Math.min(a,b),end:Math.max(a,b)});}
    const expected:Array<{start:number;end:number}>=[];
    let freeStart:number|null=null;
    for(let point=start;point<=end;point++) {
      const free=point<end && !bookings.some(b=>b.start<b.end && b.start<=point && point<b.end);
      if(free && freeStart===null) freeStart=point;
      if(!free && freeStart!==null){if(point-freeStart>=min)expected.push({start:freeStart,end:point});freeStart=null;}
    }
    assert.deepEqual(findFreeWindows(bookings,start,end,min),expected);
    assert.deepEqual(findFreeWindows([...bookings].reverse(),start,end,min),expected);
  }
});
`;

export const FREE_WINDOWS_PROTECTED_FILES: readonly ProtectedBenchmarkFile[] = Object.freeze([
  Object.freeze({ path: "tests/free-windows.test.ts", content: hiddenTests }),
]);
export const FREE_WINDOWS_CORPUS: CodingBenchmarkCorpus = Object.freeze<CodingBenchmarkCorpus>({
  schemaVersion: 1, corpusId: "sara-live-free-windows-additional-20260905", version: 1,
  origin: "internally_authored", evidenceScope: "LAB_SYNTHETIC_ONLY", promotionEligible: false,
  cases: [{ schemaVersion: 1, caseId: "live-free-windows-001", taskClass: "synthetic", taskFamily: "interval-union-complement",
    objective: "Repair findFreeWindows so it returns deterministic maximal available half-open time windows within a bounded horizon, without mutating its inputs.",
    acceptanceCriteria: [
      "Keep export type Window=Readonly<{start:number;end:number}> and findFreeWindows(bookings:readonly unknown[], horizonStart:number, horizonEnd:number, minimumDuration=1):Window[].",
      "Return [] without throwing for a non-array bookings input, or unless horizonStart/end are safe integers with 0 <= start < end <= 1000000 and minimumDuration is a safe integer from 1 through 1000000.",
      "Ignore null, non-object, array, missing-field, non-numeric, non-finite, non-safe-integer, zero-length and reversed booking records. Do not coerce values. Other object properties are irrelevant.",
      "Valid bookings represent occupied [start,end) ranges. Clip them to the horizon; ignore ranges outside it. Inputs can be unsorted, duplicated, nested, overlapping or touching.",
      "Return the maximal positive-length free intervals left by the union of occupied bookings, sorted by increasing start, each as exactly {start,end}. Never produce duplicate or zero-length intervals.",
      "Filter those maximal free intervals by end-start >= minimumDuration; include exact equality. The default minimum is 1. Do not split or join across an occupied interval.",
      "Do not mutate or sort the input array or mutate booking objects. Readonly input and sparse arrays are supported. Use no external dependencies or filesystem/network/process access.",
      "The existing SARA sandbox forbids computed property/index access such as items[i], Object/Reflect/Function/globalThis, dynamic imports and external modules. Use named properties and array iteration methods; do not change these sandbox restrictions.",
    ],
    baseline: {schemaVersion:1,candidateKind:"typescript_program",programName:"Bounded Free Windows",summary:"Repair interval union and free-window computation.",limitations:["Isolated internally authored benchmark task, not production scheduling."],files:[
      {path:"src/index.ts",content:'export * from "./free-windows.ts";\n'},
      {path:"src/free-windows.ts",content:brokenSource},
    ]},
  }],
  limitations: ["One internally authored matched task cannot establish a general speed multiplier or accuracy gain.",
    "Protected verifier tests and offline positive-control solution are excluded from both model prompts and writable candidate files.",
    "Both arms share SARA infrastructure, policy, bounded failure lessons and model worker. Only their existing controllers differ."],
});
export function freeWindowsCorpusDigest(): string {
  return sha256(canonicalJson({corpus:FREE_WINDOWS_CORPUS,protectedFiles:FREE_WINDOWS_PROTECTED_FILES.map(f=>({path:f.path,contentDigest:sha256(f.content)}))}));
}
export async function verifyFreeWindowsCandidate(input: {
  candidate: ProgramCandidateProposal; objective: string; acceptanceCriteria: string[]; constitutionDigest: string; maximumBudgetUsd: number;
}): Promise<ProgramVerificationResult> {
  const expected = new Set(["src/index.ts", "src/free-windows.ts"]);
  if (input.candidate.files.length !== expected.size || input.candidate.files.some(file => !expected.delete(file.path)) || expected.size) {
    throw new Error("Free-window candidate changed its frozen writable file set.");
  }
  return sanitizeProtectedVerifierFailures(await verifyGenomeLabProgramCandidate({ ...input,
    candidate: { ...structuredClone(input.candidate), files: [...structuredClone(input.candidate.files), ...FREE_WINDOWS_PROTECTED_FILES.map(f=>({...f}))] },
  }));
}
