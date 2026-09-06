import { authenticateCodingBenchmarkRelay, type CodingBenchmarkRelayIdentity } from "./coding-benchmark-github-relay.ts";
import { ownerCodingBenchmarkReadiness, launchOwnerCodingBenchmark } from "./coding-benchmark-owner.ts";
import { CodingBenchmarkNotReadyError } from "./coding-benchmark-readiness.ts";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DASHBOARD_HTML } from "./dashboard.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import { SaraKernel, SARA_PRINCIPAL } from "./kernel.ts";
import type { OwnerAssistant } from "./owner-assistant.ts";
import { PolicyDeniedError } from "./policy.ts";
import type { RevenuePilotInput } from "./revenue-pilot.ts";
import { normalizePublicGitHubRepository } from "./founding-pilot.ts";
import type { CommercialTerms } from "./commercial-terms.ts";
import { paymentClientSecretDigest, publicPaymentIntent } from "./revenue-payment.ts";
import { deliverySecretDigest } from "./revenue-delivery.ts";
import { verifyBaseUsdcPayment } from "./usdc-payment.ts";
import { sha256 } from "./canonical.ts";
import { listRevenueServices } from "./revenue-service-catalog.ts";
import { readRepositoryReadinessReportArtifact } from "./repository-readiness-report-artifacts.ts";
import { readRevenueNicoArtifact, readRevenueNicoPackage } from "./revenue-nico-artifacts.ts";
import { listSaraTools } from "./tool-registry.ts";
import type { NicoArtifactFormat, NicoArtifactIdentity, NicoOperator } from "./nico-operator.ts";
import type { CandidateProposal, MutationStage } from "./types.ts";
import { compileAuthorizedAutomatedReadinessDelivery } from "./authorized-readiness-delivery.ts";
import type { WorkerModelClient } from "./model-router.ts";
import type { ReparodynamicCodingMode } from "./coding-repair-types.ts";
import { createReusableCodingCandidateGenerator } from "./reusable-coding-candidate-generator.ts";
import { DurableCodingRepairMemory, codingRepairMemoryScope } from "./coding-repair-memory.ts";
import { persistCodingRepairReuse } from "./coding-repair-reuse-receipt.ts";
import { createLunaCodingRepairModel } from "./luna-coding-repair-model.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import { persistCodingRepairReceipt, persistCodingRepairRun } from "./coding-repair-receipt-store.ts";

const MAX_BODY_BYTES = 64 * 1024;

export type SaraRuntimeStatus = {
  worker: unknown;
  startupProof: unknown;
};

export type ServerOptions = {
  ownerTokenSha256: string;
  readOnlyBridgeTokenSha256?: string;
  telegramBridgeTokenSha256?: string;
  ownerAssistant?: OwnerAssistant;
  runtimeStatus?: () => Promise<SaraRuntimeStatus>;
  stateDirectory?: string;
  commerce?: {
    recipientAddress: string;
    rpcUrl: string;
    terms: CommercialTerms;
    publicOrigin: string;
    fetchImpl?: typeof fetch;
  };
  publicBaseUrl?: string;
  nicoOperator?: NicoOperator;
  reparodynamicCoding?: {
    mode: ReparodynamicCodingMode;
    modelClient: WorkerModelClient;
    stateDirectory: string;
  };
};

const publicCommerceAttempts = new Map<string, { count: number; resetAt: number }>();
const PUBLIC_COMMERCE_WINDOW_MS = 60 * 60 * 1_000;
const PUBLIC_COMMERCE_MAX_ATTEMPTS = 5;

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

function binary(response: ServerResponse, contentType: string, body: Uint8Array, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function unauthorized(response: ServerResponse): void {
  response.setHeader("www-authenticate", "Bearer");
  json(response, 401, { error: "Owner authentication required." });
}

function bridgeUnauthorized(response: ServerResponse, label = "Read-only bridge"): void {
  response.setHeader("www-authenticate", "Bearer");
  json(response, 401, { error: `${label} authentication required.` });
}

function commerceCors(request: IncomingMessage, response: ServerResponse, options: ServerOptions): boolean {
  const allowed = options.commerce?.publicOrigin;
  const origin = request.headers.origin;
  if (allowed && origin === allowed) {
    response.setHeader("access-control-allow-origin", allowed);
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("access-control-max-age", "600");
    response.setHeader("vary", "Origin");
  }
  return !origin || origin === allowed;
}

function paymentClientSecret(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new PolicyDeniedError(
      { allowed: false, code: "PAYMENT_INTENT_AUTHENTICATION_FAILED", reason: "Payment intent authentication failed." },
      "payment_intent_authentication",
    );
  }
  return header.slice("Bearer ".length);
}

