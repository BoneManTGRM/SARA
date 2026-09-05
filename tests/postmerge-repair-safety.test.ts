import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ts from "typescript";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { ExperimentalCompilerCache } from "../src/experimental-compiler-cache.ts";
import { GuardedRepairMemory, type Scope } from "../proof/guarded-repair-memory.ts";
import { runCodingRepairController, type CodingRepairModel } from "../src/experimental-v5/coding-repair-controller.ts";
import type { ProgramVerificationResult } from "../src/experimental-v5/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const candidate = (value = 0): ProgramCandidateProposal => ({
  schemaVersion: 1, candidateKind: "typescript_program", programName: "postmerge-boundary",
  summary: "Offline boundary regression", limitations: [],
  files: [{ path: "src/index.ts", content: `export const value = ${value};\n` }],
});
// Independently constructed to match the unchanged Genome Lab artifact contract.
function artifact(c: ProgramCandidateProposal): string {
  return sha256(canonicalJson({ schemaVersion: 1, files: c.files.map(f => ({
    path: f.path, contentDigest: sha256(f.content),
  })).sort((a, b) => a.path.localeCompare(b.path)) }));
}
const scope: Scope = { contract: sha256("contract"), dependencies: sha256("deps"),
  verifier: sha256("verifier"), policy: sha256("policy") };
function verification(c: ProgramCandidateProposal, passed = false): ProgramVerificationResult {
  return { passed, score: passed ? 1 : 0.8, artifactDigest: artifact(c),
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [sha256("offline evidence")], failures: passed ? [] : [{
      kind: "behavior", code: "WRONG_VALUE", file: "src/index.ts", line: 1, column: 1,
      severity: "medium", existedBeforeRepair: true,
      fingerprint: sha256("failure"), evidenceDigest: sha256("failure evidence"),
    }] };
}

