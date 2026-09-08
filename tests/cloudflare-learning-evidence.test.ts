import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordLearningCall, recordLearningOutcome, recordLearningProposal } from "../src/cloudflare-learning-evidence.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import type { SkillCandidateProposal } from "../src/types.ts";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const proposal = (): SkillCandidateProposal => ({ schemaVersion: 1, skillName: "Rejected reader",
  summary: "Diagnostic fixture, not a learned catalog skill.",
  source: "export function runSkill(input: unknown): unknown { const rows = input as {sku:string}[]; return rows[0].sku; }",
  tests: [{ name: "read", input: [{ sku: "A" }], expected: "A" }], limitations: ["Diagnostic only."] });

test("actual kernel source rejection retains exact proposal, tests and bound failure evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-learning-evidence-"));
  try {
    const directory = join(root, "evidence");
    const kernel = await SaraKernel.boot({ stateDirectory: join(root, "state") });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Read a catalog SKU.",
      expectedOwnerValue: 0, requiredCapabilities: ["catalog-read"], acceptanceCriteria: ["Return a SKU."], maximumBudgetUsd: 0 });
    const generated = proposal();
    let receipt: Awaited<ReturnType<typeof recordLearningProposal>> | undefined;
    let calls = 0;
    await assert.rejects(async () => {
      try {
        await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, {
          id: "captured-source-rejection", external: false, maximumCostUsd: 0,
          async generate(input) {
            calls += 1;
            await recordLearningCall(directory, 1, input.objective);
            receipt = await recordLearningProposal(directory, 1, generated);
            return generated;
          },
        });
      } catch (error) {
        await recordLearningOutcome(directory, 1, { status: "rejected", proposal: receipt, error });
        throw error;
      }
    }, /computed property access is prohibited/);
    assert.equal(calls, 1);
    const saved = JSON.parse(await readFile(join(directory, "attempt-1-proposal.json"), "utf8"));
    assert.deepEqual(saved.proposal, generated);
    assert.equal(saved.sourceSha256, digest(generated.source));
    assert.equal(saved.proposalSha256, digest(JSON.stringify(generated)));
    assert.equal(saved.sourceBytes, Buffer.byteLength(generated.source));
    const outcome = JSON.parse(await readFile(join(directory, "attempt-1-outcome.json"), "utf8"));
    assert.equal(outcome.proposal.sourceSha256, saved.sourceSha256);
    assert.match(outcome.evidence, /computed property access is prohibited/);
    assert.equal(outcome.productionAuthority, false);
    assert.equal((await kernel.getStatus()).mutations.length, 0);
    assert.equal((await stat(join(directory, "attempt-1-proposal.json"))).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("interrupted call retains a start record without inventing an accepted outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-learning-interrupted-"));
  try {
    await recordLearningCall(root, 1, "Learn a public audit.");
    assert.deepEqual(await readdir(root), ["attempt-1-call.json"]);
    const record = JSON.parse(await readFile(join(root, "attempt-1-call.json"), "utf8"));
    assert.equal(record.event, "generator_call_entered");
    assert.equal(record.usage, "unknown_until_provider_evidence");
    assert.equal(record.objectiveSha256, digest("Learn a public audit."));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("capture is bounded to two attempts and preserves earlier bytes on accidental reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-learning-bounds-"));
  try {
    await recordLearningProposal(root, 1, proposal());
    const path = join(root, "attempt-1-proposal.json");
    const before = await readFile(path, "utf8");
    await assert.rejects(() => recordLearningProposal(root, 1, { ...proposal(), source: "different" }), /EEXIST/);
    assert.equal(await readFile(path, "utf8"), before);
    await recordLearningProposal(root, 2, proposal());
    for (const attempt of [0, 3, 1.5]) await assert.rejects(() => recordLearningCall(root, attempt, "Learn."), /must be 1 or 2/);
    await assert.rejects(() => recordLearningProposal(root, 2, { ...proposal(), source: "x".repeat(65536) }), /exceeds 64 KiB/);
    assert.deepEqual((await readdir(root)).sort(), ["attempt-1-proposal.json", "attempt-2-proposal.json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("transport fields and arbitrary errors stay private while known failure metadata survives", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-learning-privacy-"));
  try {
    const receipt = await recordLearningProposal(root, 1, { ...proposal(), reasoning_content: "PRIVATE", apiToken: "PRIVATE" } as SkillCandidateProposal);
    await recordLearningOutcome(root, 1, { status: "rejected", proposal: { ...receipt, apiToken: "PRIVATE" }, error: new Error("PRIVATE") } as Parameters<typeof recordLearningOutcome>[2]);
    await recordLearningOutcome(root, 2, { status: "rejected", error: new Error("Cloudflare returned no candidate content. finish_reason=length; prompt_tokens=625; completion_tokens=8192.") });
    for (const file of await readdir(root)) assert.doesNotMatch(await readFile(join(root, file), "utf8"), /PRIVATE|reasoning_content|apiToken/);
    assert.match(await readFile(join(root, "attempt-2-outcome.json"), "utf8"), /finish_reason=length; prompt_tokens=625; completion_tokens=8192/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("HTTP timeout is preserved and a verified claim requires both artifact bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-learning-timeout-"));
  try {
    await recordLearningOutcome(root, 1, { status: "rejected", error: new Error("Cloudflare inference failed with HTTP 408.") });
    assert.match(await readFile(join(root, "attempt-1-outcome.json"), "utf8"), /HTTP 408/);
    await assert.rejects(() => recordLearningOutcome(root, 2, { status: "verified_shadow" }), /requires its proposal and candidate digests/);
    assert.deepEqual(await readdir(root), ["attempt-1-outcome.json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
