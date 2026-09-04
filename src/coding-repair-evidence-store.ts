import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import {
  assertCodingBenchmarkAggregate,
  assertCodingBenchmarkPairReceipt,
  assertCodingRolloutDecision,
  type CodingBenchmarkAggregate,
  type CodingBenchmarkPairReceipt,
  type CodingRolloutDecision,
} from "./coding-repair-evidence.ts";

const MAX_PAIR_FILES = 1_000;
const HEX_64 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function assertScope(protocolDigest: string, corpusVersion: string, canaryPercent: number): void {
  if (!HEX_64.test(protocolDigest)) throw new Error("Coding benchmark protocol digest is malformed.");
  if (!SAFE_ID.test(corpusVersion)) throw new Error("Coding benchmark corpus version is malformed.");
  if (!Number.isInteger(canaryPercent) || canaryPercent < 1 || canaryPercent > 100) {
    throw new Error("Coding benchmark canary percent must be an integer from 1 through 100.");
  }
}

function benchmarkDirectory(stateDirectory: string, protocolDigest: string, corpusVersion: string, canaryPercent: number): string {
  assertScope(protocolDigest, corpusVersion, canaryPercent);
  return join(stateDirectory, "coding-repair-benchmarks", corpusVersion, protocolDigest, String(canaryPercent).padStart(3, "0"));
}

function parsePairEnvelope(value: unknown): { pair: CodingBenchmarkPairReceipt; pairDigest: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Coding benchmark envelope is malformed.");
  const envelope = value as { schemaVersion?: unknown; pair?: unknown; pairDigest?: unknown };
  if (envelope.schemaVersion !== 1 || typeof envelope.pairDigest !== "string" || !HEX_64.test(envelope.pairDigest)) {
    throw new Error("Coding benchmark envelope metadata is malformed.");
  }
  const pair = envelope.pair as CodingBenchmarkPairReceipt;
  assertCodingBenchmarkPairReceipt(pair);
  if (sha256(canonicalJson(pair)) !== envelope.pairDigest) throw new Error("Coding benchmark pair digest verification failed.");
  return { pair, pairDigest: envelope.pairDigest };
}

export async function persistCodingBenchmarkPair(input: {
  stateDirectory: string;
  pair: CodingBenchmarkPairReceipt;
}): Promise<void> {
  assertCodingBenchmarkPairReceipt(input.pair);
  const directory = benchmarkDirectory(input.stateDirectory, input.pair.protocolDigest, input.pair.corpusVersion, input.pair.canaryPercent);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const envelope = {
    schemaVersion: 1,
    pair: input.pair,
    pairDigest: sha256(canonicalJson(input.pair)),
  } as const;
  const path = join(directory, `${input.pair.pairId}.json`);
  try {
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = parsePairEnvelope(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (existing.pairDigest !== envelope.pairDigest) throw new Error("Coding benchmark pair id already exists with different evidence.");
  }
}

export async function loadCodingBenchmarkPairs(input: {
  stateDirectory: string;
  protocolDigest: string;
  corpusVersion: string;
  canaryPercent: number;
}): Promise<CodingBenchmarkPairReceipt[]> {
  const directory = benchmarkDirectory(input.stateDirectory, input.protocolDigest, input.corpusVersion, input.canaryPercent);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== "summary.json").sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (names.length > MAX_PAIR_FILES) throw new Error("Coding benchmark evidence exceeds the bounded file limit.");
  const pairs: CodingBenchmarkPairReceipt[] = [];
  for (const name of names) {
    const { pair } = parsePairEnvelope(JSON.parse(await readFile(join(directory, name), "utf8")) as unknown);
    if (`${pair.pairId}.json` !== name) throw new Error("Coding benchmark pair filename does not match its identity.");
    if (pair.protocolDigest !== input.protocolDigest || pair.corpusVersion !== input.corpusVersion || pair.canaryPercent !== input.canaryPercent) {
      throw new Error("Coding benchmark pair is stored under the wrong evidence scope.");
    }
    pairs.push(pair);
  }
  return pairs.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.pairId.localeCompare(right.pairId));
}

export async function persistCodingBenchmarkSummary(input: {
  stateDirectory: string;
  aggregate: CodingBenchmarkAggregate;
  decision: CodingRolloutDecision;
}): Promise<void> {
  assertCodingBenchmarkAggregate(input.aggregate);
  assertCodingRolloutDecision({ aggregate: input.aggregate, decision: input.decision });
  const directory = benchmarkDirectory(input.stateDirectory, input.aggregate.protocolDigest, input.aggregate.corpusVersion, input.aggregate.canaryPercent);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const body = {
    schemaVersion: 1,
    aggregate: input.aggregate,
    decision: input.decision,
  } as const;
  const envelope = {
    ...body,
    summaryDigest: sha256(canonicalJson(body)),
  } as const;
  const temporary = join(directory, `.summary-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, join(directory, "summary.json"));
}
