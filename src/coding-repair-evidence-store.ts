import type {
  CodingBenchmarkAggregate,
  CodingBenchmarkPairReceipt,
  CodingRolloutDecision,
} from "./coding-repair-evidence.ts";

export async function persistCodingBenchmarkPair(_input: {
  stateDirectory: string;
  pair: CodingBenchmarkPairReceipt;
}): Promise<void> {
  throw new Error("Coding benchmark evidence persistence is not implemented.");
}

export async function loadCodingBenchmarkPairs(_input: {
  stateDirectory: string;
  corpusVersion: string;
  canaryPercent: number;
}): Promise<CodingBenchmarkPairReceipt[]> {
  throw new Error("Coding benchmark evidence loading is not implemented.");
}

export async function persistCodingBenchmarkSummary(_input: {
  stateDirectory: string;
  aggregate: CodingBenchmarkAggregate;
  decision: CodingRolloutDecision;
}): Promise<void> {
  throw new Error("Coding benchmark summary persistence is not implemented.");
}
