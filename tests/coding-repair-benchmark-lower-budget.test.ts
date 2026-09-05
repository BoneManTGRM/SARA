import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import {
  codingBenchmarkAuthorityDigest,
  parseCodingBenchmarkCommand,
} from "../src/coding-repair-benchmark-command.ts";

const target = {
  benchmarkId: "761e533a-8173-4581-8428-31bb6cb780ef",
  sourceRevision: "1".repeat(40),
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  currentCanaryPercent: 5,
  caseCount: 1,
};
function request(arm: string = "0.075", total: string = "0.15", cases: string = "1") {
  const authority = { ...target, maximumSpendUsd: Number(total), caseCount: Number(cases),
    maximumModelSpendUsdPerArm: Number(arm) };
  return {
    args: ["--live", "--acknowledge-lab-only", "--benchmark-id", target.benchmarkId,
      "--max-spend-usd", total, "--max-arm-spend-usd", arm,
      "--current-canary-percent", "5", "--case-count", cases],
    env: { OPENAI_API_KEY: "offline-test-only", SARA_CODING_BENCHMARK_SOURCE_REVISION: target.sourceRevision,
      SARA_CODING_BENCHMARK_AUTHORITY_SHA256: codingBenchmarkAuthorityDigest(authority) },
    maximumCases: 10,
  };
}

describe("equal lower-budget live benchmark admission", () => {
  it("admits one $0.15 pair with the same $0.075 ceiling for each arm", () => {
    const result = parseCodingBenchmarkCommand(request());
    assert.equal(result.maximumSpendUsd, 0.15);
    assert.equal(Reflect.get(result, "maximumModelSpendUsdPerArm"), 0.075);
    assert.equal(result.caseCount, 1);
    assert.equal(result.authorityDigest, codingBenchmarkAuthorityDigest(target));
  });

  it("binds the lower arm ceiling into the existing authority envelope", () => {
    const changed = { ...target, maximumModelSpendUsdPerArm: 0.07 };
    assert.notEqual(codingBenchmarkAuthorityDigest(target), codingBenchmarkAuthorityDigest(changed));
  });

  it("preserves the exact legacy authority digest when the new option is omitted", () => {
    const { maximumModelSpendUsdPerArm: _arm, ...legacy } = { ...target, maximumSpendUsd: 0.3 };
    const expected = sha256(canonicalJson({ schemaVersion: 1,
      action: "run_live_reparodynamic_coding_benchmark", evidenceScope: "LAB_SYNTHETIC_ONLY",
      ...legacy, maximumModelSpendUsdPerArm: 0.15 }));
    assert.equal(codingBenchmarkAuthorityDigest(legacy), expected);
    const input = request("0.15", "0.30");
    const position = input.args.indexOf("--max-arm-spend-usd");
    input.args.splice(position, 2);
    const parsed = parseCodingBenchmarkCommand(input);
    assert.equal(Reflect.get(parsed, "maximumModelSpendUsdPerArm"), 0.15);
  });

  it("does not let unused total budget silently enlarge either arm", () => {
    const parsed = parseCodingBenchmarkCommand(request("0.075", "1.00"));
    assert.equal(Reflect.get(parsed, "maximumModelSpendUsdPerArm"), 0.075);
    assert.equal(parsed.maximumSpendUsd, 1);
  });

  it("refuses a larger or smaller arm ceiling with a copied authorization", () => {
    for (const amount of ["0.07", "0.08"]) {
      const input = request("0.075", "0.30");
      input.args[input.args.indexOf("--max-arm-spend-usd") + 1] = amount;
      assert.throws(() => parseCodingBenchmarkCommand(input), /does not match the exact live benchmark target/);
    }
  });

  it("never rounds an underfunded pair down to fit the whole-cent total", () => {
    for (const arm of ["0.075001", "0.076", "0.079"]) {
      assert.throws(() => parseCodingBenchmarkCommand(request(arm)), /at least/);
    }
    assert.throws(() => parseCodingBenchmarkCommand(request("0.075", "0.14")), /at least/);
    assert.throws(() => parseCodingBenchmarkCommand(request("0.075", "0.15", "2")), /at least/);
  });

  it("rejects malformed, nonpositive, over-ceiling and sub-micro-dollar authority limits", () => {
    for (const amount of [0, -0.01, 0.150001, 0.2, NaN, Infinity, 0.0000001]) {
      assert.throws(() => codingBenchmarkAuthorityDigest({ ...target, maximumModelSpendUsdPerArm: amount }), /arm.*spend|spend.*arm/i);
    }
  });

  it("rejects malformed or duplicate CLI arm ceilings without provider dispatch", () => {
    for (const arm of ["NaN", "Infinity", "-1", "1e-2", "0.0750001", "0", "0.16"]) {
      const input = request();
      input.args[input.args.indexOf("--max-arm-spend-usd") + 1] = arm;
      assert.throws(() => parseCodingBenchmarkCommand(input), /arm/);
    }
    const input = request();
    input.args.push("--max-arm-spend-usd", "0.075");
    assert.throws(() => parseCodingBenchmarkCommand(input), /Duplicate/);
  });
});
