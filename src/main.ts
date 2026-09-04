import { resolve } from "node:path";
import { SaraKernel } from "./kernel.ts";
import { runLunaStartupProof, type LunaStartupProof } from "./luna-startup-proof.ts";
import { OpenAIResponsesClient } from "./openai-worker.ts";
import { GitHubPublicRepositoryEvidenceCollector } from "./public-repository-evidence.ts";
import { OwnerAssistant } from "./owner-assistant.ts";
import { RevenuePilotOperator } from "./revenue-pilot-operator.ts";
import { PILOT_REQUIRED_CAPABILITIES } from "./revenue-pilot.ts";
import { createSaraServer } from "./server.ts";
import { compileCommercialTerms, compilePreviousCommercialTermsDigest } from "./commercial-terms.ts";
import { NicoOperatorClient } from "./nico-operator.ts";
import { activateApprovedAutonomousPaidMandate } from "./autonomous-paid-mandate-bootstrap.ts";

const stateDirectory = resolve(process.env.SARA_STATE_DIRECTORY ?? ".sara-state");
const host = process.env.SARA_HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const ownerTokenSha256 = process.env.SARA_OWNER_TOKEN_SHA256;
const readOnlyBridgeTokenSha256 = process.env.SARA_READ_ONLY_BRIDGE_TOKEN_SHA256?.trim();
const telegramBridgeTokenSha256 = process.env.SARA_TELEGRAM_BRIDGE_TOKEN_SHA256?.trim();
const apiKey = process.env.OPENAI_API_KEY?.trim();
const monthlyBudgetUsd = Number(process.env.SARA_MONTHLY_MODEL_BUDGET_USD ?? 10);
const telegramMonthlyBudgetUsd = Number(process.env.SARA_TELEGRAM_LUNA_BUDGET_USD ?? 0);
const liveProofEnabled = process.env.SARA_LIVE_PROOF_ON_START === "true";
const paymentWalletAddress = process.env.SARA_PAYMENT_WALLET_ADDRESS?.trim();
const termsBusinessName = process.env.SARA_TERMS_BUSINESS_NAME?.trim();
const termsContactEmail = process.env.SARA_TERMS_CONTACT_EMAIL?.trim();
const termsGoverningLaw = process.env.SARA_TERMS_GOVERNING_LAW?.trim();
const approvedTermsDigest = process.env.SARA_COMMERCIAL_TERMS_APPROVED_SHA256?.trim().toLowerCase();
const baseRpcUrl = process.env.SARA_BASE_RPC_URL?.trim() ?? "https://mainnet.base.org";
const publicBaseUrl = process.env.SARA_PUBLIC_BASE_URL?.trim()
  ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