function publicClientKey(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return String(request.headers["cf-connecting-ip"] ?? value ?? request.socket.remoteAddress ?? "unknown").trim().slice(0, 128);
}

function consumePublicCommerceAttempt(request: IncomingMessage, now = Date.now()): void {
  const key = publicClientKey(request);
  const current = publicCommerceAttempts.get(key);
  if (!current || current.resetAt <= now) {
    publicCommerceAttempts.set(key, { count: 1, resetAt: now + PUBLIC_COMMERCE_WINDOW_MS });
    return;
  }
  if (current.count >= PUBLIC_COMMERCE_MAX_ATTEMPTS) throw new Error("Too many payment-intent attempts; try again later.");
  current.count += 1;
}

async function verifiedPublicRepository(
  repositoryInput: string,
  fetchImpl: typeof fetch,
): Promise<{ repository: string; recentCommitDays: number }> {
  const repository = normalizePublicGitHubRepository(repositoryInput);
  if (!repository) throw new Error("Provide one canonical public GitHub repository URL.");
  const [, owner, name] = new URL(repository).pathname.split("/");
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "SARA-Revenue-Pilot/1" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || response.redirected) throw new Error("The repository is unavailable, redirected, or not public.");
  const body = await response.json() as { private?: unknown; archived?: unknown; full_name?: unknown; pushed_at?: unknown };
  if (body.private !== false || body.archived === true || typeof body.full_name !== "string") {
    throw new Error("The repository must be public, active, and directly addressable.");
  }
  if (body.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase()) {
    throw new Error("The repository identity changed or was transferred.");
  }
  const pushedAt = typeof body.pushed_at === "string" ? Date.parse(body.pushed_at) : Number.NaN;
  if (!Number.isFinite(pushedAt)) throw new Error("Repository activity recency is unavailable.");
  return { repository, recentCommitDays: Math.max(0, Math.floor((Date.now() - pushedAt) / 86_400_000)) };
}

