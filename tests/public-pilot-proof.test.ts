import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compilePublicPilotProof,
  type PublicPilotProofInput,
} from "../src/public-pilot-proof.ts";

const SHA = "a".repeat(40);
const DIGEST = "b".repeat(64);

function demonstration(overrides: Partial<PublicPilotProofInput> = {}): PublicPilotProofInput {
  return {
    proofKind: "demonstration",
    repository: "https://github.com/example/public-project",
    immutableCommitSha: SHA,
    reportDigest: DIGEST,
    reportStatus: "ready_for_owner_review",
    ownerReviewCompleted: true,
    deliveryConfirmed: false,
    categoriesReviewed: ["code", "dependencies", "secret_exposure", "release_controls"],
    findingCount: 3,
    deliveryMinutes: 72,
    evidenceUrls: [`https://github.com/example/public-project/blob/${SHA}/README.md#L1-L20`],
    pricePaidUsd: null,
    commercialTermsVerified: false,
    customer: null,
    ...overrides,
  };
}

function customerCase(overrides: Partial<PublicPilotProofInput> = {}): PublicPilotProofInput {
  return {
    ...demonstration(),
    proofKind: "customer_case_study",
    pricePaidUsd: 149,
    commercialTermsVerified: true,
    deliveryConfirmed: true,
    customer: {
      displayName: "Example Project",
      experienceConfirmed: true,
      caseStudyPublicationConsentConfirmed: true,
      permissionToNameConfirmed: true,
      consentEvidenceId: "consent:pilot-001",
      testimonial: {
        quote: "The evidence map made our next release-control decision easier.",
        publicationConsentConfirmed: true,
        materialConnection: "paid_service",
      },
    },
    ...overrides,
  };
}

describe("public founding-pilot proof compiler", () => {
  it("prepares a clearly labeled unpaid demonstration for owner review", () => {
    const card = compilePublicPilotProof(demonstration());

    assert.equal(card.status, "ready_for_owner_review");
    assert.equal(card.publicLabel, "UNPAID DEMONSTRATION");
    assert.equal(card.testimonial, null);
    assert.deepEqual(card.evidenceGaps, []);
    assert.equal(card.externalPublicationAuthorized, false);
    assert.match(card.facts.at(-1)!.value, /no customer/i);
  });

  it("prepares a consented customer case study without authorizing publication", () => {
    const card = compilePublicPilotProof(customerCase());

    assert.equal(card.status, "ready_for_owner_review");
    assert.equal(card.headline, "Customer case study: Example Project");
    assert.equal(card.testimonial?.attribution, "Example Project");
    assert.match(card.testimonial?.disclosure ?? "", /purchased/);
    assert.match(card.facts.at(-1)!.value, /149\.00/);
    assert.equal(card.externalPublicationAuthorized, false);
  });

  it("blocks unverified customer claims and withholds an unapproved name", () => {
    const input = customerCase({
      pricePaidUsd: null,
      commercialTermsVerified: false,
      customer: {
        displayName: "Private Customer",
        experienceConfirmed: false,
        caseStudyPublicationConsentConfirmed: false,
        permissionToNameConfirmed: false,
        consentEvidenceId: null,
        testimonial: null,
      },
    });
    const card = compilePublicPilotProof(input);

    assert.equal(card.status, "blocked");
    assert.equal(card.headline, "Customer case study: Anonymous repository owner");
    assert.doesNotMatch(JSON.stringify(card), /Private Customer/);
    assert.match(card.evidenceGaps.join(" "), /consent/);
    assert.match(card.evidenceGaps.join(" "), /Commercial terms/);
    assert.doesNotMatch(card.facts.map((fact) => fact.value).join(" "), /\$/);
  });

  it("blocks incomplete source reports and missing review categories", () => {
    const card = compilePublicPilotProof(demonstration({
      reportStatus: "needs_evidence",
      categoriesReviewed: ["code", "dependencies"],
      evidenceUrls: [],
    }));

    assert.equal(card.status, "blocked");
    assert.deepEqual(card.evidenceGaps, [
      "The underlying report still needs evidence.",
      "The secret_exposure category was not reviewed.",
      "The release_controls category was not reviewed.",
      "At least one immutable public evidence URL is required.",
    ]);
    assert.match(card.safestNextStep, /Do not publish/);
  });

  it("blocks proof before owner review and blocks customer proof before delivery", () => {
    const demonstrationCard = compilePublicPilotProof(demonstration({ ownerReviewCompleted: false }));
    assert.equal(demonstrationCard.status, "blocked");
    assert.match(demonstrationCard.evidenceGaps.join(" "), /Owner review/);

    const customerCard = compilePublicPilotProof(customerCase({ deliveryConfirmed: false }));
    assert.equal(customerCard.status, "blocked");
    assert.match(customerCard.evidenceGaps.join(" "), /delivery/);
  });

  it("blocks a testimonial disclosure that contradicts verified commercial terms", () => {
    const input = customerCase({ pricePaidUsd: 0 });
    const card = compilePublicPilotProof(input);

    assert.equal(card.status, "blocked");
    assert.match(card.evidenceGaps.join(" "), /material-connection disclosure/);
  });

  it("rejects moving, cross-repository, and malformed evidence claims", () => {
    for (const evidenceUrl of [
      "https://github.com/example/public-project/blob/main/README.md",
      `https://github.com/other/public-project/blob/${SHA}/README.md`,
      `https://github.com/example/public-project/blob/${SHA}/README.md?token=secret`,
    ]) {
      assert.throws(
        () => compilePublicPilotProof(demonstration({ evidenceUrls: [evidenceUrl] })),
        /same repository and immutable commit/,
      );
    }
    assert.throws(
      () => compilePublicPilotProof(demonstration({ reportDigest: "not-a-digest" })),
      /reportDigest/,
    );
  });

  it("rejects unsupported assurance language in testimonials", () => {
    const input = customerCase();
    input.customer!.testimonial!.quote = "This proves our repository has no vulnerabilities.";

    assert.throws(() => compilePublicPilotProof(input), /unsupported assurance/);
  });

  it("is deterministic and does not mutate its input", () => {
    const input = customerCase({
      evidenceUrls: [
        `https://github.com/example/public-project/blob/${SHA}/z.ts#L2`,
        `https://github.com/example/public-project/blob/${SHA}/a.ts#L1`,
        `https://github.com/example/public-project/blob/${SHA}/z.ts#L2`,
      ],
    });
    const before = structuredClone(input);

    assert.deepEqual(compilePublicPilotProof(input), compilePublicPilotProof(input));
    assert.deepEqual(input, before);
    assert.deepEqual(compilePublicPilotProof(input).evidenceUrls, [
      `https://github.com/example/public-project/blob/${SHA}/a.ts#L1`,
      `https://github.com/example/public-project/blob/${SHA}/z.ts#L2`,
    ]);
  });
});
