import { canonicalJson, sha256 } from "../canonical.ts";
import {
  arraySchema,
  digestSchema,
  enumSchema,
  idSchema,
  integerSchema,
  objectSchema,
  snapshotJson,
  textSchema,
  validateSchema,
  type Json,
  type Schema,
} from "./schema.ts";
import type { CapabilityDefinition, ExecutionOutput } from "./types.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export type ServiceCapabilityInput = {
  id: string;
  contractDigest: string;
  qualificationStatus: "PASSED" | "FAILED";
  status: "ENABLED" | "QUARANTINED" | "SHADOW";
  estimatedDeliveryMinutes: number;
  estimatedCashMicroUsd: number;
};

export type PublicDemandSignalInput = {
  sourceUrl: string;
  observedAt: string;
  serviceName: string;
  targetCustomer: string;
  customerProblem: string;
  requiredCapabilityIds: string[];
  comparablePriceUsd: number;
};

export type ServiceOpportunityGeneratorInput = {
  capabilities: ServiceCapabilityInput[];
  demandSignals: PublicDemandSignalInput[];
  maximumDeliveryMinutes: number;
  maximumCashMicroUsd: number;
  maximumCandidates: number;
};

export type ServiceOpportunityCandidate = {
  id: string;
  serviceName: string;
  targetCustomer: string;
  customerProblem: string;
  decision: "OWNER_REVIEW" | "EVIDENCE_REQUIRED" | "REJECTED";
  commercialClaimStatus: "UNVALIDATED_PUBLIC_SIGNALS";
  requiredCapabilityIds: string[];
  qualifiedCapabilityIds: string[];
  capabilityContractDigests: string[];
  evidenceUrls: string[];
  evidenceObservedDates: string[];
  distinctSourceHostCount: number;
  observedComparablePriceRangeUsd: { low: number; high: number } | null;
  recommendedPriceUsd: null;
  estimatedDeliveryMinutes: number;
  estimatedCashMicroUsd: number;
  disqualifyingRisks: string[];
  evidenceGaps: string[];
  safestNextStep: string;
};

export type ServiceOpportunityGeneratorOutput = {
  schemaVersion: 1;
  candidates: ServiceOpportunityCandidate[];
  consideredSignalCount: number;
  mayContactCustomers: false;
  mayPublish: false;
  mayAcceptContracts: false;
  maySpend: false;
  mayExecuteWork: false;
};

const capabilitySchema = objectSchema({
  id: idSchema,
  contractDigest: digestSchema,
  qualificationStatus: enumSchema("PASSED", "FAILED"),
  status: enumSchema("ENABLED", "QUARANTINED", "SHADOW"),
  estimatedDeliveryMinutes: integerSchema(0, 100_800),
  estimatedCashMicroUsd: integerSchema(0, 300_000_000),
});

