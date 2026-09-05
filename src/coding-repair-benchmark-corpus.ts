import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingBenchmarkCase } from "./coding-repair-benchmark-runner.ts";

export type CodingBenchmarkCorpus = {
  schemaVersion: 1;
  corpusId: string;
  version: number;
  origin: "internally_authored";
  evidenceScope: "LAB_SYNTHETIC_ONLY";
  promotionEligible: false;
  cases: CodingBenchmarkCase[];
  limitations: string[];
};

function lines(...items: string[]): string {
  return `${items.join("\n")}\n`;
}

function syntheticCase(input: {
  caseId: string;
  taskFamily: string;
  programName: string;
  summary: string;
  objective: string;
  acceptanceCriteria: string[];
  moduleName: string;
  source: string;
  test: string;
}): CodingBenchmarkCase {
  return {
    schemaVersion: 1,
    caseId: input.caseId,
    taskClass: "synthetic",
    taskFamily: input.taskFamily,
    objective: input.objective,
    acceptanceCriteria: input.acceptanceCriteria,
    baseline: {
      schemaVersion: 1,
      candidateKind: "typescript_program",
      programName: input.programName,
      summary: input.summary,
      limitations: ["Internally authored synthetic benchmark fixture only."],
      files: [
        {
          path: "src/index.ts",
          content: lines(`export * from "./${input.moduleName}.ts";`),
        },
        {
          path: `src/${input.moduleName}.ts`,
          content: input.source,
        },
        {
          path: `tests/${input.moduleName}.test.ts`,
          content: input.test,
        },
      ],
    },
  };
}

