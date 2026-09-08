import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boundedCandidateFailureFeedback, createCloudflareFreeCandidateGenerator } from "../src/cloudflare-free-generator.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";

test("a real source-gate rejection reaches repair without inventing a passed source check", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-learning-feedback-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Read the first catalog SKU.", expectedOwnerValue: 0,
      requiredCapabilities: ["catalog-audit"], acceptanceCriteria: ["Return the first SKU."], maximumBudgetUsd: 0,
    });
    const rejected = {
      schemaVersion: 1 as const, skillName: "Catalog reader", summary: "A source-gate regression fixture.",
      source: "export function runSkill(input: unknown): unknown { const rows = input as {sku:string}[]; return rows[0].sku; }",
      tests: [{name: "first", input: [{sku:"A"}], expected:"A"}], limitations: ["Test fixture."],
    };
    let failure: unknown;
    try {
      await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, {
        id: "feedback-regression-fixture", external: false, maximumCostUsd: 0, async generate() { return rejected; },
      });
    } catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /computed property access is prohibited/);
    let prompt = "";
    const generator = createCloudflareFreeCandidateGenerator({
      accountId: "a".repeat(32), apiToken: "test-placeholder-token-only", workersPlan: "free",
      repairProposal: rejected, repairFeedback: boundedCandidateFailureFeedback(failure),
      async fetcher(_url, init) {
        prompt = (JSON.parse(String(init?.body)) as {messages: Array<{content: string}>}).messages[1]!.content;
        return Response.json({choices:[{message:{content:JSON.stringify(rejected)}}]});
      },
    });
    await generator.generate({objective:job.workCard.objective, acceptanceCriteria:job.workCard.acceptanceCriteria,
      missingCapabilities:["catalog-audit"],constitutionDigest:"b".repeat(64),memoryContext:{contextDigest:"c".repeat(64),memories:[]}});
    assert.match(prompt, /computed property access \(including array\[index\]\)/);
    assert.match(prompt, /Bounded independent verifier feedback: Generated skill is not a pure isolated candidate: computed property access is prohibited\./);
    assert.doesNotMatch(prompt, /previous proposal passed source/);
    const status = await kernel.getStatus();
    assert.equal(status.jobs[0]?.status, "failed");
    assert.equal(status.mutations.length, 0);
  } finally { await rm(stateDirectory, {recursive:true,force:true}); }
});

test("known compiler and behavioral evidence is preserved while arbitrary errors remain private", () => {
  const compiler = "Generated skill failed TypeScript verification with 2 error(s).";
  assert.equal(boundedCandidateFailureFeedback(new Error(compiler)), compiler);
  const mismatch = 'Behavioral verification mismatches: [{"name":"first","expected":"A","actual":"B"}]';
  assert.equal(boundedCandidateFailureFeedback(new Error(`Command failed\n${mismatch}\nprivate environment detail`)), mismatch);
  assert.equal(boundedCandidateFailureFeedback(new Error(mismatch + "x".repeat(9000))).length, 8192);
  for (const error of [new Error("Cloudflare token: secret-value"), "Generated skill is not a pure isolated candidate: secret-value.", null]) {
    const result = boundedCandidateFailureFeedback(error);
    assert.equal(result, "Candidate verification failed; no earlier gate is asserted to have passed.");
    assert.doesNotMatch(result, /secret-value/);
  }
});

test("real behavioral feedback selects the runtime error rather than Node's source excerpt", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-runtime-feedback-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Return the provided value.", expectedOwnerValue: 0,
      requiredCapabilities: ["identity"], acceptanceCriteria: ["Return input unchanged."], maximumBudgetUsd: 0,
    });
    await assert.rejects(() => kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, {
      id: "runtime-feedback-fixture", external: false, maximumCostUsd: 0,
      async generate() { return {
        schemaVersion: 1 as const, skillName: "Identity fixture", summary: "Deliberately inconsistent producer test.",
        source: "export function runSkill(input: unknown): unknown { return input; }",
        tests: [{ name: "inconsistent expectation", input: 4, expected: 7 }], limitations: ["Test fixture."],
      }; },
    }), (error: unknown) => {
      assert.equal(boundedCandidateFailureFeedback(error),
        'Behavioral verification mismatches: [{"name":"inconsistent expectation","expected":"7","actual":"4"}]');
      return true;
    });
    assert.equal((await kernel.getStatus()).mutations.length, 0);
  } finally { await rm(stateDirectory, {recursive:true,force:true}); }
});

test("a verifier source excerpt alone is not observed behavioral evidence", () => {
  const excerpt = 'if (failures.length) throw new Error(`Behavioral verification mismatches: ${JSON.stringify(failures)}`);';
  assert.equal(boundedCandidateFailureFeedback(new Error(excerpt)),
    "Candidate verification failed; no earlier gate is asserted to have passed.");
});

test("missing model content retains only allowlisted finish and bounded token metadata", async () => {
  for (const [payload, expected] of [
    [{choices:[{finish_reason:"length",message:{content:null,reasoning_content:"PRIVATE"}}],usage:{prompt_tokens:123,completion_tokens:8192}}, /finish_reason=length; prompt_tokens=123; completion_tokens=8192/],
    [{choices:[{finish_reason:"PRIVATE",message:{content:null}}],usage:{prompt_tokens:"PRIVATE",completion_tokens:Infinity}}, /finish_reason=unknown; prompt_tokens=unknown; completion_tokens=unknown/],
  ] as const) {
    const generator = createCloudflareFreeCandidateGenerator({accountId:"a".repeat(32),apiToken:"test-placeholder-token-only",workersPlan:"free",async fetcher(){return Response.json(payload);}});
    await assert.rejects(()=>generator.generate({objective:"Read a catalog.",acceptanceCriteria:[],missingCapabilities:[],constitutionDigest:"b".repeat(64),memoryContext:{contextDigest:"c".repeat(64),memories:[]}}),(error:Error)=>{
      assert.match(error.message,expected);assert.doesNotMatch(error.message,/PRIVATE/);return true;
    });
  }
});
