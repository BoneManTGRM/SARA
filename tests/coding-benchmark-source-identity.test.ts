import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyCodingBenchmarkSourceIdentity } from "../src/coding-benchmark-source-identity.ts";

const revision = "a".repeat(40);

describe("coding benchmark source identity", () => {
  it("accepts an exact clean Git checkout", () => {
    assert.equal(verifyCodingBenchmarkSourceIdentity({
      expectedRevision: revision,
      gitRevision: revision,
      gitTrackedChanges: "",
    }), "git_checkout");
  });

  it("accepts exact Railway-injected deployment metadata only when Git metadata is unavailable", () => {
    assert.equal(verifyCodingBenchmarkSourceIdentity({
      expectedRevision: revision,
      railwayGitCommitSha: revision,
    }), "railway_deployment_metadata");
  });

  it("rejects dirty Git state instead of falling back to Railway metadata", () => {
    assert.throws(() => verifyCodingBenchmarkSourceIdentity({
      expectedRevision: revision,
      gitRevision: revision,
      gitTrackedChanges: " M src/index.ts\n",
      railwayGitCommitSha: revision,
    }), /clean tracked source checkout/);
  });

  it("rejects mismatched or absent source identity", () => {
    assert.throws(() => verifyCodingBenchmarkSourceIdentity({
      expectedRevision: revision,
      railwayGitCommitSha: "b".repeat(40),
    }), /does not match/);
    assert.throws(() => verifyCodingBenchmarkSourceIdentity({
      expectedRevision: revision,
    }), /could not establish exact source identity/);
  });
});
