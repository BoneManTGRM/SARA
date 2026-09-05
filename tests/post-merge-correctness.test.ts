import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ts from "typescript";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runCodingRepairController, type CodingRepairModel } from "../src/experimental-v5/coding-repair-controller.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";
import { ExperimentalCompilerCache } from "../src/experimental-compiler-cache.ts";
import { GuardedRepairMemory, type Scope } from "../proof/guarded-repair-memory.ts";
import { claimBenchmarkRun, type BenchmarkRunGrant } from "../proof/benchmark-run-admission.ts";
import { evaluatePair } from "../proof/v7-live-evaluation.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1, candidateKind: "typescript_program", programName: "Corrective regression",
  summary: "Offline boundary regression", limitations: [],
  files: [{ path: "src/value.ts", content: "export const value = 0;\n" }],
};
function artifact(candidate: ProgramCandidateProposal): string {
  return sha256(canonicalJson({ schemaVersion: 1, files: candidate.files.map(file => ({
    path: file.path, contentDigest: sha256(file.content),
  })).sort((a, b) => a.path.localeCompare(b.path)) }));
}
function verification(candidate: ProgramCandidateProposal, passed: boolean): ProgramVerificationResult {
  return {
    passed, score: passed ? 1 : 0.8, artifactDigest: artifact(candidate),
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [sha256("offline evidence")],
    failures: passed ? [] : [{ kind: "behavior", code: "WRONG_VALUE", file: "src/value.ts",
      line: 1, column: 1, evidenceDigest: sha256("failure evidence"), fingerprint: sha256("failure"),
      severity: "medium", existedBeforeRepair: true }],
  };
}
const scope: Scope = { contract: sha256("contract"), dependencies: sha256("deps"),
  verifier: sha256("verifier"), policy: sha256("policy") };

for (const [name, mutate] of [
  ["missing acceptance checks", (v: ProgramVerificationResult) => { v.completedChecks = []; }],
  ["missing verification evidence", (v: ProgramVerificationResult) => { v.evidenceDigests = []; }],
  ["malformed artifact digest", (v: ProgramVerificationResult) => { v.artifactDigest = "not-a-digest"; }],
  ["another artifact's pass", (v: ProgramVerificationResult) => { v.artifactDigest = sha256("other artifact"); }],
] as const) test(`post-merge: rejects ${name} before claiming a verified candidate`, async () => {
  const v = verification(baseline, true); mutate(v); let modelCalls = 0;
  await assert.rejects(runCodingRepairController({ baseline, verify: async () => v,
    model: { async propose() { modelCalls++; throw new Error("must not dispatch"); } },
  }), /verification|artifact/iu);
  assert.equal(modelCalls, 0);
});

test("post-merge: rejects unknown verification check names instead of forwarding private prose", async () => {
  const v = verification(baseline, false);
  v.completedChecks.push("PRIVATE_VERIFIER_OUTPUT" as never);
  let modelCalls = 0;
  await assert.rejects(runCodingRepairController({ baseline, verify: async () => v,
    model: { async propose() { modelCalls++; throw new Error("reached model"); } },
  }), /verification/iu);
  assert.equal(modelCalls, 0);
});

test("post-merge: snapshots model usage and proposal before asynchronous verification", async () => {
  let response: Awaited<ReturnType<CodingRepairModel["propose"]>> | undefined;
  let verifierCalls = 0;
  const run = await runCodingRepairController({ baseline,
    verify: async candidate => {
      verifierCalls++;
      if (response) {
        response.accountedCostUsd = 0;
        response.inputTokens = 0;
        response.outputTokens = 0;
        response.proposal.changes.length = 0;
      }
      return verification(candidate, candidate.files[0].content.includes("= 1"));
    },
    model: { async propose(input) {
      response = { inputTokens: 12, outputTokens: 8, accountedCostUsd: 0.003,
        proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest,
          failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy,
          changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content),
            replacementText: "export const value = 1;\n" }], limitations: [] } };
      return response;
    } },
  });
  assert.equal(run.state, "VERIFIED_CANDIDATE"); assert.equal(verifierCalls, 2);
  assert.equal(run.accountedCostUsd, 0.003);
  assert.equal(run.receipts[0].accountedCostUsd, 0.003);
  assert.equal(run.receipts[0].inputTokens, 12); assert.equal(run.receipts[0].outputTokens, 8);
  assert.equal(run.receipts[0].changedFiles, 1);
  assert.equal(run.performanceGauge.accountedCostUsd, run.accountedCostUsd);
});

