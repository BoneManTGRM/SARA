import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { platformAutomationPolicy } from "../src/platform-policy.ts";

describe("commercial platform policy", () => {
  it("allows owner-site inbound research without implying outreach or applications", () => {
    assert.deepEqual(platformAutomationPolicy("owner_site"), {
      platform: "owner_site",
      research: "allowed",
      outreach: "approval_required",
      application: "denied",
      reason: "SARA may process inbound activity on the owner-controlled site; outbound contact remains separately bounded.",
    });
  });

  it("fails closed for Upwork and unknown platforms", () => {
    assert.equal(platformAutomationPolicy("upwork").application, "denied");
    assert.equal(platformAutomationPolicy("upwork").research, "denied");
    assert.equal(platformAutomationPolicy("unknown").outreach, "denied");
  });
});
