import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GMAIL_REPORT_SENDER } from "./gmail-oauth-activation.ts";

export const GMAIL_REPORT_RECIPIENT = "reparodynamics@gmail.com";

export type GmailDeliveryReceipt = {
  status: "provider_accepted";
  requestId: string;
  sender: typeof GMAIL_REPORT_SENDER;
  recipient: typeof GMAIL_REPORT_RECIPIENT;
  repository: string;
  commitSha: string;
  reportDigest: string;
  contentType: "application/pdf" | "application/zip";
  providerDeliveryId: string;
  acceptedAt: string;
};

export type GmailVerifiedReportInput = {
  requestId: string;
  sender: string;
  recipient: string;
  repository: string;
  commitSha: string;
  reportDigest: string;
  contentType: string;
  reportBytes: Uint8Array;
};

export type GmailVerifiedReportSenderOptions = {
  stateDirectory: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type DeliveryState = {
  version: 1;
  identityDigest: string;
  state: "sending" | "provider_accepted" | "failed" | "delivery_unknown";
  receipt?: GmailDeliveryReceipt;
  failureCode?: string;
  updatedAt: string;
};

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_REPORT_BYTES = 20 * 1024 * 1024;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireSecret(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length < 8) throw new Error(`${label} is not configured.`);
  return value.trim();
}

function validateInput(input: GmailVerifiedReportInput): GmailVerifiedReportInput & { contentType: "application/pdf" | "application/zip" } {
  if (!REQUEST_ID.test(input.requestId)) throw new Error("A durable report-delivery request ID is required.");
  if (input.sender.toLowerCase() !== GMAIL_REPORT_SENDER) throw new Error(`Report sender must be exactly ${GMAIL_REPORT_SENDER}.`);
  if (input.recipient.toLowerCase() !== GMAIL_REPORT_RECIPIENT) throw new Error(`Report recipient must be exactly ${GMAIL_REPORT_RECIPIENT}.`);
  if (!REPOSITORY.test(input.repository)) throw new Error("The assessed repository identity is invalid.");
  if (!COMMIT.test(input.commitSha)) throw new Error("The locked commit SHA is invalid.");
  if (!DIGEST.test(input.reportDigest)) throw new Error("The verified report digest is invalid.");
  if (input.contentType !== "application/pdf" && input.contentType !== "application/zip") throw new Error("Only a verified PDF or ZIP report may be delivered.");
  if (!(input.reportBytes instanceof Uint8Array) || input.reportBytes.byteLength === 0 || input.reportBytes.byteLength > MAX_REPORT_BYTES) {
    throw new Error("The verified report attachment is empty or exceeds the delivery limit.");
  }
  if (sha256(input.reportBytes) !== input.reportDigest) throw new Error("The report bytes no longer match the verified digest.");
  return input as GmailVerifiedReportInput & { contentType: "application/pdf" | "application/zip" };
}

function identityDigest(input: GmailVerifiedReportInput): string {
  return sha256(JSON.stringify({
    requestId: input.requestId,
    sender: input.sender.toLowerCase(),
    recipient: input.recipient.toLowerCase(),
    repository: input.repository,
    commitSha: input.commitSha,
    reportDigest: input.reportDigest,
    contentType: input.contentType,
  }));
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? value;
}

