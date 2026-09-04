import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import {
  aggregateCodingBenchmarkPairs,
  compileCodingRolloutControlEvidence,
  digestCodingBenchmarkBindings,
  evaluateCodingRollout,
  type CodingBenchmarkBindings,
  type CodingBenchmarkPairReceipt,
} from "../src/coding-repair-evidence.ts";
import { loadCodingBenchmarkPairs, persistCodingBenchmarkPair, persistCodingBenchmarkSummary } from "../src/coding-repair-evidence-store.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const bindings: CodingBenchmarkBindings = {
  repositoryDigest: sha256("repository"), commitDigest: sha256("commit"), criteriaDigest: sha256("criteria"),
  modelDigest: sha256("model"), baselineMethodDigest: sha256("baseline"), reparodynamicMethodDigest: sha256("repair"),
  verifierDigest: sha256("verifier"), environmentDigest: sha256("environment"), authorityDigest: sha256("authority"),
  budgetDigest: sha256("budget"), compilerDigest: sha256("compiler"), runtimeDigest: sha256("runtime"), toolchainDigest: sha256("toolchain"),
};
const protocolDigest = sha256("protocol");
const corpusDigest = sha256("corpus");
const identityDigest = digestCodingBenchmarkBindings(bindings);

function pair(): CodingBenchmarkPairReceipt {
  const observation = (arm: "baseline" | "reparodynamic") => ({
    arm, verified: arm === "reparodynamic", firstPass: arm === "reparodynamic", score: arm === "reparodynamic" ? 1 : 0.8,
    retries: arm === "reparodynamic" ? 1 : 0, cycles: arm === "reparodynamic" ? 2 : 1, rolledBackRepairs: 0,
    criticalRegressions: 0, escapedRegressions: 0, changedFiles: arm === "reparodynamic" ? 1 : 0, changedLines: arm === "reparodynamic" ? 3 : 0,
    inputTokens: 100, outputTokens: 50, accountedCostUsd: arm === "reparodynamic" ? 0.05 : 0.04,
    repairCostUsd: arm === "reparodynamic" ? 0.01 : 0, activeExecutionMilliseconds: arm === "reparodynamic" ? 110 : 100,
    rye: arm === "reparodynamic" ? 10 : 0, reusedVerifiedLessons: 0, completionDigest: sha256(`${arm}-completion`), evidenceDigests: [sha256(`${arm}-evidence`)],
  });
  return {
    schemaVersion: 2, pairId: randomUUID(), protocolDigest, corpusVersion: "repair-v1", corpusDigest, identityDigest, bindings,
    taskId: "task-1", taskClass: "licensed_public_typescript", trialIndex: 0, evidenceKind: "real", taskDigest: sha256("task-1"),
    caseDigest: sha256("case-1"), startingArtifactDigest: sha256("artifact-1"), licenseDigest: sha256("mit-license"), canaryPercent: 5,
    executionOrder: ["baseline", "reparodynamic"], baseline: observation("baseline"), reparodynamic: observation("reparodynamic"),
    observedAt: "2026-09-04T00:00:00.000Z",
  };
}

function scope(stateDirectory: string) {
  return { stateDirectory, protocolDigest, corpusVersion: "repair-v1", corpusDigest, identityDigest, canaryPercent: 5 };
}

function controls() {
  const passed = (name: string) => ({ status: "passed" as const, evidenceDigest: sha256(name) });
  const missing = (name: string) => ({ status: "missing" as const, evidenceDigest: sha256(name) });
  return compileCodingRolloutControlEvidence({
    digestBinding: passed("digest"), costEnforcement: passed("cost"), protectedPaths: passed("paths"), crashResume: passed("crash"),
    nicoAssessment: missing("nico"), ownerApproval: missing("owner"), rollbackDrill: missing("rollback"),
  });
}

describe("durable Reparodynamic coding evidence", () => {
  it("persists exact digest-bound pair receipts and reconstructs them without source, prompt, or model output", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-")); roots.push(root);
    const receipt = pair();
    await persistCodingBenchmarkPair({ stateDirectory: root, pair: receipt });
    assert.deepEqual(await loadCodingBenchmarkPairs(scope(root)), [receipt]);
    const path = join(root, "coding-repair-benchmarks", "repair-v1", corpusDigest, protocolDigest, identityDigest, "005", `${receipt.pairId}.json`);
    const stored = await readFile(path, "utf8");
    assert.equal(stored.includes("replacementText"), false);
    assert.equal(stored.includes("outputText"), false);
    assert.equal(stored.includes("prompt"), false);
  });

  it("treats identical replay as idempotent and rejects conflicting reuse of a pair id", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-")); roots.push(root);
    const receipt = pair();
    await persistCodingBenchmarkPair({ stateDirectory: root, pair: receipt });
    await persistCodingBenchmarkPair({ stateDirectory: root, pair: receipt });
    assert.equal((await loadCodingBenchmarkPairs(scope(root))).length, 1);
    const conflicting = structuredClone(receipt); conflicting.reparodynamic.completionDigest = sha256("different-completion");
    await assert.rejects(() => persistCodingBenchmarkPair({ stateDirectory: root, pair: conflicting }), /different evidence/);
  });

  it("rejects tampered or extra-field envelopes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-")); roots.push(root);
    const receipt = pair(); await persistCodingBenchmarkPair({ stateDirectory: root, pair: receipt });
    const path = join(root, "coding-repair-benchmarks", "repair-v1", corpusDigest, protocolDigest, identityDigest, "005", `${receipt.pairId}.json`);
    const envelope = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { pair: CodingBenchmarkPairReceipt };
    envelope.pair.reparodynamic.completionDigest = sha256("tampered-completion");
    await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8");
    await assert.rejects(() => loadCodingBenchmarkPairs(scope(root)), /digest verification failed/);
    envelope.pair.reparodynamic.completionDigest = receipt.reparodynamic.completionDigest;
    envelope.extra = "not allowed";
    await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8");
    await assert.rejects(() => loadCodingBenchmarkPairs(scope(root)), /unsupported fields/);
  });

  it("atomically replaces a digest-bound derived summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-")); roots.push(root);
    const receipt = pair();
    const aggregate = aggregateCodingBenchmarkPairs({ receipts: [receipt], protocolDigest, corpusVersion: "repair-v1", corpusDigest, canaryPercent: 5, currentIdentityDigest: identityDigest, bootstrapSamples: 200 });
    const controlEvidence = controls();
    const decision = evaluateCodingRollout({ aggregate, controls: controlEvidence });
    await persistCodingBenchmarkSummary({ stateDirectory: root, aggregate, controls: controlEvidence, decision });
    await persistCodingBenchmarkSummary({ stateDirectory: root, aggregate, controls: controlEvidence, decision });
    const summary = JSON.parse(await readFile(join(root, "coding-repair-benchmarks", "repair-v1", corpusDigest, protocolDigest, identityDigest, "005", "summary.json"), "utf8")) as { summaryDigest: string };
    assert.match(summary.summaryDigest, /^[a-f0-9]{64}$/u);
  });

  it("rejects unsafe scope before filesystem resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "sara-coding-evidence-")); roots.push(root);
    await assert.rejects(() => loadCodingBenchmarkPairs({ ...scope(root), corpusVersion: "../escape" }), /corpus version is malformed/);
  });
});
