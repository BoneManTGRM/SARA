import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compoundMandateApprovalTarget,
  decideCompoundingRate,
  validateCompoundMandateInput,
} from "../src/compounding.ts";

describe("SARA Compounding Governor", () => {
  it("keeps decisions inside 25–50% and does not inflate zero-cost work", () => {
    const zeroCost = decideCompoundingRate({
      objective: "Use an existing free verifier",
      expectedOwnerValueUsd: 1_000,
      maximumCostUsd: 0,
      confidence: 1,
      riskScore: 0,
      reserveCoverageMonths: 12,
      evidence: ["verified-free-tier"],
    }, { id: "decision-free", decidedAt: "2026-09-02T00:00:00.000Z" });
    assert.equal(zeroCost.reinvestmentRate, 0.25);

    const strong = decideCompoundingRate({
      objective: "Buy one verified production tool",
      expectedOwnerValueUsd: 2_000,
      maximumCostUsd: 100,
      confidence: 0.95,
      riskScore: 0.05,
      reserveCoverageMonths: 12,
      evidence: ["paid-pilot", "retention", "margin", "benchmark", "vendor-cap"],
    }, { id: "decision-strong", decidedAt: "2026-09-02T00:00:00.000Z" });
    assert.ok(strong.reinvestmentRate >= 0.25);
    assert.ok(strong.reinvestmentRate <= 0.5);
    assert.equal(strong.reinvestmentRate, 0.5);
    assert.equal(strong.riskAdjustedOwnerValueUsd, 1_805);
  });

  it("rejects malformed or unsupported economic evidence", () => {
    const base = {
      objective: "Invalid opportunity",
      expectedOwnerValueUsd: 100,
      maximumCostUsd: 10,
      confidence: 0.5,
      riskScore: 0.5,
      reserveCoverageMonths: 1,
      evidence: ["measured"],
    };
    assert.throws(
      () => decideCompoundingRate({ ...base, confidence: 1.01 }, { id: "x", decidedAt: "2026-09-02T00:00:00Z" }),
      /between 0 and 1/,
    );
    assert.throws(
      () => decideCompoundingRate({ ...base, evidence: [] }, { id: "x", decidedAt: "2026-09-02T00:00:00Z" }),
      /evidence/,
    );
    assert.throws(
      () => decideCompoundingRate({ ...base, maximumCostUsd: 0.001 }, { id: "x", decidedAt: "2026-09-02T00:00:00Z" }),
      /whole cents/,
    );
  });

  it("binds a mandate approval to its exact provider, target, limits, and expiration", () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    const input = validateCompoundMandateInput({
      providerId: "cloudflare",
      operation: "workers-ai-inference",
      targetId: "account:owner:workers-ai",
      maximumTotalUsd: 100,
      maximumPerActionUsd: 10,
      expiresAt: "2026-10-02T00:00:00.000Z",
      purpose: "  Buy verified inference only after free capacity is exhausted.  ",
    }, now);
    assert.equal(input.purpose, "Buy verified inference only after free capacity is exhausted.");
    const target = compoundMandateApprovalTarget(input);
    assert.match(target, /^compound-mandate:[a-f0-9]{64}$/u);
    assert.notEqual(target, compoundMandateApprovalTarget({ ...input, maximumTotalUsd: 100.01 }));
    assert.throws(
      () => validateCompoundMandateInput({ ...input, maximumPerActionUsd: 100.01 }, now),
      /cannot exceed/,
    );
    assert.throws(
      () => validateCompoundMandateInput({ ...input, expiresAt: now.toISOString() }, now),
      /future timestamp/,
    );
  });
});
