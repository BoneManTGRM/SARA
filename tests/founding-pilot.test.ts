import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileFoundingPilot, type FoundingPilotInput } from "../src/founding-pilot.ts";

function eligible(overrides: Partial<FoundingPilotInput> = {}): FoundingPilotInput {
  return {
    repoUrl: "https://github.com/example/public-project",
    repositoryIsPublic: true,
    repositoryOwnerPermissionConfirmed: true,
    requiresPrivateAccess: false,
    containsRegulatedOrPrivateData: false,
    requestsProductionChanges: false,
    requestsExploitValidation: false,
    primaryGoal: "release_readiness",
    budgetUsd: 149,
    desiredTurnaroundDays: 3,
    recentCommitDays: 14,
    ...overrides,
  };
}

describe("$149 founding pilot compiler", () => {
  it("qualifies a bounded public-repository readiness snapshot", () => {
    const card = compileFoundingPilot(eligible({ repoUrl: "https://github.com/example/public-project.git" }));

    assert.equal(card.decision, "qualified");
    assert.equal(card.fitScore, 100);
    assert.equal(card.repository, "https://github.com/example/public-project");
    assert.equal(card.priceUsd, 149);
    assert.equal(card.estimatedDeliveryHours, 3);
    assert.deepEqual(card.disqualifyingRisks, []);
    assert.deepEqual(card.evidenceGaps, []);
    assert.match(card.safestNextStep, /Owner may review/);
  });

  it("routes missing permission and budget to owner review without pretending a sale exists", () => {
    const card = compileFoundingPilot(
      eligible({ repositoryOwnerPermissionConfirmed: false, budgetUsd: 100, recentCommitDays: null }),
    );

    assert.equal(card.decision, "owner_review");
    assert.equal(card.fitScore, 50);
    assert.deepEqual(card.evidenceGaps, [
      "Repository-owner permission is not confirmed",
      "Repository activity recency is unknown",
      "Available budget is below the fixed $149 pilot price",
    ]);
    assert.match(card.safestNextStep, /Resolve/);
  });

  it("rejects private-data, production-change, and exploitation scope", () => {
    const card = compileFoundingPilot(
      eligible({
        requiresPrivateAccess: true,
        containsRegulatedOrPrivateData: true,
        requestsProductionChanges: true,
        requestsExploitValidation: true,
      }),
    );

    assert.equal(card.decision, "reject");
    assert.equal(card.fitScore, 0);
    assert.equal(card.disqualifyingRisks.length, 4);
    assert.match(card.safestNextStep, /Decline/);
  });

  it("rejects disguised or non-canonical repository URLs", () => {
    for (const repoUrl of [
      "http://github.com/example/project",
      "https://github.com@example.invalid/example/project",
      "https://github.com/example/project/issues/1",
      "https://gitlab.com/example/project",
      "https://github.com/example/project?token=secret",
    ]) {
      const card = compileFoundingPilot(eligible({ repoUrl }));
      assert.equal(card.repository, null);
      assert.equal(card.decision, "owner_review");
      assert.match(card.evidenceGaps.join(" "), /canonical public GitHub/);
    }
  });

  it("fails closed on invalid numeric claims", () => {
    assert.throws(() => compileFoundingPilot(eligible({ budgetUsd: Number.NaN })), /budgetUsd/);
    assert.throws(() => compileFoundingPilot(eligible({ recentCommitDays: -1 })), /recentCommitDays/);
  });

  it("is deterministic and does not mutate its input", () => {
    const input = eligible();
    const before = structuredClone(input);
    const first = compileFoundingPilot(input);
    const second = compileFoundingPilot(input);

    assert.deepEqual(first, second);
    assert.deepEqual(input, before);
  });
});
