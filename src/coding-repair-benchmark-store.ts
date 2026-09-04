import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import {
  summarizeCodingBenchmark,
  type CodingBenchmarkArmResult,
  type CodingBenchmarkBindings,
  type CodingBenchmarkMethod,
  type CodingBenchmarkPairReceipt,
  type CodingBenchmarkPromotionDecision,
  type CodingBenchmarkSummary,
} from "./coding-repair-benchmark.ts";

export type CodingBenchmarkManifest = {
  schemaVersion: 1;
  benchmarkId: string;
  bindings: CodingBenchmarkBindings;
  currentCanaryPercent: number;
  maximumSpendUsd: number;
  caseIds: string[];
  createdAt: string;
};

export type CodingBenchmarkArmReceipt = {
  schemaVersion: 1;
  benchmarkId: string;
  pairIndex: number;
  caseId: string;
  bindings: CodingBenchmarkBindings;
  result: CodingBenchmarkArmResult;
  completedAt: string;
};

export type CodingBenchmarkEvidenceSnapshot = {
  schemaVersion: 1;
  benchmarkId: string;
  summary: CodingBenchmarkSummary;
  decision: CodingBenchmarkPromotionDecision;
};

export type CodingBenchmarkProgress = {
  manifest: CodingBenchmarkManifest;
  armReceipts: CodingBenchmarkArmReceipt[];
  pairs: CodingBenchmarkPairReceipt[];
  snapshots: CodingBenchmarkEvidenceSnapshot[];
};

type EvidenceKind = "manifest" | "arm" | "pair" | "snapshot";
type EvidenceEnvelope<T> = {
  schemaVersion: 1;
  kind: EvidenceKind;
  payload: T;
  payloadDigest: string;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_DIGEST = /^[a-f0-9]{64}$/u;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BINDING_KEYS: Array<keyof CodingBenchmarkBindings> = [
  "sourceCommit",
  "corpusDigest",
  "modelDigest",
  "controllerDigest",
  "policyDigest",
  "verifierDigest",
  "environmentDigest",
  "authorityDigest",
];

function benchmarkDirectory(stateDirectory: string, benchmarkId: string): string {
  if (!UUID_V4.test(benchmarkId)) throw new Error("Benchmark id must be a UUID v4.");
  return join(stateDirectory, "coding-repair-benchmarks", benchmarkId);
}

function pairPrefix(pairIndex: number): string {
  if (!Number.isInteger(pairIndex) || pairIndex < 1 || pairIndex > 9_999) {
    throw new Error("Benchmark pair index must be an integer from 1 through 9999.");
  }
  return String(pairIndex).padStart(4, "0");
}

function assertBindings(bindings: CodingBenchmarkBindings): void {
  for (const key of BINDING_KEYS) {
    if (!HEX_DIGEST.test(bindings[key])) throw new Error(`Benchmark binding ${key} is malformed.`);
  }
}

function assertManifest(manifest: CodingBenchmarkManifest): void {
  if (manifest.schemaVersion !== 1) throw new Error("Benchmark manifest schema version is unsupported.");
  if (!UUID_V4.test(manifest.benchmarkId)) throw new Error("Benchmark manifest id must be a UUID v4.");
  assertBindings(manifest.bindings);
  if (
    !Number.isInteger(manifest.currentCanaryPercent)
    || manifest.currentCanaryPercent < 0
    || manifest.currentCanaryPercent > 100
  ) throw new Error("Benchmark current canary percent must be an integer from 0 through 100.");
  if (!Number.isFinite(manifest.maximumSpendUsd) || manifest.maximumSpendUsd <= 0 || manifest.maximumSpendUsd > 100) {
    throw new Error("Benchmark maximum spend must be greater than 0 and no more than 100 USD.");
  }
  if (!manifest.caseIds.length || manifest.caseIds.length > 9_999) {
    throw new Error("Benchmark manifest requires bounded cases.");
  }
  if (
    new Set(manifest.caseIds).size !== manifest.caseIds.length
    || manifest.caseIds.some((caseId) => !CASE_ID.test(caseId))
  ) throw new Error("Benchmark case ids must be unique and safely formatted.");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Benchmark manifest timestamp is malformed.");
}

function assertArmResult(result: CodingBenchmarkArmResult): void {
  if (result.method !== "luna" && result.method !== "luna_reparodynamic") {
    throw new Error("Benchmark arm method is invalid.");
  }
  if (!Number.isFinite(result.finalScore) || result.finalScore < 0 || result.finalScore > 1) {
    throw new Error("Benchmark arm score is invalid.");
  }
  if (!Number.isFinite(result.activeExecutionMilliseconds) || result.activeExecutionMilliseconds <= 0) {
    throw new Error("Benchmark arm runtime is invalid.");
  }
  if (
    result.accountedCostUsd !== null
    && (!Number.isFinite(result.accountedCostUsd) || result.accountedCostUsd < 0)
  ) throw new Error("Benchmark arm cost is invalid.");
  for (const value of [result.inputTokens, result.outputTokens]) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error("Benchmark arm token accounting is invalid.");
    }
  }
  for (const value of [result.cycles, result.rollbacks, result.changedFiles, result.changedLines]) {
    if (!Number.isInteger(value) || value < 0) throw new Error("Benchmark arm count is invalid.");
  }
  if (!Number.isFinite(result.rye) || result.rye < 0) throw new Error("Benchmark arm RYE is invalid.");
  if (!HEX_DIGEST.test(result.finalArtifactDigest)) throw new Error("Benchmark arm artifact digest is invalid.");
  if (
    !result.verifierEvidenceDigests.length
    || result.verifierEvidenceDigests.some((digest) => !HEX_DIGEST.test(digest))
  ) throw new Error("Benchmark arm verifier evidence is invalid.");
}

