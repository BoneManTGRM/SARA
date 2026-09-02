import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DASHBOARD_HTML } from "./dashboard.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import { compileDigitalWorkHandoff, type DigitalJobKind, type DigitalJobSafetyDeclaration, type DigitalWorkResult } from "./digital-work.ts";
import { SaraKernel } from "./kernel.ts";
import { PolicyDeniedError } from "./policy.ts";
import type { MutationStage, SkillCandidateProposal } from "./types.ts";

const MAX_BODY_BYTES = 64 * 1024;

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

type OwnerSession = ReturnType<SaraKernel["authenticateOwnerToken"]>;

async function handlePublicRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
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
  const proposal = body.proposal as SkillCandidateProposal;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("proposal must be a skill candidate object.");
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

async function handleCreateDigitalJob(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
): Promise<void> {
  const body = await readJson(request);
  const safety = body.safety && typeof body.safety === "object" && !Array.isArray(body.safety)
    ? body.safety as DigitalJobSafetyDeclaration
    : {} as DigitalJobSafetyDeclaration;
  const job = await kernel.createDigitalWorkJob(owner, {
    kind: String(body.kind ?? "") as DigitalJobKind,
    objective: String(body.objective ?? ""),
    ...(typeof body.sourceUrl === "string" ? { sourceUrl: body.sourceUrl } : {}),
    ...(typeof body.buyerReference === "string" ? { buyerReference: body.buyerReference } : {}),
    authorizedScope: String(body.authorizedScope ?? ""),
    expectedDeliverables: Array.isArray(body.expectedDeliverables) ? body.expectedDeliverables.map(String) : [],
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.map(String) : [],
    acceptanceCriteriaAutomatable: body.acceptanceCriteriaAutomatable === true,
    maximumBudgetUsd: Number(body.maximumBudgetUsd ?? Number.NaN),
    ...(body.offeredCompensationUsd === undefined ? {} : { offeredCompensationUsd: Number(body.offeredCompensationUsd) }),
    safety,
  });
  json(response, 201, job);
}

async function handleDigitalJobAction(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
  jobId: string,
  action: string,
): Promise<void> {
  if (action === "authorize") {
    json(response, 200, await kernel.authorizeDigitalWorkJob(owner, jobId, {
      approvalId: randomUUID(),
      action: "contract_commitment",
      targetId: `digital-job:${jobId}:accept`,
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    }));
    return;
  }
  if (action === "handoff" && request.method === "GET") {
    const job = (await kernel.getStatus()).digitalJobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      json(response, 404, { error: "Digital job not found." });
      return;
    }
    json(response, 200, compileDigitalWorkHandoff(job, kernel.constitutionDigest));
    return;
  }
  const body = await readJson(request);
  if (action === "start") {
    json(response, 200, await kernel.startDigitalWorkJob(
      owner,
      jobId,
      String(body.executorId ?? ""),
      Number(body.maximumCostUsd ?? Number.NaN),
    ));
    return;
  }
  if (action === "complete") {
    json(response, 200, await kernel.completeDigitalWorkJob(owner, jobId, body.result as DigitalWorkResult));
    return;
  }
  if (action === "human-review") {
    json(response, 200, await kernel.recordDigitalWorkHumanReview(owner, jobId, {
      reviewer: String(body.reviewer ?? "") as "owner" | "qualified_human",
      decision: String(body.decision ?? "") as "approved" | "rejected",
      evidenceDigest: String(body.evidenceDigest ?? ""),
    }));
    return;
  }
  if (action === "authorize-delivery") {
    const job = (await kernel.getStatus()).digitalJobs.find((candidate) => candidate.id === jobId);
    if (!job?.result) {
      json(response, 409, { error: "Digital job is not ready for delivery authorization." });
      return;
    }
    json(response, 200, await kernel.authorizeDigitalWorkDelivery(owner, jobId, {
      approvalId: randomUUID(),
      action: "contract_commitment",
      targetId: `digital-job:${jobId}:deliver:${job.result.artifactDigest}`,
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    }));
    return;
  }
  if (action === "record-delivery") {
    json(response, 200, await kernel.recordDigitalWorkDelivery(owner, jobId, String(body.evidenceDigest ?? "")));
    return;
  }
  if (action === "record-payment") {
    json(response, 200, await kernel.recordDigitalWorkPayment(
      owner,
      jobId,
      Number(body.amountUsd ?? Number.NaN),
      String(body.evidenceDigest ?? ""),
    ));
    return;
  }
  json(response, 404, { error: "Unknown digital job action." });
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