test("post-merge: refuses extra authority fields in a model repair proposal", async () => {
  let verifierCalls = 0;
  await assert.rejects(runCodingRepairController({ baseline,
    verify: async candidate => { verifierCalls++; return verification(candidate, verifierCalls > 1); },
    model: { async propose(input) { return { inputTokens: 1, outputTokens: 1, accountedCostUsd: 0.003,
      proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest,
        failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy,
        changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content),
          replacementText: "export const value = 1;\n" }], limitations: [], deploy: true } }; } },
  }), /proposal|schema|contract/iu);
  assert.equal(verifierCalls, 1);
});

test("post-merge: a regex-coercible array cannot be accepted as repair evidence", () => {
  const after = structuredClone(baseline); after.files[0].content = "export const value = 1;\n";
  const good = verification(after, true); good.evidenceDigests = [[sha256("fake evidence")] as unknown as string];
  const memory = new GuardedRepairMemory();
  assert.throws(() => memory.learn(baseline, after, good, scope), /UNVERIFIED/);
  assert.equal(memory.size, 0);
});

test("post-merge: malformed lookup verification cannot select a learned recipe", () => {
  const after = structuredClone(baseline); after.files[0].content = "export const value = 1;\n";
  const memory = new GuardedRepairMemory(); memory.learn(baseline, after, verification(after, true), scope);
  const bad = verification(baseline, false); bad.passed = 0 as unknown as boolean;
  assert.equal(memory.lookup(baseline, bad, scope, "surgical"), null);
});

