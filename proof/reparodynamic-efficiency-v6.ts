import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { expandCodingRepairEdits, CODING_REPAIR_EDITS_OUTPUT_CONTRACT } from "../src/coding-repair-edits.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const context = { constitutionDigest: "a".repeat(64), missingCapabilities: [], memoryContext: { contextDigest: sha256("[]"), memories: [] } };
const cases = [
  {
    id: "bounded-count", objective: "Clamp finite numbers to zero through ten.",
    before: "export function run(n: number): number {\n  return Math.max(0, n);\n}\n",
    find: "Math.max(0, n)", replace: "Math.min(10, Math.max(0, n))",
    // Independent reference: comparisons instead of candidate min/max composition.
    checks: [-5, 0, 3, 10, 12].map(n => `equal(run(${n}), ${n < 0 ? 0 : n > 10 ? 10 : n});`),
  },
  {
    id: "integer-delta", objective: "Return milliseconds for nonnegative integer seconds and null for invalid input.",
    before: 'export function run(value: string): number | null {\n  if (value.trim() === "") return null;\n  const seconds = Number(value);\n  if (!Number.isInteger(seconds) || seconds < 0) return null;\n  return seconds;\n}\n',
    find: "return seconds;", replace: "return seconds * 1000;",
    checks: ['equal(run("0"), 0);', 'equal(run(" 2 "), 2000);', 'equal(run("7"), 7000);', 'equal(run("-1"), null);', 'equal(run("1.5"), null);', 'equal(run(""), null);', 'equal(run("junk"), null);'],
  },
  {
    id: "canonical-tags", objective: "Trim, lowercase, deduplicate, and sort nonempty tags.",
    before: 'export function run(values: readonly string[]): string[] {\n  const normalized = values.map(value => value.trim().toLowerCase()).filter(value => value.length > 0);\n  return normalized.sort();\n}\n',
    find: "return normalized.sort();", replace: "return [...new Set(normalized)].sort();",
    checks: ['deepEqual(run([" B ", "a", "A", "", "b"]), ["a", "b"]);', 'deepEqual(run([]), []);', 'deepEqual(run([" z ", "x"]), ["x", "z"]);'],
  },
];
const integration = [];
for (const fixture of cases) {
  const objective = fixture.objective;
  const acceptanceCriteria = [fixture.objective];
  const fullContext = { ...context, objective, acceptanceCriteria };
  const tests = 'import { run } from "../src/value.ts";\nimport { strictEqual as equal, deepStrictEqual as deepEqual } from "node:assert/strict";\n' + fixture.checks.join("\n") + "\n";
  const baseline: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: fixture.id.replaceAll("-", " "), summary: "Credential-free transport parity fixture", limitations: [], files: [{ path: "src/index.ts", content: 'export { run } from "./value.ts";\n' }, { path: "src/value.ts", content: fixture.before }, { path: "tests/value.test.ts", content: tests }] };
  const correct = fixture.before.replace(fixture.find, fixture.replace);
  const reference = structuredClone(baseline);
  reference.files[1].content = correct;
  const verify = (candidate: ProgramCandidateProposal) => verifyGenomeLabProgramCandidate({ candidate, objective, acceptanceCriteria, constitutionDigest: context.constitutionDigest });
  // No performance trial starts until the independent reference proves this fixture is admissible.
  assert.equal((await verify(reference)).passed, true, `reference must pass for ${fixture.id}`);
  assert.equal((await verify(baseline)).passed, false, `baseline must fail for ${fixture.id}`);
  const arms = [];
  const firstPrompts: string[] = [];
  for (const compactRepairContinuations of [false, true]) {
    let calls = 0;
    let continuationBytes = 0;
    const client: WorkerModelClient = {
      routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
      async countInputTokens(prompt) { if (calls === 0) firstPrompts.push(prompt); return 100; },
      async execute(input) {
        assert.equal(input.reasoningLevel, "medium");
        calls++;
        const facts = JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
        assert(!input.prompt.includes("strictEqual as equal"));
        // Identical scripted repair sequence. Only wire encoding varies, never repair correctness.
        const replacementText = calls === 1 ? fixture.before : correct;
        const output = {
          schemaVersion: 1, baseArtifactDigest: facts.currentArtifactDigest,
          failureFingerprint: facts.failures[0].fingerprint, strategy: facts.requiredStrategy,
          changes: [{ path: "src/value.ts", expectedContentDigest: sha256(fixture.before),
            ...(input.prompt.startsWith(CODING_REPAIR_EDITS_OUTPUT_CONTRACT)
              ? { edits: [{ find: fixture.find, replace: fixture.replace }] }
              : { replacementText }) }], limitations: [],
        };
        const outputText = JSON.stringify(output);
        if (calls === 2) continuationBytes = Buffer.byteLength(outputText);
        // Synthetic accounting only. No provider/network call is made by this client.
        return { outputText, inputTokens: 100, billableOutputTokens: 50 };
      },
    };
    const result = await runCodingRepairController({ baseline, verify, model: createLunaCodingRepairModel({ client, context: fullContext, compactRepairContinuations }) });
    const postVerification = await verify(result.champion);
    assert.equal(result.state, "VERIFIED_CANDIDATE");
    assert.equal(postVerification.passed, true);
    assert.equal(calls, 2);
    arms.push({ representation: compactRepairContinuations ? "anchored_edits" : "full_replacement", verifiedComplete: true, score: postVerification.score, scriptedCalls: calls, continuationBytes, artifactDigest: postVerification.artifactDigest, proposalDigests: result.receipts.map(receipt => receipt.proposalDigest) });
  }
  assert.equal(firstPrompts[0], firstPrompts[1]);
  assert.equal(arms[0].artifactDigest, arms[1].artifactDigest);
  assert.deepEqual(arms[0].proposalDigests, arms[1].proposalDigests);
  integration.push({ caseId: fixture.id, independentChecks: fixture.checks.length, firstPromptDigest: sha256(firstPrompts[0]), arms });
}

