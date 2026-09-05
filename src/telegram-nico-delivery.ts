import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  verifyNicoAutomatedPackage,
  type NicoArtifactIdentity,
  type NicoAutomatedPackage,
  type VerifiedNicoAutomatedPackage,
} from "./nico-automated-package-verifier.ts";
import { GMAIL_REPORT_SENDER } from "./gmail-oauth-activation.ts";
import { GMAIL_REPORT_RECIPIENT, type GmailDeliveryReceipt, type GmailVerifiedReportInput } from "./gmail-verified-report-sender.ts";

export const TELEGRAM_NICO_ACTIONS = Object.freeze([
  "nico_assessment_start",
  "nico_assessment_status",
  "nico_assessment_continue",
  "nico_automated_package",
  "email_verified_report",
] as const);

export type TelegramNicoAction = typeof TELEGRAM_NICO_ACTIONS[number];

export type TelegramNicoCommand = {
  requestId: string;
  telegramUserId: string;
  action: TelegramNicoAction | string;
  repository?: string;
  commitSha?: string;
  assessmentRequestId?: string;
  reportDigest?: string;
  sender?: string;
  recipient?: string;
  emailVerifiedReport?: boolean;
};

export type TelegramNicoReceipt = {
  requestId: string;
  assessmentRequestId: string;
  action: TelegramNicoAction;
  state: "accepted" | "running" | "terminal" | "package_verified" | "provider_accepted" | "failed";
  runId: string;
  repository: string;
  repositoryUrl: string;
  commitSha: string;
  terminalStatus?: string;
  unresolvedReviewWorkload?: number;
  automatedPackageAuthorized?: boolean;
  reportContentType?: string;
  reportDigest?: string;
  delivery?: GmailDeliveryReceipt;
  updatedAt: string;
};

type AuthorizationDecision = { allowed: boolean; code: string; reason: string };

type NicoBoundary = {
  createRun(...args: unknown[]): Promise<unknown>;
  getRun(...args: unknown[]): Promise<unknown>;
  continueRun(...args: unknown[]): Promise<unknown>;
  getReviewQueue(...args: unknown[]): Promise<unknown>;
  getAutomatedDeliveryPackage(...args: unknown[]): Promise<unknown>;
};

type ExactTargetVerifier = {
  verify(...args: unknown[]): Promise<unknown>;
};

type GmailSender = {
  send(input: GmailVerifiedReportInput): Promise<GmailDeliveryReceipt>;
};

export type TelegramNicoDeliveryOperatorOptions = {
  stateDirectory: string;
  expectedTelegramUserIdSha256: string;
  nicoOperator: NicoBoundary;
  targetVerifier: ExactTargetVerifier;
  authorize: (input: { action: TelegramNicoAction; requestId: string; assessmentRequestId: string }) => Promise<AuthorizationDecision>;
  gmailSender?: GmailSender;
  reportSender?: GmailSender;
  dailyActionLimit?: number;
  maxConcurrentAssessments?: number;
  assessmentCostLimitUsd?: number;
  now?: () => Date;
};

type Target = { repository: string; repositoryUrl: string; commitSha: string };

type RunEvidence = {
  runId: string;
  repositoryUrl: string;
  commitSha: string;
  status: string;
  terminal: boolean;
  artifactIdentity?: NicoArtifactIdentity;
  costUsd: number;
};

type WorkflowState = {
  version: 1;
  assessmentRequestId: string;
  telegramUserIdSha256: string;
  repository: string;
  repositoryUrl: string;
  commitSha: string;
  runId: string;
  stage: "accepted" | "target_locked" | "running" | "terminal" | "package_verified" | "provider_accepted" | "failed";
  terminalStatus?: string;
  unresolvedReviewWorkload?: number;
  artifactIdentity?: NicoArtifactIdentity;
  verifiedPackage?: {
    contentType: "application/pdf" | "application/zip";
    reportDigest: string;
    storageName: string;
  };
  delivery?: GmailDeliveryReceipt;
  costUsd: number;
  updatedAt: string;
};

