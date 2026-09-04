import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { SaraKernel } from "./kernel.ts";
import type { WorkerModelClient } from "./model-router.ts";
import type { PublicRepositoryEvidenceCollector } from "./public-repository-evidence.ts";
import type { RevenuePilotTestingInput } from "./revenue-pilot-testing.ts";
import { RevenuePilotTestingRuntime } from "./revenue-pilot-testing-runtime.ts";
import { createSaraServer } from "./server.ts";

const MAX_JSON_BYTES = 32 * 1024;
const TESTING_ROOT = "/api/revenue-pilot/testing";

export type RevenuePilotTestingServerOptions = Parameters<typeof createSaraServer>[1] & {
  revenuePilotTesting?: {
    modelClient: WorkerModelClient;
    repositoryEvidenceCollector: PublicRepositoryEvidenceCollector;
    monthlyBudgetUsd: number;
  };
};

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.end(JSON.stringify(value));
}

function ownerAuthenticated(request: IncomingMessage, expectedDigestHex: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  if (!token || token.length > 4_096) return false;
  const expected = Buffer.from(expectedDigestHex, "hex");
  const actual = createHash("sha256").update(token).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BYTES) throw new Error("Request body exceeds 32 KiB.");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error("A JSON request body is required.");
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be one JSON object.");
  }
  return parsed as Record<string, unknown>;
}

async function handleTestingRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: RevenuePilotTestingRuntime | null,
  ownerTokenSha256: string,
  pathname: string,
): Promise<void> {
  if (!ownerAuthenticated(request, ownerTokenSha256)) {
    response.setHeader("www-authenticate", "Bearer");
    writeJson(response, 401, { error: "Owner authentication required." });
    return;
  }
  if (!runtime) {
    writeJson(response, 503, { error: "No-price testing runtime is not configured." });
    return;
  }
  if (pathname === `${TESTING_ROOT}/jobs` && request.method === "POST") {
    try {
      const input = await readJsonObject(request) as RevenuePilotTestingInput;
      const job = await runtime.createJob(input);
      writeJson(response, 201, job);
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : "Testing job creation failed.",
      });
    }
    return;
  }
  writeJson(response, 404, { error: "Testing route not found." });
}

export function createSaraServerWithTesting(
  kernel: SaraKernel,
  options: RevenuePilotTestingServerOptions,
): ReturnType<typeof createSaraServer> {
  const { revenuePilotTesting, ...baseOptions } = options;
  const runtime = revenuePilotTesting ? new RevenuePilotTestingRuntime(kernel) : null;
  const server = createSaraServer(kernel, baseOptions);
  const delegates = server.listeners("request") as RequestListener[];
  if (delegates.length !== 1) {
    throw new Error("SARA testing seam requires exactly one base request listener.");
  }
  const [delegate] = delegates;
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      writeJson(response, 400, { error: "Malformed request URL." });
      return;
    }
    if (pathname === TESTING_ROOT || pathname.startsWith(`${TESTING_ROOT}/`)) {
      void handleTestingRequest(
        request,
        response,
        runtime,
        baseOptions.ownerTokenSha256,
        pathname,
      ).catch(() => {
        if (!response.headersSent) writeJson(response, 500, { error: "Testing request failed closed." });
        else response.destroy();
      });
      return;
    }
    delegate(request, response);
  });
  return server;
}
