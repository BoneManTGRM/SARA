import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingRepairReuseSummary } from "./reusable-coding-candidate-generator.ts";

export async function persistCodingRepairReuse(input: { stateDirectory: string; runId: string; summary: CodingRepairReuseSummary }): Promise<void> {
  if (!/^[0-9a-f-]{36}$/iu.test(input.runId)) throw new Error("Coding repair run id is malformed.");
  const directory = join(input.stateDirectory, "coding-repair-receipts", input.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const data = { schemaVersion: 1, runId: input.runId, summary: input.summary, digest: sha256(canonicalJson(input.summary)) };
  const file = await open(join(directory, "reuse.json"), "wx", 0o600);
  try { await file.writeFile(canonicalJson(data), "utf8"); await file.sync(); } finally { await file.close(); }
}