const wireSizeCases = [];
for (const path of ["src/canonical.ts", "src/luna-coding-repair-model.ts", "src/coding-repair-prompt.ts", "src/coding-repair-controller.ts"]) {
  const good = await readFile(path, "utf8");
  const brokenLine = '\nconst __wireCompileProbe: number = "invalid";\n';
  const original = good + brokenLine;
  assert(Buffer.byteLength(original) < 16 * 1024);
  const candidate: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "Wire fixture", summary: "Wire size only; not an executable benchmark fixture", limitations: [], files: [{ path, content: original }] };
  const envelope = { schemaVersion: 1, baseArtifactDigest: sha256(original), failureFingerprint: "f".repeat(64), strategy: "surgical", limitations: [] };
  const common = { path, expectedContentDigest: sha256(original) };
  const full = { ...envelope, changes: [{ ...common, replacementText: good }] };
  const compact = { ...envelope, changes: [{ ...common, edits: [{ find: brokenLine, replace: "" }] }] };
  const expanded = expandCodingRepairEdits({ value: compact, candidate, artifactDigest: envelope.baseArtifactDigest, failureFingerprints: new Set([envelope.failureFingerprint]), strategy: "surgical", limits: INITIAL_CODING_REPAIR_LIMITS });
  assert.equal(canonicalJson(full), canonicalJson(expanded));
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  const compactBytes = Buffer.byteLength(JSON.stringify(compact));
  wireSizeCases.push({ path, sourceDigest: sha256(good), fullBytes, compactBytes, reductionPercent: (1 - compactBytes / fullBytes) * 100, sameProposalDigest: sha256(canonicalJson(full)) });
}
const authority = { ...INITIAL_CODING_REPAIR_LIMITS, repositoryMutation: false, merge: false, deploy: false, promotion: false };
const evidence = {
  schemaVersion: 1, evidenceLevel: "DETERMINISTIC_TRANSPORT_PARITY_AND_WIRE_MEASUREMENT",
  integration, wireSizeCases, authority, authorityDigest: sha256(canonicalJson(authority)),
  physicalProviderCalls: 0, physicalProviderSpendUsd: 0,
  providerLatencyMeasured: false, providerTokenSavingsMeasured: false, costSuperiorityEstablished: false,
  codingSpeedIncreasePercent: null, generalClaimSupported: false,
  limitations: ["Scripted responses test transport/controller/verifier integration, not Luna's ability to choose edits.", "Wire bytes are not provider tokens, reasoning cost, or end-to-end coding speed.", "Small patches may be larger than full replacements on tiny functions.", "The original three-cycle and monetary ceilings are unchanged; compact transport is opt-in and first calls are unchanged."],
};
console.log(JSON.stringify({ ...evidence, evidenceDigest: sha256(canonicalJson(evidence)) }));
