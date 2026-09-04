import type { CodingBenchmarkArmName, CodingBenchmarkArmObservation, CodingBenchmarkPairReceipt } from "./coding-repair-evidence.ts";
import { assertCodingBenchmarkPairReceipt } from "./coding-repair-evidence.ts";

export type CodingBenchmarkTaskIdentity = {
  taskId: string;
  taskDigest: string;
};

export type CodingBenchmarkArmMeasurement = Omit<CodingBenchmarkArmObservation, "arm">;

export type CodingBenchmarkArmRunner = (
  task: Readonly<CodingBenchmarkTaskIdentity>,
) => Promise<CodingBenchmarkArmMeasurement>;

function executionOrder(taskDigest: string): readonly [CodingBenchmarkArmName, CodingBenchmarkArmName] {
  const baselineFirst = Number.parseInt(taskDigest.slice(0, 2), 16) % 2 === 0;
  return baselineFirst ? ["baseline", "reparodynamic"] : ["reparodynamic", "baseline"];
}

export async function runPairedCodingBenchmark(input: {
  pairId: string;
  protocolDigest: string;
  corpusVersion: string;
  task: CodingBenchmarkTaskIdentity;
  canaryPercent: number;
  runBaseline: CodingBenchmarkArmRunner;
  runReparodynamic: CodingBenchmarkArmRunner;
  observedAt?: string;
}): Promise<CodingBenchmarkPairReceipt> {
  const task = Object.freeze({ ...input.task });
  const order = executionOrder(task.taskDigest);
  let baseline: CodingBenchmarkArmMeasurement | undefined;
  let reparodynamic: CodingBenchmarkArmMeasurement | undefined;
  for (const arm of order) {
    if (arm === "baseline") baseline = await input.runBaseline(task);
    else reparodynamic = await input.runReparodynamic(task);
  }
  if (!baseline || !reparodynamic) throw new Error("Coding benchmark did not complete both arms.");
  const receipt: CodingBenchmarkPairReceipt = {
    schemaVersion: 1,
    pairId: input.pairId,
    protocolDigest: input.protocolDigest,
    corpusVersion: input.corpusVersion,
    taskId: task.taskId,
    taskDigest: task.taskDigest,
    canaryPercent: input.canaryPercent,
    executionOrder: order,
    baseline: { arm: "baseline", ...baseline },
    reparodynamic: { arm: "reparodynamic", ...reparodynamic },
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  assertCodingBenchmarkPairReceipt(receipt);
  return receipt;
}