function assertArmReceipt(receipt: CodingBenchmarkArmReceipt): void {
  if (receipt.schemaVersion !== 1) throw new Error("Benchmark arm receipt schema version is unsupported.");
  if (!UUID_V4.test(receipt.benchmarkId)) throw new Error("Benchmark arm receipt id is malformed.");
  pairPrefix(receipt.pairIndex);
  if (!CASE_ID.test(receipt.caseId)) throw new Error("Benchmark arm receipt case id is malformed.");
  assertBindings(receipt.bindings);
  assertArmResult(receipt.result);
  if (!Number.isFinite(Date.parse(receipt.completedAt))) throw new Error("Benchmark arm receipt timestamp is malformed.");
}

function assertMatchesManifest(input: {
  manifest: CodingBenchmarkManifest;
  benchmarkId: string;
  pairIndex: number;
  caseId: string;
  bindings: CodingBenchmarkBindings;
}): void {
  if (input.benchmarkId !== input.manifest.benchmarkId) {
    throw new Error("Benchmark evidence does not match its manifest id.");
  }
  if (input.manifest.caseIds[input.pairIndex - 1] !== input.caseId) {
    throw new Error("Benchmark evidence does not match the frozen case order.");
  }
  if (canonicalJson(input.bindings) !== canonicalJson(input.manifest.bindings)) {
    throw new Error("Benchmark evidence bindings do not match the manifest.");
  }
}

async function writeImmutableEnvelope<T>(path: string, kind: EvidenceKind, payload: T): Promise<void> {
  const payloadDigest = sha256(canonicalJson(payload));
  const envelope: EvidenceEnvelope<T> = { schemaVersion: 1, kind, payload, payloadDigest };
  try {
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readEnvelope<T>(path, kind);
    if (sha256(canonicalJson(existing)) !== payloadDigest) {
      throw new Error("New evidence conflicts with immutable benchmark evidence.");
    }
  }
}

