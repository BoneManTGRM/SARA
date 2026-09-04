import { canonicalJson, sha256 } from "./canonical.ts";
import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import {
  chooseCodingRepairStrategy,
  INITIAL_CODING_REPAIR_LIMITS,
  repairYieldPerEnergy,
} from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import type {
  CodingRepairLimits,
  CodingRepairProposal,
  ProgramVerificationResult,
} from "./coding-repair-types.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "./types.ts";
import type { CodingBenchmarkArmReceipt } from "./coding-repair-benchmark-store.ts";
import type {
  CodingBenchmarkArmResult,
  CodingBenchmarkBindings,
  CodingBenchmarkExecutionKind,
  CodingBenchmarkMethod,
  CodingBenchmarkPairReceipt,
  CodingBenchmarkTaskClass,
} from "./coding-repair-benchmark.ts";

export type CodingBenchmarkCase = {
  schemaVersion: 1;
  caseId: string;
  taskClass: CodingBenchmarkTaskClass;
  taskFamily: string;
  objective: string;
  acceptanceCriteria: string[];
  baseline: ProgramCandidateProposal;
};

export type CodingBenchmarkContext = Parameters<CandidateGenerator["generate"]>[0];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_DIGEST = /^[a-f0-9]{64}$/u;

function assertBenchmarkCase(benchmarkCase: CodingBenchmarkCase, context: CodingBenchmarkContext): void {
  if (benchmarkCase.schemaVersion !== 1) {
    throw new Error("Coding benchmark case schema version is unsupported.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(benchmarkCase.caseId)) {
    throw new Error("Coding benchmark case id is malformed.");
  }
  if (!benchmarkCase.taskFamily.trim() || benchmarkCase.taskFamily.length > 128) {
    throw new Error("Coding benchmark task family is malformed.");
  }
  if (!benchmarkCase.objective.trim() || benchmarkCase.objective.length > 2_000) {
    throw new Error("Coding benchmark objective is malformed.");
  }
  if (
    !benchmarkCase.acceptanceCriteria.length
    || benchmarkCase.acceptanceCriteria.length > 32
    || benchmarkCase.acceptanceCriteria.some((criterion) => !criterion.trim() || criterion.length > 500)
  ) throw new Error("Coding benchmark acceptance criteria are malformed.");
  if (benchmarkCase.baseline.candidateKind !== "typescript_program") {
    throw new Error("Coding benchmark baseline must be a TypeScript program candidate.");
  }
  if (
    context.objective !== benchmarkCase.objective
    || canonicalJson(context.acceptanceCriteria) !== canonicalJson(benchmarkCase.acceptanceCriteria)
  ) throw new Error("Coding benchmark execution context does not match the frozen case.");
}

function changedLineCount(before: string, after: string): number {
  const left = before.split("\n");
  const right = after.split("\n");
  const overlap = Math.min(left.length, right.length);
  let changed = Math.abs(left.length - right.length);
  for (let index = 0; index < overlap; index += 1) {
    if (left[index] !== right[index]) changed += 1;
  }
  return changed;
}

function applyProposal(candidate: ProgramCandidateProposal, proposal: CodingRepairProposal): {
  candidate: ProgramCandidateProposal;
  changedLines: number;
} {
  const replacements = new Map(proposal.changes.map((change) => [change.path, change.replacementText]));
  let changedLines = 0;
  const files = candidate.files.map((file) => {
    const replacement = replacements.get(file.path);
    if (replacement === undefined) return file;
    changedLines += changedLineCount(file.content, replacement);
    return { path: file.path, content: replacement };
  });
  return { candidate: { ...candidate, files }, changedLines };
}

function hasRegression(before: ProgramVerificationResult, after: ProgramVerificationResult): boolean {
  if (after.score < before.score) return true;
  const previouslyFailingKinds = new Set(before.failures.map((failure) => failure.kind));
  return after.failures.some((failure) => !previouslyFailingKinds.has(failure.kind));
}

function hasCriticalRegression(before: ProgramVerificationResult, after: ProgramVerificationResult): boolean {
  const previous = new Set(before.failures.map((failure) => failure.fingerprint));
  return after.failures.some((failure) => (
    !previous.has(failure.fingerprint)
    && (
      failure.severity === "critical"
      || failure.kind === "security"
      || failure.kind === "integrity"
    )
  ));
}

function elapsedSince(started: number): number {
  return Math.max(0.001, performance.now() - started);
}

function cleanBaselineResult(
  method: CodingBenchmarkMethod,
  verification: ProgramVerificationResult,
  elapsed: number,
): CodingBenchmarkArmResult {
  return {
    method,
    verifiedComplete: true,
    finalScore: verification.score,
    activeExecutionMilliseconds: elapsed,
    accountedCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cycles: 0,
    rollbacks: 0,
    changedFiles: 0,
    changedLines: 0,
    rye: 0,
    regression: false,
    criticalRegression: false,
    failureCode: null,
    finalArtifactDigest: verification.artifactDigest,
    verifierEvidenceDigests: verification.evidenceDigests,
  };
}

async function runNormalArm(input: {
  baseline: ProgramCandidateProposal;
  baselineVerification: ProgramVerificationResult;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits: CodingRepairLimits;
  started: number;
}): Promise<CodingBenchmarkArmResult> {
  const target = input.baselineVerification.failures[0];
  if (!target) {
    return {
      ...cleanBaselineResult("luna", input.baselineVerification, elapsedSince(input.started)),
      verifiedComplete: false,
      failureCode: "missing_failure_signal",
    };
  }
  const decision = chooseCodingRepairStrategy({
    failures: input.baselineVerification.failures,
    cycle: 0,
    spentUsd: 0,
    recurrence: 1,
    limits: input.limits,
  });
  if (decision.strategy === "stop") {
    return {
      method: "luna",
      verifiedComplete: false,
      finalScore: input.baselineVerification.score,
      activeExecutionMilliseconds: elapsedSince(input.started),
      accountedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cycles: 0,
      rollbacks: 0,
      changedFiles: 0,
      changedLines: 0,
      rye: 0,
      regression: false,
      criticalRegression: false,
      failureCode: decision.reasonCode,
      finalArtifactDigest: input.baselineVerification.artifactDigest,
      verifierEvidenceDigests: input.baselineVerification.evidenceDigests,
    };
  }
  const strategy = decision.strategy === "luna_deep" ? "deep" : "surgical";
  const response = await input.model.propose({
    candidate: structuredClone(input.baseline),
    verification: structuredClone(input.baselineVerification),
    strategy,
    cycle: 1,
    remainingCostUsd: decision.remainingCostUsd,
  });
  if (
    !Number.isFinite(response.accountedCostUsd)
    || response.accountedCostUsd < 0
    || response.accountedCostUsd > decision.remainingCostUsd
  ) throw new Error("Normal Luna benchmark arm exceeded or malformed its accounted cost.");
  validateCodingRepairProposal({
    proposal: response.proposal,
    candidate: input.baseline,
    artifactDigest: input.baselineVerification.artifactDigest,
    failureFingerprints: new Set(input.baselineVerification.failures.map((failure) => failure.fingerprint)),
    limits: input.limits,
  });
  const applied = applyProposal(input.baseline, response.proposal);
  const lineLimit = strategy === "surgical"
    ? input.limits.surgicalChangedLines
    : input.limits.deepChangedLines;
  if (applied.changedLines > lineLimit) {
    throw new Error("Normal Luna benchmark arm exceeded its changed-line limit.");
  }
  const verificationStarted = performance.now();
  const finalVerification = await input.verify(applied.candidate);
  const verificationMilliseconds = performance.now() - verificationStarted;
  const regression = hasRegression(input.baselineVerification, finalVerification);
  return {
    method: "luna",
    verifiedComplete: finalVerification.passed,
    finalScore: finalVerification.score,
    activeExecutionMilliseconds: elapsedSince(input.started),
    accountedCostUsd: response.accountedCostUsd,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    cycles: 1,
    rollbacks: 0,
    changedFiles: response.proposal.changes.length,
    changedLines: applied.changedLines,
    rye: repairYieldPerEnergy({
      verificationGain: finalVerification.score - input.baselineVerification.score,
      costUsd: response.accountedCostUsd,
      changedLines: applied.changedLines,
      verificationMilliseconds,
    }),
    regression,
    criticalRegression: hasCriticalRegression(input.baselineVerification, finalVerification),
    failureCode: finalVerification.passed
      ? null
      : regression
        ? "regression"
        : finalVerification.failures[0]?.code ?? "verification_failed",
    finalArtifactDigest: finalVerification.artifactDigest,
    verifierEvidenceDigests: finalVerification.evidenceDigests,
  };
}

async function runReparodynamicArm(input: {
  baseline: ProgramCandidateProposal;
  baselineVerification: ProgramVerificationResult;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits: CodingRepairLimits;
  started: number;
}): Promise<CodingBenchmarkArmResult> {
  const baselineDigest = sha256(canonicalJson(input.baseline));
  let servedBaseline = false;
  const run = await runCodingRepairController({
    baseline: structuredClone(input.baseline),
    verify: async (candidate) => {
      if (!servedBaseline && sha256(canonicalJson(candidate)) === baselineDigest) {
        servedBaseline = true;
        return structuredClone(input.baselineVerification);
      }
      return input.verify(candidate);
    },
    model: input.model,
    limits: input.limits,
  });
  const receiptsWithModel = run.receipts.filter((receipt) => receipt.strategy !== "stop");
  const rye = receiptsWithModel.length
    ? receiptsWithModel.reduce((total, receipt) => total + receipt.rye, 0) / receiptsWithModel.length
    : 0;
  const regression = hasRegression(run.baselineVerification, run.verification);
  return {
    method: "luna_reparodynamic",
    verifiedComplete: run.state === "VERIFIED_CANDIDATE" && run.verification.passed,
    finalScore: run.verification.score,
    activeExecutionMilliseconds: elapsedSince(input.started),
    accountedCostUsd: run.accountedCostUsd,
    inputTokens: run.receipts.reduce((total, receipt) => total + receipt.inputTokens, 0),
    outputTokens: run.receipts.reduce((total, receipt) => total + receipt.outputTokens, 0),
    cycles: run.receipts.length,
    rollbacks: run.receipts.filter((receipt) => receipt.outcome === "rolled_back").length,
    changedFiles: run.receipts.reduce((total, receipt) => total + receipt.changedFiles, 0),
    changedLines: run.receipts.reduce((total, receipt) => total + receipt.changedLines, 0),
    rye,
    regression,
    criticalRegression: hasCriticalRegression(run.baselineVerification, run.verification),
    failureCode: run.state === "VERIFIED_CANDIDATE"
      ? null
      : run.receipts.at(-1)?.reasonCode
        ?? run.verification.failures[0]?.code
        ?? "verification_failed",
    finalArtifactDigest: run.verification.artifactDigest,
    verifierEvidenceDigests: run.verification.evidenceDigests,
  };
}

export async function runCodingBenchmarkArm(input: {
  method: CodingBenchmarkMethod;
  benchmarkCase: CodingBenchmarkCase;
  context: CodingBenchmarkContext;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits?: CodingRepairLimits;
}): Promise<CodingBenchmarkArmResult> {
  assertBenchmarkCase(input.benchmarkCase, input.context);
  const started = performance.now();
  const baseline = structuredClone(input.benchmarkCase.baseline);
  const baselineVerification = await input.verify(structuredClone(baseline));
  if (baselineVerification.passed) {
    return cleanBaselineResult(input.method, baselineVerification, elapsedSince(started));
  }
  let modelCalls = 0;
  const trackedModel: CodingRepairModel = {
    propose: async (request) => {
      modelCalls += 1;
      return input.model.propose(request);
    },
  };
  try {
    if (input.method === "luna") {
      return await runNormalArm({
        baseline,
        baselineVerification,
        verify: input.verify,
        model: trackedModel,
        limits: input.limits ?? INITIAL_CODING_REPAIR_LIMITS,
        started,
      });
    }
    return await runReparodynamicArm({
      baseline,
      baselineVerification,
      verify: input.verify,
      model: trackedModel,
      limits: input.limits ?? INITIAL_CODING_REPAIR_LIMITS,
      started,
    });
  } catch (error) {
    const costFailure = error instanceof Error && /cost|budget/iu.test(error.message);
    return {
      method: input.method,
      verifiedComplete: false,
      finalScore: baselineVerification.score,
      activeExecutionMilliseconds: elapsedSince(started),
      accountedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
      cycles: modelCalls,
      rollbacks: 0,
      changedFiles: 0,
      changedLines: 0,
      rye: 0,
      regression: false,
      criticalRegression: false,
      failureCode: costFailure ? "cost_enforcement_failed" : "arm_execution_failed",
      finalArtifactDigest: baselineVerification.artifactDigest,
      verifierEvidenceDigests: baselineVerification.evidenceDigests,
    };
  }
}

function assertRunIdentity(input: {
  benchmarkId: string;
  pairIndex: number;
  bindings: CodingBenchmarkBindings;
}): void {
  if (!UUID_V4.test(input.benchmarkId)) throw new Error("Coding benchmark id must be a UUID v4.");
  if (!Number.isInteger(input.pairIndex) || input.pairIndex < 1 || input.pairIndex > 9_999) {
    throw new Error("Coding benchmark pair index is malformed.");
  }
  if (Object.values(input.bindings).some((digest) => !HEX_DIGEST.test(digest))) {
    throw new Error("Coding benchmark bindings are malformed.");
  }
}

export async function runMatchedCodingBenchmarkCase(input: {
  benchmarkId: string;
  pairIndex: number;
  benchmarkCase: CodingBenchmarkCase;
  bindings: CodingBenchmarkBindings;
  context: CodingBenchmarkContext;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  modelFor(method: CodingBenchmarkMethod): CodingRepairModel;
  limits?: CodingRepairLimits;
  executionKind?: CodingBenchmarkExecutionKind;
  onArm?: (receipt: CodingBenchmarkArmReceipt) => Promise<void> | void;
  completedAt?: () => string;
}): Promise<CodingBenchmarkPairReceipt> {
  assertRunIdentity(input);
  const completedAt = input.completedAt ?? (() => new Date().toISOString());
  const order: [CodingBenchmarkMethod, CodingBenchmarkMethod] = input.pairIndex % 2 === 0
    ? ["luna", "luna_reparodynamic"]
    : ["luna_reparodynamic", "luna"];
  const results = new Map<CodingBenchmarkMethod, CodingBenchmarkArmResult>();
  for (const method of order) {
    const result = await runCodingBenchmarkArm({
      method,
      benchmarkCase: input.benchmarkCase,
      context: input.context,
      verify: input.verify,
      model: input.modelFor(method),
      ...(input.limits ? { limits: input.limits } : {}),
    });
    const receipt: CodingBenchmarkArmReceipt = {
      schemaVersion: 1,
      benchmarkId: input.benchmarkId,
      pairIndex: input.pairIndex,
      caseId: input.benchmarkCase.caseId,
      bindings: structuredClone(input.bindings),
      result,
      completedAt: completedAt(),
    };
    await input.onArm?.(structuredClone(receipt));
    results.set(method, result);
  }
  return {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    pairIndex: input.pairIndex,
    caseId: input.benchmarkCase.caseId,
    taskClass: input.benchmarkCase.taskClass,
    taskFamily: input.benchmarkCase.taskFamily,
    executionKind: input.executionKind ?? "live",
    order,
    bindings: structuredClone(input.bindings),
    normal: results.get("luna")!,
    reparodynamic: results.get("luna_reparodynamic")!,
    completedAt: completedAt(),
  };
}
