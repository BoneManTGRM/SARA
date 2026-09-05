import { canonicalJson, sha256 } from "./canonical.ts";
import { digestCodingRepairProposal } from "./coding-repair-artifacts.ts";
import { boundCodingRepairAttemptLessons, buildCodingRepairAttemptLesson, passingVerificationChecks } from "./coding-repair-lessons.ts";
import { runCodingRepairController, type CodingRepairModel } from "./coding-repair-controller.ts";
import {
  chooseCodingRepairStrategy,
  INITIAL_CODING_REPAIR_LIMITS,
  repairYieldPerEnergy,
} from "./coding-repair-policy.ts";
import { validateCodingRepairProposal } from "./coding-repair-prompt.ts";
import type {
  CodingRepairAttemptLesson,
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
  if (!["synthetic", "reconstructed_sara", "licensed_public"].includes(benchmarkCase.taskClass)) {
    throw new Error("Coding benchmark task class is unsupported.");
  }
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

type ArmInput = {
  baseline: ProgramCandidateProposal;
  baselineVerification: ProgramVerificationResult;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits: CodingRepairLimits;
  started: number;
};
type ArmOutcome = { result: CodingBenchmarkArmResult; candidate: ProgramCandidateProposal; verification: ProgramVerificationResult };

// A conventional best-so-far patch-and-memory control. Shared lessons and policy
// deliberately give it the same information and authority as the treatment.
// This is a conservative controller comparison, not "all Reparodynamics off".
async function runNormalArm(input: ArmInput): Promise<ArmOutcome> {
  let champion = structuredClone(input.baseline);
  let verification = structuredClone(input.baselineVerification);
  let lessons: CodingRepairAttemptLesson[] = [];
  const attempted = new Set<string>();
  const recurrence = new Map<string, number>();
  const result = { ...cleanBaselineResult("luna", verification, 0), verifiedComplete: false };
  let ryeSum = 0;
  for (let cycle = 1; cycle <= input.limits.maximumCycles; cycle++) {
    const target = verification.failures[0];
    if (!target) { result.failureCode = "missing_failure_signal"; break; }
    const seen = (recurrence.get(target.fingerprint) ?? 0) + 1;
    recurrence.set(target.fingerprint, seen);
    const decision = chooseCodingRepairStrategy({ failures: verification.failures,
      cycle: cycle - 1, spentUsd: result.accountedCostUsd!, recurrence: seen, limits: input.limits });
    if (decision.strategy === "stop") { result.failureCode = decision.reasonCode; break; }
    const strategy = decision.strategy === "luna_deep" ? "deep" : "surgical";
    const response = await input.model.propose({ candidate: structuredClone(champion),
      verification: structuredClone(verification), strategy, cycle,
      remainingCostUsd: decision.remainingCostUsd, attemptLessons: structuredClone(lessons) });
    result.cycles++;
    result.accountedCostUsd! += response.accountedCostUsd;
    result.inputTokens! += response.inputTokens;
    result.outputTokens! += response.outputTokens;
    validateCodingRepairProposal({ proposal: response.proposal, candidate: champion,
      artifactDigest: verification.artifactDigest,
      failureFingerprints: new Set(verification.failures.map(failure => failure.fingerprint)),
      limits: input.limits, expectedStrategy: strategy });
    const applied = applyProposal(champion, response.proposal);
    const lineLimit = strategy === "surgical" ? input.limits.surgicalChangedLines : input.limits.deepChangedLines;
    if (applied.changedLines > lineLimit) throw new Error("Normal benchmark changed-line limit exceeded.");
    result.changedFiles += response.proposal.changes.length;
    result.changedLines += applied.changedLines;
    const proposalDigest = digestCodingRepairProposal(response.proposal);
    const key = sha256(canonicalJson({ championArtifactDigest: verification.artifactDigest,
      failureFingerprint: target.fingerprint, proposalDigest }));
    const duplicate = attempted.has(key);
    attempted.add(key);
    const verificationStarted = performance.now();
    const next = duplicate ? verification : await input.verify(applied.candidate);
    const passing = new Set(passingVerificationChecks(next));
    const regression = passingVerificationChecks(verification).some(check => !passing.has(check))
      || next.failures.some(failure => failure.severity === "critical"
        || ["security", "timeout", "unknown"].includes(failure.kind));
    const improved = !duplicate && next.score > verification.score && !regression;
    const accepted = !duplicate && (next.passed || improved);
    const outcome = duplicate ? "duplicate_rejected" : next.passed ? "verified_complete"
      : improved ? "accepted_improvement" : "rolled_back";
    const reasonCode = duplicate ? "duplicate_proposal" : accepted
      ? next.passed ? "verified_clean" : "monotonic_improvement" : "regression_or_no_progress";
    const rye = duplicate ? 0 : repairYieldPerEnergy({ verificationGain: next.score - verification.score,
      costUsd: response.accountedCostUsd, changedLines: applied.changedLines,
      verificationMilliseconds: performance.now() - verificationStarted });
    ryeSum += rye;
    if (outcome === "rolled_back") result.rollbacks++;
    if (!next.passed) lessons = boundCodingRepairAttemptLessons([...lessons, buildCodingRepairAttemptLesson({
      cycle, requestedStrategy: strategy, proposalDigest, championArtifactDigest: verification.artifactDigest,
      proposedArtifactDigest: duplicate ? null : next.artifactDigest,
      changedPaths: response.proposal.changes.map(change => change.path),
      changedFiles: response.proposal.changes.length, changedLines: applied.changedLines,
      before: verification, after: next, beforeCandidate: champion, afterCandidate: applied.candidate,
      outcome: outcome === "verified_complete" ? "accepted_improvement" : outcome, reasonCode, rye,
    })]);
    result.failureCode = accepted && next.passed ? null : reasonCode;
    if (accepted) { champion = applied.candidate; verification = next; }
    if (verification.passed) break;
  }
  return { candidate: champion, verification, result: { ...result,
    verifiedComplete: verification.passed, finalScore: verification.score,
    finalArtifactDigest: verification.artifactDigest, verifierEvidenceDigests: verification.evidenceDigests,
    regression: hasRegression(input.baselineVerification, verification),
    criticalRegression: hasCriticalRegression(input.baselineVerification, verification),
    rye: result.cycles ? ryeSum / result.cycles : 0, activeExecutionMilliseconds: elapsedSince(input.started),
  } };
}

async function runReparodynamicArm(input: ArmInput): Promise<ArmOutcome> {
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
  return { candidate: run.champion, verification: run.verification, result: {
    method: "luna_reparodynamic",
    verifiedComplete: run.state === "VERIFIED_CANDIDATE" && run.verification.passed,
    finalScore: run.verification.score,
    activeExecutionMilliseconds: elapsedSince(input.started),
    accountedCostUsd: run.accountedCostUsd,
    inputTokens: run.receipts.reduce((total, receipt) => total + receipt.inputTokens, 0),
    outputTokens: run.receipts.reduce((total, receipt) => total + receipt.outputTokens, 0),
    cycles: receiptsWithModel.length,
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
  } };
}

// Capture the ceiling once, including its nested array; caller mutations cannot
// enlarge an already-admitted arm or the second arm of a pair.
const BENCHMARK_LIMIT_CEILING = structuredClone(INITIAL_CODING_REPAIR_LIMITS);
function snapshotLimits(supplied: CodingRepairLimits = BENCHMARK_LIMIT_CEILING): CodingRepairLimits {
  const limits = structuredClone(supplied);
  for (const key of ["maximumCycles", "surgicalFiles", "surgicalChangedLines", "deepFiles", "deepChangedLines"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > BENCHMARK_LIMIT_CEILING[key]) {
      throw new Error("Coding benchmark limits must not expand the admitted integer ceilings.");
    }
  }
  if (!Number.isFinite(limits.maximumModelSpendUsd) || limits.maximumModelSpendUsd <= 0
      || limits.maximumModelSpendUsd > BENCHMARK_LIMIT_CEILING.maximumModelSpendUsd) {
    throw new Error("Coding benchmark spend limit must not expand the admitted ceiling.");
  }
  if (!Array.isArray(limits.protectedPaths) || limits.protectedPaths.some(path => typeof path !== "string" || !path.trim())
      || BENCHMARK_LIMIT_CEILING.protectedPaths.some(path => !limits.protectedPaths.includes(path))) {
    throw new Error("Coding benchmark protected paths must not be removed.");
  }
  Object.freeze(limits.protectedPaths);
  return Object.freeze(limits);
}

// Evidence IDs can include run-specific attestations. Compare stable outcomes,
// then retain both sets of evidence instead of requiring identical timing IDs.
function stableOutcome(verification: ProgramVerificationResult): string {
  return canonicalJson({ artifactDigest: verification.artifactDigest, passed: verification.passed,
    score: verification.score, checks: [...verification.completedChecks].sort(),
    failures: verification.failures.map(({ kind, code, file, severity }) => ({ kind, code, file, severity })) });
}

export async function runCodingBenchmarkArm(input: {
  method: CodingBenchmarkMethod;
  benchmarkCase: CodingBenchmarkCase;
  context: CodingBenchmarkContext;
  verify(candidate: ProgramCandidateProposal): Promise<ProgramVerificationResult>;
  model: CodingRepairModel;
  limits?: CodingRepairLimits;
}): Promise<CodingBenchmarkArmResult> {
  const method = input.method;
  if (method !== "luna" && method !== "luna_reparodynamic") throw new Error("Coding benchmark method is unsupported.");
  const benchmarkCase = structuredClone(input.benchmarkCase);
  const context = structuredClone(input.context);
  const limits = snapshotLimits(input.limits);
  assertBenchmarkCase(benchmarkCase, context);
  const started = performance.now();
  const baseline = benchmarkCase.baseline;
  const verify = async (candidate: ProgramCandidateProposal) => structuredClone(await input.verify(structuredClone(candidate)));
  const baselineVerification = await verify(baseline);
  let modelCalls = 0;
  let accounted = 0;
  const trackedModel: CodingRepairModel = { propose: async (request) => {
    if (modelCalls >= limits.maximumCycles) throw new Error("Coding benchmark model call limit exceeded.");
    const available = Math.min(request.remainingCostUsd, limits.maximumModelSpendUsd - accounted);
    modelCalls++; // Count before the provider, including failed requests.
    const response = await input.model.propose(structuredClone({ ...request, remainingCostUsd: available }));
    if (!Number.isFinite(response.accountedCostUsd) || response.accountedCostUsd < 0
        || response.accountedCostUsd > available) throw new Error("Coding benchmark cost enforcement failed.");
    if (![response.inputTokens, response.outputTokens].every(count => Number.isSafeInteger(count) && count >= 0)) {
      throw new Error("Coding benchmark token accounting is malformed.");
    }
    accounted += response.accountedCostUsd;
    return structuredClone(response);
  } };
  let outcome: ArmOutcome;
  try {
    outcome = baselineVerification.passed
      ? { candidate: baseline, verification: baselineVerification,
          result: cleanBaselineResult(method, baselineVerification, elapsedSince(started)) }
      : await (method === "luna" ? runNormalArm : runReparodynamicArm)({
          baseline, baselineVerification, verify, model: trackedModel, limits, started });
  } catch (error) {
    const costFailure = error instanceof Error && /cost|budget/iu.test(error.message);
    return { ...cleanBaselineResult(method, baselineVerification, elapsedSince(started)),
      verifiedComplete: false, accountedCostUsd: modelCalls ? null : 0,
      inputTokens: modelCalls ? null : 0, outputTokens: modelCalls ? null : 0,
      cycles: modelCalls, failureCode: costFailure ? "cost_enforcement_failed" : "arm_execution_failed" };
  }
  // Every returned candidate, including a clean baseline, gets a fresh final
  // acceptance check. No previous PASS substitutes for this independent run.
  try {
    const final = await verify(outcome.candidate);
    const stable = stableOutcome(final) === stableOutcome(outcome.verification);
    return { ...outcome.result, activeExecutionMilliseconds: elapsedSince(started),
      verifiedComplete: stable && outcome.result.verifiedComplete && final.passed,
      finalScore: final.score, finalArtifactDigest: final.artifactDigest,
      regression: hasRegression(baselineVerification, final),
      criticalRegression: hasCriticalRegression(baselineVerification, final),
      verifierEvidenceDigests: [...new Set([...outcome.result.verifierEvidenceDigests, ...final.evidenceDigests])],
      failureCode: stable ? outcome.result.failureCode : "post_verification_failed" };
  } catch {
    return { ...outcome.result, verifiedComplete: false, failureCode: "post_verification_failed",
      activeExecutionMilliseconds: elapsedSince(started) };
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
  const keys = ["sourceCommit", "corpusDigest", "modelDigest", "controllerDigest", "policyDigest", "verifierDigest", "environmentDigest", "authorityDigest"].sort();
  if (canonicalJson(Object.keys(input.bindings).sort()) !== canonicalJson(keys)
      || Object.values(input.bindings).some((digest) => typeof digest !== "string" || !HEX_DIGEST.test(digest))) {
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
  input = { ...input, benchmarkCase: structuredClone(input.benchmarkCase),
    context: structuredClone(input.context), bindings: structuredClone(input.bindings), limits: snapshotLimits(input.limits) };
  assertRunIdentity(input);
  assertBenchmarkCase(input.benchmarkCase, input.context);
  if (input.executionKind !== undefined && input.executionKind !== "live" && input.executionKind !== "simulated") {
    throw new Error("Coding benchmark execution kind is unsupported.");
  }
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
    executionKind: input.executionKind ?? "simulated",
    order,
    bindings: structuredClone(input.bindings),
    normal: results.get("luna")!,
    reparodynamic: results.get("luna_reparodynamic")!,
    completedAt: completedAt(),
  };
}
