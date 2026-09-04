import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCodingBenchmarkCommand } from "../src/coding-repair-benchmark-command.ts";

const benchmarkId = "11111111-1111-4111-8111-111111111111";
const validEnvironment = {
  OPENAI_API_KEY: "test-secret",
  SARA_CODING_BENCHMARK_AUTHORITY_SHA256: "a".repeat(64),
  SARA_CODING_BENCHMARK_SOURCE_REVISION: "1".repeat(40),
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
    assert.equal(parsed.sourceRevision, "1".repeat(40));
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
});
