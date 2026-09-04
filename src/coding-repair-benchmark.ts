import type {
  CodingBenchmarkArmObservation,
  CodingBenchmarkPairReceipt,
} from "./coding-repair-evidence.ts";

export type CodingBenchmarkTaskIdentity = {
  taskId: string;
  taskDigest: string;
};

export type CodingBenchmarkArmMeasurement = Omit<CodingBenchmarkArmObservation, "arm">;

export type CodingBenchmarkArmRunner = (
  task: Readonly<CodingBenchmarkTaskIdentity>,
) => Promise<CodingBenchmarkArmMeasurement>;

export async function runPairedCodingBenchmark(_input: {
  pairId: string;
  corpusVersion: string;
  task: CodingBenchmarkTaskIdentity;
  canaryPercent: number;
  runBaseline: CodingBenchmarkArmRunner;
  runReparodynamic: CodingBenchmarkArmRunner;
  observedAt?: string;
}): Promise<CodingBenchmarkPairReceipt> {
  throw new Error("Paired coding benchmark execution is not implemented.");
}