async function handlePublicCommerce(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/public/revenue-pilot")) return false;
  if (!commerceCors(request, response, options)) {
    json(response, 403, { error: "Origin is not allowed." });
    return true;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/public/revenue-pilot/offer") {
    if (!options.commerce) {
      json(response, 503, { configured: false, error: "Owner payment and approved terms configuration is required." });
      return true;
    }
    json(response, 200, {
      configured: true,
      service: "Public Repository Readiness Snapshot",
      amount: 149,
      currency: "USDC",
      network: "Base",
      chainId: 8453,
      tokenContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      terms: options.commerce.terms,
    });
    return true;
  }
  if (!options.commerce) {
    json(response, 503, { error: "Owner payment and approved terms configuration is required." });
    return true;
  }
  const fetchImpl = options.commerce.fetchImpl ?? fetch;
  if (request.method === "POST" && url.pathname === "/api/public/revenue-pilot/intents") {
    consumePublicCommerceAttempt(request);
    const body = await readJson(request);
    if (body.termsAccepted !== true || body.termsDigest !== options.commerce.terms.digest) {
      throw new Error("Accept the exact current commercial terms before creating payment.");
    }
    if (body.repositoryOwnerPermissionConfirmed !== true) throw new Error("Repository authority confirmation is required.");
    if (body.requiresPrivateAccess === true || body.containsRegulatedOrPrivateData === true || body.requestsProductionChanges === true || body.requestsExploitValidation === true) {
      throw new Error("The requested scope is outside SARA's public readiness service.");
    }
    const customerReference = boundedText(body.customerReference, 3, 254, "customerReference").toLowerCase();
    const primaryGoal = String(body.primaryGoal ?? "release_readiness") as RevenuePilotInput["primaryGoal"];
    if (!new Set(["security_baseline", "release_readiness", "dependency_health"]).has(primaryGoal)) {
      throw new Error("Select one supported readiness goal.");
    }
    const repository = await verifiedPublicRepository(String(body.repoUrl ?? ""), fetchImpl);
    const opportunityId = `inbound-${randomUUID()}`;
    const job = await kernel.createRevenuePilotJob(SARA_PRINCIPAL, {
      opportunityId,
      sourceUrl: repository.repository,
      sourceAllowsAutomatedDiscovery: true,
      discoveredFromPublicSource: true,
      repoUrl: repository.repository,
      repositoryIsPublic: true,
      repositoryOwnerPermissionConfirmed: true,
      requiresPrivateAccess: false,
      containsRegulatedOrPrivateData: false,
      requestsProductionChanges: false,
      requestsExploitValidation: false,
      primaryGoal,
      customerBudgetUsd: 149,
      desiredTurnaroundDays: 3,
      recentCommitDays: repository.recentCommitDays,
      requestedServiceId: "public-repository-readiness-snapshot",
    });
    const clientSecret = randomBytes(32).toString("base64url");
    const intent = await kernel.createRevenuePaymentIntent(SARA_PRINCIPAL, {
      id: `pay_${randomUUID()}`,
      jobId: job.id,
      recipientAddress: options.commerce.recipientAddress,
      clientSecretDigest: paymentClientSecretDigest(clientSecret),
      customerReferenceDigest: sha256(customerReference),
      terms: options.commerce.terms,
    });
    json(response, 201, { ...publicPaymentIntent(intent), clientSecret });
    return true;
  }
  const statusMatch = url.pathname.match(/^\/api\/public\/revenue-pilot\/intents\/([^/]+)$/u);
  if (request.method === "GET" && statusMatch) {
    const accessSecret = paymentClientSecret(request);
    const intent = await kernel.inspectRevenuePaymentIntent(decodeURIComponent(statusMatch[1]!), accessSecret);
    const delivery = (await kernel.getStatus()).revenueDeliveries.find((candidate) =>
      candidate.jobId === intent.jobId && candidate.status !== "revoked"
    );
    let deliveryAccess: null | { status: string; expiresAt: string; downloadUrl: string; nicoDownloadUrl?: string } = null;
    if (delivery) {
      const base = options.publicBaseUrl ?? `https://${request.headers.host ?? "sara-operator-production.up.railway.app"}`;
      const download = new URL(`/api/public/revenue-pilot/deliveries/${encodeURIComponent(delivery.id)}`, base);
      download.searchParams.set("access", accessSecret);
      deliveryAccess = { status: delivery.status, expiresAt: delivery.expiresAt, downloadUrl: download.toString() };
      if (options.stateDirectory) {
        const nico = await readRevenueNicoArtifact(options.stateDirectory, intent.jobId);
        if (nico?.state === "package_ready") {
          const nicoDownload = new URL(`/api/public/revenue-pilot/deliveries/${encodeURIComponent(delivery.id)}/nico-package`, base);
          nicoDownload.searchParams.set("access", accessSecret);
          deliveryAccess.nicoDownloadUrl = nicoDownload.toString();
        }
      }
    }
    json(response, 200, { ...publicPaymentIntent(intent), delivery: deliveryAccess });
    return true;
  }
  const paymentMatch = url.pathname.match(/^\/api\/public\/revenue-pilot\/intents\/([^/]+)\/payment$/u);
  if (request.method === "POST" && paymentMatch) {
    const intentId = decodeURIComponent(paymentMatch[1]!);
    const secret = paymentClientSecret(request);
    const intent = await kernel.inspectRevenuePaymentIntent(intentId, secret);
    const body = await readJson(request);
    const payment = await verifyBaseUsdcPayment({
      transactionHash: String(body.transactionHash ?? ""),
      recipientAddress: intent.recipientAddress,
      rpcUrl: options.commerce.rpcUrl,
      fetchImpl,
    });
    json(response, 200, publicPaymentIntent(await kernel.confirmRevenuePayment(SARA_PRINCIPAL, intentId, secret, payment)));
    return true;
  }
  json(response, 404, { error: "Not found." });
  return true;
}

