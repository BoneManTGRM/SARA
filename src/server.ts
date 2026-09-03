import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DASHBOARD_HTML } from "./dashboard.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import { SaraKernel, SARA_PRINCIPAL } from "./kernel.ts";
import type { OwnerAssistant } from "./owner-assistant.ts";
import { PolicyDeniedError } from "./policy.ts";
import type { RevenuePilotInput } from "./revenue-pilot.ts";
import { listRevenueServices } from "./revenue-service-catalog.ts";
import { readRepositoryReadinessReportArtifact } from "./repository-readiness-report-artifacts.ts";
import { listSaraTools } from "./tool-registry.ts";
import type { CandidateProposal, MutationStage } from "./types.ts";

const MAX_BODY_BYTES = 64 * 1024;

export type SaraRuntimeStatus = {
  worker: unknown;
  startupProof: unknown;
};

type ServerOptions = {
  ownerTokenSha256: string;
  readOnlyBridgeTokenSha256?: string;
  telegramBridgeTokenSha256?: string;
  ownerAssistant?: OwnerAssistant;
  runtimeStatus?: () => Promise<SaraRuntimeStatus>;
  stateDirectory?: string;
};

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function authenticatedToken(request: IncomingMessage, expectedHex: string): string | null {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex)) return null;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  const received = tokenDigest(token);
  const expected = Buffer.from(expectedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected) ? token : null;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds 64 KiB.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON body must be an object.");
  return parsed as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function unauthorized(response: ServerResponse): void {
  response.setHeader("www-authenticate", "Bearer");
  json(response, 401, { error: "Owner authentication required." });
}

function bridgeUnauthorized(response: ServerResponse, label = "Read-only bridge"): void {
  response.setHeader("www-authenticate", "Bearer");
  json(response, 401, { error: `${label} authentication required.` });
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error(`${label} must contain ${minimum}–${maximum} safe characters.`);
  }
  return text;
}

type OwnerSession = ReturnType<SaraKernel["authenticateOwnerToken"]>;

async function handlePublicRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    response.end(DASHBOARD_HTML);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    const status = await kernel.getStatus();
    json(response, 200, {
      ok: true,
      constitutionVerified: status.constitution.verified,
      emergencyStopped: status.emergencyStopped,
      workerConfigured: Boolean(options.runtimeStatus),
    });
    return true;
  }
  return false;
}

async function handleObjectives(request: IncomingMessage, response: ServerResponse, kernel: SaraKernel, owner: OwnerSession): Promise<void> {
  const body = await readJson(request);
  const job = await kernel.createSelfDevelopmentJob(owner, {
    objective: String(body.objective ?? ""),
    expectedOwnerValue: Number(body.expectedOwnerValue ?? 0),
    requiredCapabilities: Array.isArray(body.requiredCapabilities) ? body.requiredCapabilities.map(String) : [],
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.map(String) : [],
    maximumBudgetUsd: Number(body.maximumBudgetUsd ?? 0),
    external: true,
  });
  json(response, 201, job);
}

async function handleEmergencyStop(request: IncomingMessage, response: ServerResponse, kernel: SaraKernel, owner: OwnerSession): Promise<void> {
  const body = await readJson(request);
  if (typeof body.active !== "boolean") throw new Error("active must be boolean.");
  await kernel.setEmergencyStop(owner, body.active);
  json(response, 200, { active: body.active });
}

async function handleRevenuePilotOpportunity(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
): Promise<void> {
  const body = await readJson(request);
  const input: RevenuePilotInput = {
    opportunityId: String(body.opportunityId ?? ""),
    sourceUrl: String(body.sourceUrl ?? ""),
    sourceAllowsAutomatedDiscovery: body.sourceAllowsAutomatedDiscovery === true,
    discoveredFromPublicSource: body.discoveredFromPublicSource === true,
    repoUrl: String(body.repoUrl ?? ""),
    repositoryIsPublic: body.repositoryIsPublic === true,
    repositoryOwnerPermissionConfirmed: body.repositoryOwnerPermissionConfirmed === true,
    requiresPrivateAccess: body.requiresPrivateAccess === true,
    containsRegulatedOrPrivateData: body.containsRegulatedOrPrivateData === true,
    requestsProductionChanges: body.requestsProductionChanges === true,
    requestsExploitValidation: body.requestsExploitValidation === true,
    primaryGoal: String(body.primaryGoal ?? "other") as RevenuePilotInput["primaryGoal"],
    customerBudgetUsd: Number(body.customerBudgetUsd),
    ...(body.requestedServiceId === undefined ? {} : { requestedServiceId: String(body.requestedServiceId) as RevenuePilotInput["requestedServiceId"] }),
    desiredTurnaroundDays: Number(body.desiredTurnaroundDays),
    recentCommitDays: body.recentCommitDays === null ? null : Number(body.recentCommitDays),
  };
  json(response, 201, await kernel.createRevenuePilotJob(owner, input));
}

