import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { GMAIL_REPORT_SENDER, type GmailOAuthActivationReceipt } from "./gmail-oauth-activation.ts";
import { GMAIL_REPORT_RECIPIENT } from "./gmail-verified-report-sender.ts";
import type { TelegramNicoCommand, TelegramNicoReceipt } from "./telegram-nico-delivery.ts";

export type TelegramNicoActionOperator = {
  submit(input: TelegramNicoCommand): Promise<TelegramNicoReceipt>;
};

export type GmailOAuthActivationBoundary = {
  start(): Promise<{ authorizationUrl: string; expiresAt: string }>;
  complete(input: { state: string; code: string }): Promise<GmailOAuthActivationReceipt>;
};

export type TelegramNicoHttpBridgeOptions = {
  bridgeTokenSha256?: string;
  telegramBridgeTokenSha256?: string;
  expectedTelegramUserIdSha256: string;
  operator?: TelegramNicoActionOperator;
  actionOperator?: TelegramNicoActionOperator;
  gmailOAuthActivation?: GmailOAuthActivationBoundary;
  oauthActivation?: GmailOAuthActivationBoundary;
};

const MAX_BODY_BYTES = 64 * 1024;
const USER_ID = /^.{1,128}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authenticated(request: IncomingMessage, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(expectedHex)) return false;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  if (token.length < 16 || token.length > 2048) return false;
  const actual = digest(token);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function paired(userId: string, expectedHex: string): boolean {
  if (!USER_ID.test(userId) || !/^[a-f0-9]{64}$/u.test(expectedHex)) return false;
  const actual = digest(userId);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) throw new Error("Telegram action body exceeds 64 KiB.");
    chunks.push(value);
  }
  if (chunks.length === 0) throw new Error("Telegram action body is required.");
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Telegram action body must be one JSON object.");
  return parsed as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

