import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { expandCodingRepairEdits, CODING_REPAIR_EDITS_OUTPUT_CONTRACT } from "../src/coding-repair-edits.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "../src/coding-repair-policy.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const text = "export const first = 1;\nexport const second = 2;\n";
const fingerprint = "f".repeat(64);
const artifactDigest = "a".repeat(64);
const candidate: ProgramCandidateProposal = { schemaVersion: 1, candidateKind: "typescript_program", programName: "Edits fixture", summary: "fixture", limitations: [], files: [{ path: "src/value.ts", content: text }, { path: "tests/value.test.ts", content: "PRIVATE_EXPECTED_SOURCE" }] };
function patch() { return { schemaVersion: 1, baseArtifactDigest: artifactDigest, failureFingerprint: fingerprint, strategy: "surgical", changes: [{ path: "src/value.ts", expectedContentDigest: sha256(text), edits: [{ find: "first = 1", replace: "first = 3" }] }], limitations: [] }; }
const expand = (value: unknown) => expandCodingRepairEdits({ value, candidate, artifactDigest, failureFingerprints: new Set([fingerprint]), strategy: "surgical", limits: INITIAL_CODING_REPAIR_LIMITS });

describe("V6 compact transport safety", () => {
  it("reconstructs the same canonical proposal digest without mutating input", () => {
    const before = structuredClone(candidate);
    const result = expand(patch());
    const expected = { schemaVersion: 1, baseArtifactDigest: artifactDigest, failureFingerprint: fingerprint, strategy: "surgical", changes: [{ path: "src/value.ts", expectedContentDigest: sha256(text), replacementText: text.replace("first = 1", "first = 3") }], limitations: [] };
    assert.equal(sha256(canonicalJson(result)), sha256(canonicalJson(expected)));
    assert.deepEqual(candidate, before);
  });
  for (const [name, mutate] of [
    ["stale artifact", (p: any) => { p.baseArtifactDigest = "b".repeat(64); }],
    ["stale file", (p: any) => { p.changes[0].expectedContentDigest = "b".repeat(64); }],
    ["unknown failure", (p: any) => { p.failureFingerprint = "b".repeat(64); }],
    ["protected test", (p: any) => { p.changes[0].path = "tests/value.test.ts"; }],
    ["unknown file", (p: any) => { p.changes[0].path = "src/other.ts"; }],
    ["duplicate file", (p: any) => { p.changes.push(p.changes[0]); }],
    ["too many files", (p: any) => { p.changes = Array(3).fill(p.changes[0]); }],
    ["ambiguous anchor", (p: any) => { p.changes[0].edits[0].find = "export const"; }],
    ["absent anchor", (p: any) => { p.changes[0].edits[0].find = "missing"; }],
    ["overlapping anchors", (p: any) => { p.changes[0].edits.push({ find: "first", replace: "other" }); }],
    ["no-op edit", (p: any) => { p.changes[0].edits[0].replace = p.changes[0].edits[0].find; }],
    ["unbounded edits", (p: any) => { p.changes[0].edits = Array(9).fill(p.changes[0].edits[0]); }],
    ["oversized result", (p: any) => { p.changes[0].edits[0].replace = "x".repeat(16*1024); }],
    ["extra authority", (p: any) => { p.maximumCycles = 99; }],
    ["unbounded limitations", (p: any) => { p.limitations = ["x".repeat(301)]; }],
  ] as const) it(`rejects ${name} without disclosing source`, () => {
    const value = patch(); mutate(value);
    assert.throws(() => expand(value), error => error instanceof Error && !error.message.includes("PRIVATE_EXPECTED_SOURCE"));
  });
  it("cannot expand any authority ceiling or remove a protected path", () => {
    for (const key of ["maximumCycles", "surgicalFiles", "surgicalChangedLines", "deepFiles", "deepChangedLines", "maximumModelSpendUsd"] as const) {
      assert.throws(() => expandCodingRepairEdits({ value: patch(), candidate, artifactDigest, failureFingerprints: new Set([fingerprint]), strategy: "surgical", limits: { ...INITIAL_CODING_REPAIR_LIMITS, [key]: INITIAL_CODING_REPAIR_LIMITS[key] + 1 } }), key);
    }
    assert.throws(() => expandCodingRepairEdits({ value: patch(), candidate, artifactDigest, failureFingerprints: new Set([fingerprint]), strategy: "surgical", limits: { ...INITIAL_CODING_REPAIR_LIMITS, protectedPaths: [] } }));
  });
  it("applies edits simultaneously, including edits that introduce another anchor", () => {
    const value = patch();
    value.changes[0].edits = [{ find: "first = 1", replace: "first = 2" }, { find: "second = 2", replace: "second = 4" }];
    assert.equal(expand(value).changes[0].replacementText, "export const first = 2;\nexport const second = 4;\n");
  });
  it("keeps first-call transport identical and never overrides controller strategy", async () => {
    const prompts: string[] = [];
    const regular = { ...patch(), changes: [{ path: "src/value.ts", expectedContentDigest: sha256(text), replacementText: text.replace("first = 1", "first = 3") }] };
    const options = { client: { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
      async countInputTokens(value: string) { prompts.push(value); return 100; },
      async execute() { return { outputText: JSON.stringify({ ...regular, strategy: "deep" }), inputTokens: 100, billableOutputTokens: 50 }; },
    }, context: { objective: "Repair value", acceptanceCriteria: ["Return a number"], constitutionDigest: "b".repeat(64), missingCapabilities: [], memoryContext: { contextDigest: "c".repeat(64), memories: [] } } };
    const request = { candidate, verification: { passed: false, score: 0.8, artifactDigest, failures: [{ kind: "behavior" as const, code: "FAILED", file: "src/value.ts", line: 1, column: 1, evidenceDigest: "d".repeat(64), fingerprint, severity: "medium" as const, existedBeforeRepair: true }], completedChecks: [] as [], evidenceDigests: [] }, strategy: "surgical" as const, cycle: 1, remainingCostUsd: 0.15, attemptLessons: [] };
    const plain = await createLunaCodingRepairModel(options).propose(request);
    const compact = await createLunaCodingRepairModel({ ...options, compactRepairContinuations: true }).propose(request);
    assert.equal(prompts[0], prompts[1]);
    assert(!prompts[0].includes("PRIVATE_EXPECTED_SOURCE"));
    assert.deepEqual(plain, compact);
    assert.equal(compact.proposal.strategy, "surgical");
  });
  it("preserves known provider usage when an invalid compact response is rejected", async () => {
    const model = createLunaCodingRepairModel({
      compactRepairContinuations: true,
      context: { objective: "repair", acceptanceCriteria: ["preserve behavior"], constitutionDigest: "b".repeat(64), missingCapabilities: [], memoryContext: { contextDigest: "c".repeat(64), memories: [] } },
      client: { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
        async countInputTokens() { return 100; },
        async execute() { return { outputText: "PRIVATE_MALFORMED_MODEL_OUTPUT", inputTokens: 100, billableOutputTokens: 50 }; },
      },
    });
    await assert.rejects(() => model.propose({ candidate, verification: { passed: false, score: 0.8, artifactDigest, failures: [], completedChecks: [], evidenceDigests: [] }, strategy: "surgical", cycle: 2, remainingCostUsd: 0.15 }), (error: any) => {
      assert.equal(error.name, "CodingRepairOutputError");
      assert.equal(error.inputTokens, 100);
      assert.equal(error.outputTokens, 50);
      assert(error.accountedCostUsd > 0);
      assert(!JSON.stringify(error).includes("PRIVATE_MALFORMED_MODEL_OUTPUT"));
      assert(!error.message.includes("PRIVATE_MALFORMED_MODEL_OUTPUT"));
      return true;
    });
  });
  it("binds the same strict edit schema to token counting and generation", async () => {
    const bodies: Record<string, any>[] = [];
    const client = new OpenAIResponsesClient({ apiKey: "test-only-not-a-credential", fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(String(url).endsWith("input_tokens") ? { input_tokens: 100 } : { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(patch()) }] }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
    } });
    const prompt = CODING_REPAIR_EDITS_OUTPUT_CONTRACT + "\nrepair";
    await client.countInputTokens(prompt);
    await client.execute({ prompt, reasoningLevel: "medium", maximumOutputTokens: 8000 });
    assert.deepEqual(bodies[0].text, bodies[1].text);
    assert.equal(bodies[0].text.format.name, "sara_coding_repair_edits_v1");
    assert.equal(bodies[0].text.format.strict, true);
    assert.equal(bodies[1].model, "gpt-5.6-luna");
    assert.equal(bodies[1].store, false);
  });
});