const demandSignalSchema = objectSchema({
  sourceUrl: textSchema(2_048, 12),
  observedAt: { type: "string", minLength: 10, maxLength: 10, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  serviceName: textSchema(120, 3),
  targetCustomer: textSchema(240, 3),
  customerProblem: textSchema(1_000, 12),
  requiredCapabilityIds: arraySchema(idSchema, 32, 1),
  comparablePriceUsd: integerSchema(0, 100_000),
});

export const serviceOpportunityInputSchema: Schema = objectSchema({
  capabilities: arraySchema(capabilitySchema, 128, 1),
  demandSignals: arraySchema(demandSignalSchema, 200, 1),
  maximumDeliveryMinutes: integerSchema(1, 100_800),
  maximumCashMicroUsd: integerSchema(0, 300_000_000),
  maximumCandidates: integerSchema(1, 20),
});

export const serviceOpportunityOutputSchema: Schema = objectSchema({
  schemaVersion: integerSchema(1, 1),
  candidates: arraySchema(objectSchema({
    id: idSchema,
    serviceName: textSchema(120, 3),
    targetCustomer: textSchema(240, 3),
    customerProblem: textSchema(1_000, 12),
    decision: enumSchema("OWNER_REVIEW", "EVIDENCE_REQUIRED", "REJECTED"),
    commercialClaimStatus: enumSchema("UNVALIDATED_PUBLIC_SIGNALS"),
    requiredCapabilityIds: arraySchema(idSchema, 32, 1),
    qualifiedCapabilityIds: arraySchema(idSchema, 32),
    capabilityContractDigests: arraySchema(digestSchema, 32),
    evidenceUrls: arraySchema(textSchema(2_048, 12), 200, 1),
    evidenceObservedDates: arraySchema(textSchema(10, 10), 200, 1),
    distinctSourceHostCount: integerSchema(1, 200),
    observedComparablePriceRangeUsd: { type: "json" },
    recommendedPriceUsd: { type: "null" },
    estimatedDeliveryMinutes: integerSchema(0, 3_225_600),
    estimatedCashMicroUsd: integerSchema(0, 9_600_000_000),
    disqualifyingRisks: arraySchema(textSchema(1_000), 10),
    evidenceGaps: arraySchema(textSchema(1_000), 10),
    safestNextStep: textSchema(1_000, 12),
  }), 20),
  consideredSignalCount: integerSchema(1, 200),
  mayContactCustomers: { type: "boolean" },
  mayPublish: { type: "boolean" },
  mayAcceptContracts: { type: "boolean" },
  maySpend: { type: "boolean" },
  mayExecuteWork: { type: "boolean" },
});

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function publicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Demand evidence requires a canonical public HTTPS URL.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname.includes(":")
  ) {
    throw new Error("Demand evidence requires a canonical public HTTPS URL.");
  }
  return url;
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizedSignal(signal: PublicDemandSignalInput): PublicDemandSignalInput & { publisher: string } {
  if (!validDate(signal.observedAt)) throw new Error("Demand evidence observedAt must be a real ISO calendar date.");
  const url = publicHttpsUrl(signal.sourceUrl);
  const requiredCapabilityIds = [...new Set(signal.requiredCapabilityIds)].sort();
  return {
    sourceUrl: url.toString(),
    observedAt: signal.observedAt,
    serviceName: normalizedText(signal.serviceName),
    targetCustomer: normalizedText(signal.targetCustomer),
    customerProblem: normalizedText(signal.customerProblem),
    requiredCapabilityIds,
    comparablePriceUsd: signal.comparablePriceUsd,
    publisher: url.hostname.toLowerCase(),
  };
}

/**
 * Converts supplied capability contracts and public market observations into
 * deterministic SHADOW service candidates. It performs no network access and
 * grants no authority to publish, contact, contract, spend, or execute work.
 */
