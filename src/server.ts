import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DASHBOARD_HTML } from "./dashboard.ts";
import { compoundMandateApprovalTarget, validateCompoundMandateInput } from "./compounding.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import { SaraKernel } from "./kernel.ts";
import { PolicyDeniedError } from "./policy.ts";
import type {
  CompoundMandateInput,
  CompoundingOpportunity,
  MutationStage,
  SkillCandidateProposal,
} from "./types.ts";

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

export function createSaraServer(kernel: SaraKernel, options: { ownerTokenSha256: string }): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        });
        response.end(DASHBOARD_HTML);
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const status = await kernel.getStatus();
        json(response, 200, {
          ok: true,
          constitutionVerified: status.constitution.verified,
          emergencyStopped: status.emergencyStopped,
        });
        return;
      }

      const token = authenticatedToken(request, options.ownerTokenSha256);
      if (!token) {
        unauthorized(response);
        return;
      }
      const owner = kernel.authenticateOwnerToken(token);

      if (request.method === "GET" && url.pathname === "/api/status") {
        json(response, 200, await kernel.getStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/objectives") {
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
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/emergency-stop") {
        const body = await readJson(request);
        if (typeof body.active !== "boolean") throw new Error("active must be boolean.");
        await kernel.setEmergencyStop(owner, body.active);
        json(response, 200, { active: body.active });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/compound/decision") {
        const body = await readJson(request);
        const opportunity: CompoundingOpportunity = {
          objective: String(body.objective ?? ""),
          expectedOwnerValueUsd: Number(body.expectedOwnerValueUsd ?? 0),
          maximumCostUsd: Number(body.maximumCostUsd ?? 0),
          confidence: Number(body.confidence ?? Number.NaN),
          riskScore: Number(body.riskScore ?? Number.NaN),
          reserveCoverageMonths: Number(body.reserveCoverageMonths ?? Number.NaN),
          evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : [],
        };
        json(response, 201, await kernel.recordCompoundingDecision(owner, opportunity));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/compound/mandates") {
        const body = await readJson(request);
        const input = validateCompoundMandateInput({
          providerId: String(body.providerId ?? ""),
          operation: String(body.operation ?? ""),
          targetId: String(body.targetId ?? ""),
          maximumTotalUsd: Number(body.maximumTotalUsd ?? 0),
          maximumPerActionUsd: Number(body.maximumPerActionUsd ?? 0),
          expiresAt: String(body.expiresAt ?? ""),
          purpose: String(body.purpose ?? ""),
        } satisfies CompoundMandateInput);
        const targetId = compoundMandateApprovalTarget(input);
        const mandate = await kernel.createCompoundMandate(owner, input, {
          approvalId: randomUUID(),
          action: "money_transfer",
          targetId,
          approvedAt: new Date().toISOString(),
          ownerId: owner.id,
        });
        json(response, 201, mandate);
        return;
      }
      const revokeMandateMatch = url.pathname.match(/^\/api\/compound\/mandates\/([^/]+)\/revoke$/);
      if (request.method === "POST" && revokeMandateMatch) {
        const mandateId = decodeURIComponent(revokeMandateMatch[1]);
        const targetId = `compound-mandate-revoke:${mandateId}`;
        json(
          response,
          200,
          await kernel.revokeCompoundMandate(owner, mandateId, {
            approvalId: randomUUID(),
            action: "money_transfer",
            targetId,
            approvedAt: new Date().toISOString(),
            ownerId: owner.id,
          }),
        );
        return;
      }
      const handoffMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/handoff$/);
      if (request.method === "GET" && handoffMatch) {
        const jobId = decodeURIComponent(handoffMatch[1]);
        const status = await kernel.getStatus();
        const job = status.jobs.find((candidate) => candidate.id === jobId);
        if (!job) {
          json(response, 404, { error: "Job not found." });
          return;
        }
        json(response, 200, compileExecutorHandoff(job, status.constitution.digest));
        return;
      }
      const executeScaffoldMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/execute-scaffold$/);
      if (request.method === "POST" && executeScaffoldMatch) {
        const jobId = decodeURIComponent(executeScaffoldMatch[1]);
        json(response, 201, await kernel.executeDeterministicSkillScaffold(owner, jobId));
        return;
      }
      const selfBuildMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/self-build$/);
      if (request.method === "POST" && selfBuildMatch) {
        const body = await readJson(request);
        const proposal = body.proposal as SkillCandidateProposal;
        if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
          throw new Error("proposal must be a skill candidate object.");
        }
        const jobId = decodeURIComponent(selfBuildMatch[1]);
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
        return;
      }
      const promoteMatch = url.pathname.match(/^\/api\/mutations\/([^/]+)\/promote$/);
      if (request.method === "POST" && promoteMatch) {
        const body = await readJson(request);
        const stage = String(body.stage ?? "") as MutationStage;
        const mutationId = decodeURIComponent(promoteMatch[1]);
        const mutation = await kernel.promoteMutation(owner, mutationId, stage, {
          approvalId: randomUUID(),
          action: "production_promotion",
          targetId: `${mutationId}:${stage}`,
          approvedAt: new Date().toISOString(),
          ownerId: owner.id,
        });
        json(response, 200, mutation);
        return;
      }
      json(response, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        json(response, error.decision.code === "EMERGENCY_STOP" ? 423 : 403, {
          error: error.decision.reason,
          code: error.decision.code,
        });
        return;
      }
      json(response, 400, { error: (error as Error).message });
    }
  });
}
