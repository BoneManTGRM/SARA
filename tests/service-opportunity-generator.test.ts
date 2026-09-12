import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import {
  compileServiceOpportunities,
  type ServiceOpportunityGeneratorInput,
} from "../src/digital-capabilities/service-opportunity.ts";

const digest = (value: string) => sha256(value);

function input(): ServiceOpportunityGeneratorInput {
  return {
    capabilities: [
      {
        id: "public-repository-inventory",
        contractDigest: digest("inventory-contract"),
        qualificationStatus: "PASSED",
        status: "ENABLED",
        estimatedDeliveryMinutes: 30,
        estimatedCashMicroUsd: 0,
      },
      {
        id: "documentation-clarity-analysis",
        contractDigest: digest("documentation-contract"),
        qualificationStatus: "PASSED",
        status: "ENABLED",
        estimatedDeliveryMinutes: 60,
        estimatedCashMicroUsd: 500_000,
      },
    ],
    demandSignals: [
      {
        sourceUrl: "https://market-a.example/documentation-review",
        observedAt: "2026-09-12",
        serviceName: "Documentation Clarity Review",
        targetCustomer: "Public repository maintainers",
        customerProblem: "Prospective users need clear installation and usage guidance.",
        requiredCapabilityIds: ["documentation-clarity-analysis", "public-repository-inventory"],
        comparablePriceUsd: 79,
      },
      {
        sourceUrl: "https://market-b.example/documentation-review",
        observedAt: "2026-09-12",
        serviceName: "Documentation Clarity Review",
        targetCustomer: "Public repository maintainers",
        customerProblem: "Prospective users need clear installation and usage guidance.",
        requiredCapabilityIds: ["public-repository-inventory", "documentation-clarity-analysis"],
        comparablePriceUsd: 99,
      },
    ],
    maximumDeliveryMinutes: 180,
    maximumCashMicroUsd: 1_000_000,
    maximumCandidates: 5,
  };
}

test("compiles capability-backed public signals into an owner-review service candidate", () => {
  const result = compileServiceOpportunities(input());
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]!;
  assert.equal(candidate.decision, "OWNER_REVIEW");
  assert.deepEqual(candidate.requiredCapabilityIds, [
    "documentation-clarity-analysis",
    "public-repository-inventory",
  ]);
  assert.equal(candidate.estimatedDeliveryMinutes, 90);
  assert.equal(candidate.estimatedCashMicroUsd, 500_000);
  assert.deepEqual(candidate.observedComparablePriceRangeUsd, { low: 79, high: 99 });
  assert.equal(candidate.recommendedPriceUsd, null);
  assert.equal(candidate.evidenceGaps.length, 0);
  assert.equal(result.mayContactCustomers, false);
  assert.equal(result.mayPublish, false);
  assert.equal(result.mayAcceptContracts, false);
  assert.equal(result.maySpend, false);
  assert.equal(result.mayExecuteWork, false);
});

test("keeps a single-source idea in evidence-required status", () => {
  const candidateInput = input();
  candidateInput.demandSignals = candidateInput.demandSignals.slice(0, 1);
  const candidate = compileServiceOpportunities(candidateInput).candidates[0]!;
  assert.equal(candidate.decision, "EVIDENCE_REQUIRED");
  assert.equal(candidate.observedComparablePriceRangeUsd, null);
  assert.ok(candidate.evidenceGaps.some((gap) => gap.includes("distinct public source hosts")));
});

test("does not treat failed or quarantined capabilities as delivery capacity", () => {
  const candidateInput = input();
  candidateInput.capabilities[1]!.status = "QUARANTINED";
  const candidate = compileServiceOpportunities(candidateInput).candidates[0]!;
  assert.equal(candidate.decision, "EVIDENCE_REQUIRED");
  assert.deepEqual(candidate.qualifiedCapabilityIds, ["public-repository-inventory"]);
  assert.ok(candidate.evidenceGaps.some((gap) => gap.includes("documentation-clarity-analysis")));
});

test("rejects candidates outside supplied delivery cost and time ceilings", () => {
  const candidateInput = input();
  candidateInput.maximumDeliveryMinutes = 60;
  candidateInput.maximumCashMicroUsd = 100_000;
  const candidate = compileServiceOpportunities(candidateInput).candidates[0]!;
  assert.equal(candidate.decision, "REJECTED");
  assert.equal(candidate.disqualifyingRisks.length, 2);
  assert.match(candidate.safestNextStep, /Do not offer/);
});

test("is deterministic under input reordering, deduplicates exact signals, and does not mutate", () => {
  const firstInput = input();
  const snapshot = structuredClone(firstInput);
  const first = compileServiceOpportunities(firstInput);
  assert.deepEqual(firstInput, snapshot);

  const reordered = input();
  reordered.capabilities.reverse();
  reordered.demandSignals = [
    reordered.demandSignals[1]!,
    reordered.demandSignals[0]!,
    structuredClone(reordered.demandSignals[0]!),
  ];
  assert.equal(canonicalJson(compileServiceOpportunities(reordered)), canonicalJson(first));
});

test("fails closed on non-public or credential-bearing evidence URLs", () => {
  for (const sourceUrl of [
    "http://example.com/demand",
    "https://user:password@example.com/demand",
    "https://localhost/demand",
  ]) {
    const candidateInput = input();
    candidateInput.demandSignals[0]!.sourceUrl = sourceUrl;
    assert.throws(() => compileServiceOpportunities(candidateInput), /public HTTPS/);
  }
});

test("runs through SARA's common capability boundary with zero external authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sara-service-opportunity-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: digest("owner") });
    const before = await kernel.getStatus();
    const result = await kernel.invokeCapability(SARA_PRINCIPAL, {
      requestId: "service-opportunity-one",
      capabilityId: "service-opportunity-generator",
      input: input(),
    });
    const after = await kernel.getStatus();
    const output = result.output as unknown as { candidates: Array<{ decision: string }> };
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.authority.required, "DRAFT_ONLY");
    assert.equal(result.authority.authorizationTokenIssued, false);
    assert.equal(result.cost.actualCashMicroUsd, 0);
    assert.equal(output.candidates[0]?.decision, "OWNER_REVIEW");
    assert.deepEqual(after.realizedProfit, before.realizedProfit);
    assert.deepEqual(after.revenuePilotJobs, before.revenuePilotJobs);
    assert.deepEqual(after.revenuePaymentIntents, before.revenuePaymentIntents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
