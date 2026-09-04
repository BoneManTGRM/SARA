import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const objective = "Parse an HTTP Retry-After value into a bounded delay.";
const acceptanceCriteria = [
  "Return null for missing, blank, negative, or invalid values.",
  "Support non-negative integer delta-seconds.",
  "Support an HTTP-date relative to the supplied current time.",
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
        "export function retryAfterMs(value: string | undefined, nowMs: number, capMs: number): number | null {",
        '  if (value === undefined || value.trim() === "") return null;',
        "  const seconds = Number(value);",
        "  const delayMs = Number.isInteger(seconds) && seconds >= 0",
        "    ? seconds * 1000",
        "    : Date.parse(value) - nowMs;",
        "  if (!Number.isFinite(delayMs) || delayMs < 0) return null;",
        "  return Math.min(capMs, delayMs);",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: "tests/retry-after.test.ts",
      content: [
        'import { retryAfterMs } from "../src/retry-after.ts";',
        'const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");',
        'const equal = (actual: unknown, expected: unknown, label: string) => { if (actual !== expected) throw new Error(`${label}: ${String(actual)}`); };',
        'equal(retryAfterMs(undefined, now, 5000), null, "missing");',
        'equal(retryAfterMs("", now, 5000), null, "blank");',
        'equal(retryAfterMs("2", now, 5000), 2000, "delta-seconds");',
        'equal(retryAfterMs("100", now, 5000), 5000, "cap");',
        'equal(retryAfterMs("Wed, 21 Oct 2015 07:28:03 GMT", now, 5000), 3000, "http-date");',
        'equal(retryAfterMs("-1", now, 5000), null, "negative");',
        'equal(retryAfterMs("not-a-date", now, 5000), null, "invalid");',
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
