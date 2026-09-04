const NICO_HOST = "app.nicoaudit.com";
const NICO_PATH = "/api/nico/";
const RUN_ID = /^comprun_[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export type NicoArtifactIdentity = {
  schema: string;
  run_id: string;
  revision: number;
  report_artifact_digest: string;
  artifact_digests: Record<string, string>;
};

export type NicoRunInput = {
  runId: string;
  repository: string;
  commitSha: string;
  clientName: string;
  projectName: string;
  authorizedBy: string;
  authorizationScope: string;
  primaryTechnicalContact: string;
};

export type NicoFinalizeInput = {
  reviewer: string;
  reviewerRole: string;
  decisionReason: string;
  expectedArtifactIdentity: NicoArtifactIdentity;
  confirmExactReport: boolean;
};

export type NicoDeliveryAuthorizationInput = {
  authorizer: string;
  authorizerRole: string;
  authorizationReason: string;
  expectedArtifactIdentity: NicoArtifactIdentity;
  confirmDelivery: boolean;
};

export type NicoAutomatedDeliveryInput = {
  expectedArtifactIdentity: NicoArtifactIdentity;
  confirmExactArtifact: boolean;
  confirmAutomatedDisclosure: boolean;
};

export type NicoArtifactFormat = "markdown" | "html" | "json" | "pdf";

export interface NicoOperator {
  createRun(input: NicoRunInput): Promise<Record<string, unknown>>;
  getRun(runId: string): Promise<Record<string, unknown>>;
  continueRun(runId: string): Promise<Record<string, unknown>>;
  getReport(runId: string, format: NicoArtifactFormat): Promise<{ contentType: string; body: Uint8Array }>;
  getReviewQueue(runId: string, password?: string): Promise<Record<string, unknown>>;
  finalizeExactDraft(runId: string, password: string | undefined, input: NicoFinalizeInput): Promise<Record<string, unknown>>;
  authorizeDelivery(runId: string, password: string | undefined, input: NicoDeliveryAuthorizationInput): Promise<Record<string, unknown>>;
  getApprovedDeliveryPackage(runId: string, password?: string): Promise<{ contentType: string; body: Uint8Array; digest: string | null }>;
  getAutomatedDeliveryPackage(runId: string, password: string | undefined, input: NicoAutomatedDeliveryInput): Promise<{ contentType: string; body: Uint8Array; digest: string | null }>;
}

type ClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  operatorPassword?: string;
};

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`${label} must contain ${minimum} through ${maximum} characters.`);
  }
  if (/[\r\n\0]/u.test(result)) throw new Error(`${label} contains prohibited control characters.`);
  return result;
}

function runId(value: string): string {
  if (!RUN_ID.test(value)) throw new Error("NICO run ID is invalid.");
  return value;
}

function password(value: string): string {
  return boundedText(value, 8, 512, "NICO finalization password");
}

function artifactIdentity(value: NicoArtifactIdentity, expectedRunId: string): NicoArtifactIdentity {
  if (!value || typeof value !== "object" || value.run_id !== expectedRunId) {
    throw new Error("The exact artifact run identity does not match the requested NICO run.");
  }
  const schema = boundedText(value.schema, 3, 160, "artifact identity schema");
  if (!Number.isInteger(value.revision) || value.revision < 1) throw new Error("Artifact revision must be a positive integer.");
  if (!SHA256.test(value.report_artifact_digest)) throw new Error("Report artifact digest must be a SHA-256 digest.");
  const entries = Object.entries(value.artifact_digests ?? {});
  if (entries.length === 0 || entries.length > 16) throw new Error("Artifact digests are required and bounded.");
  const digests = Object.fromEntries(entries.map(([key, digest]) => {
    const safeKey = boundedText(key, 1, 80, "artifact digest key");
    if (!SHA256.test(digest)) throw new Error(`Artifact digest ${safeKey} must be a SHA-256 digest.`);
    return [safeKey, digest];
  }));
  return {
    schema,
    run_id: expectedRunId,
    revision: value.revision,
    report_artifact_digest: value.report_artifact_digest,
    artifact_digests: digests,
  };
}

export function extractNicoArtifactIdentity(value: unknown, expectedRunId: string): NicoArtifactIdentity | null {
  const visited = new Set<object>();
  const visit = (candidate: unknown): NicoArtifactIdentity | null => {
    if (!candidate || typeof candidate !== "object") return null;
    if (visited.has(candidate)) return null;
    visited.add(candidate);
    if (!Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      if (
        typeof record.schema === "string" &&
        record.run_id === expectedRunId &&
        Number.isInteger(record.revision) &&
        typeof record.report_artifact_digest === "string" &&
        record.artifact_digests && typeof record.artifact_digests === "object"
      ) {
        return artifactIdentity(record as NicoArtifactIdentity, expectedRunId);
      }
      for (const nested of Object.values(record)) {
        const found = visit(nested);
        if (found) return found;
      }
      return null;
    }
    for (const nested of candidate) {
      const found = visit(nested);
      if (found) return found;
    }
    return null;
  };
  return visit(value);
}

