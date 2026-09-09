import {
  compileFoundingPilot,
  type FoundingPilotCard,
  type PilotGoal,
} from "./founding-pilot.ts";

export type PublicPilotPreflightInput = {
  repoUrl: string;
  repositoryIsPublic: boolean;
  repositoryOwnerPermissionConfirmed: boolean;
  requiresPrivateAccess: boolean;
  containsRegulatedOrPrivateData: boolean;
  requestsProductionChanges: boolean;
  requestsExploitValidation: boolean;
  primaryGoal: PilotGoal;
  recentCommitDays: number;
};

export type PublicPilotPreflight = Omit<FoundingPilotCard, "decision"> & {
  status: "eligible" | "needs_information" | "ineligible";
  repositoryVerifiedPublic: boolean;
  mayCreatePaymentIntent: false;
  mayBeginWork: false;
};

/**
 * Compiles already-observed public repository facts into a buyer-readable
 * eligibility result. This function creates no job, reservation, payment, or
 * authority. The HTTP boundary separately performs the public GitHub read.
 */
export function compilePublicPilotPreflight(input: PublicPilotPreflightInput): PublicPilotPreflight {
  const card = compileFoundingPilot({
    ...input,
    budgetUsd: 149,
    desiredTurnaroundDays: 3,
  });
  const { decision, ...result } = card;
  const status = decision === "qualified"
    ? "eligible"
    : decision === "reject"
      ? "ineligible"
      : "needs_information";
  const safestNextStep = status === "eligible"
    ? "Review and accept the exact current terms, then create a separate payment intent. This preflight created no reservation, payment, job, or delivery authority."
    : status === "ineligible"
      ? "Do not create a payment intent for this scope; use no credentials, private data, exploitation, or production access."
      : "Resolve the listed information gaps before creating a payment intent.";

  return {
    ...result,
    status,
    repositoryVerifiedPublic: input.repositoryIsPublic && result.repository !== null,
    mayCreatePaymentIntent: false,
    mayBeginWork: false,
    safestNextStep,
  };
}
