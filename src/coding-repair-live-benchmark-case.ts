import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingBenchmarkCorpus } from "./coding-repair-benchmark-corpus.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export type ProtectedBenchmarkFile = Readonly<{
  path: `tests/${string}.test.ts`;
  content: string;
}>;

const source = `export type Booking = Readonly<{
  start: number;
  end: number;
}>;

export type TimeWindow = Readonly<{
  start: number;
  end: number;
}>;

export function freeWindows(
  dayStart: number,
  dayEnd: number,
  bookings: readonly Booking[],
): TimeWindow[] {
  const free: TimeWindow[] = [];
  let cursor = dayStart;
  for (const booking of bookings) {
    if (booking.start > cursor) free.push({ start: cursor, end: booking.start });
    cursor = Math.max(cursor, booking.end);
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free;
}
`;

const protectedTest = `import assert from "node:assert/strict";
import { test } from "node:test";
import { freeWindows, type Booking } from "../src/free-windows.ts";

test("clips, sorts and merges overlapping or touching bookings", () => {
  assert.deepEqual(
    freeWindows(9, 17, [
      { start: 14, end: 15 },
      { start: 8, end: 10 },
      { start: 9.5, end: 11 },
      { start: 15, end: 16 },
      { start: 18, end: 19 },
      { start: 12, end: 13 },
    ]),
    [
      { start: 11, end: 12 },
      { start: 13, end: 14 },
      { start: 16, end: 17 },
    ],
  );
});

test("ignores invalid bookings and handles an entirely busy day", () => {
  assert.deepEqual(
    freeWindows(0, 10, [
      { start: Number.NaN, end: 2 },
      { start: 4, end: Number.POSITIVE_INFINITY },
      { start: 7, end: 7 },
      { start: 8, end: 3 },
      { start: -5, end: 20 },
    ]),
    [],
  );
});

test("returns no windows for invalid day bounds", () => {
  assert.deepEqual(freeWindows(Number.NaN, 10, []), []);
  assert.deepEqual(freeWindows(10, Number.POSITIVE_INFINITY, []), []);
  assert.deepEqual(freeWindows(10, 10, []), []);
  assert.deepEqual(freeWindows(11, 10, []), []);
});

test("does not mutate bookings and returns deterministic ascending gaps", () => {
  const bookings: Booking[] = [
    { start: 5, end: 6 },
    { start: 1, end: 2 },
    { start: 3, end: 4 },
  ];
  const before = structuredClone(bookings);
  assert.deepEqual(freeWindows(0, 7, bookings), [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
    { start: 4, end: 5 },
    { start: 6, end: 7 },
  ]);
  assert.deepEqual(bookings, before);
});

test("clips partially overlapping bookings without producing zero-width gaps", () => {
  assert.deepEqual(freeWindows(9, 17, [
    { start: 7, end: 9 },
    { start: 10, end: 12 },
    { start: 12, end: 12.5 },
    { start: 16.5, end: 19 },
  ]), [
    { start: 9, end: 10 },
    { start: 12.5, end: 16.5 },
  ]);
});
`;

export const LIVE_CODING_BENCHMARK_PROTECTED_FILES: readonly ProtectedBenchmarkFile[] = Object.freeze([
  Object.freeze({ path: "tests/free-windows.test.ts", content: protectedTest }),
]);

const liveCodingBenchmarkCorpus: CodingBenchmarkCorpus = {
  schemaVersion: 1,
  corpusId: "sara-live-free-windows-v1",
  version: 1,
  origin: "internally_authored",
  evidenceScope: "LAB_SYNTHETIC_ONLY",
  promotionEligible: false,
  cases: [
    {
      schemaVersion: 1,
      caseId: "live-free-windows-001",
      taskClass: "synthetic",
      taskFamily: "interval-normalization-merging",
      objective: "Repair freeWindows(dayStart, dayEnd, bookings) so it deterministically returns all free time inside a valid day without mutating caller data.",
      acceptanceCriteria: [
        "If dayStart or dayEnd is non-finite, or dayStart is greater than or equal to dayEnd, return an empty array.",
        "Ignore bookings with non-finite endpoints or with end less than or equal to start.",
        "Clip valid bookings to the day interval and ignore bookings that do not overlap the day.",
        "Sort and merge overlapping or touching clipped bookings before calculating gaps.",
        "Return positive-width free windows in ascending order and do not mutate the bookings array or its objects.",
      ],
      baseline: {
        schemaVersion: 1,
        candidateKind: "typescript_program",
        programName: "Free Window Repair",
        summary: "Computes free intervals from bounded bookings.",
        limitations: ["Benchmark-only isolated TypeScript candidate."],
        files: [
          { path: "src/index.ts", content: 'export * from "./free-windows.ts";\n' },
          { path: "src/free-windows.ts", content: source },
        ],
      },
    },
  ],
  limitations: [
    "This is one internally authored bounded TypeScript task and cannot establish a general coding multiplier.",
    "Protected acceptance tests are verifier-owned and excluded from the model-visible candidate and repair feedback.",
    "The matched comparison isolates controller behavior within shared SARA infrastructure; it is not all Reparodynamics versus none.",
  ],
};