async function readEnvelope<T>(path: string, expectedKind: EvidenceKind): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new Error("Persisted benchmark evidence is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Persisted benchmark evidence envelope is malformed.");
  }
  const envelope = parsed as Partial<EvidenceEnvelope<T>>;
  if (
    envelope.schemaVersion !== 1
    || envelope.kind !== expectedKind
    || !HEX_DIGEST.test(String(envelope.payloadDigest ?? ""))
  ) throw new Error("Persisted benchmark evidence envelope is malformed.");
  if (sha256(canonicalJson(envelope.payload)) !== envelope.payloadDigest) {
    throw new Error("Persisted benchmark evidence digest mismatch.");
  }
  return structuredClone(envelope.payload as T);
}

async function readManifest(stateDirectory: string, benchmarkId: string): Promise<CodingBenchmarkManifest> {
  const manifest = await readEnvelope<CodingBenchmarkManifest>(
    join(benchmarkDirectory(stateDirectory, benchmarkId), "manifest.json"),
    "manifest",
  );
  assertManifest(manifest);
  if (manifest.benchmarkId !== benchmarkId) {
    throw new Error("Persisted benchmark manifest id does not match its directory.");
  }
  return manifest;
}

export async function initializeCodingBenchmarkStore(input: {
  stateDirectory: string;
  manifest: CodingBenchmarkManifest;
}): Promise<void> {
  assertManifest(input.manifest);
  const directory = benchmarkDirectory(input.stateDirectory, input.manifest.benchmarkId);
  await Promise.all([
    mkdir(join(directory, "pairs"), { recursive: true, mode: 0o700 }),
    mkdir(join(directory, "snapshots"), { recursive: true, mode: 0o700 }),
  ]);
  await writeImmutableEnvelope(join(directory, "manifest.json"), "manifest", input.manifest);
}

export async function persistCodingBenchmarkArmReceipt(input: {
  stateDirectory: string;
  receipt: CodingBenchmarkArmReceipt;
}): Promise<void> {
  assertArmReceipt(input.receipt);
  const manifest = await readManifest(input.stateDirectory, input.receipt.benchmarkId);
  assertMatchesManifest({ manifest, ...input.receipt });
  const path = join(
    benchmarkDirectory(input.stateDirectory, input.receipt.benchmarkId),
    "pairs",
    `${pairPrefix(input.receipt.pairIndex)}-${input.receipt.result.method}.json`,
  );
  await writeImmutableEnvelope(path, "arm", input.receipt);
}

export async function persistCodingBenchmarkPairReceipt(input: {
  stateDirectory: string;
  pair: CodingBenchmarkPairReceipt;
}): Promise<void> {
  summarizeCodingBenchmark({ pairs: [input.pair], bootstrapSamples: 500 });
  const manifest = await readManifest(input.stateDirectory, input.pair.benchmarkId);
  assertMatchesManifest({ manifest, ...input.pair });
  const path = join(
    benchmarkDirectory(input.stateDirectory, input.pair.benchmarkId),
    "pairs",
    `${pairPrefix(input.pair.pairIndex)}-pair.json`,
  );
  await writeImmutableEnvelope(path, "pair", input.pair);
}

export async function persistCodingBenchmarkEvidenceSnapshot(input: {
  stateDirectory: string;
  summary: CodingBenchmarkSummary;
  decision: CodingBenchmarkPromotionDecision;
}): Promise<void> {
  if (input.decision.proofDigest !== input.summary.proofDigest) {
    throw new Error("Benchmark decision is not bound to its summary proof.");
  }
  const manifest = await readManifest(input.stateDirectory, input.summary.benchmarkId);
  if (input.summary.bindings.corpusDigest !== manifest.bindings.corpusDigest) {
    throw new Error("Benchmark summary does not match the frozen corpus.");
  }
  const snapshot: CodingBenchmarkEvidenceSnapshot = {
    schemaVersion: 1,
    benchmarkId: input.summary.benchmarkId,
    summary: input.summary,
    decision: input.decision,
  };
  await writeImmutableEnvelope(
    join(
      benchmarkDirectory(input.stateDirectory, input.summary.benchmarkId),
      "snapshots",
      `${input.summary.proofDigest}.json`,
    ),
    "snapshot",
    snapshot,
  );
}

