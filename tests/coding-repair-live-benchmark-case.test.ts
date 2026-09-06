import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  LIVE_CODING_BENCHMARK_CORPUS,
  LIVE_CODING_BENCHMARK_PROTECTED_FILES,
  liveCodingBenchmarkCorpusDigest,
  verifyLiveCodingBenchmarkCandidate,
} from "../src/coding-repair-live-benchmark-case.ts";

const constitutionDigest = sha256(await readFile(new URL("../constitution/constitution.v1.json", import.meta.url)));
const benchmarkCase = LIVE_CODING_BENCHMARK_CORPUS.cases[0]!;

function verification(candidate = benchmarkCase.baseline) {
  return verifyLiveCodingBenchmarkCandidate({
    candidate,
    objective: benchmarkCase.objective,
    acceptanceCriteria: benchmarkCase.acceptanceCriteria,
    constitutionDigest,
    maximumBudgetUsd: 0.075,
  });
}

describe("fresh live coding benchmark task", () => {
  it("keeps protected acceptance tests outside the model-visible candidate", () => {
    assert.equal(benchmarkCase.baseline.files.some((file) => file.path.startsWith("tests/")), false);
    assert.equal(LIVE_CODING_BENCHMARK_PROTECTED_FILES.length, 1);
    assert.equal(LIVE_CODING_BENCHMARK_PROTECTED_FILES[0]!.path.startsWith("tests/"), true);
    assert.match(liveCodingBenchmarkCorpusDigest(), /^[a-f0-9]{64}$/u);
  });

  it("keeps the frozen broken baseline incomplete", async () => {
    const result = await verification();
    assert.equal(result.passed, false);
    assert.equal(result.completedChecks.includes("behavior_tests"), true);
    assert.equal(result.failures.some((failure) => failure.code === "GENOME_LAB_RUNTIME_FAILURE"), true);
  });

  it("accepts a known-correct verifier fixture without treating it as benchmark output", async () => {
    const candidate = structuredClone(benchmarkCase.baseline);
    const implementation = candidate.files.find((file) => file.path === "src/free-windows.ts")!;
    implementation.content = `export type Booking = Readonly<{ start: number; end: number }>;
export type TimeWindow = Readonly<{ start: number; end: number }>;

export function freeWindows(
  dayStart: number,
  dayEnd: number,
  bookings: readonly Booking[],
): TimeWindow[] {
  if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayStart >= dayEnd) return [];

  const busy = bookings
    .filter((booking) => Number.isFinite(booking.start) && Number.isFinite(booking.end) && booking.end > booking.start)
    .map((booking) => ({ start: Math.max(dayStart, booking.start), end: Math.min(dayEnd, booking.end) }))
    .filter((booking) => booking.end > booking.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const booking of busy) {
    const previous = merged.at(-1);
    if (previous && booking.start <= previous.end) previous.end = Math.max(previous.end, booking.end);
    else merged.push({ ...booking });
  }

  const free: TimeWindow[] = [];
  let cursor = dayStart;
  for (const booking of merged) {
    if (booking.start > cursor) free.push({ start: cursor, end: booking.start });
    cursor = Math.max(cursor, booking.end);
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free;
}
`;
    const result = await verification(candidate);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1);
  });

  it("rejects candidate attempts to add or replace protected acceptance files", async () => {
    const candidate = structuredClone(benchmarkCase.baseline);
    candidate.files.push({ path: "tests/free-windows.test.ts", content: "throw new Error('forged');\n" });
    await assert.rejects(() => verification(candidate), /protected acceptance file|writable file set/);
  });

  it("sanitizes protected-test type failures before they can become repair feedback", async () => {
    const candidate = structuredClone(benchmarkCase.baseline);
    const implementation = candidate.files.find((file) => file.path === "src/free-windows.ts")!;
    implementation.content = "export function freeWindows(): number { return 0; }\n";
    const result = await verification(candidate);
    assert.equal(result.passed, false);
    assert.equal(result.failures.some((failure) => failure.file.startsWith("tests/")), false);
    assert.equal(result.failures.some((failure) => failure.code === "PROTECTED_ACCEPTANCE_FAILURE"), true);
  });
});
