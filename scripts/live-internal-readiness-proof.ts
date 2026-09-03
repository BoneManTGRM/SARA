import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel } from "../src/kernel.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import {
  GitHubPublicRepositoryEvidenceCollector,
  type PublicRepositoryEvidenceSnapshot,
} from "../src/public-repository-evidence.ts";
import { RevenuePilotOperator } from "../src/revenue-pilot-operator.ts";
import { readRepositoryReadinessReportArtifact } from "../src/repository-readiness-report-artifacts.ts";
import type { OwnerApproval } from "../src/types.ts";

const targetRepository = process.env.SARA_PROOF_TARGET_REPOSITORY?.trim()
  || "https://github.com/BoneManTGRM/SARA";
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live internal proof.");

const stateDirectory = await mkdtemp(join(tmpdir(), "sara-live-readiness-proof-"));
const ownerToken = "sara-isolated-live-proof-owner";
const ownerTokenSha256 = sha256(ownerToken);
const startedAt = new Date();

try {
  const kernel = await SaraKernel.boot({
    stateDirectory,
    ownerTokenSha256,
    bootstrapRevenueCapabilities: true,
  });
  const owner = kernel.authenticateOwnerToken(ownerToken);

  const collector = new GitHubPublicRepositoryEvidenceCollector({ timeoutMs: 60_000 });
  let snapshot: PublicRepositoryEvidenceSnapshot;
  try {
    snapshot = await collector.collect(targetRepository);
    console.log(`SARA_INTERNAL_FREE_PROOF_EVIDENCE=${JSON.stringify({
      repository: snapshot.repository,
      immutableCommitSha: snapshot.immutableCommitSha,
      inventoryEntries: snapshot.inventory.length,
      inventoryTruncated: snapshot.inventoryTruncated,
      sampledFiles: snapshot.sampledFiles.map((file) => file.path),
    })}`);
  } catch (error) {
    throw new Error(`Repository evidence collection failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const job = await kernel.createRevenuePilotJob(owner, {
    opportunityId: `internal-free-proof-${startedAt.getTime()}`,
    sourceUrl: targetRepository,
    sourceAllowsAutomatedDiscovery: true,
    discoveredFromPublicSource: true,
    repoUrl: targetRepository,
    repositoryIsPublic: true,
    repositoryOwnerPermissionConfirmed: true,
    requiresPrivateAccess: false,
    containsRegulatedOrPrivateData: false,
    requestsProductionChanges: false,
    requestsExploitValidation: false,
    primaryGoal: "release_readiness",
    customerBudgetUsd: 149,
    requestedServiceId: "public-repository-readiness-snapshot",
    desiredTurnaroundDays: 3,
    recentCommitDays: 0,
  });

  if (job.status !== "offer_ready") {
    throw new Error(`Internal proof target was not offer-ready: ${JSON.stringify(job.plan)}`);
  }

  // The production service correctly requires collected revenue. This isolated,
  // disposable state uses an explicitly synthetic ledger entry solely to exercise
  // the complete post-payment workflow without recording revenue in production.
  const syntheticRevenue = await kernel.recordLedgerEntry(owner, {
    kind: "revenue",
    source: "customer",
    amountUsd: 149,
    realized: true,
    recurringMonthly: false,
    description: `SYNTHETIC INTERNAL ACCEPTANCE TEST ONLY — no payment received — ${job.id}`,
    occurredAt: startedAt.toISOString(),
  });
  const approval: OwnerApproval = {
    approvalId: `internal-proof-approval-${startedAt.getTime()}`,
    action: "contract_commitment",
    targetId: `revenue-pilot:${job.id}:fulfillment`,
    approvedAt: new Date().toISOString(),
    ownerId: owner.id,
  };
  await kernel.authorizeRevenuePilotJob(owner, job.id, syntheticRevenue.id, approval);

  const operator = new RevenuePilotOperator({
    kernel,
    modelClient: new OpenAIResponsesClient({ apiKey, timeoutMs: 120_000 }),
    repositoryEvidenceCollector: {
      async collect(repository) {
        if (repository !== snapshot.repository) throw new Error("Internal proof repository changed after evidence collection.");
        return structuredClone(snapshot);
      },
    },
    stateDirectory,
    monthlyBudgetUsd: 1,
  });

  const ticks: unknown[] = [];
  for (let index = 0; index < 4; index += 1) {
    const tick = await operator.tick();
    ticks.push(tick);
    const current = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === job.id);
    console.log(`SARA_INTERNAL_FREE_PROOF_TICK=${JSON.stringify({ index: index + 1, tick, status: current?.status, nextRole: current?.nextRole })}`);
    if (!current || current.status === "owner_review" || current.status === "failed" || current.status === "rejected") break;
  }

  const finalJob = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === job.id);
  if (!finalJob) throw new Error("The live internal proof job disappeared from durable state.");
  if (finalJob.status !== "owner_review") {
    throw new Error(`The live internal proof did not reach owner review: ${JSON.stringify({
      status: finalJob.status,
      nextRole: finalJob.nextRole,
      completedRoles: finalJob.completedRoles,
      receipts: finalJob.receipts,
      ticks,
    })}`);
  }

  const artifact = await readRepositoryReadinessReportArtifact({ stateDirectory, jobId: job.id });
  const completedAt = new Date();
  const result = {
    schemaVersion: 1,
    proof: "SARA_LIVE_INTERNAL_FREE_PUBLIC_REPOSITORY_READINESS_SNAPSHOT",
    testMode: "ISOLATED_UNPAID_ACCEPTANCE_TEST",
    productionLedgerTouched: false,
    paymentReceived: false,
    targetRepository,
    immutableCommitSha: artifact.report.immutableCommitSha,
    serviceId: finalJob.plan.serviceId,
    nominalCustomerPriceUsd: finalJob.plan.priceUsd,
    actualLunaExecutionCostUsd: finalJob.actualExecutionCostUsd,
    completedRoles: finalJob.completedRoles,
    resultingState: finalJob.status,
    externalDeliveryAuthorized: finalJob.externalDeliveryAuthorized,
    reportDigest: artifact.reportDigest,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    report: artifact.report,
  };
  console.log(`SARA_INTERNAL_FREE_PROOF_RESULT=${JSON.stringify(result)}`);
} catch (error) {
  const failure = {
    schemaVersion: 1,
    proof: "SARA_LIVE_INTERNAL_FREE_PUBLIC_REPOSITORY_READINESS_SNAPSHOT",
    testMode: "ISOLATED_UNPAID_ACCEPTANCE_TEST",
    productionLedgerTouched: false,
    paymentReceived: false,
    targetRepository,
    message: error instanceof Error ? error.message : String(error),
  };
  console.error(`SARA_INTERNAL_FREE_PROOF_FAILURE=${JSON.stringify(failure)}`);
  process.exitCode = 1;
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
