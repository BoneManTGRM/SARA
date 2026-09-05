import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalJson, sha256 } from "../src/canonical.ts";

// Historical paid contracts are permanently consumed, including the accidental replay.
const RETIRED = new Set([
  "a4bfe2d24b4ca3d6ee537b7e5cf014faf16a0da6a766254236a104447dc13030",
  "88674aed1970e107e1e92aec10f8cfc52f58f0b8f757d42883f45ef0128c18c1",
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export type BenchmarkRunGrant = {
  experimentId: string; contractDigest: string; implementationCommit: string;
  deploymentId: string; expiresAt: number; maximumPhysicalSpendUsd: number;
};

export function benchmarkClaimKey(contractDigest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(contractDigest)) throw new Error("INVALID_CONTRACT_DIGEST");
  return sha256(canonicalJson({ schemaVersion: 2, contractDigest }));
}

/**
 * Owner-side launcher gate, NOT candidate or Railway-container authorization.
 * The trusted supervisor supplies a separately authorized grant and an existing,
 * private, durable local ledger outside the disposable runner. No default store.
 * Atomic claims require local filesystem O_EXCL semantics; not supported on NFS.
 * Never delete a claim after failure: uncertain usage must consume the grant.
 * This module does not obtain credentials, launch deployments or call providers.
 */
export async function claimBenchmarkRun(input: {
  ledgerDirectory: string;
  grant: BenchmarkRunGrant;
  observed: Pick<BenchmarkRunGrant, "contractDigest" | "implementationCommit" | "deploymentId">;
  now: number;
}): Promise<void> {
  const { grant, observed, now } = input;
  if (RETIRED.has(grant.contractDigest) || RETIRED.has(observed.contractDigest)) throw new Error("RETIRED_CONTRACT");
  if (
    !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(grant.experimentId) ||
    !/^[a-f0-9]{64}$/u.test(grant.contractDigest) || !/^[a-f0-9]{40}$/u.test(grant.implementationCommit) ||
    !UUID.test(grant.deploymentId) || !Number.isSafeInteger(grant.expiresAt) || !Number.isSafeInteger(now) ||
    now < 0 || !Number.isFinite(grant.maximumPhysicalSpendUsd) || grant.maximumPhysicalSpendUsd <= 0 ||
    grant.maximumPhysicalSpendUsd > 0.15
  ) throw new Error("INVALID_GRANT");
  if (now >= grant.expiresAt) throw new Error("EXPIRED_GRANT");
  if (grant.contractDigest !== observed.contractDigest || grant.implementationCommit !== observed.implementationCommit ||
      grant.deploymentId !== observed.deploymentId) throw new Error("IDENTITY_MISMATCH");
  if (!input.ledgerDirectory || !isAbsolute(input.ledgerDirectory)) throw new Error("LEDGER_REQUIRED");
  if (process.env.RAILWAY_DEPLOYMENT_ID) throw new Error("EXTERNAL_SUPERVISOR_REQUIRED");
  const directory = resolve(input.ledgerDirectory);
  let directorySafe = false;
  try {
    const stat = await lstat(directory);
    directorySafe = stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && await realpath(directory) === directory;
  } catch { /* Missing or unreadable ledgers deny admission. */ }
  if (!directorySafe) throw new Error("LEDGER_UNAVAILABLE");
  // Contract identity, not a caller-selected experiment/deployment label, owns the one-shot claim.
  const key = benchmarkClaimKey(grant.contractDigest);
  let claim;
  try { claim = await open(join(directory, `${key}.json`), "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("ALREADY_CLAIMED");
    throw new Error("LEDGER_UNAVAILABLE");
  }
  try {
    const record = { schemaVersion:2, experimentId:grant.experimentId, contractDigest:grant.contractDigest,
      implementationCommit:grant.implementationCommit, deploymentId:grant.deploymentId,
      maximumPhysicalSpendUsd:grant.maximumPhysicalSpendUsd, claimedAt:now, expiresAt:grant.expiresAt };
    await claim.writeFile(canonicalJson(record));
    await claim.sync();
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch { throw new Error("CLAIM_STATE_UNCERTAIN"); }
  finally { await claim.close(); }
}
