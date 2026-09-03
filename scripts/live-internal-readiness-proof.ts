import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel } from "../src/kernel.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import { OpenAIResponsesClient } from "../src/openai-worker.ts";
import type { PublicRepositoryEvidenceSnapshot } from "../src/public-repository-evidence.ts";
import { RevenuePilotOperator } from "../src/revenue-pilot-operator.ts";
import { readRepositoryReadinessReportArtifact } from "../src/repository-readiness-report-artifacts.ts";
import type { OwnerApproval } from "../src/types.ts";

const targetRepository = process.env.SARA_PROOF_TARGET_REPOSITORY?.trim()
  || "https://github.com/BoneManTGRM/SARA";
const pinnedCommit = process.env.SARA_PROOF_PINNED_COMMIT?.trim()
  || "c14f5113c34271abd69e0a9fbcbd29d4dcf4f750";
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live internal proof.");

const stateDirectory = await mkdtemp(join(tmpdir(), "sara-live-readiness-proof-"));
const ownerToken = "sara-isolated-live-proof-owner";
const ownerTokenSha256 = sha256(ownerToken);
const startedAt = new Date();

const PROOF_SAMPLE_PATHS = [
  "package.json",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  "src/openai-worker.ts",
  "src/model-router.ts",
] as const;
const MAX_FILE_SOURCE_BYTES = 5_000;
const MAX_TOTAL_SOURCE_BYTES = 16_000;

async function fetchPinnedSource(path: string, remainingBytes: number): Promise<{
  sourceText: string;
  sourceTruncated: boolean;
}> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    `https://raw.githubusercontent.com/BoneManTGRM/SARA/${pinnedCommit}/${encodedPath}`,
  );
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
    throw new Error("Pinned proof source must use raw.githubusercontent.com over HTTPS.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: { "user-agent": "SARA-Isolated-Acceptance-Proof/1.0" },
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`Pinned source ${path} timed out.`);
    throw new Error(`Pinned source ${path} could not be read.`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Pinned source ${path} failed with status ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 256 * 1024) throw new Error(`Pinned source ${path} exceeded its proof limit.`);
  const limit = Math.max(0, Math.min(MAX_FILE_SOURCE_BYTES, remainingBytes));
  const slice = bytes.subarray(0, limit);
  return {
    sourceText: slice.toString("utf8").replace(/\u0000/gu, ""),
    sourceTruncated: bytes.length > slice.length,
  };
}

async function buildConnectorVerifiedPinnedSnapshot(): Promise<PublicRepositoryEvidenceSnapshot> {
  if (targetRepository !== "https://github.com/BoneManTGRM/SARA") {
    throw new Error("The connector-verified proof snapshot is bound only to BoneManTGRM/SARA.");
  }
  if (!/^[a-f0-9]{40}$/u.test(pinnedCommit)) {
    throw new Error("SARA_PROOF_PINNED_COMMIT must be one lowercase 40-character commit SHA.");
  }
  const sampledFiles: PublicRepositoryEvidenceSnapshot["sampledFiles"] = [];
  let sampledBytes = 0;
  for (const path of PROOF_SAMPLE_PATHS) {
    if (sampledBytes >= MAX_TOTAL_SOURCE_BYTES) break;
    const source = await fetchPinnedSource(path, MAX_TOTAL_SOURCE_BYTES - sampledBytes);
    sampledBytes += Buffer.byteLength(source.sourceText, "utf8");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    sampledFiles.push({
      path,
      permalink: `${targetRepository}/blob/${pinnedCommit}/${encodedPath}`,
      sourceText: source.sourceText,
      sourceTruncated: source.sourceTruncated,
    });
  }
  if (
    sampledFiles.length !== PROOF_SAMPLE_PATHS.length ||
    sampledBytes < 1 ||
    sampledBytes > MAX_TOTAL_SOURCE_BYTES ||
    sampledFiles.some((file) => !file.sourceText)
  ) {
    throw new Error("The pinned proof evidence packet did not reach its expected bounded source coverage.");
  }
  const incompleteWorkflow = sampledFiles.find((file) =>
    file.path.startsWith(".github/workflows/") && file.sourceTruncated
  );
  if (incompleteWorkflow) {
    throw new Error(`Pinned proof workflow evidence was truncated: ${incompleteWorkflow.path}.`);
  }
  return {
    schemaVersion: 1,
    provider: "github",
    repository: targetRepository,
    immutableCommitSha: pinnedCommit,
    defaultBranch: "main",
    collectedAt: new Date().toISOString(),
    collectionMode: "anonymous_read_only",
    repositoryFacts: {
      archived: false,
      disabled: false,
      fork: false,
      stars: 0,
      openIssues: 1,
      licenseSpdx: "NOASSERTION",
    },
    inventory: [
      { path: ".github/workflows/ci.yml", type: "blob", size: 273 },
      { path: ".github/workflows/cloudflare-self-build.yml", type: "blob", size: 2701 },
      { path: ".github/workflows/codeql.yml", type: "blob", size: 4685 },
      { path: ".github/workflows/sara-revenue-scout.yml", type: "blob", size: 1488 },
      { path: ".github/workflows/self-build.yml", type: "blob", size: 1009 },
      { path: "LICENSE", type: "blob", size: 1230 },
      { path: "README.md", type: "blob", size: 18382 },
      { path: "docs/REVENUE_PILOT_50.md", type: "blob", size: 9938 },
      { path: "package-lock.json", type: "blob", size: 16751 },
      { path: "package.json", type: "blob", size: 1573 },
      { path: "src/model-router.ts", type: "blob", size: null },
      { path: "src/openai-worker.ts", type: "blob", size: null },
      { path: "src/public-repository-evidence.ts", type: "blob", size: null },
      { path: "src/repository-readiness-report.ts", type: "blob", size: null },
      { path: "src/revenue-pilot-operator.ts", type: "blob", size: null },
      { path: "tests/model-router.test.ts", type: "blob", size: null },
      { path: "tests/openai-worker.test.ts", type: "blob", size: null },
      { path: "tests/repository-readiness-report.test.ts", type: "blob", size: null },
    ],
    inventoryTruncated: true,
    sampledFiles,
    limitations: [
      "This isolated unpaid acceptance proof is bound to an owner-connected GitHub-verified immutable commit; sampled source bytes were reread anonymously from raw.githubusercontent.com after the anonymous GitHub API returned HTTP 429.",
      "The pinned proof packet is deliberately bounded to selected public files and is not evidence that unobserved files, history, branches, dependencies, vulnerabilities, or exposed secrets are absent.",
      "No private repository, credential, issue mutation, branch mutation, merge, deployment, or customer-system access was used.",
    ],
  };
}