async function handlePublicDelivery(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<boolean> {
  const nicoMatch = url.pathname.match(/^\/api\/public\/revenue-pilot\/deliveries\/([^/]+)\/nico-package$/u);
  if (request.method === "GET" && nicoMatch) {
    if (!options.stateDirectory) {
      json(response, 503, { error: "Private report storage is not configured." });
      return true;
    }
    const secret = url.searchParams.get("access") ?? "";
    const accessed = await kernel.accessRevenueDelivery(decodeURIComponent(nicoMatch[1]!), secret);
    const report = await readRepositoryReadinessReportArtifact({ stateDirectory: options.stateDirectory, jobId: accessed.job.id });
    const packaged = await readRevenueNicoPackage(options.stateDirectory, accessed.job.id);
    if (packaged.artifact.commitSha !== report.report.immutableCommitSha) throw new Error("NICO delivery commit does not match the readiness report.");
    response.writeHead(200, {
      "content-type": packaged.artifact.contentType ?? "application/zip",
      "content-disposition": `attachment; filename="nico-authorized-${packaged.artifact.runId}.zip"`,
      "content-length": String(packaged.body.byteLength),
      "cache-control": "private, no-store, max-age=0",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-nico-certified-package-sha256": packaged.artifact.packageDigest!,
      "x-nico-human-reviewed": "false",
      "x-nico-authorization-mode": "automated_policy",
    });
    response.end(packaged.body);
    return true;
  }
  const match = url.pathname.match(/^\/api\/public\/revenue-pilot\/deliveries\/([^/]+)$/u);
  if (request.method !== "GET" || !match) return false;
  if (!options.stateDirectory) {
    json(response, 503, { error: "Private report storage is not configured." });
    return true;
  }
  const secret = url.searchParams.get("access") ?? "";
  const accessed = await kernel.accessRevenueDelivery(decodeURIComponent(match[1]!), secret);
  const artifact = await readRepositoryReadinessReportArtifact({
    stateDirectory: options.stateDirectory,
    jobId: accessed.job.id,
  });
  if (artifact.reportDigest !== accessed.delivery.reportDigest) throw new Error("Delivery report integrity check failed.");
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="sara-readiness-${accessed.job.id}.json"`,
    "cache-control": "private, no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(compileAuthorizedAutomatedReadinessDelivery(artifact, accessed.delivery)));
  return true;
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
    const now = Date.now();
    const mandate = status.standingMandate;
    const standingMandateActive = Boolean(
      mandate
      && !mandate.revokedAt
      && Date.parse(mandate.startsAt) <= now
      && now < Date.parse(mandate.expiresAt),
    );
    json(response, 200, {
      ok: true,
      constitutionVerified: status.constitution.verified,
      emergencyStopped: status.emergencyStopped,
      workerConfigured: Boolean(options.runtimeStatus),
      commerceConfigured: Boolean(options.commerce),
      nicoConfigured: Boolean(options.nicoOperator),
      autonomousPaidFulfillment: Boolean(
        standingMandateActive
        && mandate?.allowedActions.includes("fixed_service_fulfillment")
        && mandate.allowedActions.includes("verified_report_delivery"),
      ),
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
  options: ServerOptions,
): Promise<void> {
  const body = await readJson(request);
  const proposal = body.proposal as CandidateProposal;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("proposal must be a skill or program candidate object.");
  }
  const baseGenerator = {
    id: "owner-supplied-zero-cost-proposal",
    external: false,
    maximumCostUsd: 0,
    async generate() {
      return structuredClone(proposal);
    },
  };
  const runId = randomUUID();
  const generator = options.reparodynamicCoding && proposal.candidateKind === "typescript_program"
    ? createReusableCodingCandidateGenerator({
      base: baseGenerator,
      memory: new DurableCodingRepairMemory(options.reparodynamicCoding.stateDirectory),
      scope: (context) => codingRepairMemoryScope(owner.id, context),
      onReuse: (summary) => persistCodingRepairReuse({ stateDirectory: options.reparodynamicCoding!.stateDirectory, runId, summary }),
      mode: options.reparodynamicCoding.mode,
      model: (context) => createLunaCodingRepairModel({
        client: options.reparodynamicCoding!.modelClient,
        context,
      }),
      verify: (candidate, context) => verifyGenomeLabProgramCandidate({
        candidate,
        objective: context.objective,
        acceptanceCriteria: context.acceptanceCriteria,
        constitutionDigest: context.constitutionDigest,
      }),
      onReceipt: (receipt) => persistCodingRepairReceipt({
        stateDirectory: options.reparodynamicCoding!.stateDirectory,
        runId,
        receipt,
      }),
      onRun: (run) => persistCodingRepairRun({
        stateDirectory: options.reparodynamicCoding!.stateDirectory,
        runId,
        run,
      }),
    })
    : baseGenerator;
  json(
    response,
    201,
    await kernel.runSelfBuildCycle(owner, jobId, generator),
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

async function handleOwnerCatalogRead(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/status") {
    const status = await kernel.getStatus();
    json(response, 200, {
      ...status,
      runtime: options.runtimeStatus ? await options.runtimeStatus() : null,
      commerce: options.commerce ? {
        configured: true,
        provider: "base-usdc-direct",
        network: "Base",
        currency: "USDC",
        amount: 149,
        recipientAddress: options.commerce.recipientAddress,
        termsVersion: options.commerce.terms.version,
        termsDigest: options.commerce.terms.digest,
      } : { configured: false },
      automation: {
        mandateEvaluator: "available",
        businessIncubator: "available",
        publicOpportunityScout: "scheduled_zero_cost",
        connectors: {
          email: "not_connected",
          calendar: "not_connected",
          whatsapp: "not_connected",
        },
        marketplaceApplications: "disabled",
      },
    });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/tools") {
    json(response, 200, listSaraTools({
      lunaConfigured: Boolean(options.runtimeStatus),
      ownerAssistantConfigured: Boolean(options.ownerAssistant),
      nicoConfigured: Boolean(options.nicoOperator),
    }));
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/operational-skills") {
    const rawQuery = url.searchParams.get("query")?.trim();
    const query = rawQuery ? boundedText(rawQuery, 2, 1_000, "query") : null;
    const catalog = await kernel.inspectOperationalSkills();
    json(response, 200, {
      ...catalog,
      routes: query ? await kernel.routeOperationalSkillContext(query) : [],
    });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/revenue-pilot/services") {
    json(response, 200, listRevenueServices());
    return true;
  }
  return false;
}

async function handleOwnerReportRead(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  options: ServerOptions,
): Promise<boolean> {
  const revenueReportMatch = url.pathname.match(/^\/api\/revenue-pilot\/jobs\/([^/]+)\/report$/);
  if (request.method !== "GET" || !revenueReportMatch) return false;
  if (!options.stateDirectory) {
    json(response, 503, { error: "Private report storage is not configured." });
    return true;
  }
  const jobId = decodeURIComponent(revenueReportMatch[1]);
  const job = (await kernel.getStatus()).revenuePilotJobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    json(response, 404, { error: "Revenue pilot job not found." });
    return true;
  }
  if (!["owner_review", "delivery_ready", "delivered"].includes(job.status)) {
    json(response, 409, { error: "The report has not passed its owner-review gate." });
    return true;
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
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    json(response, 404, { error: "Repository-readiness report not found." });
  }
  return true;
}

async function handleOwnerRevenueWrite(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  owner: OwnerSession,
  options: ServerOptions,
): Promise<boolean> {
  if (request.method === "POST" && url.pathname === "/api/objectives") {
    await handleObjectives(request, response, kernel, owner);
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/emergency-stop") {
    await handleEmergencyStop(request, response, kernel, owner);
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/autonomy/standing-mandate") {
    const now = new Date();
    const id = `exception-only-${now.toISOString().slice(0, 10)}`;
    const targetId = `standing-mandate:${id}`;
    json(response, 201, await kernel.activateStandingMandate(owner, {
      id,
      allowedActions: [
        "opportunity_research",
        "business_candidate_development",
        "inbound_customer_reply",
        "calendar_scheduling",
        "bounded_outreach",
        "fixed_service_fulfillment",
        "verified_report_delivery",
      ],
      allowedChannels: ["public_web", "email", "calendar", "approved_api"],
      allowedServiceIds: ["public-repository-readiness-snapshot"],
      maximumCostPerActionUsd: 3,
      maximumDailyActions: 10,
      maximumConcurrentActions: 1,
      startsAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      ownerId: owner.id,
    }, {
      approvalId: randomUUID(),
      action: "required_owner_approval_change",
      targetId,
      approvedAt: now.toISOString(),
      ownerId: owner.id,
    }));
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/autonomy/standing-mandate/revoke") {
    const body = await readJson(request);
    json(response, 200, await kernel.revokeStandingMandate(
      owner,
      boundedText(body.mandateId, 3, 128, "mandateId"),
      boundedText(body.reason ?? "Owner revoked the standing mandate.", 3, 300, "reason"),
    ));
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/revenue-pilot/opportunities") {
    await handleRevenuePilotOpportunity(request, response, kernel, owner);
    return true;
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
    return true;
  }
  const confirmedPaymentApprovalMatch = url.pathname.match(/^\/api\/revenue-pilot\/jobs\/([^/]+)\/approve-fulfillment$/u);
  if (request.method === "POST" && confirmedPaymentApprovalMatch) {
    const jobId = decodeURIComponent(confirmedPaymentApprovalMatch[1]!);
    const body = await readJson(request);
    const targetId = `revenue-pilot:${jobId}:fulfillment`;
    json(response, 200, await kernel.authorizeRevenuePilotFromConfirmedPayment(
      owner,
      jobId,
      boundedText(body.paymentIntentId, 8, 128, "paymentIntentId"),
      {
        approvalId: randomUUID(),
        action: "contract_commitment",
        targetId,
        approvedAt: new Date().toISOString(),
        ownerId: owner.id,
      },
    ));
    return true;
  }
  const deliveryApprovalMatch = url.pathname.match(/^\/api\/revenue-pilot\/jobs\/([^/]+)\/approve-delivery$/u);
  if (request.method === "POST" && deliveryApprovalMatch) {
    if (!options.stateDirectory) throw new Error("Private report storage is not configured.");
    const jobId = decodeURIComponent(deliveryApprovalMatch[1]!);
    const body = await readJson(request);
    if (body.confirmDelivery !== true) throw new Error("Explicit delivery confirmation is required.");
    const artifact = await readRepositoryReadinessReportArtifact({ stateDirectory: options.stateDirectory, jobId });
    const accessSecret = randomBytes(32).toString("base64url");
    const deliveryId = `delivery_${randomUUID()}`;
    const targetId = `revenue-pilot:${jobId}:delivery`;
    const result = await kernel.authorizeRevenuePilotDelivery(owner, {
      deliveryId,
      jobId,
      reportDigest: artifact.reportDigest,
      accessSecretDigest: deliverySecretDigest(accessSecret),
      lifetimeHours: 72,
      maximumDownloads: 3,
    }, {
      approvalId: randomUUID(),
      action: "contract_commitment",
      targetId,
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });
    const base = options.publicBaseUrl ?? `https://${request.headers.host ?? "sara-operator-production.up.railway.app"}`;
    const download = new URL(`/api/public/revenue-pilot/deliveries/${encodeURIComponent(deliveryId)}`, base);
    download.searchParams.set("access", accessSecret);
    json(response, 200, {
      job: result.job,
      delivery: {
        id: result.delivery.id,
        status: result.delivery.status,
        expiresAt: result.delivery.expiresAt,
        maximumDownloads: result.delivery.maximumDownloads,
        downloadUrl: download.toString(),
      },
    });
    return true;
  }
  const deliveryRevocationMatch = url.pathname.match(/^\/api\/revenue-pilot\/deliveries\/([^/]+)\/revoke$/u);
  if (request.method === "POST" && deliveryRevocationMatch) {
    json(response, 200, await kernel.revokeRevenueDelivery(owner, decodeURIComponent(deliveryRevocationMatch[1]!)));
    return true;
  }
  return false;
}

