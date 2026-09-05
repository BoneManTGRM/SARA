import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { SaraKernel } from "./kernel.ts";
import type { WorkerModelClient } from "./model-router.ts";
import type { PublicRepositoryEvidenceCollector } from "./public-repository-evidence.ts";
import type { RevenuePilotTestingInput } from "./revenue-pilot-testing.ts";
import {
  RevenuePilotTestingConflictError,
  RevenuePilotTestingInputError,
  RevenuePilotTestingNotFoundError,
  RevenuePilotTestingRuntime,
} from "./revenue-pilot-testing-runtime.ts";
import { createSaraServer } from "./server.ts";

const MAX_JSON_BYTES = 32 * 1024;
const TESTING_ROOT = "/api/revenue-pilot/testing";
const SAFE_ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type BaseSaraServerOptions = Parameters<typeof createSaraServer>[1];
type TestingJobAction = "authorize" | "run" | "report";
type TestingJobRoute = { jobId: string; action: TestingJobAction | null };

export type RevenuePilotTestingServerOptions = Omit<BaseSaraServerOptions, "stateDirectory"> & {
  stateDirectory: string;
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
    if (bytes > MAX_JSON_BYTES) throw new RevenuePilotTestingInputError("Request body exceeds 32 KiB.");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new RevenuePilotTestingInputError("A JSON request body is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RevenuePilotTestingInputError("Request body must contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RevenuePilotTestingInputError("Request body must be one JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function testingJobRoute(pathname: string): TestingJobRoute | null {
  const match = pathname.match(
    new RegExp(`^${TESTING_ROOT}/jobs/([^/]+)(?:/(authorize|run|report))?$`, "u"),
  );
  if (!match) return null;
  const encodedJobId = match[1];
  if (!encodedJobId) return null;
  let jobId: string;
  try {
    jobId = decodeURIComponent(encodedJobId);
  } catch {
    return null;
  }
  if (!SAFE_ROUTE_ID.test(jobId)) return null;
  const actionText = match[2];
  const action: TestingJobAction | null =
    actionText === "authorize" || actionText === "run" || actionText === "report"
      ? actionText
      : null;
  return { jobId, action };
}

function testingAuthorizationId(body: Record<string, unknown>): string {
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "confirmTesting" ||
    keys[1] !== "testingAuthorizationId"
  ) {
    throw new RevenuePilotTestingInputError(
      "Testing authorization requires exactly confirmTesting and testingAuthorizationId.",
    );
  }
  if (body.confirmTesting !== true) {
    throw new RevenuePilotTestingInputError("confirmTesting must be exactly true.");
  }
  if (typeof body.testingAuthorizationId !== "string") {
    throw new RevenuePilotTestingInputError("testingAuthorizationId must be a string.");
  }
  return body.testingAuthorizationId;
}

function writeTestingError(response: ServerResponse, error: unknown): void {
  if (error instanceof RevenuePilotTestingNotFoundError) {
    writeJson(response, 404, { error: error.message });
    return;
  }
  if (error instanceof RevenuePilotTestingConflictError) {
    writeJson(response, 409, { error: error.message });
    return;
  }
  if (error instanceof RevenuePilotTestingInputError) {
    writeJson(response, 400, { error: error.message });
    return;
  }
  writeJson(response, 500, { error: "No-price testing request failed closed." });
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
      writeJson(response, 201, await runtime.createJob(input));
    } catch (error) {
      writeTestingError(response, error);
    }
    return;
  }
  if (pathname === `${TESTING_ROOT}/jobs` && request.method === "GET") {
    try {
      writeJson(response, 200, await runtime.listJobs());
    } catch (error) {
      writeTestingError(response, error);
    }
    return;
  }

  const route = testingJobRoute(pathname);
  if (!route) {
    writeJson(response, 404, { error: "Testing route not found." });
    return;
  }

  if (route.action === null && request.method === "GET") {
    try {
      const job = await runtime.getJob(route.jobId);
      if (!job) throw new RevenuePilotTestingNotFoundError();
      writeJson(response, 200, job);
    } catch (error) {
      writeTestingError(response, error);
    }
    return;
  }
  if (route.action === "authorize" && request.method === "POST") {
    try {
      const body = await readJsonObject(request);
      writeJson(
        response,
        200,
        await runtime.authorizeJob(route.jobId, testingAuthorizationId(body)),
      );
    } catch (error) {
      writeTestingError(response, error);
    }
    return;
  }
  if (route.action === "run" && request.method === "POST") {
    try {
      writeJson(response, 200, await runtime.runJob(route.jobId));
    } catch (error) {
      writeTestingError(response, error);
    }
    return;
  }
  if (route.action === "report" && request.method === "GET") {
    try {
      writeJson(response, 200, await runtime.getReport(route.jobId));
    } catch (error) {
      writeTestingError(response, error);
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
  const runtime = revenuePilotTesting
    ? new RevenuePilotTestingRuntime({
      kernel,
      stateDirectory: baseOptions.stateDirectory,
      modelClient: revenuePilotTesting.modelClient,
      repositoryEvidenceCollector: revenuePilotTesting.repositoryEvidenceCollector,
      monthlyBudgetUsd: revenuePilotTesting.monthlyBudgetUsd,
    })
    : null;
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
    delegate.call(server, request, response);
  });
  return server;
}
