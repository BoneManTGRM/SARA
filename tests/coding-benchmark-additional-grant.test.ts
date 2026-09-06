import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  ADDITIONAL_CODING_BENCHMARK_GRANT,
  CODING_BENCHMARK_CONTINUATION,
  assertCodingBenchmarkDispatch,
  inspectCodingBenchmarkReadiness,
} from "../src/coding-benchmark-readiness.ts";
import { codingBenchmarkLaunchSpec } from "../src/coding-benchmark-owner.ts";

const ownerToken = "offline-owner-token";
const baseEnvironment = {
  OPENAI_API_KEY: "offline-provider-key",
  SARA_OWNER_TOKEN: ownerToken,
  SARA_OWNER_TOKEN_SHA256: sha256(ownerToken),
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
};
const activatedEnvironment = {
  ...baseEnvironment,
  SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: ADDITIONAL_CODING_BENCHMARK_GRANT.activationSha256,
};

describe("separate additional coding-benchmark grant", () => {
  it("activates only the new one-use grant while retaining the old hold as evidence", () => {
    const readiness = inspectCodingBenchmarkReadiness({
      environment: activatedEnvironment,
      constitutionVerified: true,
      emergencyStopped: false,
    });
    assert.equal(readiness.ready, true);
    assert.equal(readiness.benchmarkId, ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId);
    assert.equal(readiness.unresolvedExposureUsd, 0);
    assert.equal(readiness.availableAuthorizationUsd, 0.15);
    assert.deepEqual(readiness.historicalHold, {
      benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
      unresolvedExposureUsd: 0.15,
      confirmedChargeUsd: null,
    });
  });

  it("does not activate on a missing or altered value", () => {
    for (const environment of [baseEnvironment, {
      ...baseEnvironment,
      SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256: "0".repeat(64),
    }]) {
      const readiness = inspectCodingBenchmarkReadiness({ environment, constitutionVerified: true, emergencyStopped: false });
      assert.equal(readiness.ready, false);
      assert.equal(readiness.benchmarkId, CODING_BENCHMARK_CONTINUATION.benchmarkId);
      assert.ok(readiness.blockers.includes("UNRECONCILED_MODEL_EXPOSURE"));
      assert.equal(readiness.availableAuthorizationUsd, 0);
    }
  });

  it("cannot spend the new grant using the old benchmark id", () => {
    assert.throws(() => assertCodingBenchmarkDispatch({
      benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
      environment: activatedEnvironment,
      constitutionVerified: true,
      emergencyStopped: false,
    }), /BENCHMARK_SCOPE_MISMATCH/);
    assert.doesNotThrow(() => assertCodingBenchmarkDispatch({
      benchmarkId: ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId,
      environment: activatedEnvironment,
      constitutionVerified: true,
      emergencyStopped: false,
    }));
  });

  it("constructs the existing runner for the new grant with unchanged equal limits", () => {
    const spec = codingBenchmarkLaunchSpec({
      environment: activatedEnvironment,
      sourceRevision: "a".repeat(40),
      stateDirectory: "/data/sara/coding-benchmark-lab",
    });
    assert.equal(spec.args[spec.args.indexOf("--benchmark-id") + 1], ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId);
    assert.equal(spec.args[spec.args.indexOf("--max-spend-usd") + 1], "0.15");
    assert.equal(spec.args[spec.args.indexOf("--max-arm-spend-usd") + 1], "0.075");
    assert.equal(spec.environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256, ADDITIONAL_CODING_BENCHMARK_GRANT.activationSha256);
  });
});
