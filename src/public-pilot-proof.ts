export type PublicPilotProofKind = "demonstration" | "customer_case_study";
export type PublicPilotProofCategory = "code" | "dependencies" | "secret_exposure" | "release_controls";
export type PublicPilotProofReportStatus = "ready_for_owner_review" | "needs_evidence";
export type PublicPilotProofMaterialConnection = "paid_service" | "discounted_service" | "free_service";

export type PublicPilotProofCustomer = {
  displayName: string | null;
  experienceConfirmed: boolean;
  caseStudyPublicationConsentConfirmed: boolean;
  permissionToNameConfirmed: boolean;
  consentEvidenceId: string | null;
  testimonial: {
    quote: string;
    publicationConsentConfirmed: boolean;
    materialConnection: PublicPilotProofMaterialConnection;
  } | null;
};

export type PublicPilotProofInput = {
  proofKind: PublicPilotProofKind;
  repository: string;
  immutableCommitSha: string;
  reportDigest: string;
  reportStatus: PublicPilotProofReportStatus;
  ownerReviewCompleted: boolean;
  deliveryConfirmed: boolean;
  categoriesReviewed: readonly PublicPilotProofCategory[];
  findingCount: number;
  deliveryMinutes: number;
  evidenceUrls: readonly string[];
  pricePaidUsd: number | null;
  commercialTermsVerified: boolean;
  customer: PublicPilotProofCustomer | null;
};

export type PublicPilotProofCard = {
  schemaVersion: 1;
  offer: "$149 Public Repository Readiness Snapshot";
  status: "ready_for_owner_review" | "blocked";
  proofKind: PublicPilotProofKind;
  publicLabel: "UNPAID DEMONSTRATION" | "CUSTOMER CASE STUDY";
  headline: string;
  repository: string;
  immutableCommitSha: string;
  reportDigest: string;
  facts: Array<{ label: string; value: string }>;
  testimonial: { quote: string; attribution: string; disclosure: string } | null;
  evidenceUrls: string[];
  evidenceGaps: string[];
  limitations: string[];
  externalPublicationAuthorized: false;
  safestNextStep: string;
};

const CATEGORIES: readonly PublicPilotProofCategory[] = [
  "code",
  "dependencies",
  "secret_exposure",
  "release_controls",
];
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const CONSENT_EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()-]{0,79}$/u;
const OVERCLAIM = /\b(?:no vulnerabilities|vulnerability[- ]free|no secrets|fully secure|certified|compliant|penetration tested|guaranteed safe)\b/iu;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireCount(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be a non-negative safe integer no greater than ${maximum}.`);
  }
  return value;
}

function cleanQuote(value: string): string {
  if (typeof value !== "string") throw new TypeError("testimonial quote must be a string.");
  const cleaned = value.trim().replace(/\s+/gu, " ");
  if (!cleaned || cleaned.length > 280) throw new Error("testimonial quote must contain 1 to 280 characters.");
  if (OVERCLAIM.test(cleaned)) throw new Error("testimonial quote contains an unsupported assurance claim.");
  return cleaned;
}

function canonicalRepository(value: string): { canonical: string; owner: string; repo: string } {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      parts.length !== 2 ||
      !/^[A-Za-z0-9_.-]+$/u.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]+$/u.test(parts[1])
    ) {
      throw new Error("Repository must be one canonical public GitHub repository URL.");
    }
    return {
      canonical: `https://github.com/${parts[0]}/${parts[1]}`,
      owner: parts[0].toLowerCase(),
      repo: parts[1].toLowerCase(),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("canonical public GitHub")) throw error;
    throw new Error("Repository must be one canonical public GitHub repository URL.");
  }
}

function immutableEvidenceUrl(
  value: string,
  repository: { owner: string; repo: string },
  immutableCommitSha: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Evidence URL must be an immutable GitHub permalink.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const lineAnchor = !url.hash || /^#L[1-9]\d*(?:-L[1-9]\d*)?$/u.test(url.hash);
  const valid =
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "github.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    lineAnchor &&
    parts.length >= 5 &&
    parts[0].toLowerCase() === repository.owner &&
    parts[1].toLowerCase() === repository.repo &&
    (parts[2] === "blob" || parts[2] === "tree") &&
    parts[3].toLowerCase() === immutableCommitSha &&
    parts.slice(4).every((part) => part !== "." && part !== "..");
  if (!valid) throw new Error("Evidence must use the same repository and immutable commit.");
  return url.toString();
}

