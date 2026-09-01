import {
  MODEL_EXECUTOR_KIND,
  MODEL_GENERATOR_ID,
  SITE_EXECUTOR_KIND,
  SITE_GENERATOR_ID,
  type ClaimedSiteDirective,
  type SiteDirectiveShadowResult,
} from "./site-directive.ts";

const EXECUTOR_AUDIENCE = "https://saraseed.app/api/executor";
const PRODUCTION_ORIGIN = "https://saraseed.app";

export type SiteDirectiveClaim = {
  directive: ClaimedSiteDirective;
  claim: { id: string; expiresAt: string };
};

export type SiteDirectiveFailedResult = {
  schemaVersion: 1;
  status: "FAILED";
  maximumCostUsd: 0;
  generatorId: typeof SITE_GENERATOR_ID | typeof MODEL_GENERATOR_ID;
  failureCode: string;
  failureDigest: string;
  lessons: string[];
};

type FetchLike = typeof fetch;

function actionEnvironment(environment: NodeJS.ProcessEnv): void {
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_REPOSITORY !== "BoneManTGRM/SARA" ||
    environment.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("The site executor may run only in SARA's main-branch GitHub Actions environment.");
  }
}

function executorOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.origin !== PRODUCTION_ORIGIN || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("The executor endpoint must be the canonical saraseed.app origin.");
  }
  return parsed.origin;
}

async function responseJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed with HTTP ${response.status}; response digest input length ${body.length}.`);
  }
  return response.json() as Promise<T>;
}

export async function requestGithubOidcToken(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  actionEnvironment(environment);
  const requestUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error("GitHub OIDC request capability is unavailable.");
  const url = new URL(requestUrl);
  if (url.protocol !== "https:") throw new Error("GitHub OIDC request URL must use HTTPS.");
  url.searchParams.set("audience", EXECUTOR_AUDIENCE);
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${requestToken}`, accept: "application/json" },
    redirect: "error",
  });
  const body = await responseJson<{ value?: unknown }>(response, "GitHub OIDC token request");
  if (typeof body.value !== "string" || body.value.length < 32 || body.value.length > 24_000) {
    throw new Error("GitHub OIDC response did not contain a bounded token.");
  }
  return body.value;
}

export async function claimSiteDirective(
  oidcToken: string,
  origin = PRODUCTION_ORIGIN,
  fetchImpl: FetchLike = fetch,
): Promise<SiteDirectiveClaim | null> {
  const endpoint = `${executorOrigin(origin)}/api/executor/directives/claim`;
  const claim = async (
    body: Record<string, unknown>,
    unsupportedDuringMigration = false,
  ): Promise<SiteDirectiveClaim | null> => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${oidcToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
    });
    if (response.status === 204) return null;
    if (unsupportedDuringMigration && response.status === 400) return null;
    return responseJson<SiteDirectiveClaim>(response, "Directive claim");
  };
  const generated = await claim(
    { maximumBudgetUsd: 0, executorKind: MODEL_EXECUTOR_KIND },
    true,
  );
  if (generated) return generated;
  return claim({
    maximumBudgetUsd: 0,
    executorKind: SITE_EXECUTOR_KIND,
    recoveryDirectiveId: "488818de-840a-42cd-a951-1a69b2067f9d",
  });
}

export async function recordSiteDirectiveResult(
  oidcToken: string,
  directiveId: string,
  claimId: string,
  result: SiteDirectiveShadowResult | SiteDirectiveFailedResult,
  origin = PRODUCTION_ORIGIN,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/iu.test(directiveId) || !/^[0-9a-f-]{36}$/iu.test(claimId)) {
    throw new Error("Directive and claim ids must be UUID-shaped identifiers.");
  }
  const response = await fetchImpl(
    `${executorOrigin(origin)}/api/executor/directives/${encodeURIComponent(directiveId)}/result`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${oidcToken}`, "content-type": "application/json" },
      body: JSON.stringify({ claimId, result }),
      redirect: "error",
    },
  );
  await responseJson<{ directive: unknown }>(response, "Directive result recording");
}
