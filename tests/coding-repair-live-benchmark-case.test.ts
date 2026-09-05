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
    const implementation = candidate.files.find((file) => file.path === "src/summarize-ledger.ts")!;
    implementation.content = `export type LedgerEntry = Readonly<{ category: string; amount: number }>;
export type LedgerSummary = Readonly<{ category: string; total: number; count: number }>;
export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const entry of entries) {
    const category = entry.category.trim().toLowerCase().replace(/\\s+/gu, " ");
    if (!category || !Number.isFinite(entry.amount)) continue;
    const previous = totals.get(category) ?? { total: 0, count: 0 };
    totals.set(category, { total: previous.total + entry.amount, count: previous.count + 1 });
  }
  return Array.from(totals.entries())
    .map(([category, value]) => ({ category, total: value.total, count: value.count }))
    .sort((left, right) => left.category.localeCompare(right.category));
}
`;
    const result = await verification(candidate);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1);
  });

  it("rejects candidate attempts to add or replace protected acceptance files", async () => {
    const candidate = structuredClone(benchmarkCase.baseline);
    candidate.files.push({ path: "tests/summarize-ledger.test.ts", content: "throw new Error('forged');\n" });
    await assert.rejects(() => verification(candidate), /protected acceptance file|writable file set/);
  });
});
