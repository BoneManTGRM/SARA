import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const objective = "Parse an HTTP Retry-After delta-seconds value into a bounded delay.";
const acceptanceCriteria = [
  "Return null for missing, blank, negative, fractional, or invalid values.",
  "Support non-negative integer delta-seconds.",
  "Never exceed the supplied delay cap.",
];
const constitutionDigest = "a".repeat(64);

const completeCandidate: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "V5 Retry-After verifier oracle",
  summary: "Independent verifier isolation for the fresh horizon holdout.",
  limitations: [],
  files: [
    {
      path: "src/retry-after.ts",
      content: [
        "export function retryAfterMs(value: string | undefined, capMs: number): number | null {",
        '  if (value === undefined || value.trim() === "") return null;',
        "  const seconds = Number(value);",
        "  if (!Number.isInteger(seconds) || seconds < 0) return null;",
        "  return Math.min(capMs, seconds * 1000);",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: "tests/retry-after.test.ts",
      content: [
        'import { retryAfterMs } from "../src/retry-after.ts";',
        'const equal = (actual: unknown, expected: unknown, label: string) => { if (actual !== expected) throw new Error(`${label}: ${String(actual)}`); };',
        'equal(retryAfterMs(undefined, 5000), null, "missing");',
        'equal(retryAfterMs("", 5000), null, "blank");',
        'equal(retryAfterMs("2", 5000), 2000, "delta-seconds");',
        'equal(retryAfterMs("100", 5000), 5000, "cap");',
        'equal(retryAfterMs("-1", 5000), null, "negative");',
        'equal(retryAfterMs("2.5", 5000), null, "fractional");',
        'equal(retryAfterMs("not-a-number", 5000), null, "invalid");',
        "",
      ].join("\n"),
    },
  ],
};

describe("V5 Retry-After independent verifier oracle", () => {
  it("independently verifies the intended final artifact", async () => {
    const result = await verifyGenomeLabProgramCandidate({
      candidate: completeCandidate,
      objective,
      acceptanceCriteria,
      constitutionDigest,
      maximumBudgetUsd: INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd,
    });
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.score, 1);
  });
});
