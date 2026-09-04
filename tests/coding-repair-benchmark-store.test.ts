import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluateCodingBenchmarkPromotion,
  summarizeCodingBenchmark,
  type CodingBenchmarkArmResult,
  type CodingBenchmarkBindings,
  type CodingBenchmarkPairReceipt,
} from "../src/coding-repair-benchmark.ts";
import {
  initializeCodingBenchmarkStore,
  loadCodingBenchmarkProgress,
  missingCodingBenchmarkArms,
  persistCodingBenchmarkArmReceipt,
  persistCodingBenchmarkEvidenceSnapshot,
  persistCodingBenchmarkPairReceipt,
  type CodingBenchmarkManifest,
} from "../src/coding-repair-benchmark-store.ts";

const benchmarkId = "11111111-1111-4111-8111-111111111111";
const digest = (character: string): string => character.repeat(64);
const bindings: CodingBenchmarkBindings = {
  sourceCommit: digest("1"),
  corpusDigest: digest("2"),
  modelDigest: digest("3"),
  controllerDigest: digest("4"),
  policyDigest: digest("5"),
  verifierDigest: digest("6"),
  environmentDigest: digest("7"),
  authorityDigest: digest("8"),
};
const manifest: CodingBenchmarkManifest = {
  schemaVersion: 1,
  benchmarkId,
  bindings,
  currentCanaryPercent: 5,
  maximumSpendUsd: 3,
  caseIds: ["case-001"],
  createdAt: "2026-09-04T00:00:00.000Z",
};

function arm(method: CodingBenchmarkArmResult["method"], finalScore = 1): CodingBenchmarkArmResult {
  return {
    method,
    verifiedComplete: finalScore === 1,
    finalScore,
    activeExecutionMilliseconds: 1_000,
    accountedCostUsd: 0.1,
    inputTokens: 100,
    outputTokens: 50,
    cycles: method === "luna" ? 1 : 2,
    rollbacks: 0,
    changedFiles: 1,
    changedLines: 3,
    rye: finalScore === 1 ? 1 : 0,
    regression: false,
    criticalRegression: false,
    failureCode: finalScore === 1 ? null : "verification_failed",
    finalArtifactDigest: method === "luna" ? digest("a") : digest("b"),
    verifierEvidenceDigests: [digest("c")],
  };
}

function pair(): CodingBenchmarkPairReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    pairIndex: 1,
    caseId: "case-001",
    taskClass: "synthetic",
    taskFamily: "bounded-typescript",
    executionKind: "live",
    order: ["luna_reparodynamic", "luna"],
    bindings,
    normal: arm("luna"),
    reparodynamic: arm("luna_reparodynamic"),
    completedAt: "2026-09-04T00:01:00.000Z",
  };
}

async function temporaryState(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sara-coding-benchmark-store-"));
}

describe("coding benchmark evidence store", () => {
  it("persists each arm before pair completion and resumes only missing work", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await persistCodingBenchmarkArmReceipt({
        stateDirectory,
        receipt: {
          schemaVersion: 1,
          benchmarkId,
          pairIndex: 1,
          caseId: "case-001",
          bindings,
          result: arm("luna"),
          completedAt: "2026-09-04T00:00:30.000Z",
        },
      });
      let progress = await loadCodingBenchmarkProgress({ stateDirectory, benchmarkId });
      assert.deepEqual(missingCodingBenchmarkArms(progress, 1), ["luna_reparodynamic"]);
      assert.equal(progress.pairs.length, 0);

      await persistCodingBenchmarkArmReceipt({
        stateDirectory,
        receipt: {
          schemaVersion: 1,
          benchmarkId,
          pairIndex: 1,
          caseId: "case-001",
          bindings,
          result: arm("luna_reparodynamic"),
          completedAt: "2026-09-04T00:00:50.000Z",
        },
      });
      await persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() });
      progress = await loadCodingBenchmarkProgress({ stateDirectory, benchmarkId });
      assert.deepEqual(missingCodingBenchmarkArms(progress, 1), []);
      assert.equal(progress.armReceipts.length, 2);
      assert.equal(progress.pairs.length, 1);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("makes an identical replay idempotent but rejects conflicting evidence", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      const receipt = {
        schemaVersion: 1 as const,
        benchmarkId,
        pairIndex: 1,
        caseId: "case-001",
        bindings,
        result: arm("luna"),
        completedAt: "2026-09-04T00:00:30.000Z",
      };
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt });
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt });
      await assert.rejects(
        persistCodingBenchmarkArmReceipt({
          stateDirectory,
          receipt: { ...receipt, result: { ...receipt.result, finalScore: 0.8, verifiedComplete: false } },
        }),
        /conflicts with immutable benchmark evidence/,
      );
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a receipt whose persisted payload no longer matches its digest", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await persistCodingBenchmarkArmReceipt({
        stateDirectory,
        receipt: {
          schemaVersion: 1,
          benchmarkId,
          pairIndex: 1,
          caseId: "case-001",
          bindings,
          result: arm("luna"),
          completedAt: "2026-09-04T00:00:30.000Z",
        },
      });
      const path = join(
        stateDirectory,
        "coding-repair-benchmarks",
        benchmarkId,
        "pairs",
        "0001-luna.json",
      );
      const envelope = JSON.parse(await readFile(path, "utf8")) as {
        payload: { result: CodingBenchmarkArmResult };
      };
      envelope.payload.result.finalScore = 0;
      await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      await assert.rejects(
        loadCodingBenchmarkProgress({ stateDirectory, benchmarkId }),
        /digest mismatch/,
      );
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("preserves immutable generated summary and promotion snapshots", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() });
      const summary = summarizeCodingBenchmark({ pairs: [pair()], bootstrapSamples: 500 });
      const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
      await persistCodingBenchmarkEvidenceSnapshot({ stateDirectory, summary, decision });
      await persistCodingBenchmarkEvidenceSnapshot({ stateDirectory, summary, decision });
      const progress = await loadCodingBenchmarkProgress({ stateDirectory, benchmarkId });
      assert.equal(progress.snapshots.length, 1);
      assert.equal(progress.snapshots[0].summary.proofDigest, summary.proofDigest);
      assert.equal(progress.snapshots[0].decision.action, "hold");
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
