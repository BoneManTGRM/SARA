/** Memory-I/O component benchmark, not live coding speed. Synthetic record evidence,
 * actual durable-store API, no provider requests or injected delays. Never rewrites output.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { sha256 } from "../src/canonical.ts";
import * as current from "../src/coding-repair-memory.ts";
import { candidate, check, training } from "../tests/helpers/repair-memory-fixture.ts";

const baselinePath = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
assert(process.argv.length === 4, "Usage: proof/repair-memory-read-path.ts BASELINE NEW_OUTPUT_DIRECTORY");
for (const key of ["OPENAI_API_KEY", "SARA_OWNER_TOKEN", "ANTHROPIC_API_KEY"]) assert(!process.env[key], "Run without provider/owner credentials");
const previous: typeof current = await import(pathToFileURL(join(baselinePath, "src/coding-repair-memory.ts")).href);
await mkdir(output, { recursive: false });
const root = await mkdtemp(join(tmpdir(), "sara-memory-read-proof-"));
const protocol = { schemaVersion: 1, classification: "MEMORY_IO_COMPONENT_ONLY_SYNTHETIC_RECORD_SETUP", providerRequests: 0,
  recordsPerStore: [1, 32, 128], pairedRounds: 5, lookupsPerRound: 20,
  fixture: "One authored constant-value repair, 7900-character comment, distinct synthetic scopes. Setup uses fixture-shaped evidence, not 128 verified programming tasks.",
  timing: "Includes key construction, fresh file reads, permission/lock checks, record decoding, proposal validation and result copy. Store setup is reported separately. No compiler/model latency is measured.",
  node: process.version, typescript: (await import("typescript")).version,
  oldSourceDigest: sha256(await readFile(join(baselinePath, "src/coding-repair-memory.ts"), "utf8")),
  newSourceDigest: sha256(await readFile(new URL("../src/coding-repair-memory.ts", import.meta.url), "utf8")) };
await writeFile(join(output, "protocol.json"), JSON.stringify(protocol, null, 2));
const rows: Array<{records: number; round: number; arm: string; milliseconds: number; lookups: number; artifactDigest: string}> = [];
const setups: Array<{records: number; arm: string; milliseconds: number; fileBytes: number}> = [];
try {
  for (const records of protocol.recordsPerStore) {
    const roots = { before: join(root, `${records}-before`), after: join(root, `${records}-after`) };
    const modules = { before: previous, after: current };
    let expected = "";
    for (const arm of ["before", "after"] as const) {
      const start = performance.now(), memory = new modules[arm].DurableCodingRepairMemory(roots[arm]);
      for (let i = 0; i < records; i++) {
        const t = training(); t.scope = sha256(`read-proof-${i}`);
        t.after.files[1].content += `//${"x".repeat(7900)}\n`; t.verification = check(t.after, true);
        expected = t.verification.artifactDigest; await memory.learn(t);
      }
      setups.push({ records, arm, milliseconds: performance.now() - start,
        fileBytes: (await stat(join(memory.directory, "memory.json"))).size });
    }
    for (let round = 0; round < protocol.pairedRounds; round++) {
      for (const arm of round % 2 ? ["after", "before"] as const : ["before", "after"] as const) {
        const start = performance.now();
        let artifactDigest = "";
        for (let n = 0; n < protocol.lookupsPerRound; n++) {
          const memory = new modules[arm].DurableCodingRepairMemory(roots[arm]); // Matches per-job recreation.
          const result = await memory.lookup(candidate(), check(candidate()), sha256(`read-proof-${(n + round) % records}`), "surgical");
          assert(result); assert.equal(result.verifiedArtifactDigest, expected); artifactDigest = result.verifiedArtifactDigest;
        }
        rows.push({ records, round, arm, milliseconds: performance.now() - start, lookups: protocol.lookupsPerRound, artifactDigest });
      }
      await writeFile(join(output, "partial.json"), JSON.stringify({ setups, rows }, null, 2));
    }
  }
  const summary = protocol.recordsPerStore.map(records => {
    const total = (arm: string) => rows.filter(r => r.records === records && r.arm === arm).reduce((n, r) => n + r.milliseconds, 0);
    const beforeMs = total("before"), afterMs = total("after");
    return { records, lookupsPerArm: protocol.lookupsPerRound * protocol.pairedRounds, beforeMs, afterMs,
      observedComponentRatio: beforeMs / afterMs, reductionPercent: (1 - afterMs / beforeMs) * 100 };
  });
  const result = { ...protocol, completed: true, setups, rows, summary,
    limitations: ["Component test only; no successful-program throughput multiplier.",
      "Ordinary exact-byte decoding caches can obtain the same benefit; not a unique Reparodynamics effect.",
      "Synthetic repeated records, one local host, five ordered/alternating pairs; no population confidence claim.",
      "The previous failed or completed live trials and spending grants are not accessed."] };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(summary, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
