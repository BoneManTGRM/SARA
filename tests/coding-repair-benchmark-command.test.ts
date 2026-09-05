import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCodingBenchmarkSourceRevision,
  codingBenchmarkAuthorityDigest,
  parseCodingBenchmarkCommand,
} from "../src/coding-repair-benchmark-command.ts";

const benchmarkId = "11111111-1111-4111-8111-111111111111";
const sourceRevision = "1".repeat(40);
const authorityInput = {
  benchmarkId,
  sourceRevision,
  maximumSpendUsd: 3,
  currentCanaryPercent: 5,
  caseCount: 10,
};
const validEnvironment = {
  OPENAI_API_KEY: "test-secret",
  SARA_CODING_BENCHMARK_AUTHORITY_SHA256: codingBenchmarkAuthorityDigest(authorityInput),
  SARA_CODING_BENCHMARK_SOURCE_REVISION: sourceRevision,
};
const validArguments = [
  "--live",
  "--acknowledge-lab-only",
  "--benchmark-id",
  benchmarkId,
  "--max-spend-usd",
  "3.00",
  "--current-canary-percent",
  "5",
  "--case-count",
  "10",
];

describe("live coding benchmark command", () => {
  it("parses an explicit target-bound and sufficiently funded LAB run", () => {
    const parsed = parseCodingBenchmarkCommand({
      args: validArguments,
      env: validEnvironment,
      maximumCases: 10,
    });
    assert.equal(parsed.live, true);
    assert.equal(parsed.acknowledgeLabOnly, true);
    assert.equal(parsed.benchmarkId, benchmarkId);
    assert.equal(parsed.maximumSpendUsd, 3);
    assert.equal(parsed.currentCanaryPercent, 5);
    assert.equal(parsed.caseCount, 10);
    assert.equal(parsed.stateDirectory, ".sara-state");
    assert.equal(parsed.sourceRevision, sourceRevision);
    assert.equal(parsed.authorityDigest, codingBenchmarkAuthorityDigest(authorityInput));
  });

  it("fails closed without explicit live and LAB-only acknowledgement flags", () => {
    assert.throws(
      () => parseCodingBenchmarkCommand({
        args: validArguments.filter((argument) => argument !== "--live"),
        env: validEnvironment,
        maximumCases: 10,
      }),
      /--live/,
    );
    assert.throws(
      () => parseCodingBenchmarkCommand({
        args: validArguments.filter((argument) => argument !== "--acknowledge-lab-only"),
        env: validEnvironment,
        maximumCases: 10,
      }),
      /LAB-only/,
    );
  });

  it("requires a target-bound authority digest, source revision, and model credential", () => {
    for (const missing of Object.keys(validEnvironment)) {
      const env = { ...validEnvironment };
      delete env[missing as keyof typeof env];
      assert.throws(
        () => parseCodingBenchmarkCommand({ args: validArguments, env, maximumCases: 10 }),
        /required/,
      );
    }
  });

  it("rejects an approval digest copied from a different benchmark target", () => {
    assert.throws(
      () => parseCodingBenchmarkCommand({
        args: validArguments.map((argument) => argument === "5" ? "20" : argument),
        env: validEnvironment,
        maximumCases: 10,
      }),
      /does not match the exact live benchmark target/,
    );
  });

  it("requires the running checkout to equal the bound immutable revision", () => {
    assert.doesNotThrow(() => assertCodingBenchmarkSourceRevision(sourceRevision, sourceRevision));
    assert.throws(
      () => assertCodingBenchmarkSourceRevision(sourceRevision, "2".repeat(40)),
      /does not match the exact checked-out revision/,
    );
  });

  it("requires enough cap for the maximum two-arm spend and rejects unknown arguments", () => {
    assert.throws(
      () => parseCodingBenchmarkCommand({
        args: validArguments.map((argument) => argument === "3.00" ? "2.99" : argument),
        env: validEnvironment,
        maximumCases: 10,
      }),
      /at least \$3\.00/,
    );
    assert.throws(
      () => parseCodingBenchmarkCommand({
        args: [...validArguments, "--surprise"],
        env: validEnvironment,
        maximumCases: 10,
      }),
      /Unknown coding benchmark argument/,
    );
  });

  it("splits a smaller authorized total equally across one matched pair", () => {
    const onePairAuthority = {
      benchmarkId,
      sourceRevision,
      maximumSpendUsd: 0.15,
      currentCanaryPercent: 5,
      caseCount: 1,
    };
    const parsed = parseCodingBenchmarkCommand({
      args: [
        "--live",
        "--acknowledge-lab-only",
        "--benchmark-id",
        benchmarkId,
        "--max-spend-usd",
        "0.15",
        "--current-canary-percent",
        "5",
        "--case-count",
        "1",
      ],
      env: {
        OPENAI_API_KEY: "test-secret",
        SARA_CODING_BENCHMARK_AUTHORITY_SHA256: codingBenchmarkAuthorityDigest(onePairAuthority),
        SARA_CODING_BENCHMARK_SOURCE_REVISION: sourceRevision,
      },
      maximumCases: 1,
    });
    assert.equal((parsed as { maximumModelSpendUsdPerArm?: number }).maximumModelSpendUsdPerArm, 0.075);
  });
});
