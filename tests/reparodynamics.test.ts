import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPARODYNAMICS_DOCTRINE_DIGEST,
  REPARODYNAMICS_MEMORY_SEEDS,
  compileVerifiedLearningMemory,
} from "../src/reparodynamics.ts";

const DIGEST = "a".repeat(64);

describe("Reparodynamics learning compiler", () => {
  it("publishes a digest-bound doctrine and compiles only independently gated success", () => {
    assert.equal(REPARODYNAMICS_MEMORY_SEEDS.length, 6);
    assert.match(REPARODYNAMICS_DOCTRINE_DIGEST, /^[a-f0-9]{64}$/);
    const lesson = compileVerifiedLearningMemory({
      serviceId: "public-repository-readiness-snapshot",
      cycleId: "cycle-1",
      outcome: "verified_success",
      stage: "deterministic_compilation",
      evidenceDigests: [DIGEST, "b".repeat(64)],
      verificationBasis: "independent_verifier_and_deterministic_gate",
      costUsd: 0.12,
      observedAt: "2026-09-03T00:00:00.000Z",
    });
    assert.equal(lesson.verification, "measured");
    assert.equal(lesson.scope, "service.public-repository-readiness-snapshot");
    assert.ok(lesson.statement.includes("not a universal rule"));
    assert.deepEqual(lesson.dependencies, [DIGEST, "b".repeat(64)]);
  });

  it("rejects model self-verification, missing evidence, unsafe ids, and excess cost", () => {
    const base = {
      serviceId: "public-repository-readiness-snapshot",
      cycleId: "cycle-1",
      outcome: "verified_success" as const,
      stage: "deterministic_compilation" as const,
      evidenceDigests: [DIGEST],
      verificationBasis: "independent_verifier" as const,
      costUsd: 0.1,
      observedAt: "2026-09-03T00:00:00.000Z",
    };
    assert.throws(() => compileVerifiedLearningMemory(base), /both independent verification and a deterministic gate/i);
    assert.throws(() => compileVerifiedLearningMemory({ ...base, evidenceDigests: [] }), /evidence digests/i);
    assert.throws(() => compileVerifiedLearningMemory({ ...base, cycleId: "../../unsafe" }), /safe identifier/i);
    assert.throws(() => compileVerifiedLearningMemory({ ...base, costUsd: 3.01 }), /\$3 execution ceiling/i);
  });
});
