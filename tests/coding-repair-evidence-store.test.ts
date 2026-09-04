import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { aggregateCodingBenchmarkPairs, evaluateCodingRollout, type CodingBenchmarkPairReceipt } from "../src/coding-repair-evidence.ts";
import { loadCodingBenchmarkPairs, persistCodingBenchmarkPair, persistCodingBenchmarkSummary } from "../src/coding-repair-evidence-store.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function pair(): CodingBenchmarkPairReceipt {
  return {
    schemaVersion: 1,
    pairId: randomUUID(),
    corpusVersion: "repair-v1",
    taskId: "task-1",
    taskDigest: sha256("task-1"),
    canaryPercent: 5,
    executionOrder: ["baseline", "reparodynamic"],
    baseline: { arm: "baseline", verified: false, score: 0.8, retries: 0, rolledBackRepairs: 0, escapedRegressions: 0, accountedCostUsd: 0, elapsedMilliseconds: 100, rye: 0, evidenceDigests: [sha256("baseline")] },
    reparodynamic: { arm: "reparodynamic", verified: true, score: 1, retries: 1, rolledBackRepairs: 0, escapedRegressions: 0, accountedCostUsd: 0.05, elapsedMilliseconds: 110, rye: 10, evidenceDigests: [sha256("repair")] },
    observedAt: "2026-09-04T00:00:00.000Z",
  };
}

describe("durable Reparodynamic coding evidence", () => {
  it("persists digest-bound pair receipts and reconstructs them without raw source content", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-"));
    roots.push(root);
    const receipt = pair();
    await persistCodingBenchmarkPair({ stateDirectory: root, pair: receipt });
    assert.deepEqual(await loadCodingBenchmarkPairs({ stateDirectory: root, corpusVersion: "repair-v1", canaryPercent: 5 }), [receipt]);
    const stored = await readFile(join(root, "coding-repair-benchmarks", "repair-v1", "005", `${receipt.pairId}.json`), "utf8");
    assert.equal(stored.includes("replacementText"), false);
    assert.equal(stored.includes("outputText"), false);
  });

  it("rejects tampered evidence instead of aggregating it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-"));
    roots.push(root);
    const receipt = pair();
    await persistCodingBenchmarkPair({ stateDirectory: root, pair: receipt });
    const path = join(root, "coding-repair-benchmarks", "repair-v1", "005", `${receipt.pairId}.json`);
    const envelope = JSON.parse(await readFile(path, "utf8")) as { pair: CodingBenchmarkPairReceipt };
    envelope.pair.reparodynamic.score = 0;
    await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8");
    await assert.rejects(() => loadCodingBenchmarkPairs({ stateDirectory: root, corpusVersion: "repair-v1", canaryPercent: 5 }), /digest verification failed/);
  });

  it("atomically replaces the derived aggregate summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-"));
    roots.push(root);
    const receipt = pair();
    const aggregate = aggregateCodingBenchmarkPairs({ receipts: [receipt], corpusVersion: "repair-v1", canaryPercent: 5 });
    const decision = evaluateCodingRollout({ aggregate });
    await persistCodingBenchmarkSummary({ stateDirectory: root, aggregate, decision });
    await persistCodingBenchmarkSummary({ stateDirectory: root, aggregate, decision });
    const summary = JSON.parse(await readFile(join(root, "coding-repair-benchmarks", "repair-v1", "005", "summary.json"), "utf8")) as { summaryDigest: string };
    assert.match(summary.summaryDigest, /^[a-f0-9]{64}$/u);
  });
});
