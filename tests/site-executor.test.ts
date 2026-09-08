import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PublicationCommandFailure } from "../src/github-draft-publisher.ts";
import { SaraKernel } from "../src/kernel.ts";
import { executeOneSiteDirective } from "../src/site-executor.ts";
import type { ClaimedSiteDirective } from "../src/site-directive.ts";

const directive: ClaimedSiteDirective = {
  id: "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
  objective: "Create a deterministic release-evidence normalizer that trims and lowercases string input and rejects non-string input.",
  status: "EXECUTOR_CLAIMED",
  maximumBudgetUsd: 0,
  publicRepoApproved: true,
  executorKind: "deterministic_release_evidence_normalizer_v1",
  workCard: {
    schemaVersion: 1,
    kind: "self_development",
    acceptanceCriteria: ["The candidate compiles and passes behavioral tests."],
    maximumBudgetUsd: 0,
    publicRepoApproved: true,
    executorKind: "deterministic_release_evidence_normalizer_v1",
    prohibitedActions: ["No merge or deployment."],
  },
};

describe("site executor orchestration", () => {
  it("records a bounded failure with a digest and rethrows when publication fails", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-site-executor-"));
    const kernel = await SaraKernel.boot({ stateDirectory });
    const recorded: unknown[] = [];
    await assert.rejects(
      () => executeOneSiteDirective({
        kernel,
        stateDirectory,
        claim: async () => ({ directive, claim: { id: "78e6fccc-d230-48cd-9049-8d41d83bc799", expiresAt: "2099-01-01T00:00:00.000Z" } }),
        record: async (_directiveId, _claimId, result) => { recorded.push(result); },
        publisher: { async publish() { throw new Error("sensitive internal failure detail"); } },
      }),
      /Self-build directive failed after recording bounded evidence/,
    );
    assert.equal(recorded.length, 1);
    const result = recorded[0] as Record<string, unknown>;
    assert.equal(result.status, "FAILED");
    assert.equal(result.failureCode, "DRAFT_PUBLICATION_FAILED");
    assert.equal(result.maximumCostUsd, 0);
    assert.match(String(result.failureDigest), /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /sensitive internal failure detail/);
  });

  it("does nothing when no authorized directive is available", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-site-executor-"));
    const kernel = await SaraKernel.boot({ stateDirectory });
    let recorded = false;
    const outcome = await executeOneSiteDirective({
      kernel,
      stateDirectory,
      claim: async () => null,
      record: async () => { recorded = true; },
      publisher: { async publish() { throw new Error("must not run"); } },
    });
    assert.equal(outcome, "NO_DIRECTIVE");
    assert.equal(recorded, false);
  });
});

it("prepares the native verifier before claiming a directive", async () => {
  const workflow = await readFile(new URL("../.github/workflows/self-build.yml", import.meta.url), "utf8");
  assert.ok(workflow.indexOf("node scripts/build-native-checker.mjs") > workflow.indexOf("npm ci"));
  assert.ok(workflow.indexOf("node scripts/build-native-checker.mjs") < workflow.indexOf("npm run executor:site"));
});

it("records repository verification evidence without publishing raw output", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-site-evidence-"));
  const kernel = await SaraKernel.boot({ stateDirectory });
  const recorded: any[] = [];
  await assert.rejects(() => executeOneSiteDirective({kernel, stateDirectory,
    executionUrl: "https://github.com/BoneManTGRM/SARA/actions/runs/123",
    claim: async () => ({directive, claim:{id:"78e6fccc-d230-48cd-9049-8d41d83bc799",expiresAt:"2099-01-01T00:00:00Z"}}),
    record: async (_d,_c,r) => { recorded.push(r); },
    publisher: {async publish() { throw new PublicationCommandFailure({exitCode:1,stdout:"private-output",stderr:"private-error"}, "Repository verification"); }},
  }), /REPOSITORY_VERIFICATION_FAILED/);
  assert.equal(recorded[0].failureCode, "REPOSITORY_VERIFICATION_FAILED");
  assert.match(recorded[0].outputDigest, /^[a-f0-9]{64}$/);
  assert.equal(recorded[0].executionUrl,"https://github.com/BoneManTGRM/SARA/actions/runs/123");
  assert.doesNotMatch(JSON.stringify(recorded), /private-output|private-error/);
});

it("does not overwrite an uncertain successful recording with failure", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-site-recording-"));
  const kernel = await SaraKernel.boot({stateDirectory});
  let writes = 0;
  await assert.rejects(() => executeOneSiteDirective({kernel,stateDirectory,
    claim: async () => ({directive,claim:{id:"78e6fccc-d230-48cd-9049-8d41d83bc799",expiresAt:"2099-01-01T00:00:00Z"}}),
    record: async () => { writes++; throw Error("response lost"); },
    publisher: {async publish() { return {draftPrUrl:"https://github.com/BoneManTGRM/SARA/pull/123",commitSha:"a".repeat(40),sourceTreeDigest:"b".repeat(64),verification:[{command:"npm run verify",exitCode:0,outputDigest:"c".repeat(64)}]}; }},
  }), /recording is uncertain/);
  assert.equal(writes,1);
});
