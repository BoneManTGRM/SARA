import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseCodingRepairStrategy, INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import type { CodingFailureSignal } from "../src/coding-repair-types.ts";

function failure(overrides: Partial<CodingFailureSignal> = {}): CodingFailureSignal {
  return {
    kind: "type", code: "TS2322", file: "src/value.ts", line: 1, column: 1,
    evidenceDigest: "a".repeat(64), fingerprint: "b".repeat(64), severity: "medium",
    existedBeforeRepair: true, ...overrides,
  };
}

describe("coding repair policy", () => {
  it("uses the bounded initial experimental contract", () => {
    assert.equal(INITIAL_CODING_REPAIR_LIMITS.maximumCycles, 3);
    assert.equal(INITIAL_CODING_REPAIR_LIMITS.surgicalFiles, 2);
    assert.equal(INITIAL_CODING_REPAIR_LIMITS.surgicalChangedLines, 80);
    assert.equal(INITIAL_CODING_REPAIR_LIMITS.deepFiles, 6);
    assert.equal(INITIAL_CODING_REPAIR_LIMITS.deepChangedLines, 240);
    assert.equal(INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd, 0.15);
  });

  it("stops on protected, critical, exhausted, or recurring failures", () => {
    assert.equal(chooseCodingRepairStrategy({ failures: [failure({ file: "tests/x.test.ts" })], cycle: 0, spentUsd: 0, recurrence: 1 }).strategy, "stop");
    assert.equal(chooseCodingRepairStrategy({ failures: [failure({ severity: "critical" })], cycle: 0, spentUsd: 0, recurrence: 1 }).strategy, "stop");
    assert.equal(chooseCodingRepairStrategy({ failures: [failure()], cycle: 3, spentUsd: 0, recurrence: 1 }).reasonCode, "cycle_limit");
    assert.equal(chooseCodingRepairStrategy({ failures: [failure()], cycle: 0, spentUsd: 0, recurrence: 3 }).reasonCode, "reparodynamic_debt");
  });
});
