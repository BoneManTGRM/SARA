import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  aggregateCodingBenchmarkPairs,
  compileCodingRolloutControlEvidence,
  digestCodingBenchmarkBindings,
  evaluateCodingRollout,
  type CodingBenchmarkArmObservation,
  type CodingBenchmarkBindings,
  type CodingBenchmarkPairReceipt,
  type CodingBenchmarkTaskClass,
  type CodingRolloutControlStatus,
} from "../src/coding-repair-evidence.ts";

const protocolDigest = sha256("paired-protocol-v2");
const corpusDigest = sha256("frozen-corpus-v1");
const corpusVersion = "repair-v1";

const bindings: CodingBenchmarkBindings = {
  repositoryDigest: sha256("repository"),
  commitDigest: sha256("commit"),
  criteriaDigest: sha256("criteria"),
  modelDigest: sha256("gpt-5.6-luna"),
  baselineMethodDigest: sha256("luna-alone"),
  reparodynamicMethodDigest: sha256("luna-reparodynamic"),
  verifierDigest: sha256("verifier"),
  environmentDigest: sha256("environment"),
  authorityDigest: sha256("authority"),
  budgetDigest: sha256("budget"),
  compilerDigest: sha256("typescript"),
  runtimeDigest: sha256("node"),
  toolchainDigest: sha256("toolchain"),
};
const identityDigest = digestCodingBenchmarkBindings(bindings);

function arm(
  name: "baseline" | "reparodynamic",
  index: number,
  overrides: Partial<CodingBenchmarkArmObservation> = {},
): CodingBenchmarkArmObservation {
  const verified = overrides.verified ?? (name === "reparodynamic");
  return {
    arm: name,
    verified,
    firstPass: overrides.firstPass ?? verified,
    score: overrides.score ?? (verified ? 1 : 0.8),
    retries: overrides.retries ?? (name === "reparodynamic" ? 1 : 0),
    cycles: overrides.cycles ?? (name === "reparodynamic" ? 2 : 1),
    rolledBackRepairs: overrides.rolledBackRepairs ?? 0,
    criticalRegressions: overrides.criticalRegressions ?? 0,
    escapedRegressions: overrides.escapedRegressions ?? 0,
    changedFiles: overrides.changedFiles ?? (name === "reparodynamic" ? 1 : 0),
    changedLines: overrides.changedLines ?? (name === "reparodynamic" ? 3 : 0),
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    accountedCostUsd: overrides.accountedCostUsd ?? (name === "reparodynamic" ? 0.05 : 0.04),
    repairCostUsd: overrides.repairCostUsd ?? (name === "reparodynamic" ? 0.01 : 0),
    activeExecutionMilliseconds: overrides.activeExecutionMilliseconds ?? (name === "reparodynamic" ? 110 : 100),
    rye: overrides.rye ?? (name === "reparodynamic" ? 10 : 0),
    reusedVerifiedLessons: overrides.reusedVerifiedLessons ?? 0,
    completionDigest: overrides.completionDigest ?? sha256(`${name}-completion-${index}`),
    evidenceDigests: overrides.evidenceDigests ?? [sha256(`${name}-evidence-${index}`)],
  };
}

function taskClass(index: number): CodingBenchmarkTaskClass {
  const classes: CodingBenchmarkTaskClass[] = [
    "synthetic_deterministic",
    "reconstructed_sara",
    "licensed_public_typescript",
  ];
  return classes[index % classes.length]!;
}

function pair(
  index: number,
  options: {
    taskClass?: CodingBenchmarkTaskClass;
    taskId?: string;
    taskDigest?: string;
    trialIndex?: number;
    canaryPercent?: number;
    evidenceKind?: "real" | "simulated";
    identityDigest?: string;
    baseline?: Partial<CodingBenchmarkArmObservation>;
    reparodynamic?: Partial<CodingBenchmarkArmObservation>;
  } = {},
): CodingBenchmarkPairReceipt {
  const kind = options.taskClass ?? taskClass(index);
  const taskId = options.taskId ?? `task-${index}`;
  return {
    schemaVersion: 2,
    pairId: randomUUID(),
    protocolDigest,
    corpusVersion,
    corpusDigest,
    identityDigest: options.identityDigest ?? identityDigest,
    bindings,
    taskId,
    taskClass: kind,
    trialIndex: options.trialIndex ?? 0,
    evidenceKind: options.evidenceKind ?? "real",
    taskDigest: options.taskDigest ?? sha256(taskId),
    caseDigest: sha256(`case-${taskId}`),
    startingArtifactDigest: sha256(`artifact-${taskId}`),
    licenseDigest: kind === "licensed_public_typescript" ? sha256(`license-${taskId}`) : null,
    canaryPercent: options.canaryPercent ?? 5,
    executionOrder: ["baseline", "reparodynamic"],
    baseline: arm("baseline", index, options.baseline),
    reparodynamic: arm("reparodynamic", index, options.reparodynamic),
    observedAt: new Date(Date.UTC(2026, 8, 4, 0, index % 60)).toISOString(),
  };
}