async function handleOwnerDevelopmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  owner: OwnerSession,
  options: ServerOptions,
): Promise<boolean> {
  const handoffMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/handoff$/);
  if (request.method === "GET" && handoffMatch) {
    await handleJobHandoff(response, kernel, decodeURIComponent(handoffMatch[1]));
    return true;
  }
  const executeScaffoldMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/execute-scaffold$/);
  if (request.method === "POST" && executeScaffoldMatch) {
    json(response, 201, await kernel.executeDeterministicSkillScaffold(owner, decodeURIComponent(executeScaffoldMatch[1])));
    return true;
  }
  const selfBuildMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/self-build$/);
  if (request.method === "POST" && selfBuildMatch) {
    await handleSelfBuild(request, response, kernel, owner, decodeURIComponent(selfBuildMatch[1]), options);
    return true;
  }
  const promoteMatch = url.pathname.match(/^\/api\/mutations\/([^/]+)\/promote$/);
  if (request.method === "POST" && promoteMatch) {
    await handleMutationPromotion(request, response, kernel, owner, decodeURIComponent(promoteMatch[1]));
    return true;
  }
  return false;
}

async function handleOwnerNicoOperation(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  owner: OwnerSession,
  options: ServerOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/nico/")) return false;
  const operator = options.nicoOperator;
  if (!operator) {
    json(response, 503, { error: "NICO operator is not configured." });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/nico/runs") {
    const body = await readJson(request);
    const id = typeof body.runId === "string" && body.runId.trim()
      ? body.runId.trim()
      : `comprun_${randomBytes(16).toString("hex")}`;
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:create`, "external_write");
    json(response, 202, await operator.createRun({
      runId: id,
      repository: boundedText(body.repository, 3, 240, "repository"),
      commitSha: boundedText(body.commitSha, 40, 40, "commitSha"),
      clientName: boundedText(body.clientName, 3, 160, "clientName"),
      projectName: boundedText(body.projectName, 3, 160, "projectName"),
      authorizedBy: boundedText(body.authorizedBy, 3, 160, "authorizedBy"),
      authorizationScope: boundedText(body.authorizationScope, 8, 1_000, "authorizationScope"),
      primaryTechnicalContact: boundedText(body.primaryTechnicalContact, 3, 160, "primaryTechnicalContact"),
    }));
    return true;
  }
  const statusMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})$/u);
  if (request.method === "GET" && statusMatch) {
    const id = statusMatch[1]!;
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:status`, "external_read");
    json(response, 200, await operator.getRun(id));
    return true;
  }
  const continueMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/continue$/u);
  if (request.method === "POST" && continueMatch) {
    const id = continueMatch[1]!;
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:continue`, "external_write");
    json(response, 200, await operator.continueRun(id));
    return true;
  }
  const reportMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/report\/(markdown|html|json|pdf)$/u);
  if (request.method === "GET" && reportMatch) {
    const id = reportMatch[1]!;
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:report:${reportMatch[2]}`, "external_read");
    const artifact = await operator.getReport(id, reportMatch[2] as NicoArtifactFormat);
    binary(response, artifact.contentType, artifact.body);
    return true;
  }
  const queueMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/review-queue$/u);
  if (request.method === "POST" && queueMatch) {
    const id = queueMatch[1]!;
    const body = await readJson(request);
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:review-queue`, "external_read");
    const override = body.nicoPassword === undefined ? undefined : boundedText(body.nicoPassword, 8, 512, "nicoPassword");
    json(response, 200, await operator.getReviewQueue(id, override));
    return true;
  }
  const finalizeMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/finalize$/u);
  if (request.method === "POST" && finalizeMatch) {
    const id = finalizeMatch[1]!;
    const body = await readJson(request);
    if (body.confirmExactReport !== true) throw new Error("Explicit exact-report confirmation is required.");
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:finalize`, "external_write");
    const override = body.nicoPassword === undefined ? undefined : boundedText(body.nicoPassword, 8, 512, "nicoPassword");
    json(response, 200, await operator.finalizeExactDraft(id, override, {
      reviewer: boundedText(body.reviewer, 3, 160, "reviewer"),
      reviewerRole: boundedText(body.reviewerRole, 3, 160, "reviewerRole"),
      decisionReason: boundedText(body.decisionReason, 8, 1_000, "decisionReason"),
      expectedArtifactIdentity: body.expectedArtifactIdentity as NicoArtifactIdentity,
      confirmExactReport: true,
    }));
    return true;
  }
  const deliveryMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/authorize-delivery$/u);
  if (request.method === "POST" && deliveryMatch) {
    const id = deliveryMatch[1]!;
    const body = await readJson(request);
    if (body.confirmDelivery !== true) throw new Error("Explicit client-delivery confirmation is required.");
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:authorize-delivery`, "external_write");
    const override = body.nicoPassword === undefined ? undefined : boundedText(body.nicoPassword, 8, 512, "nicoPassword");
    json(response, 200, await operator.authorizeDelivery(id, override, {
      authorizer: boundedText(body.authorizer, 3, 160, "authorizer"),
      authorizerRole: boundedText(body.authorizerRole, 3, 160, "authorizerRole"),
      authorizationReason: boundedText(body.authorizationReason, 8, 1_000, "authorizationReason"),
      expectedArtifactIdentity: body.expectedArtifactIdentity as NicoArtifactIdentity,
      confirmDelivery: true,
    }));
    return true;
  }
  const packageMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/approved-package$/u);
  if (request.method === "POST" && packageMatch) {
    const id = packageMatch[1]!;
    const body = await readJson(request);
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:approved-package`, "external_read");
    const override = body.nicoPassword === undefined ? undefined : boundedText(body.nicoPassword, 8, 512, "nicoPassword");
    const artifact = await operator.getApprovedDeliveryPackage(id, override);
    binary(response, artifact.contentType, artifact.body, artifact.digest ? { "x-nico-certified-package-sha256": artifact.digest } : {});
    return true;
  }
  const automatedPackageMatch = url.pathname.match(/^\/api\/nico\/runs\/(comprun_[0-9a-f]{32})\/authorize-automated-delivery$/u);
  if (request.method === "POST" && automatedPackageMatch) {
    const id = automatedPackageMatch[1]!;
    const body = await readJson(request);
    if (body.confirmExactArtifact !== true || body.confirmAutomatedDisclosure !== true) {
      throw new Error("Exact-artifact and automated-disclosure confirmations are required.");
    }
    await kernel.authorizeOwnerNicoOperation(owner, `nico:${id}:authorize-automated-delivery`, "external_write");
    const override = body.nicoPassword === undefined ? undefined : boundedText(body.nicoPassword, 8, 512, "nicoPassword");
    const artifact = await operator.getAutomatedDeliveryPackage(id, override, {
      expectedArtifactIdentity: body.expectedArtifactIdentity as NicoArtifactIdentity,
      confirmExactArtifact: true,
      confirmAutomatedDisclosure: true,
    });
    binary(response, artifact.contentType, artifact.body, artifact.digest ? { "x-nico-certified-package-sha256": artifact.digest } : {});
    return true;
  }
  json(response, 404, { error: "Not found." });
  return true;
}