export function compileServiceOpportunities(raw: ServiceOpportunityGeneratorInput): ServiceOpportunityGeneratorOutput {
  const input = snapshotJson(raw) as unknown as ServiceOpportunityGeneratorInput;
  validateSchema(serviceOpportunityInputSchema, input as unknown as Json);

  const capabilities = new Map<string, ServiceCapabilityInput>();
  for (const capability of [...input.capabilities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!SAFE_ID.test(capability.id)) throw new Error("Capability IDs must be safe identifiers.");
    const existing = capabilities.get(capability.id);
    if (existing && canonicalJson(existing) !== canonicalJson(capability)) {
      throw new Error(`Conflicting capability evidence for ${capability.id}.`);
    }
    capabilities.set(capability.id, structuredClone(capability));
  }

  const uniqueSignals = new Map<string, ReturnType<typeof normalizedSignal>>();
  for (const signal of input.demandSignals.map(normalizedSignal)) {
    uniqueSignals.set(canonicalJson(signal), signal);
  }
  const signals = [...uniqueSignals.values()].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const groups = new Map<string, typeof signals>();
  for (const signal of signals) {
    const key = canonicalJson({
      serviceName: signal.serviceName,
      targetCustomer: signal.targetCustomer,
      customerProblem: signal.customerProblem,
      requiredCapabilityIds: signal.requiredCapabilityIds,
    });
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }

  const candidates = [...groups.entries()].map(([identity, group]): ServiceOpportunityCandidate => {
    const first = group[0]!;
    const requiredCapabilityIds = [...first.requiredCapabilityIds];
    const qualified = requiredCapabilityIds
      .map((id) => capabilities.get(id))
      .filter((capability): capability is ServiceCapabilityInput =>
        capability?.qualificationStatus === "PASSED" && capability.status === "ENABLED")
      .sort((a, b) => a.id.localeCompare(b.id));
    const qualifiedIds = qualified.map(({ id }) => id);
    const missing = requiredCapabilityIds.filter((id) => !qualifiedIds.includes(id));
    const suppliedRequired = requiredCapabilityIds
      .map((id) => capabilities.get(id))
      .filter((capability): capability is ServiceCapabilityInput => capability !== undefined);
    const estimatedDeliveryMinutes = suppliedRequired.reduce((sum, capability) => sum + capability.estimatedDeliveryMinutes, 0);
    const estimatedCashMicroUsd = suppliedRequired.reduce((sum, capability) => sum + capability.estimatedCashMicroUsd, 0);
    const evidenceUrls = [...new Set(group.map(({ sourceUrl }) => sourceUrl))].sort();
    const evidenceObservedDates = [...new Set(group.map(({ observedAt }) => observedAt))].sort();
    const publishers = [...new Set(group.map(({ publisher }) => publisher))].sort();
    const priceByPublisher = new Map<string, number>();
    for (const signal of group) {
      if (signal.comparablePriceUsd <= 0) continue;
      const current = priceByPublisher.get(signal.publisher);
      if (current === undefined || signal.comparablePriceUsd < current) {
        priceByPublisher.set(signal.publisher, signal.comparablePriceUsd);
      }
    }
    const observedPrices = [...priceByPublisher.values()].sort((a, b) => a - b);
    const evidenceGaps: string[] = [];
    const disqualifyingRisks: string[] = [];
    if (publishers.length < 2) evidenceGaps.push("Provide observations from at least two distinct public source hosts; host diversity does not by itself prove publisher independence.");
    if (missing.length) evidenceGaps.push(`Missing qualified enabled capabilities: ${missing.join(", ")}.`);
    if (observedPrices.length < 2) evidenceGaps.push("Provide comparable-price observations from at least two distinct public source hosts before considering a price; host diversity does not prove independence.");
    if (estimatedDeliveryMinutes > input.maximumDeliveryMinutes) {
      disqualifyingRisks.push(`Estimated delivery time exceeds the supplied ${input.maximumDeliveryMinutes}-minute ceiling.`);
    }
    if (estimatedCashMicroUsd > input.maximumCashMicroUsd) {
      disqualifyingRisks.push(`Estimated cash cost exceeds the supplied ${input.maximumCashMicroUsd}-micro-USD ceiling.`);
    }
    const decision = disqualifyingRisks.length
      ? "REJECTED" as const
      : evidenceGaps.length
        ? "EVIDENCE_REQUIRED" as const
        : "OWNER_REVIEW" as const;
    const safestNextStep = decision === "REJECTED"
      ? "Do not offer or execute this service under the supplied ceilings. Revise the scope or obtain a separate exact owner decision."
      : decision === "EVIDENCE_REQUIRED"
        ? "Resolve every listed evidence gap using current public evidence before preparing an owner-review offer."
        : "Owner may review the evidence and decide whether to validate the service manually; no offer, outreach, price, contract, or work is authorized.";

    return {
      id: `service-${sha256(identity).slice(0, 20)}`,
      serviceName: first.serviceName,
      targetCustomer: first.targetCustomer,
      customerProblem: first.customerProblem,
      decision,
      commercialClaimStatus: "UNVALIDATED_PUBLIC_SIGNALS",
      requiredCapabilityIds,
      qualifiedCapabilityIds: qualifiedIds,
      capabilityContractDigests: qualified.map(({ contractDigest }) => contractDigest),
      evidenceUrls,
      evidenceObservedDates,
      distinctSourceHostCount: publishers.length,
      observedComparablePriceRangeUsd: observedPrices.length >= 2
        ? { low: observedPrices[0]!, high: observedPrices.at(-1)! }
        : null,
      recommendedPriceUsd: null,
      estimatedDeliveryMinutes,
      estimatedCashMicroUsd,
      disqualifyingRisks,
      evidenceGaps,
      safestNextStep,
    };
  }).sort((a, b) => a.id.localeCompare(b.id)).slice(0, input.maximumCandidates);

  return {
    schemaVersion: 1,
    candidates,
    consideredSignalCount: signals.length,
    mayContactCustomers: false,
    mayPublish: false,
    mayAcceptContracts: false,
    maySpend: false,
    mayExecuteWork: false,
  };
}

