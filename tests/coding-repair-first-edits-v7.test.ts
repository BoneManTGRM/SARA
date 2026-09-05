import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { CODING_REPAIR_EDITS_OUTPUT_CONTRACT } from "../src/coding-repair-edits.ts";
import { createLunaCodingRepairModel, CodingRepairOutputError } from "../src/luna-coding-repair-model.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { CodingRepairProposal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const source = "export const first = 1;\nexport const second = 2;\n";
const artifactDigest = "a".repeat(64);
const fingerprint = "f".repeat(64);
const candidate: ProgramCandidateProposal = {
  schemaVersion: 1, candidateKind: "typescript_program", programName: "First edit fixture",
  summary: "Scripted adapter boundary proof", limitations: [],
  files: [{ path: "src/value.ts", content: source },
    { path: "tests/value.test.ts", content: "PRIVATE_EXPECTED_OUTPUT_DO_NOT_DISCLOSE" }],
};
const verification: ProgramVerificationResult = {
  passed: false, score: 0.8, artifactDigest,
  failures: [{ kind: "behavior", code: "FAILED", file: "src/value.ts", line: 1, column: 1,
    evidenceDigest: "d".repeat(64), fingerprint, severity: "medium", existedBeforeRepair: true }],
  completedChecks: ["source_policy", "syntax", "typecheck", "artifact_integrity"], evidenceDigests: [],
};
const request = { candidate, verification, strategy: "surgical" as const, cycle: 1, remainingCostUsd: 0.15 };
const context = {
  objective: "Repair the value without changing the other export", acceptanceCriteria: ["first is 3; second remains 2"],
  constitutionDigest: "b".repeat(64), missingCapabilities: [], memoryContext: { contextDigest: sha256("[]"), memories: [] },
};
function compact() {
  return { schemaVersion: 1, baseArtifactDigest: artifactDigest, failureFingerprint: fingerprint,
    strategy: "deep", changes: [{ path: "src/value.ts", expectedContentDigest: sha256(source),
      edits: [{ find: "first = 1", replace: "first = 3" }] }], limitations: [] };
}
function full(): CodingRepairProposal {
  return { schemaVersion: 1, baseArtifactDigest: artifactDigest, failureFingerprint: fingerprint, strategy: "surgical",
    changes: [{ path: "src/value.ts", expectedContentDigest: sha256(source), replacementText: source.replace("first = 1", "first = 3") }], limitations: [] };
}
function clientFor(output: unknown) {
  const prompts: string[] = [];
  let calls = 0;
  const client: WorkerModelClient = {
    routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
    async countInputTokens(prompt) { prompts.push(prompt); return 100; },
    async execute(input) {
      assert.equal(input.reasoningLevel, "medium");
      assert.equal(input.maximumOutputTokens, 8000);
      calls++;
      return { outputText: JSON.stringify(output), inputTokens: 100, billableOutputTokens: 50 };
    },
  };
  return { client, prompts, calls: () => calls };
}
const experimental = { compactRepairContinuations: true, experimentalCompactFirstProposal: true };

describe("V7 explicit first-proposal compact experiment", () => {
  it("uses compact output on cycle one only when separately opted in", async () => {
    const fake = clientFor(compact());
    const result = await createLunaCodingRepairModel({ ...fake, context, ...experimental }).propose(request);
    assert(fake.prompts[0].startsWith(CODING_REPAIR_EDITS_OUTPUT_CONTRACT));
    assert.deepEqual(result.proposal, full());
    assert.equal(fake.calls(), 1);
    assert.equal(result.proposal.strategy, "surgical");
    assert(!fake.prompts[0].includes("PRIVATE_EXPECTED_OUTPUT_DO_NOT_DISCLOSE"));
    assert.equal(candidate.files[0].content, source);
  });
  it("requires continuation opt-in too, before any model call", () => {
    const fake = clientFor(compact());
    assert.throws(() => createLunaCodingRepairModel({ ...fake, context, experimentalCompactFirstProposal: true }), /requires compactRepairContinuations/u);
    assert.equal(fake.calls(), 0);
  });
  it("preserves the old first prompt and proposal exactly for default, legacy and explicitly disabled settings", async () => {
    const prompts: string[] = [];
    for (const options of [{}, { compactRepairContinuations: true }, { ...experimental, experimentalCompactFirstProposal: false }]) {
      const fake = clientFor(full());
      const result = await createLunaCodingRepairModel({ ...fake, context, ...options }).propose(request);
      assert.deepEqual(result.proposal, full());
      prompts.push(fake.prompts[0]);
    }
    assert.equal(new Set(prompts).size, 1);
    assert(!prompts[0].startsWith(CODING_REPAIR_EDITS_OUTPUT_CONTRACT));
  });
  for (const [name, mutate] of [
    ["extra authority", (p: ReturnType<typeof compact>) => { Object.assign(p, {maximumCycles: 99}); }],
    ["stale file", (p: ReturnType<typeof compact>) => { p.changes[0].expectedContentDigest = "0".repeat(64); }],
    ["protected test", (p: ReturnType<typeof compact>) => { p.changes[0].path = "tests/value.test.ts"; }],
    ["ambiguous anchor", (p: ReturnType<typeof compact>) => { p.changes[0].edits[0].find = "export const"; }],
    ["no-op", (p: ReturnType<typeof compact>) => { p.changes[0].edits[0].replace = p.changes[0].edits[0].find; }],
  ] as const) it(`rejects ${name} on the first call, preserving usage and not retrying`, async () => {
    const value = compact(); mutate(value);
    const fake = clientFor(value);
    await assert.rejects(() => createLunaCodingRepairModel({ ...fake, context, ...experimental }).propose(request), error => {
      assert(error instanceof CodingRepairOutputError);
      assert.equal(error.inputTokens, 100); assert.equal(error.outputTokens, 50);
      assert(error.accountedCostUsd > 0);
      assert(!error.message.includes("PRIVATE_EXPECTED"));
      return true;
    });
    assert.equal(fake.calls(), 1);
  });
  it("keeps the original first-cycle changed-line ceiling", async () => {
    const value = compact();
    value.changes[0].edits[0].replace = "first = 3;\n" + "// bounded probe\n".repeat(81);
    const fake = clientFor(value); let verifierCalls = 0;
    await assert.rejects(() => runCodingRepairController({ baseline: candidate,
      verify: async () => { verifierCalls++; return verification; },
      model: createLunaCodingRepairModel({ ...fake, context, ...experimental }),
    }), /changed-line limit/u);
    assert.equal(fake.calls(), 1); assert.equal(verifierCalls, 1);
    assert.equal(candidate.files[0].content, source);
  });
  it("still stops clean candidates before any proposal", async () => {
    const fake = clientFor(compact());
    const run = await runCodingRepairController({ baseline: candidate,
      verify: async () => ({ ...verification, passed: true, score: 1, failures: [] }),
      model: createLunaCodingRepairModel({ ...fake, context, ...experimental }) });
    assert.equal(run.state, "VERIFIED_CANDIDATE"); assert.equal(fake.calls(), 0);
    assert.equal(run.accountedCostUsd, 0); assert.deepEqual(run.champion, candidate);
  });
});