const nicoBaseUrl = process.env.SARA_NICO_BASE_URL?.trim();
const nicoOperatorPassword = process.env.SARA_NICO_OPERATOR_PASSWORD?.trim();
const ownerToken = process.env.SARA_OWNER_TOKEN?.trim();
const approvedAutonomousPaidMandateDigest = process.env.SARA_AUTONOMOUS_PAID_MANDATE_APPROVED_SHA256?.trim();
if (!ownerTokenSha256 || !/^[a-f0-9]{64}$/i.test(ownerTokenSha256)) {
  throw new Error("Set SARA_OWNER_TOKEN_SHA256 to a SHA-256 digest before starting the owner dashboard.");
}
if (readOnlyBridgeTokenSha256 && !/^[a-f0-9]{64}$/i.test(readOnlyBridgeTokenSha256)) {
  throw new Error("SARA_READ_ONLY_BRIDGE_TOKEN_SHA256 must be a SHA-256 digest when configured.");
}
if (telegramBridgeTokenSha256 && !/^[a-f0-9]{64}$/i.test(telegramBridgeTokenSha256)) {
  throw new Error("SARA_TELEGRAM_BRIDGE_TOKEN_SHA256 must be a SHA-256 digest when configured.");
}
if (telegramBridgeTokenSha256 && telegramBridgeTokenSha256 === readOnlyBridgeTokenSha256) {
  throw new Error("Telegram action and read-only bridge credentials must be distinct.");
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be a valid TCP port.");
if (
  !Number.isFinite(monthlyBudgetUsd) ||
  monthlyBudgetUsd < 0 ||
  monthlyBudgetUsd > 50 ||
  Math.abs(monthlyBudgetUsd * 100 - Math.round(monthlyBudgetUsd * 100)) > 1e-9
) {
  throw new Error("SARA_MONTHLY_MODEL_BUDGET_USD must be a whole-cent amount from 0 through 50.");
}

const compiledTerms = termsBusinessName && termsContactEmail && termsGoverningLaw
  ? compileCommercialTerms({
    businessName: termsBusinessName,
    contactEmail: termsContactEmail,
    governingLaw: termsGoverningLaw,
  })
  : null;
const previousTermsDigest = termsBusinessName && termsContactEmail && termsGoverningLaw
  ? compilePreviousCommercialTermsDigest({
    businessName: termsBusinessName,
    contactEmail: termsContactEmail,
    governingLaw: termsGoverningLaw,
  })
  : null;
const termsApproved = Boolean(
  approvedTermsDigest
  && compiledTerms
  && (approvedTermsDigest === compiledTerms.digest || approvedTermsDigest === previousTermsDigest),
);
if (approvedTermsDigest && !termsApproved) {
  throw new Error("SARA_COMMERCIAL_TERMS_APPROVED_SHA256 does not match the exact compiled commercial terms.");
}
const commerce = paymentWalletAddress && compiledTerms && termsApproved
  ? {
    recipientAddress: paymentWalletAddress,
    rpcUrl: baseRpcUrl,
    terms: compiledTerms,
    publicOrigin: "https://saraseed.app",
  }
  : null;
if (
  !Number.isFinite(telegramMonthlyBudgetUsd) ||
  telegramMonthlyBudgetUsd < 0 ||
  telegramMonthlyBudgetUsd > 10 ||
  telegramMonthlyBudgetUsd > monthlyBudgetUsd ||
  Math.abs(telegramMonthlyBudgetUsd * 100 - Math.round(telegramMonthlyBudgetUsd * 100)) > 1e-9
) {
  throw new Error("SARA_TELEGRAM_LUNA_BUDGET_USD must be a whole-cent amount within the total monthly model budget.");
}

const kernel = await SaraKernel.boot({
  stateDirectory,
  ownerTokenSha256,
  bootstrapRevenueCapabilities: true,
});
await activateApprovedAutonomousPaidMandate({
  kernel,
  ...(ownerToken ? { ownerToken } : {}),
  ...(approvedAutonomousPaidMandateDigest ? { approvedDigest: approvedAutonomousPaidMandateDigest } : {}),
});
const bootStatus = await kernel.getStatus();
const capabilityReadiness = PILOT_REQUIRED_CAPABILITIES.map((id) => ({
  id,
  status: bootStatus.capabilities.find((capability) => capability.id === id)?.status ?? "missing",
}));
console.log(`SARA revenue readiness proof ${JSON.stringify({
  schemaVersion: 1,
  capabilities: capabilityReadiness,
  commerceConfigured: commerce !== null,
  commercialTermsVersion: compiledTerms?.version ?? null,
  commercialTermsDigest: compiledTerms?.digest ?? null,
  commercialTermsApproval: approvedTermsDigest === compiledTerms?.digest ? "exact" : termsApproved ? "v1_to_v2_migration" : "missing",
})}`);
const client = apiKey ? new OpenAIResponsesClient({ apiKey }) : null;
const ownerAssistant = client && telegramBridgeTokenSha256 && telegramMonthlyBudgetUsd > 0
  ? new OwnerAssistant({ modelClient: client, stateDirectory, monthlyBudgetUsd: telegramMonthlyBudgetUsd })
  : null;
if (Boolean(nicoBaseUrl) !== Boolean(nicoOperatorPassword)) {
  throw new Error("SARA_NICO_BASE_URL and SARA_NICO_OPERATOR_PASSWORD must be configured together.");
}
const nicoOperator = nicoBaseUrl && nicoOperatorPassword
  ? new NicoOperatorClient({ baseUrl: nicoBaseUrl, operatorPassword: nicoOperatorPassword })
  : null;
const activeTelegramMonthlyBudgetUsd = ownerAssistant ? telegramMonthlyBudgetUsd : 0;
let operator: RevenuePilotOperator | null = null;
let startupProof: LunaStartupProof = {
  schemaVersion: 1,
  status: client ? "disabled" : "failed",
  attemptedAt: null,
  completedAt: null,
  provider: "openai",
  model: "gpt-5.6-luna",
  accountedCostUsd: 0,
  outputDigest: null,
  failureCode: client ? null : "unexpected_failure",
};
const server = createSaraServer(kernel, {
  ownerTokenSha256,
  stateDirectory,
  ...(publicBaseUrl ? { publicBaseUrl } : {}),
  ...(readOnlyBridgeTokenSha256 ? { readOnlyBridgeTokenSha256 } : {}),
  ...(telegramBridgeTokenSha256 ? { telegramBridgeTokenSha256 } : {}),
  ...(ownerAssistant ? { ownerAssistant } : {}),
  ...(commerce ? { commerce } : {}),
  ...(nicoOperator ? { nicoOperator } : {}),
  ...(client ? {
    runtimeStatus: async () => ({
      worker: operator ? await operator.status() : {
        configured: true,
        running: false,
        monthlyBudgetUsd,
        currentMonthCostUsd: startupProof.accountedCostUsd,
        lastTickAt: null,
        lastOutcome: null,
      },
      startupProof,
    }),
  } : {}),
});
server.listen(port, host, () => {
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  console.log(`SARA owner dashboard listening on http://${host}:${resolvedPort}`);
  if (!client) {
    console.log("SARA Luna worker is disabled because OPENAI_API_KEY is not configured.");
    return;
  }
  void (async () => {
    try {
      startupProof = await runLunaStartupProof({
        client,
        stateDirectory,
        enabled: liveProofEnabled,
      });
      const proofIsCurrentMonth = startupProof.attemptedAt?.slice(0, 7) === new Date().toISOString().slice(0, 7);
      operator = new RevenuePilotOperator({
        kernel,
        modelClient: client,
        repositoryEvidenceCollector: new GitHubPublicRepositoryEvidenceCollector(),
        stateDirectory,
        monthlyBudgetUsd: monthlyBudgetUsd - activeTelegramMonthlyBudgetUsd,
        monthlyCostOffsetUsd: proofIsCurrentMonth ? startupProof.accountedCostUsd : 0,
      });
      if (!liveProofEnabled || startupProof.status === "succeeded") {
        operator.start();
      }
      console.log(
        `SARA Luna startup proof ${startupProof.status}; accounted cost $${startupProof.accountedCostUsd.toFixed(6)}; worker ${(await operator.status()).running ? "running" : "stopped"}.`,
      );
    } catch {
      console.error("SARA Luna runtime initialization failed closed without exposing provider or storage details.");
    }
  })();
});

function shutdown(): void {
  operator?.stop();
  server.close();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
