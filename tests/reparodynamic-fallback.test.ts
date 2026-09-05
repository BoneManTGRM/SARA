import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createReparodynamicCandidateGenerator } from "../src/reparodynamic-candidate-generator.ts";
import type { CodingRepairModel } from "../src/coding-repair-controller.ts";
import type { ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { CandidateGenerator, ProgramCandidateProposal } from "../src/types.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1, candidateKind: "typescript_program", programName: "Fallback fixture",
  summary: "A deliberately invalid source remains subject to kernel acceptance.", limitations: [],
  files: [
    { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
    { path: "src/value.ts", content: 'export const value: number = "invalid";\n' },
    { path: "tests/value.test.ts", content: 'import { value } from "../src/value.ts";\nif (value !== 42) throw new Error("wrong");\n' },
  ],
};
const context = { objective: "Repair value", acceptanceCriteria: ["Value is 42"], missingCapabilities: [], constitutionDigest: "a".repeat(64), memoryContext: { contextDigest: "b".repeat(64), memories: [] } };
function baseGenerator(onGenerate = () => {}): CandidateGenerator {
  return { id: "fallback-fixture", external: false, maximumCostUsd: 0, generate: async () => { onGenerate(); return structuredClone(baseline); } };
}
function check(candidate: ProgramCandidateProposal, passed = false): ProgramVerificationResult {
  return { passed, score: passed ? 1 : 0.5, artifactDigest: sha256(JSON.stringify(candidate.files)),
    failures: passed ? [] : [{ kind: "behavior", code: "FAILED", file: "src/value.ts", line: 1, column: 1, evidenceDigest: "d".repeat(64), fingerprint: "e".repeat(64), severity: "medium", existedBeforeRepair: true }],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"], evidenceDigests: ["f".repeat(64)] };
}
const knownModel: CodingRepairModel = { propose: async (request) => ({
  proposal: { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
    failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
    changes: [{ path: "src/value.ts", expectedContentDigest: sha256(request.candidate.files[1].content), replacementText: "export const value: number = 0;\n" }], limitations: [] },
  inputTokens: 1, outputTokens: 1, accountedCostUsd: 0.001,
}) };

describe("bounded baseline fallback without hiding accounting failures", () => {
  it("retains only the existing baseline after a completed unsuccessful repair", async () => {
    let baseCalls = 0, savedRun = false;
    const events: unknown[] = [];
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(() => { baseCalls++; }), mode: "canary", verify: async c => check(c), model: knownModel,
      onRun: run => { assert.notEqual(run.state, "VERIFIED_CANDIDATE"); assert(run.accountedCostUsd > 0); savedRun = true; },
      onFallback: event => { assert(savedRun); events.push(event); },
    });
    assert.deepEqual(await wrapper.generate(context), baseline);
    assert.equal(baseCalls, 1);
    assert.deepEqual(events, [{ mode: "canary", reasonCode: "unverified_candidate" }]);
    assert.equal(wrapper.maximumCostUsd, 0.15);
  });
  it("can fall back when model construction fails before any proposal invocation", async () => {
    const events: unknown[] = [];
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary", verify: async c => check(c),
      model: () => { throw new Error("construction failed"); }, onFallback: event => { events.push(event); } });
    assert.deepEqual(await wrapper.generate(context), baseline);
    assert.deepEqual(events, [{ mode: "canary", reasonCode: "pre_dispatch_error" }]);
  });
  it("does not hide a model request whose usage is unknown", async () => {
    const original = new Error("provider disconnected after dispatch"); let fallbackCalls = 0;
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary", verify: async c => check(c),
      model: { propose: async () => { throw original; } }, onFallback: () => { fallbackCalls++; } });
    await assert.rejects(wrapper.generate(context), e => e === original); assert.equal(fallbackCalls, 0);
  });
  it("does not hide invalid cost accounting after a proposal invocation", async () => {
    let fallbackCalls = 0;
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary", verify: async c => check(c),
      model: { propose: async r => ({ ...await knownModel.propose(r), accountedCostUsd: Number.NaN }) }, onFallback: () => { fallbackCalls++; } });
    await assert.rejects(wrapper.generate(context), /accounted cost/); assert.equal(fallbackCalls, 0);
  });
  it("does not swallow durable receipt persistence failures", async () => {
    const original = new Error("receipt disk full");
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary", verify: async c => check(c), model: knownModel,
      onReceipt: () => { throw original; } });
    await assert.rejects(wrapper.generate(context), e => e === original);
  });
  it("does not swallow a stopped receipt before any model dispatch", async () => {
    const original = new Error("stopped receipt disk full"); let calls = 0;
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary",
      verify: async c => ({ ...check(c), failures: [{ ...check(c).failures[0]!, kind: "security", severity: "critical" }] }),
      model: { propose: async r => { calls++; return knownModel.propose(r); } },
      onReceipt: () => { throw original; } });
    await assert.rejects(wrapper.generate(context), e => e === original); assert.equal(calls, 0);
  });
  it("does not hide a verifier exception after a model request", async () => {
    const original = new Error("post-dispatch verifier unavailable"); let checks = 0;
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary",
      verify: async c => { checks++; if (checks > 1) throw original; return check(c); }, model: knownModel });
    await assert.rejects(wrapper.generate(context), e => e === original); assert.equal(checks, 2);
  });
  it("does not swallow final run persistence failures, even with no model call", async () => {
    const original = new Error("run disk full");
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary", verify: async c => check(c, true), model: knownModel,
      onRun: () => { throw original; } });
    await assert.rejects(wrapper.generate(context), e => e === original);
  });
  it("optional fallback telemetry cannot force another generation or prevent fallback", async () => {
    let baseCalls = 0;
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(() => { baseCalls++; }), mode: "canary", verify: async c => check(c), model: knownModel,
      onFallback: () => { throw new Error("telemetry unavailable"); } });
    assert.deepEqual(await wrapper.generate(context), baseline); assert.equal(baseCalls, 1);
  });
  it("retains off-mode identity without calling repair or telemetry", async () => {
    const unexpected = () => { throw new Error("unexpected repair"); };
    const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "off", verify: async () => unexpected(), model: () => unexpected(), onFallback: unexpected });
    assert.deepEqual(await wrapper.generate(context), baseline); assert.equal(wrapper.external, false); assert.equal(wrapper.maximumCostUsd, 0);
  });
  it("preserves errors from the original generator rather than retrying it", async () => {
    const original = new Error("baseline unavailable"); let baseCalls = 0;
    const wrapper = createReparodynamicCandidateGenerator({ base: { ...baseGenerator(), generate: async () => { baseCalls++; throw original; } }, mode: "canary", verify: async c => check(c), model: knownModel });
    await assert.rejects(wrapper.generate(context), e => e === original); assert.equal(baseCalls, 1);
  });
  it("the actual kernel still refuses an invalid fallback instead of promoting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sara-fallback-kernel-"));
    try {
      const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256("fallback-owner-test") });
      const owner = kernel.authenticateOwnerToken("fallback-owner-test");
      await kernel.recordLedgerEntry(owner, { kind: "revenue", source: "customer", amountUsd: 100, realized: true, recurringMonthly: false, description: "Scripted test funding", occurredAt: "2026-09-05T00:00:00.000Z" });
      const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Value is 42", expectedOwnerValue: 1, requiredCapabilities: [], acceptanceCriteria: ["Value is 42"], maximumBudgetUsd: 0.15 });
      let fallback = false;
      const wrapper = createReparodynamicCandidateGenerator({ base: baseGenerator(), mode: "canary", verify: async c => check(c), model: knownModel, onFallback: () => { fallback = true; } });
      await assert.rejects(kernel.runSelfBuildCycle(owner, job.id, wrapper));
      assert.equal(fallback, true);
      const status = await kernel.getStatus();
      assert.equal(status.jobs.find(j => j.id === job.id)?.status, "failed");
      assert.equal(status.mutations.length, 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