function mimeMessage(input: GmailVerifiedReportInput & { contentType: "application/pdf" | "application/zip" }): string {
  const boundary = `sara-nico-${sha256(`${input.requestId}:${input.reportDigest}`).slice(0, 32)}`;
  const extension = input.contentType === "application/pdf" ? "pdf" : "zip";
  const subject = `NICO automated assessment: ${input.repository} @ ${input.commitSha.slice(0, 12)}`;
  const messageId = `<nico-${sha256(`${input.requestId}:${input.reportDigest}`).slice(0, 40)}@sara.reparodynamics.gmail>`;
  const attachment = foldBase64(Buffer.from(input.reportBytes).toString("base64"));
  return [
    `From: SARA <${GMAIL_REPORT_SENDER}>`,
    `To: ${GMAIL_REPORT_RECIPIENT}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `Attached is the private NICO automated assessment of ${input.repository} locked to commit ${input.commitSha}.`,
    "This package used Authorized — Automated Delivery and was not human reviewed.",
    "It is an automated technical assessment, not a certification, warranty, or security guarantee.",
    "",
    `--${boundary}`,
    `Content-Type: ${input.contentType}; name=\"nico-automated-assessment-${input.commitSha.slice(0, 12)}.${extension}\"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename=\"nico-automated-assessment-${input.commitSha.slice(0, 12)}.${extension}\"`,
    "",
    attachment,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function atomicWrite(path: string, value: DeliveryState): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

export class GmailVerifiedReportSender {
  readonly #directory: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #refreshToken: string;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => Date;

  constructor(options: GmailVerifiedReportSenderOptions) {
    this.#directory = join(options.stateDirectory, "gmail-report-deliveries");
    this.#clientId = requireSecret(options.clientId, "Gmail OAuth client ID");
    this.#clientSecret = requireSecret(options.clientSecret, "Gmail OAuth client secret");
    this.#refreshToken = requireSecret(options.refreshToken, "Gmail OAuth refresh token");
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async send(inputValue: GmailVerifiedReportInput): Promise<GmailDeliveryReceipt> {
    const input = validateInput(inputValue);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const digest = identityDigest(input);
    const statePath = join(this.#directory, `${sha256(input.requestId)}.json`);
    const lockPath = join(this.#directory, `${sha256(input.requestId)}.lock`);

    try {
      const existing = JSON.parse(await readFile(statePath, "utf8")) as DeliveryState;
      if (existing.identityDigest !== digest) throw new Error("The delivery request ID is already bound to different report evidence.");
      if (existing.state === "provider_accepted" && existing.receipt) return existing.receipt;
      if (existing.state === "sending" || existing.state === "delivery_unknown") {
        throw new Error("A prior Gmail delivery may have reached the provider; automatic resend is refused.");
      }
      throw new Error("The original Gmail delivery attempt failed; use explicit owner recovery rather than an automatic resend.");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ENOENT")) {
        if (error instanceof SyntaxError) throw new Error("The durable Gmail delivery receipt is invalid.");
        if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
      }
    }

    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch {
      throw new Error("This Gmail delivery request is already in progress.");
    }

    const sending: DeliveryState = { version: 1, identityDigest: digest, state: "sending", updatedAt: this.#now().toISOString() };
    await atomicWrite(statePath, sending);
    let providerRequestStarted = false;
    try {
      const tokenResponse = await this.#fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          refresh_token: this.#refreshToken,
          grant_type: "refresh_token",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResponse.ok) throw new Error("Gmail authorization refresh failed.");
      const token = await tokenResponse.json() as { access_token?: unknown; token_type?: unknown };
      if (typeof token.access_token !== "string" || String(token.token_type).toLowerCase() !== "bearer") throw new Error("Gmail authorization refresh failed.");

      const identityResponse = await this.#fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!identityResponse.ok) throw new Error("Gmail sender identity verification failed.");
      const identity = await identityResponse.json() as { email?: unknown; email_verified?: unknown };
      if (typeof identity.email !== "string" || identity.email.toLowerCase() !== GMAIL_REPORT_SENDER || identity.email_verified !== true) {
        throw new Error(`Gmail sender identity must be exactly ${GMAIL_REPORT_SENDER}.`);
      }

      const raw = Buffer.from(mimeMessage(input), "utf8").toString("base64url");
      providerRequestStarted = true;
      const sendResponse = await this.#fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ raw }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!sendResponse.ok) {
        await atomicWrite(statePath, { version: 1, identityDigest: digest, state: "failed", failureCode: "PROVIDER_REJECTED", updatedAt: this.#now().toISOString() });
        throw new Error("Gmail did not accept the verified report message.");
      }
      const sent = await sendResponse.json() as { id?: unknown };
      if (typeof sent.id !== "string" || sent.id.length < 4 || sent.id.length > 512) {
        await atomicWrite(statePath, { version: 1, identityDigest: digest, state: "delivery_unknown", failureCode: "MISSING_PROVIDER_ID", updatedAt: this.#now().toISOString() });
        throw new Error("Gmail acceptance could not be verified; automatic resend is refused.");
      }
      const receipt: GmailDeliveryReceipt = {
        status: "provider_accepted",
        requestId: input.requestId,
        sender: GMAIL_REPORT_SENDER,
        recipient: GMAIL_REPORT_RECIPIENT,
        repository: input.repository,
        commitSha: input.commitSha,
        reportDigest: input.reportDigest,
        contentType: input.contentType,
        providerDeliveryId: sent.id,
        acceptedAt: this.#now().toISOString(),
      };
      await atomicWrite(statePath, { version: 1, identityDigest: digest, state: "provider_accepted", receipt, updatedAt: receipt.acceptedAt });
      return receipt;
    } catch (error) {
      if (providerRequestStarted) {
        try {
          const current = JSON.parse(await readFile(statePath, "utf8")) as DeliveryState;
          if (current.state === "sending") await atomicWrite(statePath, { ...current, state: "delivery_unknown", failureCode: "AMBIGUOUS_PROVIDER_RESULT", updatedAt: this.#now().toISOString() });
        } catch {
          // Preserve the original failure while refusing automatic resend through the durable lock/state contract.
        }
      } else {
        await atomicWrite(statePath, { version: 1, identityDigest: digest, state: "failed", failureCode: "PRE_SEND_FAILURE", updatedAt: this.#now().toISOString() });
      }
      throw error instanceof Error ? error : new Error("Gmail report delivery failed.");
    } finally {
      await lock.close();
      await import("node:fs/promises").then(({ rm }) => rm(lockPath, { force: true }));
    }
  }
}