async function listJson(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadCodingBenchmarkProgress(input: {
  stateDirectory: string;
  benchmarkId: string;
}): Promise<CodingBenchmarkProgress> {
  const manifest = await readManifest(input.stateDirectory, input.benchmarkId);
  const directory = benchmarkDirectory(input.stateDirectory, input.benchmarkId);
  const armReceipts: CodingBenchmarkArmReceipt[] = [];
  const pairs: CodingBenchmarkPairReceipt[] = [];
  for (const name of await listJson(join(directory, "pairs"))) {
    const armMatch = name.match(/^(\d{4})-(luna|luna_reparodynamic)\.json$/u);
    const pairMatch = name.match(/^(\d{4})-pair\.json$/u);
    if (armMatch) {
      const receipt = await readEnvelope<CodingBenchmarkArmReceipt>(join(directory, "pairs", name), "arm");
      assertArmReceipt(receipt);
      assertMatchesManifest({ manifest, ...receipt });
      if (pairPrefix(receipt.pairIndex) !== armMatch[1] || receipt.result.method !== armMatch[2]) {
        throw new Error("Persisted benchmark arm filename does not match its payload.");
      }
      armReceipts.push(receipt);
      continue;
    }
    if (pairMatch) {
      const pair = await readEnvelope<CodingBenchmarkPairReceipt>(join(directory, "pairs", name), "pair");
      summarizeCodingBenchmark({ pairs: [pair], bootstrapSamples: 500 });
      assertMatchesManifest({ manifest, ...pair });
      if (pairPrefix(pair.pairIndex) !== pairMatch[1]) {
        throw new Error("Persisted benchmark pair filename does not match its payload.");
      }
      pairs.push(pair);
      continue;
    }
    throw new Error("Benchmark pair directory contains an unexpected JSON evidence file.");
  }
  const snapshots: CodingBenchmarkEvidenceSnapshot[] = [];
  for (const name of await listJson(join(directory, "snapshots"))) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) throw new Error("Benchmark snapshot filename is malformed.");
    const snapshot = await readEnvelope<CodingBenchmarkEvidenceSnapshot>(
      join(directory, "snapshots", name),
      "snapshot",
    );
    if (
      snapshot.schemaVersion !== 1
      || snapshot.benchmarkId !== manifest.benchmarkId
      || snapshot.summary.proofDigest !== snapshot.decision.proofDigest
      || `${snapshot.summary.proofDigest}.json` !== name
    ) throw new Error("Persisted benchmark snapshot is not internally bound.");
    snapshots.push(snapshot);
  }
  armReceipts.sort((left, right) => (
    left.pairIndex - right.pairIndex || left.result.method.localeCompare(right.result.method)
  ));
  pairs.sort((left, right) => left.pairIndex - right.pairIndex);
  snapshots.sort((left, right) => left.summary.proofDigest.localeCompare(right.summary.proofDigest));
  return { manifest, armReceipts, pairs, snapshots };
}

export function missingCodingBenchmarkArms(
  progress: CodingBenchmarkProgress,
  pairIndex: number,
): CodingBenchmarkMethod[] {
  pairPrefix(pairIndex);
  if (progress.pairs.some((pair) => pair.pairIndex === pairIndex)) return [];
  const completed = new Set(
    progress.armReceipts
      .filter((receipt) => receipt.pairIndex === pairIndex)
      .map((receipt) => receipt.result.method),
  );
  return (["luna", "luna_reparodynamic"] as const).filter((method) => !completed.has(method));
}
