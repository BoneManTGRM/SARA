import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingBenchmarkCorpus } from "./coding-repair-benchmark-corpus.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export type ProtectedBenchmarkFile = Readonly<{
  path: `tests/${string}.test.ts`;
  content: string;
}>;

const source = `export type LedgerEntry = Readonly<{
  category: string;
  amount: number;
}>;

export type LedgerSummary = Readonly<{
  category: string;
  total: number;
  count: number;
}>;

export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const entry of entries) {
    const key = entry.category;
    const current = totals.get(key) ?? { total: 0, count: 0 };
    current.total += entry.amount;
    current.count += 1;
    totals.set(key, current);
  }
  return Array.from(totals.entries()).map(([category, value]) => ({
    category,
    total: value.total,
    count: value.count,
  }));
}
`;

const protectedTest = `import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeLedger, type LedgerEntry } from "../src/summarize-ledger.ts";

test("normalizes and groups equivalent categories", () => {
  assert.deepEqual(
    summarizeLedger([
      { category: " Food ", amount: 2.5 },
      { category: "FOOD", amount: 1.5 },
      { category: "  home   office ", amount: 4 },
      { category: "HOME OFFICE", amount: 1 },
    ]),
    [
      { category: "food", total: 4, count: 2 },
      { category: "home office", total: 5, count: 2 },
    ],
  );
});

test("drops invalid entries and returns categories in lexical order", () => {
  assert.deepEqual(
    summarizeLedger([
      { category: "zeta", amount: 3 },
      { category: "   ", amount: 100 },
      { category: "alpha", amount: 2 },
      { category: "beta", amount: Number.NaN },
      { category: "gamma", amount: Number.POSITIVE_INFINITY },
    ]),
    [
      { category: "alpha", total: 2, count: 1 },
      { category: "zeta", total: 3, count: 1 },
    ],
  );
});

test("does not mutate the caller's entries", () => {
  const entries: LedgerEntry[] = [
    { category: " B ", amount: 2 },
    { category: "a", amount: 1 },
  ];
  const before = structuredClone(entries);
  summarizeLedger(entries);
  assert.deepEqual(entries, before);
});
`;

export const LIVE_CODING_BENCHMARK_PROTECTED_FILES: readonly ProtectedBenchmarkFile[] = Object.freeze([
  Object.freeze({ path: "tests/summarize-ledger.test.ts", content: protectedTest }),
]);

const liveCodingBenchmarkCorpus: CodingBenchmarkCorpus = {
  schemaVersion: 1,
  corpusId: "sara-live-summarize-ledger-v1",
  version: 1,
  origin: "internally_authored",
  evidenceScope: "LAB_SYNTHETIC_ONLY",
  promotionEligible: false,
  cases: [
    {
      schemaVersion: 1,
      caseId: "live-summarize-ledger-001",
      taskClass: "synthetic",
      taskFamily: "collection-normalization-aggregation",
      objective: "Repair summarizeLedger(entries) so it creates a deterministic summary of valid ledger entries without mutating the input.",
      acceptanceCriteria: [
        "Normalize each category by trimming outer whitespace, lowercasing, and collapsing every internal whitespace run to one space.",
        "Ignore entries whose normalized category is empty or whose amount is not finite.",
        "Group entries by normalized category and return each category with its numeric total and count.",
        "Sort the returned summaries by category using ascending lexical order.",
        "Do not mutate the caller's entries or entry objects.",
      ],
      baseline: {
        schemaVersion: 1,
        candidateKind: "typescript_program",
        programName: "Ledger Summary Repair",
        summary: "Normalizes and aggregates bounded ledger entries.",
        limitations: ["Benchmark-only isolated TypeScript candidate."],
        files: [
          {
            path: "src/index.ts",
            content: 'export * from "./summarize-ledger.ts";\n',
          },
          {
            path: "src/summarize-ledger.ts",
            content: source,
          },
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
    protectedFiles: LIVE_CODING_BENCHMARK_PROTECTED_FILES.map((file) => ({
      path: file.path,
      contentDigest: sha256(file.content),
    })),
  }));
}

function assertModelWritableCandidate(candidate: ProgramCandidateProposal): void {
  const expected = new Set(["src/index.ts", "src/summarize-ledger.ts"]);
  if (candidate.files.length !== expected.size) {
    throw new Error("Live benchmark candidate changed the frozen writable file set.");
  }
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
  const evidenceDigest = sha256(canonicalJson({
    artifactDigest: result.artifactDigest,
    code: "PROTECTED_ACCEPTANCE_FAILURE",
    protectedFailureCount: protectedFailures.length,
  }));
  const genericFailure: CodingFailureSignal = {
    kind: "behavior",
    code: "PROTECTED_ACCEPTANCE_FAILURE",
    file: "",
    line: 0,
    column: 0,
    evidenceDigest,
    fingerprint: sha256(canonicalJson({
      code: "PROTECTED_ACCEPTANCE_FAILURE",
      artifactDigest: result.artifactDigest,
    })),
    severity: "high",
    existedBeforeRepair: true,
  };
  return {
    ...result,
    failures: [
      ...result.failures.filter((failure) => !failure.file.startsWith("tests/")),
      genericFailure,
    ],
    evidenceDigests: [
      ...new Set([
        ...result.failures
          .filter((failure) => !failure.file.startsWith("tests/"))
          .map((failure) => failure.evidenceDigest),
        evidenceDigest,
      ]),
    ],
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
      ...LIVE_CODING_BENCHMARK_PROTECTED_FILES.map((file) => ({
        path: file.path,
        content: file.content,
      })),
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
