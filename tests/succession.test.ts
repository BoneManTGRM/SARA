import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { authenticateOwnerPrincipal, SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { PolicyDeniedError } from "../src/policy.ts";
import {
  provisionalFamilyScenarioTarget,
  type FamilyEligibility,
  type SuccessionStatusEvidence,
} from "../src/succession.ts";
import type { OwnerApproval, Principal } from "../src/types.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "succession-test-owner-token";
process.env.SARA_OWNER_TOKEN_SHA256 = sha256(OWNER_TOKEN);
const owner: Principal = authenticateOwnerPrincipal(OWNER_TOKEN);

async function kernel(): Promise<SaraKernel> {
  const directory = await mkdtemp(join(tmpdir(), "sara-succession-"));
  cleanup.push(directory);
  return SaraKernel.boot({ stateDirectory: directory });
}

function evidence(kind: SuccessionStatusEvidence["kind"], label: string): SuccessionStatusEvidence {
  return { kind, referenceDigest: sha256(label) };
}

function approval(ownerDistributionUsd: number, eligibility: FamilyEligibility): OwnerApproval {
  const targetId = provisionalFamilyScenarioTarget(ownerDistributionUsd, eligibility);
  return {
    approvalId: `approval-${sha256(targetId)}`,
    action: "beneficiary_change",
    targetId,
    approvedAt: "2026-09-01T00:00:00.000Z",
    ownerId: owner.id,
  };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SARA protected family succession calculation", () => {
  it("pays the eligible spouse 100% only as an owner-attested, legally inactive scenario", async () => {
    const sara = await kernel();
    const eligibility: FamilyEligibility = {
      spouseStatus: "eligible",
      statusEvidence: evidence("baseline_registry", "spouse eligible registry record"),
      ownerEligible: true,
      childEligible: true,
    };
    const plan = await sara.calculateProvisionalFamilyDistribution(owner, 300, eligibility, approval(300, eligibility));
    assert.deepEqual(plan.allocations, [{ role: "spouse", amountUsd: 300 }]);
    assert.equal(plan.evidenceAttestation.status, "OWNER_ATTESTED_SCENARIO_ONLY");
    assert.equal(plan.evidenceAttestation.externalAuthorityVerified, false);
    assert.equal(plan.legalActivationStatus, "UNCONFIGURED_PENDING_LEGAL_INSTRUMENT");
  });

  it("splits 50/50 after an owner-attested death or incapacity scenario", async () => {
    const sara = await kernel();
    const eligibility: FamilyEligibility = {
      spouseStatus: "deceased_or_incapacitated",
      statusEvidence: evidence("authoritative_record", "spouse death or incapacity record"),
      ownerEligible: true,
      childEligible: true,
    };
    const plan = await sara.calculateProvisionalFamilyDistribution(owner, 300, eligibility, approval(300, eligibility));
    assert.deepEqual(plan.allocations, [
      { role: "owner", amountUsd: 150 },
      { role: "child", amountUsd: 150 },
    ]);
  });

  it("pays the sole owner-or-child survivor 100% after the spouse scenario", async () => {
    const sara = await kernel();
    const childOnly: FamilyEligibility = {
      spouseStatus: "deceased_or_incapacitated",
      statusEvidence: evidence("authoritative_record", "spouse unavailable child only"),
      ownerEligible: false,
      childEligible: true,
    };
    assert.deepEqual(
      (await sara.calculateProvisionalFamilyDistribution(owner, 300, childOnly, approval(300, childOnly))).allocations,
      [{ role: "child", amountUsd: 300 }],
    );
    const ownerOnly: FamilyEligibility = {
      spouseStatus: "deceased_or_incapacitated",
      statusEvidence: evidence("authoritative_record", "spouse unavailable owner only"),
      ownerEligible: true,
      childEligible: false,
    };
    assert.deepEqual(
      (await sara.calculateProvisionalFamilyDistribution(owner, 300, ownerOnly, approval(300, ownerOnly))).allocations,
      [{ role: "owner", amountUsd: 300 }],
    );
  });

  it("preserves the explicit owner-death cascade from spouse 100% to child 100%", async () => {
    const sara = await kernel();
    const ownerDeceased: FamilyEligibility = {
      spouseStatus: "eligible",
      statusEvidence: evidence("baseline_registry", "owner deceased spouse remains primary"),
      ownerEligible: false,
      childEligible: true,
    };
    assert.deepEqual(
      (await sara.calculateProvisionalFamilyDistribution(owner, 300, ownerDeceased, approval(300, ownerDeceased)))
        .allocations,
      [{ role: "spouse", amountUsd: 300 }],
    );

    const bothParentsDeceased: FamilyEligibility = {
      spouseStatus: "deceased_or_incapacitated",
      statusEvidence: evidence("authoritative_record", "both parents deceased child successor"),
      ownerEligible: false,
      childEligible: true,
    };
    assert.deepEqual(
      (
        await sara.calculateProvisionalFamilyDistribution(
          owner,
          300,
          bothParentsDeceased,
          approval(300, bothParentsDeceased),
        )
      ).allocations,
      [{ role: "child", amountUsd: 300 }],
    );
  });

  it("pays owner 100% after an attested separation or owner revocation scenario", async () => {
    const sara = await kernel();
    const separated: FamilyEligibility = {
      spouseStatus: "legally_separated",
      statusEvidence: evidence("authoritative_record", "legal separation record"),
      ownerEligible: true,
      childEligible: true,
    };
    assert.deepEqual(
      (await sara.calculateProvisionalFamilyDistribution(owner, 300, separated, approval(300, separated))).allocations,
      [{ role: "owner", amountUsd: 300 }],
    );
    const revoked: FamilyEligibility = {
      spouseStatus: "owner_revoked",
      statusEvidence: evidence("authenticated_owner_revocation", "owner revocation"),
      ownerEligible: true,
      childEligible: true,
    };
    assert.deepEqual(
      (await sara.calculateProvisionalFamilyDistribution(owner, 300, revoked, approval(300, revoked))).allocations,
      [{ role: "owner", amountUsd: 300 }],
    );
  });

  it("falls through to child, then holds, when earlier roles are unavailable", async () => {
    const sara = await kernel();
    const child: FamilyEligibility = {
      spouseStatus: "owner_revoked",
      statusEvidence: evidence("authenticated_owner_revocation", "owner revocation child fallback"),
      ownerEligible: false,
      childEligible: true,
    };
    assert.deepEqual(
      (await sara.calculateProvisionalFamilyDistribution(owner, 300, child, approval(300, child))).allocations,
      [{ role: "child", amountUsd: 300 }],
    );
    const nobody: FamilyEligibility = {
      spouseStatus: "deceased_or_incapacitated",
      statusEvidence: evidence("authoritative_record", "no configured survivor"),
      ownerEligible: false,
      childEligible: false,
    };
    const held = await sara.calculateProvisionalFamilyDistribution(owner, 300, nobody, approval(300, nobody));
    assert.deepEqual(held.allocations, []);
    assert.equal(held.heldForLegalDirectionUsd, 300);
  });

  it("rejects malformed statuses, mismatched evidence classes, and zero evidence digests", async () => {
    const sara = await kernel();
    await assert.rejects(
      () =>
        sara.calculateProvisionalFamilyDistribution(owner, 300, {
          spouseStatus: "owner_argument" as never,
          statusEvidence: evidence("authoritative_record", "argument is not a legal trigger"),
          ownerEligible: true,
          childEligible: true,
        }),
      /Unrecognized spouse status/,
    );
    await assert.rejects(
      () =>
        sara.calculateProvisionalFamilyDistribution(owner, 300, {
          spouseStatus: "owner_revoked",
          statusEvidence: evidence("authoritative_record", "not an owner revocation"),
          ownerEligible: true,
          childEligible: true,
        }),
      /authenticated_owner_revocation/,
    );
    await assert.rejects(
      () =>
        sara.calculateProvisionalFamilyDistribution(owner, 300, {
          spouseStatus: "owner_revoked",
          statusEvidence: { kind: "authenticated_owner_revocation", referenceDigest: "0".repeat(64) },
          ownerEligible: true,
          childEligible: true,
        }),
      /non-zero digest-bound/,
    );
  });

  it("requires the exact authenticated owner and approval bound to the entire scenario", async () => {
    const sara = await kernel();
    const eligibility: FamilyEligibility = {
      spouseStatus: "owner_revoked",
      statusEvidence: evidence("authenticated_owner_revocation", "bounded owner revocation"),
      ownerEligible: true,
      childEligible: true,
    };
    await assert.rejects(
      () => sara.calculateProvisionalFamilyDistribution(SARA_PRINCIPAL, 300, eligibility, approval(300, eligibility)),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
    );
    for (const impostor of [
      { id: "not-owner", kind: "owner", authenticated: true },
      { id: "OWNER", kind: "owner", authenticated: false },
      { id: "OWNER", kind: "owner", authenticated: true },
    ] as Principal[]) {
      await assert.rejects(
        () => sara.calculateProvisionalFamilyDistribution(impostor, 300, eligibility, approval(300, eligibility)),
        (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
      );
    }
    await assert.rejects(
      () => sara.calculateProvisionalFamilyDistribution(owner, 300, eligibility),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "APPROVAL_REQUIRED",
    );
    const wrongTarget = { ...approval(300, eligibility), targetId: "family-succession-scenario:wrong" };
    await assert.rejects(
      () => sara.calculateProvisionalFamilyDistribution(owner, 300, eligibility, wrongTarget),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "APPROVAL_REQUIRED",
    );
  });
});