function testimonialDisclosure(connection: PublicPilotProofMaterialConnection): string {
  if (connection === "paid_service") return "The quoted customer purchased this service.";
  if (connection === "discounted_service") return "The quoted customer received a discounted service.";
  return "The quoted customer received this service at no charge.";
}

export function compilePublicPilotProof(input: PublicPilotProofInput): PublicPilotProofCard {
  if (!input || typeof input !== "object") throw new TypeError("Public proof input is required.");
  if (input.proofKind !== "demonstration" && input.proofKind !== "customer_case_study") {
    throw new Error("proofKind is invalid.");
  }
  if (input.reportStatus !== "ready_for_owner_review" && input.reportStatus !== "needs_evidence") {
    throw new Error("reportStatus is invalid.");
  }
  if (typeof input.ownerReviewCompleted !== "boolean" || typeof input.deliveryConfirmed !== "boolean" ||
      typeof input.commercialTermsVerified !== "boolean") {
    throw new TypeError("Review, delivery, and commercial verification flags must be boolean.");
  }
  const repository = canonicalRepository(input.repository);
  const immutableCommitSha = input.immutableCommitSha.toLowerCase();
  const reportDigest = input.reportDigest.toLowerCase();
  if (!COMMIT_SHA.test(immutableCommitSha)) throw new Error("immutableCommitSha must be a 40-character SHA.");
  if (!DIGEST.test(reportDigest)) throw new Error("reportDigest must be a 64-character SHA-256 digest.");
  if (!Array.isArray(input.categoriesReviewed as unknown)) throw new TypeError("categoriesReviewed must be an array.");
  if (!Array.isArray(input.evidenceUrls as unknown)) throw new TypeError("evidenceUrls must be an array.");

  const seenCategories = new Set<PublicPilotProofCategory>();
  for (const category of input.categoriesReviewed) {
    if (!CATEGORIES.includes(category)) throw new Error("categoriesReviewed contains an unsupported category.");
    if (seenCategories.has(category)) throw new Error(`Duplicate reviewed category: ${category}.`);
    seenCategories.add(category);
  }
  const categoriesReviewed = CATEGORIES.filter((category) => seenCategories.has(category));
  const findingCount = requireCount(input.findingCount, "findingCount", 20);
  const deliveryMinutes = requireCount(input.deliveryMinutes, "deliveryMinutes", 24 * 60);
  const evidenceUrls = [...new Set(input.evidenceUrls.map((value) =>
    immutableEvidenceUrl(value, repository, immutableCommitSha)
  ))].sort(compareText);

  if (input.pricePaidUsd !== null && (!Number.isFinite(input.pricePaidUsd) || input.pricePaidUsd < 0)) {
    throw new Error("pricePaidUsd must be null or finite and non-negative.");
  }
  if (input.proofKind === "demonstration" &&
      (input.customer !== null || input.pricePaidUsd !== null || input.commercialTermsVerified || input.deliveryConfirmed)) {
    throw new Error("A demonstration cannot contain customer or payment claims.");
  }
  if (input.proofKind === "customer_case_study" && input.customer === null) {
    throw new Error("A customer case study requires a customer evidence record.");
  }

  const evidenceGaps: string[] = [];
  if (input.reportStatus !== "ready_for_owner_review") {
    evidenceGaps.push("The underlying report still needs evidence.");
  }
  if (!input.ownerReviewCompleted) evidenceGaps.push("Owner review of the underlying report is not complete.");
  for (const category of CATEGORIES) {
    if (!seenCategories.has(category)) evidenceGaps.push(`The ${category} category was not reviewed.`);
  }
  if (evidenceUrls.length === 0) evidenceGaps.push("At least one immutable public evidence URL is required.");

  let headline = "Unpaid demonstration: Public Repository Readiness Snapshot";
  let testimonial: PublicPilotProofCard["testimonial"] = null;
  if (input.proofKind === "customer_case_study") {
    const customer = input.customer!;
    if (
      typeof customer.experienceConfirmed !== "boolean" ||
      typeof customer.caseStudyPublicationConsentConfirmed !== "boolean" ||
      typeof customer.permissionToNameConfirmed !== "boolean"
    ) {
      throw new TypeError("Customer verification and consent flags must be boolean.");
    }
    if (customer.displayName !== null && !DISPLAY_NAME.test(customer.displayName)) {
      throw new Error("customer displayName is invalid.");
    }
    if (!customer.experienceConfirmed) evidenceGaps.push("Customer experience has not been confirmed.");
    if (!customer.caseStudyPublicationConsentConfirmed) {
      evidenceGaps.push("Customer consent to prepare a public case study is not confirmed.");
    }
    if (!customer.consentEvidenceId || !CONSENT_EVIDENCE_ID.test(customer.consentEvidenceId)) {
      evidenceGaps.push("A valid consent evidence identifier is required.");
    }
    if (customer.displayName !== null && !customer.permissionToNameConfirmed) {
      evidenceGaps.push("Permission to publish the customer name is not confirmed.");
    }
    if (input.pricePaidUsd === null || !input.commercialTermsVerified) {
      evidenceGaps.push("Commercial terms are not verified, so no price claim may be published.");
    }
    if (!input.deliveryConfirmed) evidenceGaps.push("Customer delivery is not confirmed.");
    const attribution = customer.displayName !== null && customer.permissionToNameConfirmed
      ? customer.displayName
      : "Anonymous repository owner";
    headline = `Customer case study: ${attribution}`;
    if (customer.testimonial) {
      if (typeof customer.testimonial.publicationConsentConfirmed !== "boolean") {
        throw new TypeError("Testimonial publication consent flag must be boolean.");
      }
      if (!["paid_service", "discounted_service", "free_service"].includes(customer.testimonial.materialConnection)) {
        throw new Error("testimonial materialConnection is invalid.");
      }
      const quote = cleanQuote(customer.testimonial.quote);
      if (!customer.testimonial.publicationConsentConfirmed) {
        evidenceGaps.push("Testimonial publication consent is not confirmed.");
      }
      testimonial = {
        quote,
        attribution,
        disclosure: testimonialDisclosure(customer.testimonial.materialConnection),
      };
      if (input.pricePaidUsd !== null && input.commercialTermsVerified) {
        const expectedConnection = input.pricePaidUsd === 0
          ? "free_service"
          : input.pricePaidUsd < 149
            ? "discounted_service"
            : "paid_service";
        if (customer.testimonial.materialConnection !== expectedConnection) {
          evidenceGaps.push("Testimonial material-connection disclosure does not match the verified price.");
        }
      }
    }
  }

  const facts = [
    { label: "Review scope", value: `${categoriesReviewed.length} of ${CATEGORIES.length} readiness categories reviewed` },
    { label: "Reported findings", value: String(findingCount) },
    { label: "Measured delivery time", value: `${deliveryMinutes} minutes` },
    { label: "Source revision", value: immutableCommitSha },
  ];
  if (input.proofKind === "demonstration") {
    facts.push({ label: "Commercial status", value: "Unpaid demonstration; no customer was involved" });
  } else if (input.pricePaidUsd !== null && input.commercialTermsVerified) {
    facts.push({ label: "Verified customer price", value: `$${input.pricePaidUsd.toFixed(2)} USD` });
  }

  const status = evidenceGaps.length === 0 ? "ready_for_owner_review" : "blocked";
  return {
    schemaVersion: 1,
    offer: "$149 Public Repository Readiness Snapshot",
    status,
    proofKind: input.proofKind,
    publicLabel: input.proofKind === "demonstration" ? "UNPAID DEMONSTRATION" : "CUSTOMER CASE STUDY",
    headline,
    repository: repository.canonical,
    immutableCommitSha,
    reportDigest,
    facts,
    testimonial,
    evidenceUrls,
    evidenceGaps,
    limitations: [
      "This proof summarizes one bounded review of one named public revision.",
      "It is not penetration testing, remediation, certification, legal advice, or a security warranty.",
      "Reported findings and delivery time do not guarantee the same result for another repository.",
    ],
    externalPublicationAuthorized: false,
    safestNextStep: status === "blocked"
      ? "Resolve every evidence gap and recompile before owner review. Do not publish this draft."
      : "The owner must compare every public claim with its evidence and explicitly approve publication; this compiler publishes nothing.",
  };
}
