import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
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
  type CodingBenchmarkArmReceipt,
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

function armReceipt(method: CodingBenchmarkArmResult["method"]): CodingBenchmarkArmReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    pairIndex: 1,
    caseId: "case-001",
    bindings,
    result: arm(method),
    completedAt: method === "luna"
      ? "2026-09-04T00:00:30.000Z"
      : "2026-09-04T00:00:50.000Z",
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

async function persistBothArms(stateDirectory: string): Promise<void> {
  await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt: armReceipt("luna") });
  await persistCodingBenchmarkArmReceipt({
    stateDirectory,
    receipt: armReceipt("luna_reparodynamic"),
  });
}

describe("coding benchmark evidence store", () => {
  it("persists each arm before pair completion and resumes only missing work", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt: armReceipt("luna") });
      let progress = await loadCodingBenchmarkProgress({ stateDirectory, benchmarkId });
      assert.deepEqual(missingCodingBenchmarkArms(progress, 1), ["luna_reparodynamic"]);
      assert.equal(progress.pairs.length, 0);

      await persistCodingBenchmarkArmReceipt({
        stateDirectory,
        receipt: armReceipt("luna_reparodynamic"),
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

  it("refuses to finalize a pair until both matching immutable arms exist", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await assert.rejects(
        persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() }),
        /both immutable arm receipts/,
      );
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt: armReceipt("luna") });
      await assert.rejects(
        persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() }),
        /both immutable arm receipts/,
      );
      await persistCodingBenchmarkArmReceipt({
        stateDirectory,
        receipt: armReceipt("luna_reparodynamic"),
      });
      await persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("makes an identical replay idempotent but rejects conflicting evidence", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      const receipt = armReceipt("luna");
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt });
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt });
      await assert.rejects(
        persistCodingBenchmarkArmReceipt({
          stateDirectory,
          receipt: {
            ...receipt,
            result: { ...receipt.result, finalScore: 0.8, verifiedComplete: false },
          },
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
      await persistCodingBenchmarkArmReceipt({ stateDirectory, receipt: armReceipt("luna") });
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

  it("rejects a summary snapshot whose proof or bindings do not match persisted pairs", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await persistBothArms(stateDirectory);
      await persistCodingBenchmarkPairReceipt({ stateDirectory, pair: pair() });
      const summary = summarizeCodingBenchmark({ pairs: [pair()], bootstrapSamples: 500 });
      const decision = evaluateCodingBenchmarkPromotion({ summary, currentCanaryPercent: 5 });
      const tampered = structuredClone(summary);
      tampered.bindings.policyDigest = digest("9");
      await assert.rejects(
        persistCodingBenchmarkEvidenceSnapshot({
          stateDirectory,
          summary: tampered,
          decision,
        }),
        /proof|bindings/,
      );
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("preserves immutable generated summary and promotion snapshots", async () => {
    const stateDirectory = await temporaryState();
    try {
      await initializeCodingBenchmarkStore({ stateDirectory, manifest });
      await persistBothArms(stateDirectory);
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


it("rejects a caller-forged expansion decision even when its summary digest matches", async () => {
  const stateDirectory = await temporaryState();
  try {
    await initializeCodingBenchmarkStore({stateDirectory, manifest});
    await persistBothArms(stateDirectory);
    await persistCodingBenchmarkPairReceipt({stateDirectory, pair: pair()});
    const summary = summarizeCodingBenchmark({pairs: [pair()], bootstrapSamples: 500});
    const decision = evaluateCodingBenchmarkPromotion({summary, currentCanaryPercent: 5});
    await assert.rejects(persistCodingBenchmarkEvidenceSnapshot({stateDirectory, summary,
      decision: {...decision, action: "promote_default", recommendedCanaryPercent: 100}}), /deterministic recommendation/);
  } finally { await rm(stateDirectory, {recursive:true, force:true}); }
});

it("rejects a legacy partial snapshot on reload even with consistent content hashes", async () => {
  const stateDirectory = await temporaryState();
  try {
    await initializeCodingBenchmarkStore({stateDirectory, manifest: {...manifest, caseIds: ["case-001", "case-002"]}});
    await persistBothArms(stateDirectory);
    await persistCodingBenchmarkPairReceipt({stateDirectory, pair: pair()});
    const summary = summarizeCodingBenchmark({pairs:[pair()], bootstrapSamples:500});
    const decision = evaluateCodingBenchmarkPromotion({summary, currentCanaryPercent:5});
    const payload = {schemaVersion:1,benchmarkId,pairDigests:[sha256(canonicalJson(pair()))],summary,decision};
    const envelope = {schemaVersion:1,kind:"snapshot",payload,payloadDigest:sha256(canonicalJson(payload))};
    await writeFile(join(stateDirectory,"coding-repair-benchmarks",benchmarkId,"snapshots",summary.proofDigest+".json"),JSON.stringify(envelope));
    await assert.rejects(loadCodingBenchmarkProgress({stateDirectory,benchmarkId}), /entire frozen benchmark corpus/);
  } finally { await rm(stateDirectory,{recursive:true,force:true}); }
});

it("rejects non-boolean outcome flags and unsafe counters at the arm persistence boundary", async () => {
  const stateDirectory = await temporaryState();
  try {
    await initializeCodingBenchmarkStore({ stateDirectory, manifest });
    for (const field of ["verifiedComplete", "regression", "criticalRegression"] as const) {
      const receipt = armReceipt("luna");
      (receipt.result as unknown as Record<string, unknown>)[field] = "false";
      await assert.rejects(persistCodingBenchmarkArmReceipt({ stateDirectory, receipt }), /boolean/iu);
    }
    const receipt = armReceipt("luna"); receipt.result.inputTokens = Number.MAX_SAFE_INTEGER + 1;
    await assert.rejects(persistCodingBenchmarkArmReceipt({ stateDirectory, receipt }), /integer/iu);
    assert.equal((await loadCodingBenchmarkProgress({ stateDirectory, benchmarkId })).armReceipts.length, 0);
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});
