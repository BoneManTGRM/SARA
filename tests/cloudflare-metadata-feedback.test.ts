import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boundedCandidateFailureFeedback, createCloudflareFreeCandidateGenerator } from "../src/cloudflare-free-generator.ts";
import { recordLearningOutcome, recordLearningProposal } from "../src/cloudflare-learning-evidence.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";

test("oversized metadata reaches repair and durable evidence without accepting an ignored repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-metadata-feedback-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory: root });
    const proposal = {
      schemaVersion: 1 as const, skillName: "Lookup regression", summary: "Intentionally missing lookup narrowing.",
      source: 'export function runSkill(input: unknown): unknown { const rows = new Map<string, { title: string }>(); const item = rows.get("missing"); return item.title; }',
      tests: [{ name: "missing", input: null, expected: null }], limitations: ["x".repeat(438)],
    };
    const createJob = () => kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Read a lookup safely and return null if missing.", expectedOwnerValue: 0,
      requiredCapabilities: ["lookup"], acceptanceCriteria: ["Handle absent values safely."], maximumBudgetUsd: 0,
    });
    const first = await createJob();
    let failure: unknown;
    try {
      await kernel.runSelfBuildCycle(SARA_PRINCIPAL, first.id, {
        id: "metadata-negative-fixture", external: false, maximumCostUsd: 0, async generate() { return proposal; },
      });
    } catch (error) { failure = error; }
    const feedback = boundedCandidateFailureFeedback(failure);
    assert.equal(feedback, "Skill limitations must contain at most 16 non-empty entries of 300 characters or fewer.");
    assert.doesNotMatch(feedback, /item\.title|\/tmp\/|passed/);
    let requests = 0;
    let repairRequest: Record<string, unknown> | undefined;
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: "a".repeat(32), apiToken: "test-placeholder-token-only", workersPlan: "free",
      repairProposal: proposal, repairFeedback: feedback,
      async fetcher(_url, init) {
        requests++;
        repairRequest = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
      },
    });
    const second = await createJob();
    const receipt = await recordLearningProposal(join(root, "evidence"), 1, proposal);
    await assert.rejects(() => kernel.runSelfBuildCycle(SARA_PRINCIPAL, second.id, {
      ...generator, external: false,
    }), /Skill limitations/);
    await recordLearningOutcome(join(root, "evidence"), 1, { status: "rejected", proposal: receipt, error: failure });
    const saved = JSON.parse(await readFile(join(root, "evidence", "attempt-1-outcome.json"), "utf8"));
    assert.equal(saved.evidence, feedback);
    assert.deepEqual(saved.proposal, receipt);
    assert.ok(JSON.stringify(repairRequest).includes("300 characters or fewer"));
    assert.equal(repairRequest?.max_completion_tokens, 2048);
    assert.equal(requests, 1);
    const state = await kernel.getStatus();
    assert.equal(state.mutations.length, 0);
    assert.equal(state.jobs.find(job => job.id === second.id)?.status, "failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("metadata feedback only forwards exact fixed messages", () => {
  const safe = "Skill limitations must contain at most 16 non-empty entries of 300 characters or fewer.";
  for (const message of [safe + " private-value", "private-value " + safe, safe + "\nprivate-value"]) {
    assert.equal(boundedCandidateFailureFeedback(new Error(message)), "Candidate verification failed; no earlier gate is asserted to have passed.");
  }
});
