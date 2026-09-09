import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compilePublicPilotPreflight,
  type PublicPilotPreflightInput,
} from "../src/public-pilot-preflight.ts";

function eligible(overrides: Partial<PublicPilotPreflightInput> = {}): PublicPilotPreflightInput {
  return {
    repoUrl: "https://github.com/example/project",
    repositoryIsPublic: true,
    repositoryOwnerPermissionConfirmed: true,
    requiresPrivateAccess: false,
    containsRegulatedOrPrivateData: false,
    requestsProductionChanges: false,
    requestsExploitValidation: false,
    primaryGoal: "release_readiness",
    recentCommitDays: 12,
    ...overrides,
  };
}

describe("public $149 pilot preflight", () => {
  it("returns a complete eligible decision without granting payment or work authority", () => {
    const result = compilePublicPilotPreflight(eligible());

    assert.equal(result.status, "eligible");
    assert.equal(result.repository, "https://github.com/example/project");
    assert.equal(result.priceUsd, 149);
    assert.equal(result.fitScore, 100);
    assert.equal(result.mayCreatePaymentIntent, false);
    assert.equal(result.mayBeginWork, false);
    assert.equal(result.disqualifyingRisks.length, 0);
    assert.equal(result.evidenceGaps.length, 0);
    assert.match(result.safestNextStep, /separate payment intent/i);
  });

  it("rejects unsafe scope and preserves every reason", () => {
    const result = compilePublicPilotPreflight(eligible({
      requiresPrivateAccess: true,
      containsRegulatedOrPrivateData: true,
      requestsProductionChanges: true,
      requestsExploitValidation: true,
    }));

    assert.equal(result.status, "ineligible");
    assert.equal(result.disqualifyingRisks.length, 4);
    assert.match(result.safestNextStep, /do not create a payment intent/i);
  });

  it("requests missing repository authority instead of treating it as consent", () => {
    const result = compilePublicPilotPreflight(eligible({ repositoryOwnerPermissionConfirmed: false }));

    assert.equal(result.status, "needs_information");
    assert.deepEqual(result.evidenceGaps, ["Repository-owner permission is not confirmed"]);
    assert.equal(result.mayCreatePaymentIntent, false);
  });

  it("is deterministic and does not mutate the request", () => {
    const input = eligible();
    const before = structuredClone(input);
    assert.deepEqual(compilePublicPilotPreflight(input), compilePublicPilotPreflight(input));
    assert.deepEqual(input, before);
  });
});
