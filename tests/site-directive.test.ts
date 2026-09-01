import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import {
  runClaimedSiteDirective,
  SITE_EXECUTOR_KIND,
  type ClaimedSiteDirective,
  type DraftPullRequestPublisher,
} from "../src/site-directive.ts";

const cleanup: string[] = [];

async function tempState(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sara-site-directive-"));
  cleanup.push(directory);
  return directory;
}

function directive(overrides: Partial<ClaimedSiteDirective> = {}): ClaimedSiteDirective {
  const base: ClaimedSiteDirective = {
    id: "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
    objective: "Create a deterministic release-evidence normalizer that trims and lowercases string input and rejects non-string input.",
    status: "EXECUTOR_CLAIMED",
    maximumBudgetUsd: 0,
    publicRepoApproved: true,
    executorKind: SITE_EXECUTOR_KIND,
    workCard: {
      schemaVersion: 1,
      kind: "self_development",
      acceptanceCriteria: [
        "The skill returns trimmed lowercase text for string input.",
        "The skill returns null for non-string input.",
        "The candidate passes isolated behavioral verification and stops at SHADOW.",
        "Only a draft pull request may be opened; merge and deployment remain owner-gated.",
      ],
      maximumBudgetUsd: 0,
      publicRepoApproved: true,
      executorKind: SITE_EXECUTOR_KIND,
      prohibitedActions: ["spending", "production_promotion"],
    },
  };
  return { ...base, ...overrides };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("saraseed.app directive runner", () => {
  it("verifies a zero-cost candidate, publishes a draft PR, and durably stops at SHADOW", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    const publications: Parameters<DraftPullRequestPublisher["publish"]>[0][] = [];
    const publisher: DraftPullRequestPublisher = {
      async publish(candidate) {
        publications.push(candidate);
        const source = await readFile(join(candidate.artifactDirectory, "skill.ts"), "utf8");
        assert.match(source, /input\.trim\(\)\.toLowerCase\(\)/u);
        return {
          draftPrUrl: "https://github.com/BoneManTGRM/SARA/pull/2",
          commitSha: "c".repeat(40),
          sourceTreeDigest: createHash("sha256").update(source).digest("hex"),
          verification: [
            { command: "npm run verify", exitCode: 0, outputDigest: "d".repeat(64) },
          ],
        };
      },
    };

    const result = await runClaimedSiteDirective(kernel, stateDirectory, directive(), publisher);
    assert.equal(result.status, "SHADOW");
    assert.equal(result.maximumCostUsd, 0);
    assert.equal(result.draftPrUrl, "https://github.com/BoneManTGRM/SARA/pull/2");
    assert.equal(publications.length, 1);

    const restarted = await SaraKernel.boot({ stateDirectory });
    const status = await restarted.getStatus();
    assert.equal(status.jobs.length, 1);
    assert.equal(status.jobs[0].status, "verified");
    assert.equal(status.mutations.length, 1);
    assert.equal(status.mutations[0].stage, "SHADOW");
    assert.equal(status.ownerFundedRecurringMonthlyUsd, 0);
  });

  it("rejects unapproved publication and non-zero budgets before invoking a publisher", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    let published = false;
    const publisher: DraftPullRequestPublisher = {
      async publish() {
        published = true;
        throw new Error("must not be called");
      },
    };
    await assert.rejects(
      () => runClaimedSiteDirective(
        kernel,
        stateDirectory,
        directive({ publicRepoApproved: false as true }),
        publisher,
      ),
      /public-repository approval/,
    );
    await assert.rejects(
      () => runClaimedSiteDirective(
        kernel,
        stateDirectory,
        directive({ maximumBudgetUsd: 1 as 0 }),
        publisher,
      ),
      /zero-cost/,
    );
    assert.equal(published, false);
  });
});