function html(response: ServerResponse, status: number, title: string, message: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`);
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "The Telegram NICO action failed closed.";
  if (/(bearer|oauth code|refresh token|client secret|password|api key|credential value)/iu.test(message)) return "The Telegram NICO action failed closed without exposing sensitive details.";
  return message.slice(0, 500);
}

function deterministicInstruction(body: Record<string, unknown>): TelegramNicoCommand {
  const requestId = String(body.requestId ?? "");
  const telegramUserId = String(body.telegramUserId ?? "");
  const instruction = String(body.instruction ?? "").trim();
  if (!REQUEST_ID.test(requestId)) throw new Error("A durable unique Telegram request ID is required.");
  if (!USER_ID.test(telegramUserId)) throw new Error("A Telegram identity is required.");
  const target = instruction.match(/Run a private NICO automated assessment of (https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+) locked to commit ([a-f0-9]{40})\./u);
  if (!target) throw new Error("The operational instruction must contain one canonical GitHub repository and a locked 40-character commit SHA.");
  const normalized = instruction.toLowerCase();
  if (!normalized.includes("zero unresolved review workload")
    || !normalized.includes("independent package verification")
    || !normalized.includes("automated-delivery disclosure")
    || !normalized.includes("no human-review claim")
    || !normalized.includes("do not contact the repository owner")
    || !normalized.includes("do not publish the report")) {
    throw new Error("The operational instruction is missing one or more mandatory automated-delivery safeguards.");
  }
  const email = instruction.match(/Email the verified final report from ([^\s]+) to ([^\s]+) and return the assessment and delivery receipts\./u);
  if (!email || email[1]!.toLowerCase() !== GMAIL_REPORT_SENDER || email[2]!.toLowerCase() !== GMAIL_REPORT_RECIPIENT) {
    throw new Error(`The operational instruction must use ${GMAIL_REPORT_SENDER} as sender and ${GMAIL_REPORT_RECIPIENT} as recipient.`);
  }
  return {
    requestId,
    telegramUserId,
    action: "nico_assessment_start",
    repository: target[1],
    commitSha: target[2],
    emailVerifiedReport: true,
    sender: GMAIL_REPORT_SENDER,
    recipient: GMAIL_REPORT_RECIPIENT,
  };
}

function structuredCommand(body: Record<string, unknown>): TelegramNicoCommand {
  if (typeof body.instruction === "string") return deterministicInstruction(body);
  const allowed = new Set([
    "requestId", "telegramUserId", "action", "repository", "commitSha", "assessmentRequestId",
    "reportDigest", "sender", "recipient", "emailVerifiedReport",
  ]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new Error(`Unsupported Telegram action field: ${key}.`);
  return {
    requestId: String(body.requestId ?? ""),
    telegramUserId: String(body.telegramUserId ?? ""),
    action: String(body.action ?? ""),
    repository: typeof body.repository === "string" ? body.repository : undefined,
    commitSha: typeof body.commitSha === "string" ? body.commitSha : undefined,
    assessmentRequestId: typeof body.assessmentRequestId === "string" ? body.assessmentRequestId : undefined,
    reportDigest: typeof body.reportDigest === "string" ? body.reportDigest : undefined,
    sender: typeof body.sender === "string" ? body.sender : undefined,
    recipient: typeof body.recipient === "string" ? body.recipient : undefined,
    emailVerifiedReport: body.emailVerifiedReport === true,
  };
}

export class TelegramNicoHttpBridge {
  readonly #bridgeTokenSha256: string;
  readonly #expectedTelegramUserIdSha256: string;
  readonly #operator: TelegramNicoActionOperator;
  readonly #oauth?: GmailOAuthActivationBoundary;

  constructor(options: TelegramNicoHttpBridgeOptions) {
    this.#bridgeTokenSha256 = options.bridgeTokenSha256 ?? options.telegramBridgeTokenSha256 ?? "";
    this.#expectedTelegramUserIdSha256 = options.expectedTelegramUserIdSha256;
    const operator = options.operator ?? options.actionOperator;
    if (!operator) throw new Error("Telegram NICO action operator is not configured.");
    this.#operator = operator;
    this.#oauth = options.gmailOAuthActivation ?? options.oauthActivation;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === "/api/telegram/luna") return false;
    if (url.pathname === "/api/gmail/oauth/callback") {
      if (request.method !== "GET") { json(response, 405, { error: "Method not allowed." }); return true; }
      if (!this.#oauth) { html(response, 503, "SARA Gmail inactive", "Gmail OAuth activation is not configured."); return true; }
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const providerError = url.searchParams.get("error");
      if (providerError) { html(response, 400, "SARA Gmail not activated", "Google authorization was not completed. No email was sent."); return true; }
      try {
        const receipt = await this.#oauth.complete({ state, code });
        html(response, 200, "SARA Gmail authorized", `Authenticated sender verified as ${receipt.authenticatedSender}. Railway is restarting SARA with the protected refresh token.`);
      } catch (error) {
        html(response, 400, "SARA Gmail not activated", `${safeFailure(error)} No email was sent.`);
      }
      return true;
    }
    if (url.pathname !== "/api/telegram/actions" && url.pathname !== "/api/telegram/gmail/oauth/start") return false;
    if (!authenticated(request, this.#bridgeTokenSha256)) {
      response.setHeader("www-authenticate", "Bearer");
      json(response, 401, { error: "Telegram bridge authentication required." });
      return true;
    }
    if (request.method !== "POST") { json(response, 405, { error: "Method not allowed." }); return true; }
    try {
      const body = await readJson(request);
      const telegramUserId = String(body.telegramUserId ?? "");
      if (!paired(telegramUserId, this.#expectedTelegramUserIdSha256)) {
        json(response, 403, { error: "Only Cody's paired Telegram identity may invoke operational actions." });
        return true;
      }
      if (url.pathname === "/api/telegram/gmail/oauth/start") {
        if (!this.#oauth) { json(response, 503, { error: "Gmail OAuth activation is not configured." }); return true; }
        const activation = await this.#oauth.start();
        json(response, 200, {
          status: "owner_authorization_required",
          authenticatedSenderRequired: GMAIL_REPORT_SENDER,
          authorizationUrl: activation.authorizationUrl,
          expiresAt: activation.expiresAt,
        });
        return true;
      }
      const result = await this.#operator.submit(structuredCommand(body));
      json(response, 200, result);
      return true;
    } catch (error) {
      json(response, 400, { error: safeFailure(error) });
      return true;
    }
  }
}