async function handleAuthenticatedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  owner: OwnerSession,
  options: ServerOptions,
): Promise<void> {
  if (await handleOwnerCatalogRead(request, response, url, kernel, options)) return;
  if (await handleOwnerNicoOperation(request, response, url, kernel, owner, options)) return;
  if (await handleOwnerReportRead(request, response, url, kernel, options)) return;
  if (await handleOwnerRevenueWrite(request, response, url, kernel, owner, options)) return;
  if (await handleOwnerDevelopmentRequest(request, response, url, kernel, owner, options)) return;
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
      standingMandate: status.standingMandate,
      prohibitedActions: [
        "unmandated or platform-prohibited outreach",
        "unapproved applications",
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
  if (request.method === "POST" && url.pathname === "/api/bridge/actions/business-candidates") {
    const body = await readJson(request);
    const publicEvidenceUrls = Array.isArray(body.publicEvidenceUrls)
      ? body.publicEvidenceUrls.map((value) => boundedText(value, 12, 2_048, "publicEvidenceUrl"))
      : [];
    json(response, 201, await kernel.createBusinessCandidate(SARA_PRINCIPAL, {
      id: boundedText(body.id, 3, 128, "id"),
      name: boundedText(body.name, 3, 120, "name"),
      customerProblem: boundedText(body.customerProblem, 12, 1_000, "customerProblem"),
      serviceId: boundedText(body.serviceId, 3, 128, "serviceId"),
      publicEvidenceUrls,
      expectedPriceUsd: Number(body.expectedPriceUsd),
      estimatedDeliveryCostUsd: Number(body.estimatedDeliveryCostUsd),
    }));
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
  if (await handlePublicDelivery(request, response, url, kernel, options)) return;
  if (await handlePublicCommerce(request, response, url, kernel, options)) return;

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
        nicoConfigured: Boolean(options.nicoOperator),
      }),
      services: listRevenueServices(),
      operationalSkills: await kernel.inspectOperationalSkills(),
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

  let token = authenticatedToken(request, options.ownerTokenSha256);
  let launcher: CodingBenchmarkRelayIdentity | null = null;
  // This explicitly configured delegation is restricted to the existing benchmark
  // routes. It cannot authenticate ordinary owner, bridge or emergency-stop APIs.
  const relayRoute = !url.search && ((request.method === "GET" && url.pathname === "/api/coding-benchmark/readiness")
    || (request.method === "POST" && url.pathname === "/api/coding-benchmark/run"));
  if (!token && relayRoute && request.headers.authorization?.startsWith("Bearer ")) {
    launcher = await authenticateCodingBenchmarkRelay(request.headers.authorization.slice(7), process.env);
    const configuredOwner = process.env.SARA_OWNER_TOKEN?.trim();
    if (launcher && configuredOwner && /^[a-f0-9]{64}$/iu.test(options.ownerTokenSha256)
      && timingSafeEqual(tokenDigest(configuredOwner), Buffer.from(options.ownerTokenSha256, "hex"))) {
      token = configuredOwner;
    }
  }
  if (!token) {
    unauthorized(response);
    return;
  }
  if (url.pathname === "/api/coding-benchmark/readiness" || url.pathname === "/api/coding-benchmark/run") {
    // Preserve both existing authentication layers, even if server and kernel
    // configuration disagree. Never expose credentials in response/evidence.
    kernel.authenticateOwnerToken(token);
    const status = await kernel.getStatus();
    const environment = { ...process.env, SARA_OWNER_TOKEN: token, SARA_OWNER_TOKEN_SHA256: options.ownerTokenSha256 };
    const input = { environment, stateDirectory: options.stateDirectory,
      constitutionVerified: status.constitution.verified, emergencyStopped: status.emergencyStopped,
      ...(launcher ? { launcher } : {}) };
    if (request.method === "GET" && url.pathname.endsWith("/readiness")) {
      json(response, 200, await ownerCodingBenchmarkReadiness(input));
    } else if (request.method === "POST" && url.pathname.endsWith("/run")) {
      json(response, 202, await launchOwnerCodingBenchmark({ ...input, body: await readJson(request) }));
    } else {
      json(response, 405, { error: "Method not allowed." });
    }
    return;
  }
  await handleAuthenticatedRequest(request, response, url, kernel, kernel.authenticateOwnerToken(token), options);
}

function handleRequestError(response: ServerResponse, error: unknown): void {
  if (error instanceof CodingBenchmarkNotReadyError) {
    json(response, 423, { error: "Coding benchmark is not cleared for execution.", code: error.code });
    return;
  }
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
