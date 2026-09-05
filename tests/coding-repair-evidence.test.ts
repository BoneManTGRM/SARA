import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { bindCodingRepairBenchmarkAuthority } from "../src/coding-repair-evidence.ts";

describe("matched coding benchmark authority evidence", () => {
  it("records an explicit deterministic authority hash without replacing established pair semantics", () => {
    const raw = {
      contractDigest: "a".repeat(64),
      pairDigest: "b".repeat(64),
      authority: {
        maximumCycles: 3,
        maximumModelSpendUsd: 0.15,
        physicalMaximumSpendUsd: 0.15,
        repositoryMutation: false,
        merge: false,
        deploy: false,
        promotion: false,
      },
    };

    const first = bindCodingRepairBenchmarkAuthority(raw);
    const second = bindCodingRepairBenchmarkAuthority(structuredClone(raw));

    assert.equal(first.authorityDigest, sha256(canonicalJson(raw.authority)));
    assert.match(first.authorityDigest, /^[a-f0-9]{64}$/u);
    assert.match(first.evidenceEnvelopeDigest, /^[a-f0-9]{64}$/u);
    assert.equal(first.pairDigest, raw.pairDigest);
    assert.equal(first.contractDigest, raw.contractDigest);
    assert.deepEqual(first, second);
  });
});