type CommandState = {
  version: 1;
  inputDigest: string;
  action: TelegramNicoAction;
  assessmentRequestId: string;
  status: "accepted" | "working" | "completed" | "failed";
  result?: TelegramNicoReceipt;
  failure?: { code: string; reason: string };
  updatedAt: string;
};

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const REPORT_DIGEST = /^[a-f0-9]{64}$/u;
const CREDENTIAL_KEY = /(password|token|secret|credential|authorization|api[_-]?key)/iu;
const TERMINAL = new Set(["complete", "completed", "authorized", "authorized_automated_delivery", "delivery_authorized", "package_ready"]);
const FAILED = /(failed|error|cancelled|canceled|rejected|blocked|review_required)/iu;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pairedIdentity(value: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(expectedHex) || typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  const actual = Buffer.from(sha256(value), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function canonicalRepository(value: string): { repository: string; repositoryUrl: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provide one canonical public GitHub repository URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.search || url.hash || url.username || url.password || url.port) {
    throw new Error("Provide one canonical public GitHub repository URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[1]!.endsWith(".git")) throw new Error("Branch-only, path, and arbitrary URL assessment requests are not supported.");
  const repository = `${parts[0]}/${parts[1]}`;
  const repositoryUrl = `https://github.com/${repository}`;
  if (value !== repositoryUrl && value !== `${repositoryUrl}/`) throw new Error("Use the canonical repository URL without a branch, tag, or path.");
  return { repository, repositoryUrl };
}

function rejectCredentialMaterial(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_KEY.test(key)) throw new Error("Credentials are not accepted by the Telegram action bridge.");
    rejectCredentialMaterial(child, depth + 1);
  }
}

function validateCommand(input: TelegramNicoCommand): TelegramNicoCommand & { action: TelegramNicoAction } {
  rejectCredentialMaterial(input);
  if (!REQUEST_ID.test(input.requestId)) throw new Error("A durable unique Telegram request ID is required.");
  if (!TELEGRAM_NICO_ACTIONS.includes(input.action as TelegramNicoAction)) throw new Error("The Telegram action is not supported.");
  const action = input.action as TelegramNicoAction;
  if (action === "nico_assessment_start") {
    if (typeof input.repository !== "string") throw new Error("An exact repository URL is required.");
    canonicalRepository(input.repository);
    if (typeof input.commitSha !== "string" || !COMMIT_SHA.test(input.commitSha)) throw new Error("A locked lowercase 40-character commit SHA is required.");
  } else if (!REQUEST_ID.test(input.assessmentRequestId ?? input.requestId)) {
    throw new Error("A valid assessment request ID is required.");
  }
  if (input.reportDigest !== undefined && !REPORT_DIGEST.test(input.reportDigest)) throw new Error("The exact verified report digest is invalid.");
  if (input.sender !== undefined && input.sender.toLowerCase() !== GMAIL_REPORT_SENDER) throw new Error(`Report sender must be exactly ${GMAIL_REPORT_SENDER}.`);
  if (input.recipient !== undefined && input.recipient.toLowerCase() !== GMAIL_REPORT_RECIPIENT) throw new Error(`Report recipient must be exactly ${GMAIL_REPORT_RECIPIENT}.`);
  return input as TelegramNicoCommand & { action: TelegramNicoAction };
}

function stableCommand(input: TelegramNicoCommand & { action: TelegramNicoAction }): Record<string, unknown> {
  return {
    requestId: input.requestId,
    action: input.action,
    repository: input.repository ?? null,
    commitSha: input.commitSha ?? null,
    assessmentRequestId: input.assessmentRequestId ?? null,
    reportDigest: input.reportDigest ?? null,
    sender: input.sender?.toLowerCase() ?? null,
    recipient: input.recipient?.toLowerCase() ?? null,
    emailVerifiedReport: input.emailVerifiedReport === true,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is missing or invalid.`);
  return value as Record<string, unknown>;
}

function firstValue(value: unknown, names: Set<string>, depth = 0): unknown {
  if (depth > 7 || !value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (names.has(normalized)) return child;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = firstValue(child, names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function firstString(value: unknown, names: string[], label: string): string {
  const found = firstValue(value, new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/gu, ""))));
  if (typeof found !== "string" || found.length === 0 || found.length > 1024) throw new Error(`${label} is missing or invalid.`);
  return found;
}

function optionalNumber(value: unknown, names: string[]): number | undefined {
  const found = firstValue(value, new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/gu, ""))));
  const number = typeof found === "number" ? found : typeof found === "string" && found.trim() !== "" ? Number(found) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function claimsHumanReview(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if ((normalized.includes("humanreview") || normalized.includes("reviewedby") || normalized.includes("specialistattestation"))) {
      if (child === true) return true;
      if (typeof child === "string" && child.trim() !== "" && !/^(false|none|null|not[_ -]?reviewed)$/iu.test(child.trim())) return true;
    }
    if (claimsHumanReview(child, depth + 1)) return true;
  }
  return false;
}

function artifactIdentity(value: unknown): NicoArtifactIdentity | undefined {
  const candidate = firstValue(value, new Set(["artifactidentity", "artifact"]));
  if (!candidate || typeof candidate !== "object") return undefined;
  const objectValue = candidate as Record<string, unknown>;
  const hashAndSize = (objectValue.hash_and_size ?? objectValue.hashAndSize ?? objectValue) as unknown;
  try {
    const artifactSchema = firstString(objectValue, ["artifact_schema", "artifactSchema", "schema"], "The NICO artifact schema");
    const artifactId = firstString(objectValue, ["artifact_id", "artifactId", "id"], "The NICO artifact ID");
    const revision = optionalNumber(objectValue, ["revision", "artifact_revision", "artifactRevision"]);
    const digest = firstString(hashAndSize, ["sha256", "digest", "content_sha256", "contentSha256"], "The NICO artifact digest");
    const sizeBytes = optionalNumber(hashAndSize, ["size_bytes", "sizeBytes", "bytes", "content_length", "contentLength"]);
    if (!Number.isSafeInteger(revision) || revision! < 0 || !REPORT_DIGEST.test(digest) || !Number.isSafeInteger(sizeBytes) || sizeBytes! <= 0) return undefined;
    return { artifactSchema, artifactId, revision: revision!, sha256: digest, sizeBytes: sizeBytes! };
  } catch {
    return undefined;
  }
}

function normalizeTargetRepository(value: string): string {
  return canonicalRepository(value).repositoryUrl.toLowerCase();
}

function verifyRun(value: unknown, expected: { runId: string; repositoryUrl: string; commitSha: string }, costLimitUsd: number): RunEvidence {
  if (claimsHumanReview(value)) throw new Error("The automated NICO path may not claim or imply human review.");
  const runId = firstString(value, ["run_id", "runId", "id"], "The NICO run ID");
  const repositoryUrl = firstString(value, ["repository_url", "repositoryUrl", "repo_url", "repoUrl", "repository"], "The NICO repository");
  const commitSha = firstString(value, ["commit_sha", "commitSha", "locked_commit", "lockedCommit", "resolved_commit", "resolvedCommit"], "The NICO commit");
  const status = firstString(value, ["status", "terminal_status", "terminalStatus", "phase"], "The NICO status");
  if (runId !== expected.runId || normalizeTargetRepository(repositoryUrl) !== normalizeTargetRepository(expected.repositoryUrl) || commitSha !== expected.commitSha) {
    throw new Error("The NICO run record does not match the exact requested run, repository, and commit.");
  }
  if (FAILED.test(status)) throw new Error(`NICO stopped without an authorized automated package: ${status}.`);
  const explicitTerminal = firstValue(value, new Set(["terminal", "isterminal", "complete", "completed"])) === true;
  const terminal = explicitTerminal || TERMINAL.has(status.toLowerCase().replace(/[ —-]+/gu, "_"));
  const costUsd = optionalNumber(value, ["cost_usd", "costUsd", "total_cost_usd", "totalCostUsd", "accounted_cost_usd", "accountedCostUsd"]) ?? 0;
  if (costUsd > costLimitUsd) throw new Error("The NICO assessment exceeded the bounded assessment cost limit.");
  return { runId, repositoryUrl: canonicalRepository(repositoryUrl).repositoryUrl, commitSha, status, terminal, artifactIdentity: artifactIdentity(value), costUsd };
}

function unresolvedReviewWorkload(value: unknown): number {
  if (claimsHumanReview(value)) throw new Error("The automated NICO review queue may not contain a human-review claim.");
  const direct = optionalNumber(value, [
    "unresolved_review_workload", "unresolvedReviewWorkload", "unresolved_count", "unresolvedCount",
    "remaining_review_work_units", "remainingReviewWorkUnits", "review_required_count", "reviewRequiredCount", "remaining",
  ]);
  if (direct !== undefined) return direct;
  const items = firstValue(value, new Set(["items", "queue", "workitems", "reviewitems"]));
  if (Array.isArray(items)) {
    return items.filter((item) => {
      if (!item || typeof item !== "object") return true;
      const status = String((item as Record<string, unknown>).status ?? "unresolved").toLowerCase();
      return !new Set(["resolved", "closed", "dismissed", "automatically_resolved"]).has(status);
    }).length;
  }
  throw new Error("NICO did not return a canonical unresolved review workload.");
}

function packageFromUnknown(value: unknown, run: RunEvidence): NicoAutomatedPackage {
  const source = record(value, "The NICO automated package");
  const bodyValue = source.body ?? source.bytes ?? source.content;
  let body: Uint8Array;
  if (bodyValue instanceof Uint8Array) body = new Uint8Array(bodyValue);
  else if (bodyValue instanceof ArrayBuffer) body = new Uint8Array(bodyValue);
  else if (typeof bodyValue === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(bodyValue)) body = new Uint8Array(Buffer.from(bodyValue, "base64"));
  else throw new Error("NICO did not return package bytes.");
  const identity = artifactIdentity(source) ?? run.artifactIdentity;
  if (!identity) throw new Error("NICO did not return an exact artifact schema plus hash-and-size identity.");
  return {
    runId: firstString(source, ["run_id", "runId"], "The package run ID"),
    repositoryUrl: firstString(source, ["repository_url", "repositoryUrl", "repository"], "The package repository"),
    commitSha: firstString(source, ["commit_sha", "commitSha"], "The package commit"),
    artifactIdentity: identity,
    authorizationStatus: firstString(source, ["authorization_status", "authorizationStatus", "status"], "The package authorization status"),
    humanReviewed: firstValue(source, new Set(["humanreviewed"])) === true,
    automatedDeliveryDisclosure: firstString(source, ["automated_delivery_disclosure", "automatedDeliveryDisclosure", "disclosure"], "The package automated-delivery disclosure"),
    contentType: firstString(source, ["content_type", "contentType"], "The package content type"),
    body,
    digest: firstString(source, ["digest", "sha256", "content_sha256", "contentSha256"], "The package digest"),
  };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function maybeJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) return null;
    throw new Error("Durable Telegram NICO state is invalid.");
  }
}

function receipt(workflow: WorkflowState, requestId: string, action: TelegramNicoAction): TelegramNicoReceipt {
  return {
    requestId,
    assessmentRequestId: workflow.assessmentRequestId,
    action,
    state: workflow.stage === "provider_accepted" ? "provider_accepted"
      : workflow.stage === "package_verified" ? "package_verified"
      : workflow.stage === "terminal" ? "terminal"
      : workflow.stage === "failed" ? "failed"
      : workflow.stage === "accepted" || workflow.stage === "target_locked" ? "accepted" : "running",
    runId: workflow.runId,
    repository: workflow.repository,
    repositoryUrl: workflow.repositoryUrl,
    commitSha: workflow.commitSha,
    terminalStatus: workflow.terminalStatus,
    unresolvedReviewWorkload: workflow.unresolvedReviewWorkload,
    automatedPackageAuthorized: workflow.verifiedPackage ? true : undefined,
    reportContentType: workflow.verifiedPackage?.contentType,
    reportDigest: workflow.verifiedPackage?.reportDigest,
    delivery: workflow.delivery,
    updatedAt: workflow.updatedAt,
  };
}

export class TelegramNicoDeliveryOperator {
  readonly #directory: string;
  readonly #commands: string;
  readonly #workflows: string;
  readonly #reports: string;
  readonly #expectedTelegramUserIdSha256: string;
  readonly #nico: NicoBoundary;
  readonly #targetVerifier: ExactTargetVerifier;
  readonly #authorize: TelegramNicoDeliveryOperatorOptions["authorize"];
  readonly #gmailSender?: GmailSender;
  readonly #dailyActionLimit: number;
  readonly #maxConcurrentAssessments: number;
  readonly #assessmentCostLimitUsd: number;
  readonly #now: () => Date;

  constructor(options: TelegramNicoDeliveryOperatorOptions) {
    this.#directory = join(options.stateDirectory, "telegram-nico-actions");
    this.#commands = join(this.#directory, "commands");
    this.#workflows = join(this.#directory, "workflows");
    this.#reports = join(this.#directory, "reports");
    this.#expectedTelegramUserIdSha256 = options.expectedTelegramUserIdSha256;
    this.#nico = options.nicoOperator;
    this.#targetVerifier = options.targetVerifier;
    this.#authorize = options.authorize;
    this.#gmailSender = options.gmailSender ?? options.reportSender;
    this.#dailyActionLimit = options.dailyActionLimit ?? 10;
    this.#maxConcurrentAssessments = options.maxConcurrentAssessments ?? 1;
    this.#assessmentCostLimitUsd = options.assessmentCostLimitUsd ?? 3;
    this.#now = options.now ?? (() => new Date());
  }

  #commandPath(requestId: string): string { return join(this.#commands, `${sha256(requestId)}.json`); }
  #workflowPath(requestId: string): string { return join(this.#workflows, `${sha256(requestId)}.json`); }
  #reportPath(storageName: string): string { return join(this.#reports, storageName); }

  async #prepare(): Promise<void> {
    await Promise.all([
      mkdir(this.#commands, { recursive: true, mode: 0o700 }),
      mkdir(this.#workflows, { recursive: true, mode: 0o700 }),
      mkdir(this.#reports, { recursive: true, mode: 0o700 }),
    ]);
  }

  async #consumeDailyAction(requestId: string): Promise<void> {
    const day = this.#now().toISOString().slice(0, 10);
    const path = join(this.#directory, `daily-${day}.json`);
    const lockPath = `${path}.lock`;
    const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("The Telegram action ledger is busy; retry safely with the same request ID."); });
    try {
      const current = await maybeJson<{ requestIds: string[] }>(path) ?? { requestIds: [] };
      if (current.requestIds.includes(requestId)) return;
      if (current.requestIds.length >= this.#dailyActionLimit) throw new Error("The Telegram NICO daily action limit has been reached.");
      await atomicJson(path, { requestIds: [...current.requestIds, requestId] });
    } finally {
      await lock.close();
      await import("node:fs/promises").then(({ rm }) => rm(lockPath, { force: true }));
    }
  }

  async #assertConcurrency(assessmentRequestId: string): Promise<void> {
    const names = await readdir(this.#workflows).catch(() => [] as string[]);
    let active = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const state = await maybeJson<WorkflowState>(join(this.#workflows, name));
      if (state && state.assessmentRequestId !== assessmentRequestId && !new Set(["terminal", "package_verified", "provider_accepted", "failed"]).has(state.stage)) active += 1;
    }
    if (active >= this.#maxConcurrentAssessments) throw new Error("Another bounded Telegram NICO assessment is already active.");
  }

  async #saveWorkflow(workflow: WorkflowState): Promise<void> {
    await atomicJson(this.#workflowPath(workflow.assessmentRequestId), workflow);
  }

  async #loadWorkflow(assessmentRequestId: string): Promise<WorkflowState> {
    const workflow = await maybeJson<WorkflowState>(this.#workflowPath(assessmentRequestId));
    if (!workflow || workflow.version !== 1 || workflow.assessmentRequestId !== assessmentRequestId) throw new Error("The referenced Telegram NICO assessment does not exist.");
    return workflow;
  }

  async #lockTarget(workflow: WorkflowState): Promise<WorkflowState> {
    if (workflow.stage !== "accepted") return workflow;
    const verified = record(await this.#targetVerifier.verify({ repositoryUrl: workflow.repositoryUrl, commitSha: workflow.commitSha }), "The exact GitHub target verification");
    const target: Target = {
      repository: firstString(verified, ["repository"], "The verified repository"),
      repositoryUrl: firstString(verified, ["repository_url", "repositoryUrl"], "The verified repository URL"),
      commitSha: firstString(verified, ["commit_sha", "commitSha"], "The verified commit"),
    };
    if (normalizeTargetRepository(target.repositoryUrl) !== normalizeTargetRepository(workflow.repositoryUrl) || target.commitSha !== workflow.commitSha) {
      throw new Error("The public repository verifier returned a different immutable target.");
    }
    const next = { ...workflow, repository: target.repository, repositoryUrl: target.repositoryUrl, stage: "target_locked" as const, updatedAt: this.#now().toISOString() };
    await this.#saveWorkflow(next);
    return next;
  }

  async #startRun(workflow: WorkflowState): Promise<WorkflowState> {
    if (workflow.stage !== "target_locked") return workflow;
    await this.#nico.createRun({
      runId: workflow.runId,
      repository: workflow.repositoryUrl,
      repositoryUrl: workflow.repositoryUrl,
      commitSha: workflow.commitSha,
      lockedCommitSha: workflow.commitSha,
      deliveryMode: "automated",
      humanReviewed: false,
    });
    const run = verifyRun(await this.#nico.getRun(workflow.runId), workflow, this.#assessmentCostLimitUsd);
    const next: WorkflowState = {
      ...workflow,
      stage: run.terminal ? "terminal" : "running",
      terminalStatus: run.terminal ? run.status : undefined,
      artifactIdentity: run.artifactIdentity,
      costUsd: run.costUsd,
      updatedAt: this.#now().toISOString(),
    };
    await this.#saveWorkflow(next);
    return next;
  }

  async #refresh(workflow: WorkflowState): Promise<WorkflowState> {
    const run = verifyRun(await this.#nico.getRun(workflow.runId), workflow, this.#assessmentCostLimitUsd);
    const next: WorkflowState = {
      ...workflow,
      stage: run.terminal ? "terminal" : "running",
      terminalStatus: run.terminal ? run.status : workflow.terminalStatus,
      artifactIdentity: run.artifactIdentity ?? workflow.artifactIdentity,
      costUsd: Math.max(workflow.costUsd, run.costUsd),
      updatedAt: this.#now().toISOString(),
    };
    await this.#saveWorkflow(next);
    return next;
  }

  async #continue(workflow: WorkflowState): Promise<WorkflowState> {
    if (new Set(["terminal", "package_verified", "provider_accepted"]).has(workflow.stage)) return workflow;
    const run = verifyRun(await this.#nico.continueRun(workflow.runId), workflow, this.#assessmentCostLimitUsd);
    const next: WorkflowState = {
      ...workflow,
      stage: run.terminal ? "terminal" : "running",
      terminalStatus: run.terminal ? run.status : undefined,
      artifactIdentity: run.artifactIdentity ?? workflow.artifactIdentity,
      costUsd: Math.max(workflow.costUsd, run.costUsd),
      updatedAt: this.#now().toISOString(),
    };
    await this.#saveWorkflow(next);
    return next;
  }

  async #driveToTerminal(workflow: WorkflowState): Promise<WorkflowState> {
    let current = workflow;
    for (let phase = 0; phase < 24; phase += 1) {
      current = await this.#refresh(current);
      if (current.stage === "terminal") return current;
      current = await this.#continue(current);
      if (current.stage === "terminal") return current;
    }
    throw new Error("NICO did not reach a terminal state within the bounded continuation limit.");
  }

  async #verifyPackage(workflow: WorkflowState): Promise<WorkflowState> {
    if (workflow.stage === "package_verified" || workflow.stage === "provider_accepted") return workflow;
    if (workflow.stage !== "terminal" || !workflow.artifactIdentity) throw new Error("A terminal exact-artifact NICO run is required before package authorization.");
    const queue = await this.#nico.getReviewQueue(workflow.runId);
    const unresolved = unresolvedReviewWorkload(queue);
    if (unresolved !== 0) throw new Error(`NICO automated delivery requires zero unresolved review workload; found ${unresolved}.`);
    const raw = await this.#nico.getAutomatedDeliveryPackage({
      runId: workflow.runId,
      repositoryUrl: workflow.repositoryUrl,
      commitSha: workflow.commitSha,
      artifactIdentity: workflow.artifactIdentity,
      deliveryMode: "automated",
    });
    const verified: VerifiedNicoAutomatedPackage = verifyNicoAutomatedPackage(packageFromUnknown(raw, {
      runId: workflow.runId,
      repositoryUrl: workflow.repositoryUrl,
      commitSha: workflow.commitSha,
      status: workflow.terminalStatus ?? "complete",
      terminal: true,
      artifactIdentity: workflow.artifactIdentity,
      costUsd: workflow.costUsd,
    }), {
      runId: workflow.runId,
      repositoryUrl: workflow.repositoryUrl,
      commitSha: workflow.commitSha,
      artifactIdentity: workflow.artifactIdentity,
    });
    const storageName = `${sha256(`${workflow.assessmentRequestId}:${verified.reportDigest}`)}.bin`;
    const reportPath = this.#reportPath(storageName);
    try {
      const handle = await open(reportPath, "wx", 0o600);
      await handle.writeFile(verified.reportBytes);
      await handle.close();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("EEXIST")) throw error;
      const existing = new Uint8Array(await readFile(reportPath));
      if (sha256(existing) !== verified.reportDigest) throw new Error("The private verified report store contains inconsistent bytes.");
    }
    const next: WorkflowState = {
      ...workflow,
      stage: "package_verified",
      unresolvedReviewWorkload: 0,
      verifiedPackage: { contentType: verified.contentType, reportDigest: verified.reportDigest, storageName },
      updatedAt: this.#now().toISOString(),
    };
    await this.#saveWorkflow(next);
    return next;
  }

  async #email(workflow: WorkflowState, command: TelegramNicoCommand): Promise<WorkflowState> {
    if (workflow.stage === "provider_accepted") return workflow;
    if (workflow.stage !== "package_verified" || !workflow.verifiedPackage) throw new Error("Only an independently verified NICO automated package may be emailed.");
    if (!this.#gmailSender) throw new Error("SARA Gmail is not authenticated for verified report delivery.");
    if (command.reportDigest && command.reportDigest !== workflow.verifiedPackage.reportDigest) throw new Error("The requested email digest does not match the verified report.");
    const bytes = new Uint8Array(await readFile(this.#reportPath(workflow.verifiedPackage.storageName)));
    if (sha256(bytes) !== workflow.verifiedPackage.reportDigest) throw new Error("The private report bytes changed after verification.");
    const delivery = await this.#gmailSender.send({
      requestId: `email:${workflow.assessmentRequestId}`,
      sender: command.sender ?? GMAIL_REPORT_SENDER,
      recipient: command.recipient ?? GMAIL_REPORT_RECIPIENT,
      repository: workflow.repository,
      commitSha: workflow.commitSha,
      reportDigest: workflow.verifiedPackage.reportDigest,
      contentType: workflow.verifiedPackage.contentType,
      reportBytes: bytes,
    });
    const next: WorkflowState = { ...workflow, stage: "provider_accepted", delivery, updatedAt: this.#now().toISOString() };
    await this.#saveWorkflow(next);
    return next;
  }

  async submit(inputValue: TelegramNicoCommand): Promise<TelegramNicoReceipt> {
    const input = validateCommand(inputValue);
    if (!pairedIdentity(input.telegramUserId, this.#expectedTelegramUserIdSha256)) throw new Error("Only Cody's paired Telegram identity may invoke operational actions.");
    await this.#prepare();
    const assessmentRequestId = input.action === "nico_assessment_start" ? input.requestId : (input.assessmentRequestId ?? input.requestId);
    const digest = sha256(JSON.stringify(stableCommand(input)));
    const commandPath = this.#commandPath(input.requestId);
    const existing = await maybeJson<CommandState>(commandPath);
    if (existing) {
      if (existing.inputDigest !== digest || existing.assessmentRequestId !== assessmentRequestId || existing.action !== input.action) {
        throw new Error("The Telegram request ID is already bound to a different action.");
      }
      if (existing.status === "completed" && existing.result) return existing.result;
      if (existing.status === "failed" && existing.failure) throw new Error(existing.failure.reason);
    } else {
      await atomicJson(commandPath, {
        version: 1,
        inputDigest: digest,
        action: input.action,
        assessmentRequestId,
        status: "accepted",
        updatedAt: this.#now().toISOString(),
      } satisfies CommandState);
      await this.#consumeDailyAction(input.requestId);
    }

    const decision = await this.#authorize({ action: input.action, requestId: input.requestId, assessmentRequestId });
    if (!decision.allowed) {
      await atomicJson(commandPath, { version: 1, inputDigest: digest, action: input.action, assessmentRequestId, status: "failed", failure: { code: decision.code, reason: decision.reason }, updatedAt: this.#now().toISOString() } satisfies CommandState);
      throw new Error(decision.reason);
    }
    await atomicJson(commandPath, { version: 1, inputDigest: digest, action: input.action, assessmentRequestId, status: "working", updatedAt: this.#now().toISOString() } satisfies CommandState);

    try {
      let workflow: WorkflowState;
      if (input.action === "nico_assessment_start") {
        const target = canonicalRepository(input.repository!);
        workflow = await maybeJson<WorkflowState>(this.#workflowPath(assessmentRequestId)) ?? {
          version: 1,
          assessmentRequestId,
          telegramUserIdSha256: sha256(input.telegramUserId),
          repository: target.repository,
          repositoryUrl: target.repositoryUrl,
          commitSha: input.commitSha!,
          runId: `sara-telegram-nico-${sha256(assessmentRequestId).slice(0, 24)}`,
          stage: "accepted",
          costUsd: 0,
          updatedAt: this.#now().toISOString(),
        };
        if (workflow.repositoryUrl !== target.repositoryUrl || workflow.commitSha !== input.commitSha) throw new Error("The assessment request is already bound to a different immutable target.");
        await this.#saveWorkflow(workflow);
        await this.#assertConcurrency(assessmentRequestId);
        workflow = await this.#lockTarget(workflow);
        workflow = await this.#startRun(workflow);
        if (input.emailVerifiedReport === true) {
          workflow = await this.#driveToTerminal(workflow);
          workflow = await this.#verifyPackage(workflow);
          workflow = await this.#email(workflow, {
            ...input,
            sender: input.sender ?? GMAIL_REPORT_SENDER,
            recipient: input.recipient ?? GMAIL_REPORT_RECIPIENT,
          });
        }
      } else {
        workflow = await this.#loadWorkflow(assessmentRequestId);
        if (input.action === "nico_assessment_status") workflow = await this.#refresh(workflow);
        if (input.action === "nico_assessment_continue") workflow = await this.#continue(workflow);
        if (input.action === "nico_automated_package") workflow = await this.#verifyPackage(await this.#driveToTerminal(workflow));
        if (input.action === "email_verified_report") workflow = await this.#email(workflow, input);
      }
      const result = receipt(workflow, input.requestId, input.action);
      await atomicJson(commandPath, { version: 1, inputDigest: digest, action: input.action, assessmentRequestId, status: "completed", result, updatedAt: this.#now().toISOString() } satisfies CommandState);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "The Telegram NICO action failed closed.";
      await atomicJson(commandPath, { version: 1, inputDigest: digest, action: input.action, assessmentRequestId, status: "failed", failure: { code: "TELEGRAM_NICO_ACTION_FAILED", reason }, updatedAt: this.#now().toISOString() } satisfies CommandState);
      throw new Error(reason);
    }
  }
}