test("post-merge: external grant identifiers must be primitive strings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-grant-type-"));
  const grant: BenchmarkRunGrant = { experimentId: ["array-id"] as unknown as string,
    contractDigest: sha256("not a live contract"), implementationCommit: "a".repeat(40),
    deploymentId: "12345678-1234-4234-8234-123456789012", expiresAt: 100,
    maximumPhysicalSpendUsd: 0.15 };
  try {
    await assert.rejects(claimBenchmarkRun({ ledgerDirectory: directory, grant, observed: { ...grant }, now: 1 }), /INVALID_GRANT/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const [name, controlTime, canaryTime] of [
  ["ratio overflow", Number.MAX_VALUE, Number.MIN_VALUE],
  ["percentage overflow", Number.MAX_VALUE, 2],
] as const) test(`post-merge: ${name} cannot become a supported speed claim`, () => {
  const pair = evaluatePair({ verifiedComplete: true, timeMs: controlTime, costUsd: 1, error: null },
    { verifiedComplete: true, timeMs: canaryTime, costUsd: 1, error: null });
  assert.equal(pair.timeComparable, false);
  assert.equal(pair.speedRatio, null); assert.equal(pair.speedIncreasePercent, null);
  assert.equal(pair.target300PercentMet, false); assert.equal(pair.verdict, "INCONCLUSIVE");
});

test("post-merge: mutable compiler nodes cannot contaminate a later verifier host", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-cache-isolation-"));
  const dir = join(root, "node_modules", "fixture"); await mkdir(dir, { recursive: true });
  const file = join(dir, "index.d.ts"); await writeFile(file, "export const value: number;\n");
  const cache = new ExperimentalCompilerCache();
  try {
    const first = cache.createHost({}).getSourceFile(file, ts.ScriptTarget.ES2022)!;
    const type = (first.statements[0] as ts.VariableStatement).declarationList.declarations[0].type!;
    (type as unknown as { kind: ts.SyntaxKind }).kind = ts.SyntaxKind.StringKeyword;
    const later = cache.createHost({}).getSourceFile(file, ts.ScriptTarget.ES2022)!;
    const ordinary = ts.createCompilerHost({}).getSourceFile(file, ts.ScriptTarget.ES2022)!;
    assert.notEqual(later, first);
    assert.equal((later.statements[0] as ts.VariableStatement).declarationList.declarations[0].type!.kind,
      (ordinary.statements[0] as ts.VariableStatement).declarationList.declarations[0].type!.kind);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("post-merge: equal callback source text does not imply equal parse context", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-cache-context-"));
  const dir = join(root, "node_modules", "fixture"); await mkdir(dir, { recursive: true });
  const file = join(dir, "index.d.ts"); await writeFile(file, "declare const value: number;\n");
  const cache = new ExperimentalCompilerCache(); const host = cache.createHost({});
  const callback = (module: boolean) => (source: ts.SourceFile) => {
    (source as ts.SourceFile & { externalModuleIndicator: boolean | undefined }).externalModuleIndicator = module || undefined;
  };
  try {
    const first = host.getSourceFile(file, { languageVersion: ts.ScriptTarget.ES2022, setExternalModuleIndicator: callback(false) })!;
    const second = host.getSourceFile(file, { languageVersion: ts.ScriptTarget.ES2022, setExternalModuleIndicator: callback(true) })!;
    assert.equal(ts.isExternalModule(first), false); assert.equal(ts.isExternalModule(second), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("post-merge: rejects oversized one-line replacement before source analysis or verification", async () => {
  let verifierCalls = 0;
  await assert.rejects(runCodingRepairController({ baseline,
    verify: async candidate => { verifierCalls++; return verification(candidate, verifierCalls > 1); },
    model: { async propose(input) { return { inputTokens: 1, outputTokens: 1, accountedCostUsd: 0.003,
      proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest,
        failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy,
        changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content),
          replacementText: 'export const value = "' + "x".repeat(16 * 1024) + '";\n' }], limitations: [] } }; } },
  }), /proposal|size|contract/iu);
  assert.equal(verifierCalls, 1);
});

test("post-merge: a rejected final verification retains known model spending", async () => {
  const { CodingRepairRejectedAttemptError } = await import("../src/coding-repair-rejection.ts");
  let verifierCalls = 0;
  await assert.rejects(runCodingRepairController({ baseline,
    verify: async candidate => {
      verifierCalls++;
      const v = verification(candidate, verifierCalls > 1);
      if (verifierCalls > 1) v.evidenceDigests = [];
      return v;
    },
    model: { async propose(input) { return { inputTokens: 10, outputTokens: 7, accountedCostUsd: 0.003,
      proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest,
        failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy,
        changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content),
          replacementText: "export const value = 1;\n" }], limitations: [] } }; } },
  }), error => {
    assert(error instanceof CodingRepairRejectedAttemptError);
    assert.equal(error.evidence.accountedCostUsd, 0.003);
    assert.equal(error.evidence.knownRunSpendUsd, 0.003);
    assert.equal(error.evidence.usageUnknown, false);
    assert.equal(error.evidence.retainedArtifactDigest, artifact(baseline));
    return true;
  });
  assert.equal(verifierCalls, 2);
});

test("post-merge: valid ordinary verifier output still completes a real compiled repair", async () => {
  const { verifyProgramCandidate } = await import("../src/genome-lab-verifier.ts");
  const run = await runCodingRepairController({ baseline,
    verify: candidate => verifyProgramCandidate({ candidate, behaviorCheck: async candidate =>
      candidate.files[0].content === "export const value = 1;\n" ? [] : verification(candidate, false).failures }),
    model: { async propose(input) { return { inputTokens: 0, outputTokens: 0, accountedCostUsd: 0,
      proposal: { schemaVersion: 1, baseArtifactDigest: input.verification.artifactDigest,
        failureFingerprint: input.verification.failures[0].fingerprint, strategy: input.strategy,
        changes: [{ path: "src/value.ts", expectedContentDigest: sha256(input.candidate.files[0].content),
          replacementText: "export const value = 1;\n" }], limitations: [] } }; } },
  });
  assert.equal(run.state, "VERIFIED_CANDIDATE");
  assert.equal(run.verification.artifactDigest, artifact(run.champion));
  assert.equal(run.performanceGauge.verifierExecutions, 2);
});