test("compiler cache never exposes the same mutable declaration AST to two programs", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-cache-isolation-"));
  try {
    const dir = join(root, "node_modules", "fixture"); await mkdir(dir, { recursive: true });
    const path = join(dir, "index.d.ts"); await writeFile(path, "type Answer = number;\n");
    const cache = new ExperimentalCompilerCache();
    const options: ts.CompilerOptions = { noLib: true, types: [], strict: true, noEmit: true };
    const first = ts.createProgram([path], options, cache.createHost(options));
    const second = ts.createProgram([path], options, cache.createHost(options));
    assert.notStrictEqual(first.getSourceFile(path), second.getSourceFile(path));
    assert(cache.snapshot().hits > 0, "immutable declaration text can still be interned");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("mutating an earlier compiler AST cannot make a later wrong program pass semantic checking", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-cache-poison-"));
  try {
    const dir = join(root, "node_modules", "fixture"); await mkdir(dir, { recursive: true });
    const path = join(dir, "index.d.ts"), entry = join(root, "main.ts");
    await writeFile(path, "type Answer = number;\n");
    await writeFile(entry, 'const answer: Answer = "not a number";\n');
    const options: ts.CompilerOptions = { noLib: true, types: [], strict: true, noEmit: true };
    const cache = new ExperimentalCompilerCache();
    const first = ts.createProgram([path, entry], options, cache.createHost(options));
    const alias = first.getSourceFile(path)!.statements[0] as ts.TypeAliasDeclaration;
    (alias as unknown as { type: ts.TypeNode }).type = ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
    const ordinary = ts.createProgram([path, entry], options, ts.createCompilerHost(options));
    const later = ts.createProgram([path, entry], options, cache.createHost(options));
    const codes = (p: ts.Program) => p.getSemanticDiagnostics().map(d => d.code);
    assert(codes(ordinary).includes(2322));
    assert.deepEqual(codes(later), codes(ordinary));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("quarantine survives replacing a recipe and then relearning its old repair", () => {
  const memory = new GuardedRepairMemory(), before = candidate(), a = candidate(1), b = candidate(2);
  const id = memory.learn(before, a, verification(a, true), scope);
  memory.quarantine(id, sha256("actual later failure"));
  memory.learn(before, b, verification(b, true), scope);
  assert(memory.lookup(before, verification(before), scope, "surgical"), "a different verified repair stays usable");
  memory.learn(before, a, verification(a, true), scope);
  assert.equal(memory.lookup(before, verification(before), scope, "surgical"), null);
});

test("a new evidence digest cannot reactivate the same quarantined repair", () => {
  const memory = new GuardedRepairMemory(), before = candidate(), after = candidate(1);
  const good = verification(after, true), id = memory.learn(before, after, good, scope);
  memory.quarantine(id, sha256("failed fresh verification"));
  memory.learn(before, after, { ...good, evidenceDigests: [sha256("different evidence")] }, scope);
  assert.equal(memory.lookup(before, verification(before), scope, "surgical"), null);
});

test("quarantining an earlier recipe identity remains effective after an intervening replacement", () => {
  const memory = new GuardedRepairMemory(), before = candidate(), a = candidate(1), b = candidate(2);
  const id = memory.learn(before, a, verification(a, true), scope);
  memory.learn(before, b, verification(b, true), scope);
  memory.quarantine(id, sha256("late evidence for original recipe"));
  memory.learn(before, a, verification(a, true), scope);
  assert.equal(memory.lookup(before, verification(before), scope, "surgical"), null);
});

for (const invalid of [undefined, null, 0, ""]) test(`memory lookup rejects malformed false-like verification: ${String(invalid)}`, () => {
  const memory = new GuardedRepairMemory(), before = candidate(), after = candidate(1);
  memory.learn(before, after, verification(after, true), scope);
  const malformed = { ...verification(before), passed: invalid } as unknown as ProgramVerificationResult;
  assert.equal(memory.lookup(before, malformed, scope, "surgical"), null);
});

const passMutations: Array<[string, (v: ProgramVerificationResult) => void]> = [
  ["missing behavioral check", v => { v.completedChecks = v.completedChecks.filter(c => c !== "behavior_tests"); }],
  ["empty verification evidence", v => { v.evidenceDigests = []; }],
  ["malformed artifact digest", v => { v.artifactDigest = "not-a-digest"; }],
  ["valid-looking digest for a different artifact", v => { v.artifactDigest = artifact(candidate(9)); }],
  ["unknown completed check", v => { (v.completedChecks as string[]).push("PRIVATE_TEST_OUTPUT"); }],
];
for (const [name, mutate] of passMutations) test(`controller rejects claimed PASS with ${name} before model dispatch`, async () => {
  const baseline = candidate(); const v = verification(baseline, true); mutate(v); let calls = 0;
  await assert.rejects(runCodingRepairController({ baseline, verify: async () => v,
    model: { propose: async () => { calls++; throw new Error("unexpected model dispatch"); } },
  }), /verification/i);
  assert.equal(calls, 0);
});

test("controller cannot pass malformed nested verifier evidence through to the model", async () => {
  const baseline = candidate(); const v = verification(baseline);
  (v.failures[0] as unknown as { kind: object }).kind = { privateTestOutput: "PRIVATE_TEST_OUTPUT" };
  let calls = 0;
  await assert.rejects(runCodingRepairController({ baseline, verify: async () => v,
    model: { propose: async () => { calls++; throw new Error("unexpected model dispatch"); } },
  }), /verification/i);
  assert.equal(calls, 0);
});

test("model-owned response mutation during verification cannot change receipts or accounted totals", async () => {
  let response: Awaited<ReturnType<CodingRepairModel["propose"]>> | undefined;
  const baseline = candidate(); let verifications = 0;
  const run = await runCodingRepairController({ baseline,
    verify: async c => {
      verifications++;
      if (response) { response.accountedCostUsd = 0; response.inputTokens = 999; response.proposal.changes.length = 0; }
      return verification(c, verifications > 1);
    },
    model: { propose: async r => {
      response = { inputTokens: 10, outputTokens: 20, accountedCostUsd: 0.01, proposal: {
        schemaVersion: 1, baseArtifactDigest: r.verification.artifactDigest,
        failureFingerprint: r.verification.failures[0].fingerprint, strategy: r.strategy,
        limitations: [], changes: [{ path: "src/index.ts", expectedContentDigest: sha256(r.candidate.files[0].content),
          replacementText: candidate(1).files[0].content }],
      } }; return response;
    } },
  });
  assert.equal(run.state, "VERIFIED_CANDIDATE");
  assert.equal(run.receipts[0].accountedCostUsd, 0.01);
  assert.equal(run.receipts[0].inputTokens, 10);
  assert.equal(run.receipts[0].changedFiles, 1);
  assert.equal(run.performanceGauge.accountedCostUsd, run.accountedCostUsd);
});

test("equal callback source text cannot collapse different compiler parse contexts", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-cache-closures-"));
  try {
    const dir = join(root, "node_modules", "fixture"); await mkdir(dir, { recursive: true });
    const path = join(dir, "index.d.ts"); await writeFile(path, "type Answer = number;\n");
    const cache = new ExperimentalCompilerCache(), host = cache.createHost({});
    const makeContext = (module: boolean): ts.CreateSourceFileOptions => ({ languageVersion: ts.ScriptTarget.ES2022,
      setExternalModuleIndicator(file) {
        (file as ts.SourceFile & { externalModuleIndicator?: ts.Node }).externalModuleIndicator = module ? file.statements[0] : undefined;
      },
    });
    const first = host.getSourceFile(path, makeContext(true))!;
    const second = host.getSourceFile(path, makeContext(false))!;
    assert(ts.isExternalModule(first)); assert.equal(ts.isExternalModule(second), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("memory capacity includes superseded and quarantined repair identities", () => {
  const memory = new GuardedRepairMemory(), before = candidate(); let firstId = "";
  for (let i = 1; i <= 32; i++) {
    const after = candidate(i), id = memory.learn(before, after, verification(after, true), scope);
    if (i === 1) firstId = id;
    memory.quarantine(id, sha256(`failure ${i}`));
  }
  assert.equal(memory.identityCount, 32);
  const extra = candidate(33);
  assert.throws(() => memory.learn(before, extra, verification(extra, true), scope), /CAPACITY/);
  const first = candidate(1);
  assert.equal(memory.learn(before, first, verification(first, true), scope), firstId);
  assert.equal(memory.lookup(before, verification(before), scope, "surgical"), null);
});

test("reordered files and refreshed evidence do not change a quarantined repair identity", () => {
  const memory = new GuardedRepairMemory(), before = candidate(), after = candidate(1);
  for (const c of [before, after]) c.files.push({ path: "src/other.ts", content: `export const other = ${c === before ? 0 : 1};\n` });
  const id = memory.learn(before, after, verification(after, true), scope);
  memory.quarantine(id, sha256("failed actual repair"));
  before.files.reverse(); after.files.reverse();
  assert.equal(memory.learn(before, after, { ...verification(after, true), evidenceDigests: [sha256("refreshed")] }, scope), id);
  assert.equal(memory.lookup(before, verification(before), scope, "surgical"), null);
});

test("isolated V5 still repairs through actual compilation and sandboxed behavioral verification", async () => {
  const { verifyGenomeLabProgramCandidate } = await import("../src/genome-lab-verifier.ts");
  const { loadConstitution } = await import("../src/constitution.ts");
  const constitutionDigest = (await loadConstitution()).digest;
  const baseline: ProgramCandidateProposal = { ...candidate(), files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: "export const value: number = 0;\n" },
    { path: "tests/value.test.ts", content: 'import { value } from "../src/index.ts";\nif (value !== 42) throw new Error("wrong value");\n' },
  ] };
  const verify = (c: ProgramCandidateProposal) => verifyGenomeLabProgramCandidate({ candidate: c,
    objective: "Export the number 42", acceptanceCriteria: ["The exported number is 42."], constitutionDigest });
  let calls = 0;
  const run = await runCodingRepairController({ baseline, verify, model: { propose: async r => {
    calls++;
    return { inputTokens: 0, outputTokens: 0, accountedCostUsd: 0, proposal: {
      schemaVersion: 1, baseArtifactDigest: r.verification.artifactDigest, failureFingerprint: r.verification.failures[0].fingerprint,
      strategy: r.strategy, limitations: [], changes: [{ path: "src/value.ts",
        expectedContentDigest: sha256(r.candidate.files.find(f => f.path === "src/value.ts")!.content),
        replacementText: "export const value: number = 42;\n" }],
    } };
  } } });
  assert.equal(run.state, "VERIFIED_CANDIDATE"); assert.equal(calls, 1);
  assert.equal(run.baselineVerification.passed, false);
  assert.equal(run.performanceGauge.verifierExecutions, 2);
  assert.deepEqual(await verify(run.champion), run.verification);
  assert.equal(run.champion.files[2].content, baseline.files[2].content);
});

test("historical evaluator cannot turn arithmetic overflow or underflow into speed evidence", async () => {
  const { evaluatePair } = await import("../proof/v7-live-evaluation.ts");
  const arm = (timeMs: number) => ({ verifiedComplete: true, timeMs, costUsd: 0, error: null });
  for (const [control, treatment] of [[Number.MAX_VALUE, Number.MIN_VALUE], [Number.MAX_VALUE, 1], [Number.MIN_VALUE, Number.MAX_VALUE]]) {
    const result = evaluatePair(arm(control), arm(treatment));
    assert.equal(result.valid, false); assert.equal(result.timeComparable, false);
    assert.equal(result.speedRatio, null); assert.equal(result.speedIncreasePercent, null);
    assert.equal(result.target300PercentMet, false); assert.equal(result.verdict, "INCONCLUSIVE");
  }
});
