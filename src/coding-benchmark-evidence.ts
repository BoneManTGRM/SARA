import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { sha256 } from "./canonical.ts";
import { OBSERVED_REUSE_BENCHMARK_GRANT, HARDENED_REUSE_BENCHMARK_GRANT, ADDITIONAL_CODING_BENCHMARK_GRANT, CODING_BENCHMARK_CONTINUATION, POST_FIX_CODING_BENCHMARK_GRANT, CURRENT_CODING_BENCHMARK_GRANT, REUSE_SPEED_BENCHMARK_GRANT } from "./coding-benchmark-readiness.ts";

const MAX_FILES = 128;
const MAX_FILE_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 4_194_304;
export type BenchmarkEvidence = {
  schemaVersion: 1;
  status: "not_started" | "claimed" | "terminal";
  replayAllowed: false;
  files: { path: string; sha256: string; bytes: number; content: string }[];
};

/** Private read-only export from the same owner-authenticated readiness route.
 * Never accept an HTTP-supplied path or follow a symlink into production data.
 * Raw bounded files preserve interrupted writes without inventing valid receipts.
 */
export async function readCodingBenchmarkEvidence(stateDirectory: string, benchmarkId: string): Promise<BenchmarkEvidence> {
  if (!isAbsolute(stateDirectory) || ![ADDITIONAL_CODING_BENCHMARK_GRANT.benchmarkId, CODING_BENCHMARK_CONTINUATION.benchmarkId, POST_FIX_CODING_BENCHMARK_GRANT.benchmarkId, CURRENT_CODING_BENCHMARK_GRANT.benchmarkId, REUSE_SPEED_BENCHMARK_GRANT.benchmarkId, HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId, OBSERVED_REUSE_BENCHMARK_GRANT.benchmarkId].some(id => id === benchmarkId)) {
    throw new Error("BENCHMARK_EVIDENCE_SCOPE_REJECTED");
  }
  const empty: BenchmarkEvidence = { schemaVersion: 1, status: "not_started", replayAllowed: false, files: [] };
  const base = resolve(stateDirectory);
  // Inspect every parent, not only the eventual file (O_NOFOLLOW protects the leaf).
  for (const directory of [base, join(base, "coding-repair-benchmarks"), join(base, "coding-repair-benchmarks", benchmarkId)]) {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("BENCHMARK_EVIDENCE_PATH_REJECTED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw error;
    }
  }
  const root = join(base, "coding-repair-benchmarks", benchmarkId);
  const paths: string[] = [];
  const rules: [string, RegExp][] = [
    ["", /^(manifest|execution-claim)\.json$/u],
    ["pairs", /^0001-(luna|luna_reparodynamic|pair)\.json$/u],
    ["snapshots", /^[a-f0-9]{64}\.json$/u],
    ["trace", /^(?:(?:owner-launch-(?:claim|exit)|terminal-accounting|trial-registration)|(?:luna(?:_reparodynamic)?-(?:(?:count-)?[0-9]{4}-(?:reservation|response|error)|event-[0-9]{4}-(?:verification|model_request|model_response|model_failure))))\.json$/u],
  ];
  if ([REUSE_SPEED_BENCHMARK_GRANT.benchmarkId, HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId, OBSERVED_REUSE_BENCHMARK_GRANT.benchmarkId].some(id => id === benchmarkId)) {
    rules.push(["reuse-state/jobs", /^(regenerate|ordinary_memory|optimized)-[0-3]\.json$/u],
      ["reuse-state/trace", /^(reuse-registration|reuse-summary|reuse-budget-[0-9]{4}-(reservation|response|error))\.json$/u]);
  }
  for (const [subdirectory, allowed] of rules) {
    const directory = join(root, subdirectory);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("BENCHMARK_EVIDENCE_PATH_REJECTED");
      const names = await readdir(directory);
      if (names.length > MAX_FILES) throw new Error("BENCHMARK_EVIDENCE_COUNT_EXCEEDED");
      for (const name of names) {
        if (!allowed.test(name)) continue;
        paths.push(subdirectory ? `${subdirectory}/${name}` : name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  if (paths.length > MAX_FILES) throw new Error("BENCHMARK_EVIDENCE_COUNT_EXCEEDED");
  const files: BenchmarkEvidence["files"] = [];
  let total = 0;
  for (const path of paths.sort()) {
    const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) throw new Error("BENCHMARK_EVIDENCE_FILE_REJECTED");
      const bytes = Buffer.alloc(info.size + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== info.size || (await handle.stat()).size !== info.size) throw new Error("BENCHMARK_EVIDENCE_WRITE_IN_PROGRESS");
      const raw = bytes.subarray(0, bytesRead);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      total += bytesRead;
      files.push({ path, sha256: sha256(raw), bytes: bytesRead, content });
    } finally { await handle.close(); }
  }
  // Any surviving evidence consumes readiness, even when the claim is incomplete.
  return { schemaVersion: 1, status: files.some(file => file.path === "trace/owner-launch-exit.json") ? "terminal" : files.length ? "claimed" : "not_started",
    replayAllowed: false, files };
}
