import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import { validateProgramCandidateStructure } from "./genome-lab.ts";
import { assertCodingRepairVerification, codingRepairCandidateDigest } from "./experimental-v5/coding-repair-verification.ts";
import { createLunaCodingRepairModel } from "./luna-coding-repair-model.ts";
import type { CodingRepairModel } from "./coding-repair-controller.ts";

export type RepairFormatDecision = Readonly<{
  schemaVersion: 1;
  cycle: number;
  artifactDigest: string;
  strategy: "surgical" | "deep";
  format: "full_files" | "compact_edits";
  reason: "small_source" | "deep_repair" | "large_localized_repair" | "large_unlocalized_repair";
  largestRelevantSourceBytes: number;
}>;
type Request = Parameters<CodingRepairModel["propose"]>[0];
const LOCALIZED_MIN_BYTES = 2048;
const UNLOCALIZED_MIN_BYTES = 4096;

/** A representation heuristic, not an estimate of tokens, correctness, or elapsed time. */
export function selectRepairOutputFormat(request: Request): RepairFormatDecision {
  validateProgramCandidateStructure(request.candidate);
  assertCodingRepairVerification(request.verification);
  if (request.verification.passed || request.verification.failures.length === 0 ||
      request.verification.artifactDigest !== codingRepairCandidateDigest(request.candidate) ||
      !Number.isInteger(request.cycle) || request.cycle < 1 || request.cycle > INITIAL_CODING_REPAIR_LIMITS.maximumCycles ||
      !Number.isFinite(request.remainingCostUsd) || request.remainingCostUsd <= 0 ||
      request.remainingCostUsd > INITIAL_CODING_REPAIR_LIMITS.maximumModelSpendUsd ||
      (request.strategy !== "surgical" && request.strategy !== "deep")) {
    throw new Error("REPAIR_FORMAT_INVALID_REQUEST");
  }
  const sources = request.candidate.files.filter(file => file.path.startsWith("src/") &&
    !INITIAL_CODING_REPAIR_LIMITS.protectedPaths.some(path => file.path === path || file.path.startsWith(path)));
  const located = sources.filter(file => request.verification.failures.some(failure => failure.file === file.path));
  // No protected test text or test size affects this decision. With no visible
  // file location, only large source modules qualify for the representation change.
  const largestRelevantSourceBytes = Math.max(0, ...(located.length ? located : sources).map(file => Buffer.byteLength(file.content)));
  const large = largestRelevantSourceBytes >= (located.length ? LOCALIZED_MIN_BYTES : UNLOCALIZED_MIN_BYTES);
  const compact = request.strategy === "surgical" && large;
  return Object.freeze({ schemaVersion: 1, cycle: request.cycle, artifactDigest: request.verification.artifactDigest,
    strategy: request.strategy, format: compact ? "compact_edits" : "full_files",
    reason: request.strategy === "deep" ? "deep_repair" : !large ? "small_source" :
      located.length ? "large_localized_repair" : "large_unlocalized_repair", largestRelevantSourceBytes });
}

/** Canary owner route only. Existing frozen benchmark callers are unchanged. */
export function createAdaptiveCodingRepairModel(input: Pick<Parameters<typeof createLunaCodingRepairModel>[0], "client" | "context"> & {
  onFormat(decision: RepairFormatDecision): Promise<void> | void;
}): CodingRepairModel {
  // Deliberately do not inherit caller-supplied experimental switches.
  const context = structuredClone(input.context);
  const full = createLunaCodingRepairModel({ client: input.client, context });
  const compact = createLunaCodingRepairModel({ client: input.client, context,
    compactRepairContinuations: true, experimentalCompactFirstProposal: true });
  return { async propose(request) {
    request = structuredClone(request);
    const decision = selectRepairOutputFormat(request);
    // Persist intent before token counting or provider execution. Failure is fatal;
    // never retry an uncertain/invalid compact response as an extra full-file call.
    await input.onFormat(structuredClone(decision));
    return (decision.format === "compact_edits" ? compact : full).propose(request);
  } };
}

/** This is pre-dispatch intent, not a receipt that a provider call succeeded. */
export async function persistRepairFormatDecision(input: {
  stateDirectory: string; runId: string; decision: RepairFormatDecision;
}): Promise<void> {
  const decision = structuredClone(input.decision);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(input.runId) ||
      !Number.isInteger(decision.cycle) || decision.cycle < 1 || decision.cycle > INITIAL_CODING_REPAIR_LIMITS.maximumCycles) {
    throw new Error("REPAIR_FORMAT_INVALID_RECEIPT_ID");
  }
  const directory = join(input.stateDirectory, "coding-repair-receipts", input.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(join(directory, `format-${decision.cycle}.json`), "wx", 0o600);
  try { await file.writeFile(canonicalJson({ schemaVersion: 1, runId: input.runId,
    phase: "before_dispatch", decision, digest: sha256(canonicalJson(decision)) }), "utf8"); await file.sync(); }
  finally { await file.close(); }
  const dir = await open(directory, "r");
  try { await dir.sync(); } finally { await dir.close(); }
}