try {
  const kernel = await SaraKernel.boot({
    stateDirectory,
    ownerTokenSha256,
    bootstrapRevenueCapabilities: true,
  });
  const owner = kernel.authenticateOwnerToken(ownerToken);

  const snapshot = await buildConnectorVerifiedPinnedSnapshot();
  console.log(`SARA_INTERNAL_FREE_PROOF_EVIDENCE=${JSON.stringify({
    evidenceMode: "CONNECTOR_VERIFIED_PINNED_IMMUTABLE_SNAPSHOT",
    repository: snapshot.repository,
    immutableCommitSha: snapshot.immutableCommitSha,
    inventoryEntries: snapshot.inventory.length,
    inventoryTruncated: snapshot.inventoryTruncated,
    sampledFiles: snapshot.sampledFiles.map((file) => file.path),
    sampledSourceBytes: snapshot.sampledFiles.reduce(
      (total, file) => total + Buffer.byteLength(file.sourceText, "utf8"),
      0,
    ),
  })}`);

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

  const rawClient = new OpenAIResponsesClient({ apiKey, timeoutMs: 120_000 });
  const diagnosticClient: WorkerModelClient = {
    routeKey: rawClient.routeKey,
    maximumWallTimeMs: rawClient.maximumWallTimeMs,
    async countInputTokens(prompt) {
      const count = await rawClient.countInputTokens(prompt);
      console.log(`SARA_INTERNAL_FREE_PROOF_MODEL_PREFLIGHT=${JSON.stringify({
        utf8Bytes: Buffer.byteLength(prompt, "utf8"),
        reportedInputTokens: count,
      })}`);
      return count;
    },
    async execute(input) {
      console.log(`SARA_INTERNAL_FREE_PROOF_MODEL_EXECUTE=${JSON.stringify({
        reasoningLevel: input.reasoningLevel,
        maximumOutputTokens: input.maximumOutputTokens,
      })}`);
      try {
        const result = await rawClient.execute(input);
        console.log(`SARA_INTERNAL_FREE_PROOF_MODEL_USAGE=${JSON.stringify({
          inputTokens: result.inputTokens,
          billableOutputTokens: result.billableOutputTokens,
          outputDigest: sha256(result.outputText),
        })}`);
        return result;
      } catch (error) {
        console.error(`SARA_INTERNAL_FREE_PROOF_MODEL_ERROR=${JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        })}`);
        throw error;
      }
    },
  };

  const operator = new RevenuePilotOperator({
    kernel,
    modelClient: diagnosticClient,
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
    let tick: unknown;
    try {
      tick = await operator.tick();
    } catch (error) {
      const current = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === job.id);
      console.error(`SARA_INTERNAL_FREE_PROOF_TICK_ERROR=${JSON.stringify({
        index: index + 1,
        message: error instanceof Error ? error.message : String(error),
        status: current?.status,
        nextRole: current?.nextRole,
        receipts: current?.receipts,
      })}`);
      throw error;
    }
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
    evidenceMode: "CONNECTOR_VERIFIED_PINNED_IMMUTABLE_SNAPSHOT",
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
    pinnedCommit,
    message: error instanceof Error ? error.message : String(error),
  };
  console.error(`SARA_INTERNAL_FREE_PROOF_FAILURE=${JSON.stringify(failure)}`);
  process.exitCode = 1;
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
