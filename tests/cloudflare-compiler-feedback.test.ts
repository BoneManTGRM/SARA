import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as ts from "typescript";
import { boundedCandidateFailureFeedback, createCloudflareFreeCandidateGenerator } from "../src/cloudflare-free-generator.ts";
import { recordLearningOutcome, recordLearningProposal } from "../src/cloudflare-learning-evidence.ts";
import { GenomeLabTypecheckError } from "../src/genome-lab.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";

test("real pure-skill compiler evidence reaches repair and its candidate-bound receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-compiler-feedback-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory: root });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Read the code field after checking the input.", expectedOwnerValue: 0,
      requiredCapabilities: ["pure-reader"], acceptanceCriteria: ["Return a code safely."], maximumBudgetUsd: 0,
    });
    const proposal = {
      schemaVersion: 1 as const, skillName: "Reader fixture", summary: "Missing narrowing, intentionally rejected.",
      source: "export function runSkill(input: unknown): unknown { return input.code; }",
      tests: [{ name: "code", input: { code: "A" }, expected: "A" }], limitations: ["Test fixture."],
    };
    let failure: unknown;
    try {
      await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, {
        id: "compiler-feedback-fixture", external: false, maximumCostUsd: 0, async generate() { return proposal; },
      });
    } catch (error) { failure = error; }
    const feedback = boundedCandidateFailureFeedback(failure);
    assert.match(feedback, /TS18046 at skill\.ts:1:\d+/);
    assert.match(feedback, /unknown/);
    assert.doesNotMatch(feedback, /behavior.*passed|\/tmp\/|input\.code/);
    const evidence = join(root, "evidence");
    const receipt = await recordLearningProposal(evidence, 1, proposal);
    await recordLearningOutcome(evidence, 1, { status: "rejected", proposal: receipt, error: failure });
    const saved = JSON.parse(await readFile(join(evidence, "attempt-1-outcome.json"), "utf8"));
    assert.deepEqual(saved.proposal, receipt);
    assert.equal(saved.evidence, feedback);
    let prompt = "";
    let calls = 0;
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: "a".repeat(32), apiToken: "test-placeholder-token-only", workersPlan: "free",
      repairProposal: proposal, repairFeedback: feedback,
      async fetcher(_url, init) {
        calls++;
        prompt = JSON.parse(String(init?.body)).messages[1].content;
        return Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
      },
    });
    await generator.generate({ objective: job.workCard.objective, acceptanceCriteria: job.workCard.acceptanceCriteria,
      missingCapabilities: [], constitutionDigest: "b".repeat(64), memoryContext: { contextDigest: "c".repeat(64), memories: [] } });
    assert.ok(prompt.includes(feedback));
    assert.equal(calls, 1);
    assert.equal((await kernel.getStatus()).mutations.length, 0);
    assert.equal((await kernel.getStatus()).jobs[0]?.status, "failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compiler feedback excludes raw messages, verifier locations and absolute paths, and caps locations", () => {
  const root = "/private/COMPILER_PATH_SENTINEL";
  const skill = ts.createSourceFile(join(root, "skill.ts"), "x;\n".repeat(20), ts.ScriptTarget.ES2022);
  const verifier = ts.createSourceFile(join(root, "verification.ts"), "PRIVATE_TEST_ANSWER", ts.ScriptTarget.ES2022);
  const diagnostics: ts.Diagnostic[] = Array.from({ length: 20 }, (_, index) => ({
    category: ts.DiagnosticCategory.Error, code: 18046, file: skill, start: index * 3, length: 1,
    messageText: "PRIVATE_DIAGNOSTIC_SENTINEL",
  }));
  diagnostics.push({ category: ts.DiagnosticCategory.Error, code: 2322, file: verifier, start: 0, length: 1, messageText: "PRIVATE_TEST_ANSWER" });
  const error = new GenomeLabTypecheckError(diagnostics, root, "skill");
  error.message = "PRIVATE_MUTATED_MESSAGE";
  const feedback = boundedCandidateFailureFeedback(error);
  assert.match(feedback, /21 error\(s\)/);
  assert.equal((feedback.match(/TS18046 at skill\.ts:/g) ?? []).length, 8);
  assert.doesNotMatch(feedback, /PRIVATE|COMPILER_PATH|verification\.ts|TS2322/);
  assert.ok(feedback.length < 8192);
  assert.equal(boundedCandidateFailureFeedback(new Error("TS18046 at skill.ts:1:1 PRIVATE")),
    "Candidate verification failed; no earlier gate is asserted to have passed.");
});

test("program compiler errors keep their existing classification and do not become pure-skill evidence", () => {
  const error = new GenomeLabTypecheckError([], "/private/program");
  assert.equal(error.message, "Generated program failed TypeScript verification with 0 error(s).");
  assert.equal(boundedCandidateFailureFeedback(error),
    "Candidate verification failed; no earlier gate is asserted to have passed.");
});