const qualificationInput: ServiceOpportunityGeneratorInput = {
  capabilities: [{
    id: "verified-analysis",
    contractDigest: "a".repeat(64),
    qualificationStatus: "PASSED",
    status: "ENABLED",
    estimatedDeliveryMinutes: 30,
    estimatedCashMicroUsd: 0,
  }],
  demandSignals: [
    {
      sourceUrl: "https://publisher-one.example/observed-problem",
      observedAt: "2026-09-12",
      serviceName: "Bounded Analysis",
      targetCustomer: "Public project maintainers",
      customerProblem: "Maintainers need a repeatable evidence-backed analysis.",
      requiredCapabilityIds: ["verified-analysis"],
      comparablePriceUsd: 79,
    },
    {
      sourceUrl: "https://publisher-two.example/comparable-offer",
      observedAt: "2026-09-12",
      serviceName: "Bounded Analysis",
      targetCustomer: "Public project maintainers",
      customerProblem: "Maintainers need a repeatable evidence-backed analysis.",
      requiredCapabilityIds: ["verified-analysis"],
      comparablePriceUsd: 99,
    },
  ],
  maximumDeliveryMinutes: 60,
  maximumCashMicroUsd: 0,
  maximumCandidates: 3,
};

function executeServiceOpportunity(input: Record<string, Json>): ExecutionOutput {
  const output = compileServiceOpportunities(input as unknown as ServiceOpportunityGeneratorInput);
  return {
    output: output as unknown as Json,
    observed: output.candidates.flatMap((candidate) => candidate.evidenceUrls.map((sourceUrl) => ({ sourceUrl }))),
    inferred: output.candidates.map((candidate) => ({ candidateId: candidate.id, decision: candidate.decision })),
    unknowns: [
      "Public signals do not prove customer demand, willingness to pay, legal suitability, or delivery success.",
      "Any publication, outreach, contract, payment, or work requires its separate existing authority gate.",
    ],
    confidence: {
      level: "MEDIUM",
      basis: "Deterministic compilation of supplied capability contracts and public observations; market truth remains unverified.",
    },
  };
}

export const serviceOpportunityDefinition: CapabilityDefinition = {
  id: "service-opportunity-generator",
  version: "1.0.0",
  description: "Compile verified capability contracts and supplied public demand observations into zero-cost SHADOW service candidates without outreach or commercial authority.",
  inputSchema: serviceOpportunityInputSchema,
  outputSchema: serviceOpportunityOutputSchema,
  effect: "PURE",
  authorityClass: "DRAFT_ONLY",
  resources: ["supplied-input", "kernel-read-only-projection"],
  sourceFiles: ["service-opportunity.ts"],
  qualificationRequirements: [
    "frozen-contract",
    "malformed-input",
    "source-host-diversity-evidence",
    "qualified-capability-evidence",
    "deterministic-output",
    "zero-external-authority",
  ],
  execute: executeServiceOpportunity,
  cases: [
    {
      name: "qualified-signals-stop-at-owner-review",
      input: qualificationInput as unknown as Json,
      check: (result) => {
        const output = result.output as unknown as ServiceOpportunityGeneratorOutput;
        return output.candidates[0]?.decision === "OWNER_REVIEW" &&
          output.candidates[0]?.recommendedPriceUsd === null &&
          output.mayContactCustomers === false && output.mayExecuteWork === false;
      },
    },
    {
      name: "single-publisher-remains-evidence-required",
      input: { ...qualificationInput, demandSignals: qualificationInput.demandSignals.slice(0, 1) } as unknown as Json,
      check: (result) => (result.output as unknown as ServiceOpportunityGeneratorOutput).candidates[0]?.decision === "EVIDENCE_REQUIRED",
    },
    {
      name: "delivery-ceiling-rejects",
      input: { ...qualificationInput, maximumDeliveryMinutes: 1 } as unknown as Json,
      check: (result) => (result.output as unknown as ServiceOpportunityGeneratorOutput).candidates[0]?.decision === "REJECTED",
    },
  ],
};