export const INITIAL_CODING_BENCHMARK_CORPUS: CodingBenchmarkCorpus = {
  schemaVersion: 1,
  corpusId: "sara-reparodynamic-coding-synthetic-v1",
  version: 1,
  origin: "internally_authored",
  evidenceScope: "LAB_SYNTHETIC_ONLY",
  promotionEligible: false,
  cases: [
    syntheticCase({
      caseId: "synthetic-addition-001",
      taskFamily: "arithmetic",
      programName: "Addition Repair",
      summary: "Adds two finite numbers.",
      objective: "Repair add(left, right) so it returns the arithmetic sum of the two inputs.",
      acceptanceCriteria: ["add(7, 5) returns 12.", "add(-2, 3) returns 1."],
      moduleName: "addition",
      source: lines(
        "export function add(left: number, right: number): number {",
        "  return left - right;",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { add } from "../src/addition.ts";',
        'test("adds finite numbers", () => {',
        "  assert.equal(add(7, 5), 12);",
        "  assert.equal(add(-2, 3), 1);",
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-clamp-002",
      taskFamily: "boundary-logic",
      programName: "Clamp Repair",
      summary: "Constrains a number to an inclusive range.",
      objective: "Repair clamp(value, minimum, maximum) so values below the range become minimum, values above become maximum, and in-range values are unchanged.",
      acceptanceCriteria: [
        "clamp(15, 0, 10) returns 10.",
        "clamp(-5, 0, 10) returns 0.",
        "clamp(4, 0, 10) returns 4.",
      ],
      moduleName: "clamp",
      source: lines(
        "export function clamp(value: number, minimum: number, maximum: number): number {",
        "  return Math.max(maximum, Math.min(minimum, value));",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { clamp } from "../src/clamp.ts";',
        'test("clamps inclusively", () => {',
        "  assert.equal(clamp(15, 0, 10), 10);",
        "  assert.equal(clamp(-5, 0, 10), 0);",
        "  assert.equal(clamp(4, 0, 10), 4);",
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-normalize-label-003",
      taskFamily: "text-normalization",
      programName: "Label Normalization Repair",
      summary: "Normalizes a human-readable label.",
      objective: "Repair normalizeLabel(input) so it trims outer whitespace, lowercases the text, and collapses every internal whitespace run to one space.",
      acceptanceCriteria: ['normalizeLabel("  Hello   WORLD ") returns "hello world".'],
      moduleName: "normalize-label",
      source: lines(
        "export function normalizeLabel(input: string): string {",
        "  return input.trim().toLowerCase();",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { normalizeLabel } from "../src/normalize-label.ts";',
        'test("normalizes label whitespace and case", () => {',
        '  assert.equal(normalizeLabel("  Hello   WORLD "), "hello world");',
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-unique-numbers-004",
      taskFamily: "collection-deduplication",
      programName: "Unique Numbers Repair",
      summary: "Removes duplicate numbers while preserving first-seen order.",
      objective: "Repair uniqueNumbers(values) so each number appears once and the first-seen order is preserved.",
      acceptanceCriteria: ["uniqueNumbers([3, 1, 3, 2, 1]) returns [3, 1, 2]."],
      moduleName: "unique-numbers",
      source: lines(
        "export function uniqueNumbers(values: number[]): number[] {",
        "  return values.slice();",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { uniqueNumbers } from "../src/unique-numbers.ts";',
        'test("deduplicates while preserving order", () => {',
        "  assert.deepEqual(uniqueNumbers([3, 1, 3, 2, 1]), [3, 1, 2]);",
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-positive-total-005",
      taskFamily: "numeric-filtering",
      programName: "Positive Total Repair",
      summary: "Totals only positive values.",
      objective: "Repair positiveTotal(values) so it sums only values greater than zero and ignores zero and negative values.",
      acceptanceCriteria: ["positiveTotal([-4, 2, 0, 7, -1]) returns 9."],
      moduleName: "positive-total",
      source: lines(
        "export function positiveTotal(values: number[]): number {",
        "  return values.reduce((total, value) => total + value, 0);",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { positiveTotal } from "../src/positive-total.ts";',
        'test("sums positive values only", () => {',
        "  assert.equal(positiveTotal([-4, 2, 0, 7, -1]), 9);",
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-slugify-006",
      taskFamily: "text-tokenization",
      programName: "Slugify Repair",
      summary: "Creates a normalized URL-safe slug.",
      objective: "Repair slugify(input) so it trims, lowercases, replaces each non-alphanumeric run with one hyphen, and removes leading or trailing hyphens.",
      acceptanceCriteria: ['slugify("  Hello, Reparodynamics!  ") returns "hello-reparodynamics".'],
      moduleName: "slugify",
      source: lines(
        "export function slugify(input: string): string {",
        '  return input.trim().toLowerCase().replace(/\\s+/gu, "-");',
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { slugify } from "../src/slugify.ts";',
        'test("creates a URL-safe slug", () => {',
        '  assert.equal(slugify("  Hello, Reparodynamics!  "), "hello-reparodynamics");',
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-average-007",
      taskFamily: "aggregation",
      programName: "Average Repair",
      summary: "Computes the arithmetic mean.",
      objective: "Repair average(values) so it returns zero for an empty list and otherwise returns the arithmetic mean.",
      acceptanceCriteria: ["average([]) returns 0.", "average([2, 4, 6]) returns 4."],
      moduleName: "average",
      source: lines(
        "export function average(values: number[]): number {",
        "  if (!values.length) return 0;",
        "  return values.reduce((total, value) => total + value, 0) / (values.length + 1);",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { average } from "../src/average.ts";',
        'test("computes the arithmetic mean", () => {',
        "  assert.equal(average([]), 0);",
        "  assert.equal(average([2, 4, 6]), 4);",
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-affirmative-008",
      taskFamily: "boolean-parsing",
      programName: "Affirmative Parsing Repair",
      summary: "Parses bounded affirmative text values.",
      objective: "Repair isAffirmative(input) so trimmed case-insensitive values yes, true, and 1 return true; every other value returns false.",
      acceptanceCriteria: [
        'isAffirmative(" YES ") returns true.',
        'isAffirmative("TrUe") returns true.',
        'isAffirmative("no") returns false.',
      ],
      moduleName: "affirmative",
      source: lines(
        "export function isAffirmative(input: string): boolean {",
        '  return input === "true";',
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { isAffirmative } from "../src/affirmative.ts";',
        'test("parses affirmative values", () => {',
        '  assert.equal(isAffirmative(" YES "), true);',
        '  assert.equal(isAffirmative("TrUe"), true);',
        '  assert.equal(isAffirmative("no"), false);',
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-reverse-words-009",
      taskFamily: "sequence-transformation",
      programName: "Reverse Words Repair",
      summary: "Reverses word order without reversing characters.",
      objective: "Repair reverseWords(input) so it trims the input, splits on whitespace runs, reverses word order, and joins words with one space.",
      acceptanceCriteria: ['reverseWords("one two three") returns "three two one".'],
      moduleName: "reverse-words",
      source: lines(
        "export function reverseWords(input: string): string {",
        '  return input.split("").reverse().join("");',
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { reverseWords } from "../src/reverse-words.ts";',
        'test("reverses word order", () => {',
        '  assert.equal(reverseWords("one two three"), "three two one");',
        "});",
      ),
    }),
    syntheticCase({
      caseId: "synthetic-median-010",
      taskFamily: "statistics",
      programName: "Median Repair",
      summary: "Computes a numeric median.",
      objective: "Repair median(values) so it returns zero for an empty list, sorts numerically ascending, returns the middle value for odd length, and averages the two middle values for even length.",
      acceptanceCriteria: [
        "median([]) returns 0.",
        "median([2, 10, 3]) returns 3.",
        "median([1, 2, 3, 4]) returns 2.5.",
      ],
      moduleName: "median",
      source: lines(
        "export function median(values: number[]): number {",
        "  const sorted = [...values].sort();",
        "  if (!sorted.length) return 0;",
        "  const middle = Math.floor(sorted.length / 2);",
        "  if (sorted.length % 2 === 1) return sorted.at(middle) ?? 0;",
        "  return ((sorted.at(middle - 1) ?? 0) + (sorted.at(middle) ?? 0)) / 2;",
        "}",
      ),
      test: lines(
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { median } from "../src/median.ts";',
        'test("computes a numeric median", () => {',
        "  assert.equal(median([]), 0);",
        "  assert.equal(median([2, 10, 3]), 3);",
        "  assert.equal(median([1, 2, 3, 4]), 2.5);",
        "});",
      ),
    }),
  ],
  limitations: [
    "This initial corpus contains only ten internally authored synthetic TypeScript failures.",
    "It can exercise the matched harness and produce LAB evidence but is not promotion eligible.",
    "Results from this corpus alone do not establish a general speed or accuracy advantage.",
    "MEASURED evidence still requires at least 30 matched live cases including reconstructed SARA and immutable licensed public tasks.",
  ],
};

export function validateCodingBenchmarkCorpus(corpus: CodingBenchmarkCorpus): void {
  if (corpus.schemaVersion !== 1 || corpus.version !== 1) {
    throw new Error("Coding benchmark corpus version is unsupported.");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(corpus.corpusId)) {
    throw new Error("Coding benchmark corpus id is malformed.");
  }
  if (
    corpus.origin !== "internally_authored"
    || corpus.evidenceScope !== "LAB_SYNTHETIC_ONLY"
    || corpus.promotionEligible !== false
  ) throw new Error("Initial coding benchmark corpus authority or evidence scope is malformed.");
  if (!corpus.cases.length || corpus.cases.length > 100) {
    throw new Error("Coding benchmark corpus case count is invalid.");
  }
  const caseIds = new Set<string>();
  for (const benchmarkCase of corpus.cases) {
    if (benchmarkCase.schemaVersion !== 1 || benchmarkCase.taskClass !== "synthetic") {
      throw new Error("Initial coding benchmark cases must be synthetic schema v1 cases.");
    }
    if (caseIds.has(benchmarkCase.caseId)) throw new Error("Coding benchmark case ids must be unique.");
    caseIds.add(benchmarkCase.caseId);
    if (!benchmarkCase.objective.trim() || !benchmarkCase.acceptanceCriteria.length) {
      throw new Error("Coding benchmark case objective or criteria are missing.");
    }
    if (
      benchmarkCase.baseline.candidateKind !== "typescript_program"
      || benchmarkCase.baseline.files.length < 3
    ) throw new Error("Coding benchmark case baseline is malformed.");
    const paths = new Set(benchmarkCase.baseline.files.map((file) => file.path));
    if (
      paths.size !== benchmarkCase.baseline.files.length
      || !paths.has("src/index.ts")
      || ![...paths].some((path) => path.startsWith("tests/"))
    ) throw new Error("Coding benchmark case files are incomplete or duplicated.");
  }
  if (!corpus.limitations.length || corpus.limitations.some((limitation) => !limitation.trim())) {
    throw new Error("Coding benchmark corpus limitations are required.");
  }
}

export function codingBenchmarkCorpusDigest(corpus: CodingBenchmarkCorpus): string {
  validateCodingBenchmarkCorpus(corpus);
  return sha256(canonicalJson(corpus));
}
