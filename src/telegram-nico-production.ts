import type { IncomingMessage, ServerResponse } from "node:http";
import type { NicoOperator } from "./nico-operator.ts";
import { TelegramNicoDeliveryOperator } from "./telegram-nico-delivery.ts";
import { TelegramNicoHttpBridge } from "./telegram-nico-http.ts";
import { GitHubExactTargetVerifier } from "./github-exact-target-verifier.ts";
import { GmailOAuthActivation, RailwayRefreshTokenSecretWriter } from "./gmail-oauth-activation.ts";
import { GmailVerifiedReportSender } from "./gmail-verified-report-sender.ts";
import {enforceEffectBoundary} from './effect-boundary.ts';

export const TELEGRAM_NICO_MANDATE_APPROVAL = "SARA_TELEGRAM_NICO_AUTOMATED_DELIVERY_V1_OWNER_APPROVED_2026-09-04";

export type TelegramNicoProductionOptions = {
  telegramBridgeTokenSha256?: string;
  nicoOperator?: NicoOperator;
  stateDirectory?: string;
};

export type TelegramNicoProductionKernel = {
  getStatus(): Promise<unknown>;
};

type HttpBridge = {
  handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean>;
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function explicitEmergencyStop(status: unknown): boolean | null {
  let sawInactive = false;
  const visit = (value: unknown, path: string[], depth: number): boolean => {
    if (depth > 8 || !value || typeof value !== "object") return false;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = [...path, key];
      const normalized = next.join(".").toLowerCase().replace(/[^a-z]/gu, "");
      if (normalized.includes("emergencystop")) {
        if (child === true) return true;
        if (child === false) sawInactive = true;
        if (child && typeof child === "object") {
          const record = child as Record<string, unknown>;
          if (record.active === true || record.engaged === true || record.stopped === true) return true;
          if (record.active === false || record.engaged === false || record.stopped === false) sawInactive = true;
        }
      }
      if (visit(child, next, depth + 1)) return true;
    }
    return false;
  };
  if (visit(status, [], 0)) return true;
  return sawInactive ? false : null;
}

export function evaluateTelegramNicoProductionAuthorization(input: {
  status: unknown;
  mandateApproval?: string;
  revoked?: string;
  action?: string;
  targetId?: string;
}): { allowed: boolean; code: string; reason: string } {
  if (input.mandateApproval !== TELEGRAM_NICO_MANDATE_APPROVAL) {
    return { allowed: false, code: "TELEGRAM_NICO_MANDATE_INACTIVE", reason: "The exact owner-issued Telegram NICO mandate is not active." };
  }
  if (input.revoked === "true") {
    return { allowed: false, code: "TELEGRAM_NICO_OWNER_REVOKED", reason: "The owner revoked Telegram NICO actions." };
  }
  if (explicitEmergencyStop(input.status) !== false) {
    return { allowed: false, code: "TELEGRAM_NICO_EMERGENCY_STOP", reason: "Emergency-stop state is active or could not be verified inactive." };
  }
  const {allowed,code,reason}=enforceEffectBoundary({action:input.action??'telegram_nico_bounded_workflow',target:input.targetId??'telegram-nico:mandate-inspection',external:true,
    emergencyStopped:false,effect:'EXTERNAL',authority:'EXACT_MANDATE',authorityIdentity:input.mandateApproval,cost:null,credentials:true,
    decision:{allowed:true,code:'TELEGRAM_NICO_OWNER_AUTHORIZED',reason:'Exact bounded owner mandate and inactive emergency stop verified.'}});
  return {allowed,code,reason};
}