async function handleRevenuePilotAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
  jobId: string,
): Promise<void> {
  const body = await readJson(request);
  const targetId = `revenue-pilot:${jobId}:fulfillment`;
  const approval = {
    approvalId: randomUUID(),
    action: "contract_commitment" as const,
    targetId,
    approvedAt: new Date().toISOString(),
    ownerId: owner.id,
  };
  json(response, 200, await kernel.authorizeRevenuePilotWithCollectedRevenue(owner, jobId, {
    amountUsd: Number(body.collectedRevenueUsd),
    occurredAt: String(body.occurredAt ?? ""),
    paymentReferenceDigest: String(body.paymentReferenceDigest ?? ""),
  }, approval));
}

async function handleJobHandoff(response: ServerResponse, kernel: SaraKernel, jobId: string): Promise<void> {
  const status = await kernel.getStatus();
  const job = status.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    json(response, 404, { error: "Job not found." });
    return;
  }
  json(response, 200, compileExecutorHandoff(job, status.constitution.digest));
}

async function handleSelfBuild(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
  jobId: string,
): Promise<void> {
  const body = await readJson(request);
  const proposal = body.proposal as CandidateProposal;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("proposal must be a skill or program candidate object.");
  }
  json(
    response,
    201,
    await kernel.runSelfBuildCycle(owner, jobId, {
      id: "owner-supplied-zero-cost-proposal",
      external: false,
      maximumCostUsd: 0,
      async generate() {
        return structuredClone(proposal);
      },
    }),
  );
}

async function handleMutationPromotion(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
  mutationId: string,
): Promise<void> {
  const body = await readJson(request);
  const stage = String(body.stage ?? "") as MutationStage;
  const mutation = await kernel.promoteMutation(owner, mutationId, stage, {
    approvalId: randomUUID(),
    action: "production_promotion",
    targetId: `${mutationId}:${stage}`,
    approvedAt: new Date().toISOString(),
    ownerId: owner.id,
  });
  json(response, 200, mutation);
}

async function handleAuthenticatedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  owner: OwnerSession,
  options: ServerOptions,
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/status") {
    const status = await kernel.getStatus();
    json(response, 200, {
      ...status,
      runtime: options.runtimeStatus ? await options.runtimeStatus() : null,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/tools") {
    json(response, 200, listSaraTools({
      lunaConfigured: Boolean(options.runtimeStatus),
      ownerAssistantConfigured: Boolean(options.ownerAssistant),
    }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/revenue-pilot/services") {
    json(response, 200, listRevenueServices());
    return;
  }
  const revenueReportMatch = url.pathname.match(/^\/api\/revenue-pilot\/jobs\/([^/]+)\/report$/);
  if (request.method === "GET" && revenueReportMatch) {
    if (!options.stateDirectory) {
      json(response, 503, { error: "Private report storage is not configured." });
      return;
    }
    const jobId = decodeURIComponent(revenueReportMatch[1]);
    const job = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      json(response, 404, { error: "Revenue pilot job not found." });
      return;
    }
    if (job.status !== "owner_review" || job.externalDeliveryAuthorized !== false) {
      json(response, 409, { error: "The report has not passed its owner-review gate." });
      return;
    }
    try {
      const artifact = await readRepositoryReadinessReportArtifact({
        stateDirectory: options.stateDirectory,
        jobId,
      });
      const receipt = job.receipts.find((candidate) => candidate.role === "delivery_operator");
      if (!receipt?.reportDigest || receipt.reportDigest !== artifact.reportDigest) {
        throw new Error("Repository-readiness report does not match the completed delivery receipt.");
      }
      json(response, 200, artifact);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        json(response, 404, { error: "Repository-readiness report not found." });
        return;
      }
      throw error;
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/objectives") {
    await handleObjectives(request, response, kernel, owner);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/emergency-stop") {
    await handleEmergencyStop(request, response, kernel, owner);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/revenue-pilot/opportunities") {
    await handleRevenuePilotOpportunity(request, response, kernel, owner);
    return;
  }
  const revenueAuthorizationMatch = url.pathname.match(/^\/api\/revenue-pilot\/jobs\/([^/]+)\/authorize$/);
  if (request.method === "POST" && revenueAuthorizationMatch) {
    await handleRevenuePilotAuthorization(
      request,
      response,
      kernel,
      owner,
      decodeURIComponent(revenueAuthorizationMatch[1]),
    );
    return;
  }
  const handoffMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/handoff$/);
  if (request.method === "GET" && handoffMatch) {
    await handleJobHandoff(response, kernel, decodeURIComponent(handoffMatch[1]));
    return;
  }
  const executeScaffoldMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/execute-scaffold$/);
  if (request.method === "POST" && executeScaffoldMatch) {
    json(response, 201, await kernel.executeDeterministicSkillScaffold(owner, decodeURIComponent(executeScaffoldMatch[1])));
    return;
  }
  const selfBuildMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/self-build$/);
  if (request.method === "POST" && selfBuildMatch) {
    await handleSelfBuild(request, response, kernel, owner, decodeURIComponent(selfBuildMatch[1]));
    return;
  }
  const promoteMatch = url.pathname.match(/^\/api\/mutations\/([^/]+)\/promote$/);
  if (request.method === "POST" && promoteMatch) {
    await handleMutationPromotion(request, response, kernel, owner, decodeURIComponent(promoteMatch[1]));
    return;
  }
  json(response, 404, { error: "Not found." });
}

