import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const GMAIL_REPORT_SENDER = "sara.reparodynamics@gmail.com";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_OAUTH_SCOPES = Object.freeze(["openid", "email", GMAIL_SEND_SCOPE]);

export type GmailOAuthActivationReceipt = {
  status: "activated";
  authenticatedSender: typeof GMAIL_REPORT_SENDER;
  permission: "gmail.send";
  authenticatedAt: string;
};

export interface RefreshTokenSecretWriter {
  write(refreshToken: string): Promise<void>;
}

type PendingAuthorization = {
  version: 1;
  stateSha256: string;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
};

export type GmailOAuthActivationOptions = {
  stateDirectory: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  secretWriter: RefreshTokenSecretWriter;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  randomBytesImpl?: (size: number) => Buffer;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function requireSecret(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length < 8) throw new Error(`${name} is not configured.`);
  return value.trim();
}

function pendingPath(directory: string, state: string): string {
  return join(directory, `${sha256(state)}.pending.json`);
}

function consumingPath(directory: string, state: string): string {
  return join(directory, `${sha256(state)}.consuming.json`);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function assertHttpsRedirect(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Gmail OAuth redirect URI is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Gmail OAuth redirect URI must be a protected HTTPS URL.");
  return url.toString();
}

export class GmailOAuthActivation {
  readonly #directory: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;
  readonly #secretWriter: RefreshTokenSecretWriter;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => Date;
  readonly #randomBytes: (size: number) => Buffer;

  constructor(options: GmailOAuthActivationOptions) {
    this.#directory = join(options.stateDirectory, "gmail-oauth-activation");
    this.#clientId = requireSecret(options.clientId, "Gmail OAuth client ID");
    this.#clientSecret = requireSecret(options.clientSecret, "Gmail OAuth client secret");
    this.#redirectUri = assertHttpsRedirect(options.redirectUri);
    this.#secretWriter = options.secretWriter;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#randomBytes = options.randomBytesImpl ?? randomBytes;
  }

  async start(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const state = base64url(this.#randomBytes(32));
    const codeVerifier = base64url(this.#randomBytes(48));
    const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const pending: PendingAuthorization = {
      version: 1,
      stateSha256: sha256(state),
      codeVerifier,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const file = pendingPath(this.#directory, state);
    const handle = await open(file, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(pending)}\n`, "utf8");
    await handle.close();

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", this.#redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GMAIL_OAUTH_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "false");
    url.searchParams.set("login_hint", GMAIL_REPORT_SENDER);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async complete(input: { state: string; code: string }): Promise<GmailOAuthActivationReceipt> {
    if (!/^[A-Za-z0-9_-]{32,256}$/u.test(input.state) || typeof input.code !== "string" || input.code.length < 8 || input.code.length > 4096) {
      throw new Error("Gmail OAuth callback is invalid.");
    }
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const source = pendingPath(this.#directory, input.state);
    const consuming = consumingPath(this.#directory, input.state);
    try {
      await rename(source, consuming);
    } catch {
      throw new Error("Gmail OAuth state is absent, expired, or already used.");
    }

    try {
      const pending = JSON.parse(await readFile(consuming, "utf8")) as PendingAuthorization;
      if (pending.version !== 1 || pending.stateSha256 !== sha256(input.state) || Date.parse(pending.expiresAt) <= this.#now().getTime()) {
        throw new Error("Gmail OAuth state is absent, expired, or already used.");
      }
      const tokenResponse = await this.#fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          code: input.code,
          code_verifier: pending.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: this.#redirectUri,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResponse.ok) throw new Error("Google rejected Gmail OAuth authorization.");
      const tokens = await tokenResponse.json() as { access_token?: unknown; refresh_token?: unknown; token_type?: unknown; scope?: unknown };
      if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string" || String(tokens.token_type).toLowerCase() !== "bearer") {
        throw new Error("Google did not return the required offline Gmail authorization.");
      }
      if (typeof tokens.scope === "string") {
        const granted = new Set(tokens.scope.split(/\s+/u).filter(Boolean));
        if (!GMAIL_OAUTH_SCOPES.every((scope) => granted.has(scope))) throw new Error("Google did not grant the minimum required Gmail permission.");
        const allowed = new Set([...GMAIL_OAUTH_SCOPES, "https://www.googleapis.com/auth/userinfo.email"]);
        if ([...granted].some((scope) => !allowed.has(scope))) throw new Error("Google returned permissions broader than this Gmail capability allows.");
      }
      const identityResponse = await this.#fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!identityResponse.ok) throw new Error("Google Gmail identity verification failed.");
      const identity = await identityResponse.json() as { email?: unknown; email_verified?: unknown };
      if (typeof identity.email !== "string" || identity.email.toLowerCase() !== GMAIL_REPORT_SENDER || identity.email_verified !== true) {
        throw new Error(`Gmail activation requires exactly ${GMAIL_REPORT_SENDER}.`);
      }
      await this.#secretWriter.write(tokens.refresh_token);
      return {
        status: "activated",
        authenticatedSender: GMAIL_REPORT_SENDER,
        permission: "gmail.send",
        authenticatedAt: this.#now().toISOString(),
      };
    } finally {
      await rm(consuming, { force: true });
    }
  }
}

export type RailwayRefreshTokenSecretWriterOptions = {
  projectToken: string;
  projectId: string;
  serviceId: string;
  environmentId: string;
  variableName?: "SARA_GMAIL_REFRESH_TOKEN";
  fetchImpl?: typeof fetch;
};

export class RailwayRefreshTokenSecretWriter implements RefreshTokenSecretWriter {
  readonly #projectToken: string;
  readonly #projectId: string;
  readonly #serviceId: string;
  readonly #environmentId: string;
  readonly #variableName: "SARA_GMAIL_REFRESH_TOKEN";
  readonly #fetchImpl: typeof fetch;

  constructor(options: RailwayRefreshTokenSecretWriterOptions) {
    this.#projectToken = requireSecret(options.projectToken, "Railway project token");
    this.#projectId = requireSecret(options.projectId, "Railway project ID");
    this.#serviceId = requireSecret(options.serviceId, "Railway service ID");
    this.#environmentId = requireSecret(options.environmentId, "Railway environment ID");
    this.#variableName = options.variableName ?? "SARA_GMAIL_REFRESH_TOKEN";
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async write(refreshToken: string): Promise<void> {
    if (typeof refreshToken !== "string" || refreshToken.length < 16) throw new Error("Google did not return a usable refresh token.");
    const query = `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`;
    const response = await this.#fetchImpl("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Project-Access-Token": this.#projectToken,
      },
      body: JSON.stringify({
        query,
        variables: {
          input: {
            projectId: this.#projectId,
            environmentId: this.#environmentId,
            serviceId: this.#serviceId,
            variables: { [this.#variableName]: refreshToken },
            skipDeploys: false,
          },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Railway rejected Gmail OAuth secret installation.");
    const result = await response.json() as { errors?: unknown[]; data?: unknown };
    if (Array.isArray(result.errors) && result.errors.length > 0) throw new Error("Railway rejected Gmail OAuth secret installation.");
  }
}