export const LIVE_CODING_BENCHMARK_CORPUS: CodingBenchmarkCorpus = Object.freeze(liveCodingBenchmarkCorpus);

export function liveCodingBenchmarkCorpusDigest(): string {
  return sha256(canonicalJson({
    corpus: LIVE_CODING_BENCHMARK_CORPUS,
    protectedFiles: LIVE_CODING_BENCHMARK_PROTECTED_FILES.map((file) => ({ path: file.path, contentDigest: sha256(file.content) })),
  }));
}

function assertModelWritableCandidate(candidate: ProgramCandidateProposal): void {
  const expected = new Set(["src/index.ts", "src/free-windows.ts"]);
  if (candidate.files.length !== expected.size) throw new Error("Live benchmark candidate changed the frozen writable file set.");
  for (const file of candidate.files) {
    if (!expected.delete(file.path) || file.path.startsWith("tests/")) {
      throw new Error("Live benchmark candidate attempted to access a protected acceptance file.");
    }
  }
  if (expected.size) throw new Error("Live benchmark candidate omitted a frozen writable file.");
}

function sanitizeProtectedVerifierFailures(result: ProgramVerificationResult): ProgramVerificationResult {
  const protectedFailures = result.failures.filter((failure) => failure.file.startsWith("tests/"));
  if (!protectedFailures.length) return result;
  const evidenceDigest = sha256(canonicalJson({ artifactDigest: result.artifactDigest, code: "PROTECTED_ACCEPTANCE_FAILURE", protectedFailureCount: protectedFailures.length }));
  const genericFailure: CodingFailureSignal = {
    kind: "behavior", code: "PROTECTED_ACCEPTANCE_FAILURE", file: "", line: 0, column: 0,
    evidenceDigest,
    fingerprint: sha256(canonicalJson({ code: "PROTECTED_ACCEPTANCE_FAILURE", artifactDigest: result.artifactDigest })),
    severity: "high", existedBeforeRepair: true,
  };
  return {
    ...result,
    failures: [...result.failures.filter((failure) => !failure.file.startsWith("tests/")), genericFailure],
    evidenceDigests: [...new Set([
      ...result.failures.filter((failure) => !failure.file.startsWith("tests/")).map((failure) => failure.evidenceDigest),
      evidenceDigest,
    ])],
  };
}

export async function verifyLiveCodingBenchmarkCandidate(input: {
  candidate: ProgramCandidateProposal;
  objective: string;
  acceptanceCriteria: string[];
  constitutionDigest: string;
  maximumBudgetUsd: number;
}): Promise<ProgramVerificationResult> {
  assertModelWritableCandidate(input.candidate);
  const candidateWithProtectedTests: ProgramCandidateProposal = {
    ...structuredClone(input.candidate),
    files: [
      ...structuredClone(input.candidate.files),
      ...LIVE_CODING_BENCHMARK_PROTECTED_FILES.map((file) => ({ path: file.path, content: file.content })),
    ],
  };
  return sanitizeProtectedVerifierFailures(await verifyGenomeLabProgramCandidate({
    candidate: candidateWithProtectedTests,
    objective: input.objective,
    acceptanceCriteria: input.acceptanceCriteria,
    constitutionDigest: input.constitutionDigest,
    maximumBudgetUsd: input.maximumBudgetUsd,
  }));
}
