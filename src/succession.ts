import { canonicalJson, sha256 } from "./canonical.ts";
import { assertMoney } from "./economics.ts";

export type ProtectedBeneficiaryRole = "owner" | "spouse" | "child";
export type SpouseStatus = "eligible" | "deceased_or_incapacitated" | "legally_separated" | "owner_revoked";
export type SuccessionStatusEvidence = {
  kind: "baseline_registry" | "authoritative_record" | "authenticated_owner_revocation";
  referenceDigest: string;
};

export type FamilyEligibility = {
  spouseStatus: SpouseStatus;
  statusEvidence: SuccessionStatusEvidence;
  ownerEligible: boolean;
  childEligible: boolean;
};

export type ProvisionalFamilyDistribution = {
  model: "SPOUSE_PRIMARY_REASON_AWARE_FALLBACK";
  legalActivationStatus: "UNCONFIGURED_PENDING_LEGAL_INSTRUMENT";
  evidenceAttestation: {
    status: "OWNER_ATTESTED_SCENARIO_ONLY";
    externalAuthorityVerified: false;
    ownerId: string;
    targetId: string;
    referenceDigest: string;
  };
  allocations: Array<{ role: ProtectedBeneficiaryRole; amountUsd: number }>;
  heldForLegalDirectionUsd: number;
};

export function provisionalFamilyScenarioTarget(
  ownerDistributionUsd: number,
  eligibility: FamilyEligibility,
): string {
  assertMoney(ownerDistributionUsd, "Owner distribution");
  const scenarioDigest = sha256(
    canonicalJson({
      ownerDistributionUsd,
      spouseStatus: eligibility.spouseStatus,
      statusEvidence: {
        kind: eligibility.statusEvidence?.kind,
        referenceDigest: eligibility.statusEvidence?.referenceDigest?.toLowerCase(),
      },
      ownerEligible: eligibility.ownerEligible,
      childEligible: eligibility.childEligible,
    }),
  );
  return `family-succession-scenario:${scenarioDigest}`;
}