async function handleTelegramBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/bridge/actions/status") {
    const status = await kernel.getStatus();
    json(response, 200, {
      schemaVersion: 1,
      access: "telegram_explicit_actions",
      emergencyStopped: status.emergencyStopped,
      jobs: status.jobs.length,
      mutations: status.mutations.length,
      ownerAssistant: options.ownerAssistant ? await options.ownerAssistant.status() : null,
      prohibitedActions: [
        "outreach",
        "applications",
        "contracts",
        "payments",
        "customer delivery",
        "account creation",
        "merge",
        "deployment",
        "production mutation",
      ],
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/bridge/actions/luna") {
    if (!options.ownerAssistant) {
      json(response, 503, { error: "Bounded Luna analysis is not configured." });
      return;
    }
    if ((await kernel.getStatus()).emergencyStopped) {
      json(response, 423, { error: "Emergency stop is active. No paid request was made." });
      return;
    }
    const body = await readJson(request);
    const requestId = boundedText(body.requestId, 8, 160, "requestId");
    const text = boundedText(body.text, 3, 1_200, "text");
    json(response, 200, await options.ownerAssistant.analyze({ requestId, text }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/bridge/actions/tasks") {
    const body = await readJson(request);
    boundedText(body.requestId, 8, 160, "requestId");
    const objective = boundedText(body.objective, 3, 1_000, "objective");
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective,
      expectedOwnerValue: 1,
      requiredCapabilities: ["owner-requested-capability"],
      acceptanceCriteria: [
        "Produce a reviewable candidate artifact.",
        "Pass deterministic verification before SHADOW.",
        "Never promote, spend, deploy, merge, contact anyone, or make commitments without a separate owner gate.",
      ],
      maximumBudgetUsd: 0,
      external: true,
    });
    json(response, 201, { schemaVersion: 1, outcome: "work_card_created", job });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/bridge/actions/scaffolds") {
    const body = await readJson(request);
    boundedText(body.requestId, 8, 160, "requestId");
    const objective = boundedText(body.objective, 3, 1_000, "objective");
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective,
      expectedOwnerValue: 1,
      requiredCapabilities: ["typescript-skill-scaffold"],
      acceptanceCriteria: [
        "Create a dependency-free TypeScript scaffold in Genome Lab.",
        "Compile the scaffold and bind evidence to its candidate digest.",
        "Stop in SANDBOX without promotion or production mutation.",
      ],
      maximumBudgetUsd: 0,
      external: true,
    });
    const scaffold = await kernel.executeDeterministicSkillScaffold(SARA_PRINCIPAL, job.id);
    json(response, 201, {
      schemaVersion: 1,
      outcome: "sandbox_scaffold_verified",
      jobId: job.id,
      mutationId: scaffold.mutation.id,
      stage: scaffold.mutation.stage,
      candidateDigest: scaffold.mutation.candidateDigest,
      evidence: scaffold.evidence,
    });
    return;
  }
  json(response, 404, { error: "Not found." });
}

async function routeSaraRequest(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (await handlePublicRequest(request, response, url, kernel, options)) return;

  if (request.method === "GET" && url.pathname === "/api/bridge/catalog") {
    if (!options.readOnlyBridgeTokenSha256 || !authenticatedToken(request, options.readOnlyBridgeTokenSha256)) {
      bridgeUnauthorized(response);
      return;
    }
    json(response, 200, {
      schemaVersion: 1,
      access: "read_only",
      tools: listSaraTools({
        lunaConfigured: Boolean(options.runtimeStatus),
        ownerAssistantConfigured: Boolean(options.ownerAssistant),
      }),
      services: listRevenueServices(),
    });
    return;
  }

  if (url.pathname.startsWith("/api/bridge/actions/")) {
    if (!options.telegramBridgeTokenSha256 || !authenticatedToken(request, options.telegramBridgeTokenSha256)) {
      bridgeUnauthorized(response, "Telegram action bridge");
      return;
    }
    await handleTelegramBridgeRequest(request, response, url, kernel, options);
    return;
  }

  const token = authenticatedToken(request, options.ownerTokenSha256);
  if (!token) {
    unauthorized(response);
    return;
  }
  await handleAuthenticatedRequest(request, response, url, kernel, kernel.authenticateOwnerToken(token), options);
}

function handleRequestError(response: ServerResponse, error: unknown): void {
  if (error instanceof PolicyDeniedError) {
    json(response, error.decision.code === "EMERGENCY_STOP" ? 423 : 403, {
      error: error.decision.reason,
      code: error.decision.code,
    });
    return;
  }
  json(response, 400, { error: (error as Error).message });
}

export function createSaraServer(kernel: SaraKernel, options: ServerOptions): Server {
  return createServer(async (request, response) => {
    try {
      await routeSaraRequest(request, response, kernel, options);
    } catch (error) {
      handleRequestError(response, error);
    }
  });
}
