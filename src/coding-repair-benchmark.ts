import { canonicalJson, sha256 } from "./canonical.ts";
import {
  assertCodingBenchmarkPairReceipt,
  digestCodingBenchmarkBindings,
  type CodingBenchmarkArmName,
  type CodingBenchmarkArmObservation,
  type CodingBenchmarkBindings,
  type CodingBenchmarkEvidenceKind,
  type CodingBenchmarkPairReceipt,
  type CodingBenchmarkTaskClass,
} from "./coding-repair-evidence.ts";

export type CodingBenchmarkTaskIdentity = {
  taskId: string;
  taskClass: CodingBenchmarkTaskClass;
  trialIndex: number;
  evidenceKind: CodingBenchmarkEvidenceKind;
  taskDigest: string;
  caseDigest: string;
  startingArtifactDigest: string;
  licenseDigest: string | null;
  bindings: CodingBenchmarkBindings;
};

export type CodingBenchmarkArmMeasurement = Omit<CodingBenchmarkArmObservation, "arm">;
export type CodingBenchmarkArmRunner = (task: Readonly<CodingBenchmarkTaskIdentity>) => Promise<CodingBenchmarkArmMeasurement>;

function executionOrder(task: CodingBenchmarkTaskIdentity): readonly [CodingBenchmarkArmName, CodingBenchmarkArmName] {
  const digest = sha256(canonicalJson({ taskDigest: task.taskDigest, trialIndex: task.trialIndex }));
  return Number.parseInt(digest.slice(0, 2), 16) % 2 === 0
    ? ["baseline", "reparodynamic"]
    : ["reparodynamic", "baseline"];
}

function freezeTask(task: CodingBenchmarkTaskIdentity): Readonly<CodingBenchmarkTaskIdentity> {
  return Object.freeze({ ...task, bindings: Object.freeze({ ...task.bindings }) });
}

export async function runPairedCodingBenchmark(input: {
  pairId: string;
  protocolDigest: string;
  corpusVersion: string;
  corpusDigest: string;
  currentIdentityDigest: string;
  task: CodingBenchmarkTaskIdentity;
  canaryPercent: number;
  runBaseline: CodingBenchmarkArmRunner;
  runReparodynamic: CodingBenchmarkArmRunner;
  observedAt?: string;
}): Promise<CodingBenchmarkPairReceipt> {
  const task = freezeTask(input.task);
  const identityDigest = digestCodingBenchmarkBindings(task.bindings);
  if (identityDigest !== input.currentIdentityDigest) throw new Error("Coding benchmark task bindings do not match the current method identity.");
  const order = executionOrder(task);
  let baseline: CodingBenchmarkArmMeasurement | undefined;
  let reparodynamic: CodingBenchmarkArmMeasurement | undefined;
  for (const arm of order) {
    if (arm === "baseline") baseline = await input.runBaseline(task);
    else reparodynamic = await input.runReparodynamic(task);
  }
  if (!baseline || !reparodynamic) throw new Error("Coding benchmark did not complete both arms.");
  const receipt: CodingBenchmarkPairReceipt = {
    schemaVersion: 2,
    pairId: input.pairId,
    protocolDigest: input.protocolDigest,
    corpusVersion: input.corpusVersion,
    corpusDigest: input.corpusDigest,
    identityDigest,
    bindings: { ...task.bindings },
    taskId: task.taskId,
    taskClass: task.taskClass,
    trialIndex: task.trialIndex,
    evidenceKind: task.evidenceKind,
    taskDigest: task.taskDigest,
    caseDigest: task.caseDigest,
    startingArtifactDigest: task.startingArtifactDigest,
    licenseDigest: task.licenseDigest,
    canaryPercent: input.canaryPercent,
    executionOrder: order,
    baseline: { arm: "baseline", ...baseline },
    reparodynamic: { arm: "reparodynamic", ...reparodynamic },
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  assertCodingBenchmarkPairReceipt(receipt);
  return receipt;
}
