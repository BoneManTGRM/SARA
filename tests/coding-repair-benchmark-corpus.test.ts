import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INITIAL_CODING_BENCHMARK_CORPUS,
  codingBenchmarkCorpusDigest,
  validateCodingBenchmarkCorpus,
} from "../src/coding-repair-benchmark-corpus.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";

const constitutionDigest = "a".repeat(64);

describe("frozen Reparodynamic coding benchmark corpus", () => {
  it("contains ten unique internal synthetic failures that start unverified", async () => {
    validateCodingBenchmarkCorpus(INITIAL_CODING_BENCHMARK_CORPUS);
    assert.equal(INITIAL_CODING_BENCHMARK_CORPUS.cases.length, 10);
    assert.equal(new Set(INITIAL_CODING_BENCHMARK_CORPUS.cases.map((item) => item.caseId)).size, 10);
    assert.ok(INITIAL_CODING_BENCHMARK_CORPUS.cases.every((item) => item.taskClass === "synthetic"));
    for (const item of INITIAL_CODING_BENCHMARK_CORPUS.cases) {
      const verification = await verifyGenomeLabProgramCandidate({
        candidate: item.baseline,
        objective: item.objective,
        acceptanceCriteria: item.acceptanceCriteria,
        constitutionDigest,
      });
      assert.equal(verification.passed, false, `${item.caseId} must begin as a real failing case`);
    }
  });

  it("has a deterministic digest that changes with any case mutation", () => {
    const digest = codingBenchmarkCorpusDigest(INITIAL_CODING_BENCHMARK_CORPUS);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digest, codingBenchmarkCorpusDigest(INITIAL_CODING_BENCHMARK_CORPUS));
    const changed = structuredClone(INITIAL_CODING_BENCHMARK_CORPUS);
    changed.cases[0].acceptanceCriteria = ["A deliberately changed criterion."];
    assert.notEqual(codingBenchmarkCorpusDigest(changed), digest);
  });

  it("states the honest evidence boundary for the initial corpus", () => {
    assert.equal(INITIAL_CODING_BENCHMARK_CORPUS.evidenceScope, "LAB_SYNTHETIC_ONLY");
    assert.equal(INITIAL_CODING_BENCHMARK_CORPUS.promotionEligible, false);
    assert.match(INITIAL_CODING_BENCHMARK_CORPUS.limitations.join(" "), /not establish a general speed or accuracy advantage/i);
  });
});
