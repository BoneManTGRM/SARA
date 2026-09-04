import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingRepairReceipt, CodingRepairRun } from "./coding-repair-types.ts";

export async function persistCodingRepairReceipt(input: {
  stateDirectory: string;
  runId: string;
  receipt: CodingRepairReceipt;
}): Promise<void> {
  if (!/^[0-9a-f-]{36}$/iu.test(input.runId)) throw new Error("Coding repair run id is malformed.");
  const directory = join(input.stateDirectory, "coding-repair-receipts", input.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const envelope = {
    schemaVersion: 1,
    runId: input.runId,
    receipt: input.receipt,
    receiptDigest: sha256(canonicalJson(input.receipt)),
  } as const;
  await writeFile(
    join(directory, `${String(input.receipt.cycle).padStart(2, "0")}.json`),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
}

export async function persistCodingRepairRun(input: {
  stateDirectory: string;
  runId: string;
  run: CodingRepairRun;
}): Promise<void> {
  if (!/^[0-9a-f-]{36}$/iu.test(input.runId)) throw new Error("Coding repair run id is malformed.");
  const directory = join(input.stateDirectory, "coding-repair-receipts", input.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const summary = {
    schemaVersion: 1,
    runId: input.runId,
    state: input.run.state,
    baselineArtifactDigest: input.run.baselineVerification.artifactDigest,
    finalArtifactDigest: input.run.verification.artifactDigest,
    baselineScore: input.run.baselineVerification.score,
    finalScore: input.run.verification.score,
    verifiedAccuracyGain: input.run.verification.score - input.run.baselineVerification.score,
    verifiedComplete: input.run.state === "VERIFIED_CANDIDATE",
    cycles: input.run.receipts.length,
    changedLines: input.run.receipts.reduce((total, receipt) => total + receipt.changedLines, 0),
    accountedCostUsd: input.run.accountedCostUsd,
    elapsedMilliseconds: input.run.elapsedMilliseconds,
    receiptDigests: input.run.receipts.map((receipt) => sha256(canonicalJson(receipt))),
  } as const;
  await writeFile(join(directory, "run.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}