async function buildBridge(kernel: TelegramNicoProductionKernel, options: TelegramNicoProductionOptions): Promise<HttpBridge | null> {
  const bridgeTokenSha256 = nonEmpty(options.telegramBridgeTokenSha256);
  const expectedTelegramUserIdSha256 = nonEmpty(process.env.SARA_TELEGRAM_OWNER_USER_ID_SHA256);
  const stateDirectory = nonEmpty(options.stateDirectory);
  if (!bridgeTokenSha256 || !expectedTelegramUserIdSha256 || !stateDirectory || !options.nicoOperator) return null;

  const targetVerifier = new GitHubExactTargetVerifier({ fetchImpl: fetch });
  const gmailClientId = nonEmpty(process.env.SARA_GMAIL_OAUTH_CLIENT_ID);
  const gmailClientSecret = nonEmpty(process.env.SARA_GMAIL_OAUTH_CLIENT_SECRET);
  const gmailRefreshToken = nonEmpty(process.env.SARA_GMAIL_REFRESH_TOKEN);
  const gmailSender = gmailClientId && gmailClientSecret && gmailRefreshToken
    ? new GmailVerifiedReportSender({ stateDirectory, clientId: gmailClientId, clientSecret: gmailClientSecret, refreshToken: gmailRefreshToken, fetchImpl: fetch })
    : undefined;

  const redirectUri = nonEmpty(process.env.SARA_GMAIL_OAUTH_REDIRECT_URI);
  const railwayProjectToken = nonEmpty(process.env.SARA_RAILWAY_PROJECT_TOKEN);
  const railwayProjectId = nonEmpty(process.env.SARA_RAILWAY_PROJECT_ID) ?? nonEmpty(process.env.RAILWAY_PROJECT_ID);
  const railwayServiceId = nonEmpty(process.env.SARA_RAILWAY_SERVICE_ID) ?? nonEmpty(process.env.RAILWAY_SERVICE_ID);
  const railwayEnvironmentId = nonEmpty(process.env.SARA_RAILWAY_ENVIRONMENT_ID) ?? nonEmpty(process.env.RAILWAY_ENVIRONMENT_ID);
  const gmailOAuthActivation = gmailClientId && gmailClientSecret && redirectUri && railwayProjectToken && railwayProjectId && railwayServiceId && railwayEnvironmentId
    ? new GmailOAuthActivation({
        stateDirectory,
        clientId: gmailClientId,
        clientSecret: gmailClientSecret,
        redirectUri,
        fetchImpl: fetch,
        secretWriter: new RailwayRefreshTokenSecretWriter({
          projectToken: railwayProjectToken,
          projectId: railwayProjectId,
          serviceId: railwayServiceId,
          environmentId: railwayEnvironmentId,
          fetchImpl: fetch,
        }),
      })
    : undefined;

  const operator = new TelegramNicoDeliveryOperator({
    stateDirectory,
    expectedTelegramUserIdSha256,
    nicoOperator: options.nicoOperator,
    targetVerifier,
    gmailSender,
    dailyActionLimit: 10,
    maxConcurrentAssessments: 1,
    assessmentCostLimitUsd: 3,
    authorize: async (request) => evaluateTelegramNicoProductionAuthorization({
      status: await kernel.getStatus(),
      mandateApproval: process.env.SARA_TELEGRAM_NICO_MANDATE_APPROVAL,
      revoked: process.env.SARA_TELEGRAM_NICO_REVOKED,
      action:request.action,targetId:request.assessmentRequestId,
    }),
  });

  return new TelegramNicoHttpBridge({
    bridgeTokenSha256,
    expectedTelegramUserIdSha256,
    operator,
    gmailOAuthActivation,
  });
}

function unavailable(response: ServerResponse): void {
  response.writeHead(503, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify({ error: "Telegram NICO action bridge is not fully configured." }));
}

function operationalPath(pathname: string): boolean {
  return pathname === "/api/telegram/actions"
    || pathname === "/api/telegram/gmail/oauth/start"
    || pathname === "/api/gmail/oauth/callback";
}

export async function handleTelegramNicoProductionRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  kernel: TelegramNicoProductionKernel;
  options: TelegramNicoProductionOptions;
}): Promise<boolean> {
  if (!operationalPath(input.url.pathname)) return false;
  const cachedBridge = await buildBridge(input.kernel, input.options);
  if (!cachedBridge) {
    unavailable(input.response);
    return true;
  }
  return cachedBridge.handle(input.request, input.response, input.url);
}
