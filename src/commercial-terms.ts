import { canonicalJson, sha256 } from "./canonical.ts";

export const COMMERCIAL_TERMS_VERSION = "public-repository-readiness-2026-09-03-v2" as const;
export const PREVIOUS_COMMERCIAL_TERMS_VERSION = "public-repository-readiness-2026-09-03-v1" as const;

export type CommercialTerms = {
  schemaVersion: 1;
  version: typeof COMMERCIAL_TERMS_VERSION;
  digest: string;
  businessName: string;
  contactEmail: string;
  governingLaw: string;
  service: "Public Repository Readiness Snapshot";
  price: "149 USDC on Base";
  turnaround: "Three business days after verified payment";
  clauses: string[];
};

function bounded(value: string, minimum: number, maximum: number, label: string): string {
  const result = value.trim();
  if (result.length < minimum || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new Error(`${label} must contain ${minimum}–${maximum} safe characters.`);
  }
  return result;
}

export function compileCommercialTerms(input: {
  businessName: string;
  contactEmail: string;
  governingLaw: string;
}): CommercialTerms {
  const businessName = bounded(input.businessName, 2, 120, "Business name");
  const contactEmail = bounded(input.contactEmail, 3, 254, "Contact email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)) throw new Error("Contact email is invalid.");
  const governingLaw = bounded(input.governingLaw, 2, 160, "Governing law");
  const unsigned = {
    schemaVersion: 1 as const,
    version: COMMERCIAL_TERMS_VERSION,
    businessName,
    contactEmail,
    governingLaw,
    service: "Public Repository Readiness Snapshot" as const,
    price: "149 USDC on Base" as const,
    turnaround: "Three business days after verified payment" as const,
    clauses: [
      "The service covers one customer-authorized public GitHub repository and uses only its publicly available contents.",
      "The customer represents that they own the repository or have authority to request this review.",
      "Private repositories, credentials, regulated or private data, exploit validation, production access, and production changes are excluded.",
      "The deliverable is an evidence-bound technical readiness snapshot with limitations and prioritized observations; it is not a security certification, legal advice, warranty, or guarantee of defect-free software.",
      "The fixed price is 149 USDC paid on Base. The customer is responsible for using the displayed token contract, network, amount, address, and invoice before expiration, and for any wallet or network fees.",
      "Work begins only after exact on-chain payment verification. SARA may automatically fulfill and deliver this fixed service under an active, versioned, owner-issued standing mandate.",
      "A cancellation requested before fulfillment approval is eligible for a refund less unrecoverable network fees. After fulfillment starts, refunds are decided by the owner based on work completed and applicable law.",
      "Refunds are never automatic and are sent only after owner approval to a verified appropriate destination.",
      "Customer contact details and operational records are retained only as needed for fulfillment, security, accounting, tax, disputes, and legal obligations; unnecessary delivery access is revoked or expires.",
      `Questions and notices must be sent to ${contactEmail}. The agreement is governed by ${governingLaw}, subject to non-waivable applicable law.`,
      `SARA is a disclosed automated analysis and delivery system operating for ${businessName}; this service does not include human specialist review unless a separate human-reviewed service is expressly purchased.`,
      "An Authorized — Automated Delivery status means the exact evidence-bound artifact passed SARA's separate logical verifier and deterministic compiler and was released under an active owner-issued policy. It does not mean a human reviewed, certified, or guaranteed the repository.",
      `SARA cannot accept custom terms, negotiate discounts, impersonate a person, or make commitments outside this fixed service.`,
    ],
  };
  return { ...unsigned, digest: sha256(canonicalJson(unsigned)) };
}

export function compilePreviousCommercialTermsDigest(input: {
  businessName: string;
  contactEmail: string;
  governingLaw: string;
}): string {
  const businessName = bounded(input.businessName, 2, 120, "Business name");
  const contactEmail = bounded(input.contactEmail, 3, 254, "Contact email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)) throw new Error("Contact email is invalid.");
  const governingLaw = bounded(input.governingLaw, 2, 160, "Governing law");
  const previous = {
    schemaVersion: 1 as const,
    version: PREVIOUS_COMMERCIAL_TERMS_VERSION,
    businessName,
    contactEmail,
    governingLaw,
    service: "Public Repository Readiness Snapshot" as const,
    price: "149 USDC on Base" as const,
    turnaround: "Three business days after verified payment and owner fulfillment approval" as const,
    clauses: [
      "The service covers one customer-authorized public GitHub repository and uses only its publicly available contents.",
      "The customer represents that they own the repository or have authority to request this review.",
      "Private repositories, credentials, regulated or private data, exploit validation, production access, and production changes are excluded.",
      "The deliverable is an evidence-bound technical readiness snapshot with limitations and prioritized observations; it is not a security certification, legal advice, warranty, or guarantee of defect-free software.",
      "The fixed price is 149 USDC paid on Base. The customer is responsible for using the displayed token contract, network, amount, address, and invoice before expiration, and for any wallet or network fees.",
      "Work begins only after on-chain payment verification and owner fulfillment approval. External delivery remains owner-approved for the first five paid reports.",
      "A cancellation requested before fulfillment approval is eligible for a refund less unrecoverable network fees. After fulfillment starts, refunds are decided by the owner based on work completed and applicable law.",
      "Refunds are never automatic and are sent only after owner approval to a verified appropriate destination.",
      "Customer contact details and operational records are retained only as needed for fulfillment, security, accounting, tax, disputes, and legal obligations; unnecessary delivery access is revoked or expires.",
      `Questions and notices must be sent to ${contactEmail}. The agreement is governed by ${governingLaw}, subject to non-waivable applicable law.`,
      `SARA is an automated system operating for ${businessName}; it cannot accept custom terms, negotiate discounts, or make commitments outside this fixed service.`,
    ],
  };
  return sha256(canonicalJson(previous));
}