export function assertNicoRunTarget(value: unknown, expectedRunId: string, expectedCommitSha: string): void {
  const serialized = JSON.stringify(value);
  if (!serialized.includes(expectedRunId) || !serialized.includes(expectedCommitSha)) {
    throw new Error("NICO run response is not bound to the expected run and immutable commit.");
  }
}

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("NICO response exceeded the permitted size.");
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximum) throw new Error("NICO response exceeded the permitted size.");
  return body;
}

export class NicoOperatorClient implements NicoOperator {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #operatorPassword?: string;

  constructor(options: ClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "https:") throw new Error("NICO operator requires HTTPS.");
    if (baseUrl.hostname !== NICO_HOST) throw new Error(`NICO operator is restricted to ${NICO_HOST}.`);
    if (baseUrl.pathname !== NICO_PATH) throw new Error(`NICO operator base URL must end with ${NICO_PATH}.`);
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("NICO operator URL cannot contain credentials, query, or fragment.");
    this.#baseUrl = baseUrl;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#operatorPassword = options.operatorPassword === undefined ? undefined : password(options.operatorPassword);
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 120_000) {
      throw new Error("NICO request timeout must be between 1 and 120 seconds.");
    }
  }

  async #requestJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { accept: "application/json", ...(init.headers ?? {}) },
    });
    if (response.status >= 300 && response.status < 400) throw new Error("NICO refused a redirected request.");
    if (!response.ok) throw new Error(`NICO request failed with HTTP ${response.status}.`);
    const bytes = await boundedBody(response, MAX_JSON_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("NICO returned malformed JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("NICO returned an invalid response object.");
    return parsed as Record<string, unknown>;
  }

  #jsonBody(value: unknown): Pick<RequestInit, "headers" | "body"> {
    return { headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
  }

  #privilegedJsonBody(secret: string, value?: unknown): Pick<RequestInit, "headers" | "body"> {
    return {
      headers: {
        "content-type": "application/json",
        "x-nico-admin-token": password(secret),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    };
  }

  #credential(override?: string): string {
    if (override !== undefined) return password(override);
    if (this.#operatorPassword) return this.#operatorPassword;
    throw new Error("SARA's NICO operator password is not configured.");
  }

  createRun(input: NicoRunInput): Promise<Record<string, unknown>> {
    const id = runId(input.runId);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repository)) throw new Error("Repository must be an owner/name public GitHub repository.");
    if (!COMMIT_SHA.test(input.commitSha)) throw new Error("NICO intake requires an exact lowercase 40-character commit SHA.");
    const observedAt = new Date().toISOString();
    const body = {
      run_id: id,
      repository: input.repository,
      provider: "github",
      provider_access_mode: "anonymous_public",
      customer_id: boundedText(input.clientName, 3, 160, "clientName"),
      project_id: boundedText(input.projectName, 3, 160, "projectName"),
      client_name: boundedText(input.clientName, 3, 160, "clientName"),
      project_name: boundedText(input.projectName, 3, 160, "projectName"),
      authorized_by: boundedText(input.authorizedBy, 3, 160, "authorizedBy"),
      authorization_scope: boundedText(input.authorizationScope, 8, 1_000, "authorizationScope"),
      authorization_confirmed: true,
      authorized: true,
      expected_commit_sha: input.commitSha,
      assessment_depth: "comprehensive",
      report_language: "en",
      timeframe_days: 180,
      human_evidence: {
        stakeholder_context: {
          evidence: {
            access_method: ["Authorized public GitHub repository, anonymous/read-only."],
            primary_technical_contact: [boundedText(input.primaryTechnicalContact, 3, 160, "primaryTechnicalContact")],
            authorized_scope: [boundedText(input.authorizationScope, 8, 1_000, "authorizationScope")],
            automation_coordinator: ["SARA — owner-controlled NICO operator"],
          },
          reviewer: boundedText(input.authorizedBy, 3, 160, "authorizedBy"),
          observed_at: observedAt,
          source_reference: `https://github.com/${input.repository}/commit/${input.commitSha}`,
          excluded: false,
          exclusion_rationale: "",
        },
      },
    };
    return this.#requestJson("assessment/comprehensive-intake", { method: "POST", ...this.#jsonBody(body) });
  }

  getRun(id: string): Promise<Record<string, unknown>> {
    return this.#requestJson(`assessment/comprehensive-run/${runId(id)}`, {
      headers: { "x-nico-browser-projection": "terminal-manifest-v1" },
    });
  }

  continueRun(id: string): Promise<Record<string, unknown>> {
    return this.#requestJson(`assessment/comprehensive-run/${runId(id)}/continue`, {
      method: "POST",
      ...this.#jsonBody({ max_stages: 1 }),
    });
  }

  async getReport(id: string, format: NicoArtifactFormat): Promise<{ contentType: string; body: Uint8Array }> {
    if (!new Set<NicoArtifactFormat>(["markdown", "html", "json", "pdf"]).has(format)) throw new Error("Unsupported NICO report format.");
    const response = await this.#fetch(new URL(`assessment/comprehensive-run/${runId(id)}/report/${format}`, this.#baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("NICO refused a redirected report request.");
    if (!response.ok) throw new Error(`NICO report request failed with HTTP ${response.status}.`);
    return { contentType: response.headers.get("content-type") ?? "application/octet-stream", body: await boundedBody(response, MAX_ARTIFACT_BYTES) };
  }

  getReviewQueue(id: string, secret?: string): Promise<Record<string, unknown>> {
    return this.#requestJson(`assessment/comprehensive-run/${runId(id)}/review-queue`, {
      ...this.#privilegedJsonBody(this.#credential(secret)),
    });
  }

  finalizeExactDraft(idInput: string, secret: string | undefined, input: NicoFinalizeInput): Promise<Record<string, unknown>> {
    const id = runId(idInput);
    if (input.confirmExactReport !== true) throw new Error("Explicit exact-report confirmation is required.");
    const body = {
      review_authorized: true,
      authorization_confirmed: true,
      reviewer: boundedText(input.reviewer, 3, 160, "reviewer"),
      reviewer_role: boundedText(input.reviewerRole, 3, 160, "reviewerRole"),
      decision: "approved",
      decision_reason: boundedText(input.decisionReason, 8, 1_000, "decisionReason"),
      expected_artifact_identity: artifactIdentity(input.expectedArtifactIdentity, id),
    };
    return this.#requestJson(`assessment/comprehensive-run/${id}/review`, {
      method: "POST",
      ...this.#privilegedJsonBody(this.#credential(secret), body),
    });
  }

  authorizeDelivery(idInput: string, secret: string | undefined, input: NicoDeliveryAuthorizationInput): Promise<Record<string, unknown>> {
    const id = runId(idInput);
    if (input.confirmDelivery !== true) throw new Error("Explicit client-delivery confirmation is required.");
    const body = {
      delivery_authorized: true,
      authorization_confirmed: true,
      authorizer: boundedText(input.authorizer, 3, 160, "authorizer"),
      authorizer_role: boundedText(input.authorizerRole, 3, 160, "authorizerRole"),
      authorization_reason: boundedText(input.authorizationReason, 8, 1_000, "authorizationReason"),
      expected_artifact_identity: artifactIdentity(input.expectedArtifactIdentity, id),
    };
    return this.#requestJson(`assessment/comprehensive-run/${id}/authorize-delivery`, {
      method: "POST",
      ...this.#privilegedJsonBody(this.#credential(secret), body),
    });
  }

  async getApprovedDeliveryPackage(id: string, secret?: string): Promise<{ contentType: string; body: Uint8Array; digest: string | null }> {
    const response = await this.#fetch(new URL(`assessment/comprehensive-run/${runId(id)}/approved-delivery-package`, this.#baseUrl), {
      headers: { "x-nico-admin-token": this.#credential(secret) },
      redirect: "manual",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("NICO refused a redirected package request.");
    if (!response.ok) throw new Error(`NICO package request failed with HTTP ${response.status}.`);
    return {
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body: await boundedBody(response, MAX_ARTIFACT_BYTES),
      digest: response.headers.get("x-nico-certified-package-sha256"),
    };
  }

  async getAutomatedDeliveryPackage(
    idInput: string,
    secret: string | undefined,
    input: NicoAutomatedDeliveryInput,
  ): Promise<{ contentType: string; body: Uint8Array; digest: string | null }> {
    const id = runId(idInput);
    if (input.confirmExactArtifact !== true || input.confirmAutomatedDisclosure !== true) {
      throw new Error("Exact-artifact and automated-disclosure confirmations are required.");
    }
    const response = await this.#fetch(new URL(`assessment/comprehensive-run/${id}/automated-delivery-package`, this.#baseUrl), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(this.#timeoutMs),
      ...this.#privilegedJsonBody(this.#credential(secret), {
        automated_authorization_confirmed: true,
        exact_artifact_confirmed: true,
        automated_disclosure_confirmed: true,
        expected_artifact_identity: artifactIdentity(input.expectedArtifactIdentity, id),
      }),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("NICO refused a redirected automated-delivery request.");
    if (!response.ok) throw new Error(`NICO automated-delivery request failed with HTTP ${response.status}.`);
    if (response.headers.get("x-nico-authorization-mode") !== "automated_policy") {
      throw new Error("NICO returned an invalid automated authorization mode.");
    }
    if (response.headers.get("x-nico-human-reviewed") !== "false") {
      throw new Error("NICO returned an invalid human-review disclosure.");
    }
    return {
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body: await boundedBody(response, MAX_ARTIFACT_BYTES),
      digest: response.headers.get("x-nico-certified-package-sha256"),
    };
  }
}
