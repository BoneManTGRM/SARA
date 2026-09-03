export type CommercialPlatform = "owner_site" | "github_public_api" | "upwork" | "unknown";

export type PlatformAutomationDecision = {
  platform: CommercialPlatform;
  research: "allowed" | "approval_required" | "denied";
  outreach: "allowed" | "approval_required" | "denied";
  application: "allowed" | "approval_required" | "denied";
  reason: string;
};

/**
 * Conservative defaults. A platform-specific permission may be strengthened
 * only by an immutable, owner-reviewed policy/API evidence record in a future
 * release; a standing mandate alone never changes these defaults.
 */
export function platformAutomationPolicy(platform: CommercialPlatform): PlatformAutomationDecision {
  if (platform === "owner_site") {
    return {
      platform,
      research: "allowed",
      outreach: "approval_required",
      application: "denied",
      reason: "SARA may process inbound activity on the owner-controlled site; outbound contact remains separately bounded.",
    };
  }
  if (platform === "github_public_api") {
    return {
      platform,
      research: "allowed",
      outreach: "approval_required",
      application: "denied",
      reason: "Public API evidence may be researched within rate limits; unsolicited contact and applications are not implied.",
    };
  }
  if (platform === "upwork") {
    return {
      platform,
      research: "denied",
      outreach: "denied",
      application: "denied",
      reason: "Unapproved automation is disabled unless an approved API and current platform-policy evidence are explicitly registered.",
    };
  }
  return {
    platform,
    research: "approval_required",
    outreach: "denied",
    application: "denied",
    reason: "Unknown platform rules fail closed.",
  };
}