async function handleSkillCapabilityBinding(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
  skillId: string,
): Promise<void> {
  const body = await readJson(request);
  json(response, 200, await kernel.bindSkillCapability(
    owner,
    skillId,
    String(body.capabilityId ?? ""),
    String(body.capabilityName ?? ""),
  ));
}

async function handleSkillExecution(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  owner: OwnerSession,
  capabilityId: string,
): Promise<void> {
  const body = await readJson(request);
  if (!("input" in body)) throw new Error("Skill execution requires a JSON input field.");
  json(response, 200, await kernel.executeRegisteredSkill(owner, capabilityId, body.input));
}

async function handleAuthenticatedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  kernel: SaraKernel,
  owner: OwnerSession,
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/status") {
    json(response, 200, await kernel.getStatus());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/objectives") {
    await handleObjectives(request, response, kernel, owner);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/digital-jobs") {
    await handleCreateDigitalJob(request, response, kernel, owner);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/emergency-stop") {
    await handleEmergencyStop(request, response, kernel, owner);
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
  const digitalJobMatch = url.pathname.match(/^\/api\/digital-jobs\/([^/]+)\/(authorize|handoff|start|complete|human-review|authorize-delivery|record-delivery|record-payment)$/);
  if (digitalJobMatch && (request.method === "POST" || (request.method === "GET" && digitalJobMatch[2] === "handoff"))) {
    await handleDigitalJobAction(
      request,
      response,
      kernel,
      owner,
      decodeURIComponent(digitalJobMatch[1]),
      digitalJobMatch[2],
    );
    return;
  }
  const bindSkillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/bind-capability$/);
  if (request.method === "POST" && bindSkillMatch) {
    await handleSkillCapabilityBinding(request, response, kernel, owner, decodeURIComponent(bindSkillMatch[1]));
    return;
  }
  const executeSkillMatch = url.pathname.match(/^\/api\/capabilities\/([^/]+)\/execute$/);
  if (request.method === "POST" && executeSkillMatch) {
    await handleSkillExecution(request, response, kernel, owner, decodeURIComponent(executeSkillMatch[1]));
    return;
  }
  const promoteMatch = url.pathname.match(/^\/api\/mutations\/([^/]+)\/promote$/);
  if (request.method === "POST" && promoteMatch) {
    await handleMutationPromotion(request, response, kernel, owner, decodeURIComponent(promoteMatch[1]));
    return;
  }
  json(response, 404, { error: "Not found." });
}

async function routeSaraRequest(
  request: IncomingMessage,
  response: ServerResponse,
  kernel: SaraKernel,
  ownerTokenSha256: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (await handlePublicRequest(request, response, url, kernel)) return;

  const token = authenticatedToken(request, ownerTokenSha256);
  if (!token) {
    unauthorized(response);
    return;
  }
  await handleAuthenticatedRequest(request, response, url, kernel, kernel.authenticateOwnerToken(token));
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

export function createSaraServer(kernel: SaraKernel, options: { ownerTokenSha256: string }): Server {
  return createServer(async (request, response) => {
    try {
      await routeSaraRequest(request, response, kernel, options.ownerTokenSha256);
    } catch (error) {
      handleRequestError(response, error);
    }
  });
}