function controls(status: CodingRolloutControlStatus = "passed", includeDefault = false) {
  const check = (name: string, value: CodingRolloutControlStatus = status) => ({
    status: value,
    evidenceDigest: sha256(`${name}-${value}`),
  });
  return compileCodingRolloutControlEvidence({
    digestBinding: check("digest"),
    costEnforcement: check("cost"),
    protectedPaths: check("protected"),
    crashResume: check("crash"),
    nicoAssessment: check("nico", includeDefault ? "passed" : "missing"),
    ownerApproval: check("owner", includeDefault ? "passed" : "missing"),
    rollbackDrill: check("rollback", includeDefault ? "passed" : "missing"),
  });
}

function aggregate(receipts: CodingBenchmarkPairReceipt[], currentIdentityDigest = identityDigest) {
  return aggregateCodingBenchmarkPairs({
    receipts,
    protocolDigest,
    corpusVersion,
    corpusDigest,
    canaryPercent: receipts[0]?.canaryPercent ?? 5,
    currentIdentityDigest,
    bootstrapSamples: 1000,
  });
}

describe("Reparodynamic coding evidence contract", () => {
  it("classifies 30 balanced real matched tasks as MEASURED and computes deterministic positive matched-pair confidence intervals", () => {
    const receipts = Array.from({ length: 30 }, (_, index) => pair(index));
    const first = aggregate(receipts);
    const second = aggregate(receipts);
    assert.equal(first.evidenceLevel, "MEASURED");
    assert.deepEqual(first.taskClassCounts, {
      synthetic_deterministic: 10,
      reconstructed_sara: 10,
      licensed_public_typescript: 10,
    });
    assert.equal(first.uniqueTasks, 30);
    assert.equal(first.successRateGain, 1);
    assert(first.confidenceIntervals.successRateGain.low > 0);
    assert.deepEqual(first.confidenceIntervals, second.confidenceIntervals);
    assert.equal(first.aggregateDigest, second.aggregateDigest);
  });

  it("expands only after the frozen 30-task contract and core safety proofs pass", () => {
    const decision = evaluateCodingRollout({ aggregate: aggregate(Array.from({ length: 30 }, (_, index) => pair(index))), controls: controls() });
    assert.equal(decision.decision, "expand");
    assert.equal(decision.nextCanaryPercent, 10);
    assert.equal(decision.majorBenefit, "verified_success");
    assert.equal(decision.claimStatus, "measured_directional");
  });

  it("holds the former provisional 12-pair threshold", () => {
    const decision = evaluateCodingRollout({ aggregate: aggregate(Array.from({ length: 12 }, (_, index) => pair(index))), controls: controls() });
    assert.equal(decision.decision, "hold");
    assert(decision.reasonCodes.includes("insufficient_matched_pairs"));
  });

  it("holds when any required task class has fewer than ten matched tasks", () => {
    const receipts = Array.from({ length: 30 }, (_, index) => pair(index, {
      taskClass: index < 15 ? "synthetic_deterministic" : index < 29 ? "reconstructed_sara" : "licensed_public_typescript",
    }));
    const decision = evaluateCodingRollout({ aggregate: aggregate(receipts), controls: controls() });
    assert.equal(decision.decision, "hold");
    assert(decision.reasonCodes.includes("insufficient_task_class_coverage"));
  });

  it("does not claim a benefit when the matched 95% interval crosses zero", () => {
    const receipts = Array.from({ length: 30 }, (_, index) => pair(index, index % 2 === 0
      ? { baseline: { verified: false, firstPass: false }, reparodynamic: { verified: true, firstPass: true } }
      : { baseline: { verified: true, firstPass: true }, reparodynamic: { verified: false, firstPass: false, score: 0.8 } }));
    const measured = aggregate(receipts);
    const decision = evaluateCodingRollout({ aggregate: measured, controls: controls() });
    assert(measured.confidenceIntervals.successRateGain.low <= 0);
    assert(measured.confidenceIntervals.successRateGain.high >= 0);
    assert.equal(decision.decision, "hold");
    assert.equal(decision.majorBenefit, "none");
    assert(decision.reasonCodes.includes("no_proven_major_benefit"));
  });

  it("permits the 25% cost-reduction path only at equivalent verified success", () => {
    const receipts = Array.from({ length: 30 }, (_, index) => pair(index, {
      baseline: { verified: true, firstPass: true, accountedCostUsd: 0.2 },
      reparodynamic: { verified: true, firstPass: true, accountedCostUsd: 0.1, repairCostUsd: 0.02 },
    }));
    const measured = aggregate(receipts);
    const decision = evaluateCodingRollout({ aggregate: measured, controls: controls() });
    assert(measured.meanCostReduction !== null && measured.meanCostReduction >= 0.25);
    assert(measured.confidenceIntervals.costReduction!.low > 0);
    assert.equal(decision.decision, "expand");
    assert.equal(decision.majorBenefit, "cost_reduction");
  });

  it("rolls back on any escaped regression or increase in critical regressions", () => {
    const escaped = Array.from({ length: 30 }, (_, index) => pair(index));
    escaped[4] = pair(4, { reparodynamic: { escapedRegressions: 1 } });
    const escapedDecision = evaluateCodingRollout({ aggregate: aggregate(escaped), controls: controls() });
    assert.equal(escapedDecision.decision, "rollback");
    assert(escapedDecision.reasonCodes.includes("escaped_regression"));

    const critical = Array.from({ length: 30 }, (_, index) => pair(index));
    critical[7] = pair(7, { reparodynamic: { criticalRegressions: 1 } });
    const criticalDecision = evaluateCodingRollout({ aggregate: aggregate(critical), controls: controls() });
    assert.equal(criticalDecision.decision, "rollback");
    assert(criticalDecision.reasonCodes.includes("critical_regression_increase"));
  });

  it("holds simulated or stale evidence even when its point estimates are favorable", () => {
    const simulated = Array.from({ length: 30 }, (_, index) => pair(index, { evidenceKind: index === 0 ? "simulated" : "real" }));
    const simulatedDecision = evaluateCodingRollout({ aggregate: aggregate(simulated), controls: controls() });
    assert.equal(simulatedDecision.decision, "hold");
    assert.equal(simulatedDecision.evidenceLevel, "SIMULATED");

    const staleAggregate = aggregate(Array.from({ length: 30 }, (_, index) => pair(index)), sha256("changed-toolchain"));
    const staleDecision = evaluateCodingRollout({ aggregate: staleAggregate, controls: controls() });
    assert.equal(staleDecision.decision, "hold");
    assert.equal(staleDecision.evidenceLevel, "STALE");
  });

  it("requires 100 replicated pairs across all three classes plus NICO, owner approval, and rollback-drill evidence before default eligibility", () => {
    const receipts = Array.from({ length: 100 }, (_, index) => pair(index, { canaryPercent: 100 }));
    const measured = aggregate(receipts);
    const missingApproval = evaluateCodingRollout({ aggregate: measured, controls: controls() });
    assert.equal(measured.evidenceLevel, "REPLICATED");
    assert.equal(missingApproval.decision, "hold");
    assert(missingApproval.reasonCodes.includes("default_controls_missing"));

    const eligible = evaluateCodingRollout({ aggregate: measured, controls: controls("passed", true) });
    assert.equal(eligible.decision, "eligible_default");
    assert.equal(eligible.nextCanaryPercent, 100);
    assert.equal(eligible.claimStatus, "sustained_verified_improvement");
  });

  it("holds on missing core proof and rolls back on a failed core safety proof", () => {
    const receipts = Array.from({ length: 30 }, (_, index) => pair(index));
    const missing = controls();
    const missingInput = {
      digestBinding: missing.digestBinding,
      costEnforcement: missing.costEnforcement,
      protectedPaths: missing.protectedPaths,
      crashResume: { status: "missing" as const, evidenceDigest: sha256("crash-missing") },
      nicoAssessment: missing.nicoAssessment,
      ownerApproval: missing.ownerApproval,
      rollbackDrill: missing.rollbackDrill,
    };
    const missingDecision = evaluateCodingRollout({ aggregate: aggregate(receipts), controls: compileCodingRolloutControlEvidence(missingInput) });
    assert.equal(missingDecision.decision, "hold");
    assert(missingDecision.reasonCodes.includes("core_controls_missing"));

    const failedInput = { ...missingInput, crashResume: { status: "failed" as const, evidenceDigest: sha256("crash-failed") } };
    const failedDecision = evaluateCodingRollout({ aggregate: aggregate(receipts), controls: compileCodingRolloutControlEvidence(failedInput) });
    assert.equal(failedDecision.decision, "rollback");
    assert(failedDecision.reasonCodes.includes("core_control_failed"));
  });

  it("rejects duplicate trials, changed task identities, missing public-task license evidence, and raw-output fields", () => {
    const duplicate = pair(1, { taskId: "same", trialIndex: 0 });
    assert.throws(() => aggregate([duplicate, { ...pair(2, { taskId: "same", trialIndex: 0 }), taskDigest: duplicate.taskDigest }]), /trial identity must be unique/);

    assert.throws(() => aggregate([
      pair(1, { taskId: "same", taskDigest: sha256("v1"), trialIndex: 0 }),
      pair(2, { taskId: "same", taskDigest: sha256("v2"), trialIndex: 1 }),
    ]), /task identity changed/);

    const unlicensed = pair(3, { taskClass: "licensed_public_typescript" });
    unlicensed.licenseDigest = null;
    assert.throws(() => aggregate([unlicensed]), /license digest/);

    const raw = pair(4) as CodingBenchmarkPairReceipt & { outputText?: string };
    raw.outputText = "untrusted model output";
    assert.throws(() => aggregate([raw]), /unsupported fields/);
  });
});
