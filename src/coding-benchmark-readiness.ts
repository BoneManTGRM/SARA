import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./canonical.ts";

// Historical unresolved authorization remains the default and can never be
// cleared by a new UUID or missing evidence.
export const CODING_BENCHMARK_CONTINUATION = Object.freeze({
  benchmarkId: "41267154-ba42-496a-bb79-1656898ac716",
  originalSourceRevision: "30a7cb3c21a77b65bf7ba2c4c393897850e61eeb",
  originalAuthorityDigest: "6ceb8530c59902abd842483a059e337a30f4979eceaa0f93979269dd2e5c4f0c",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  unresolvedExposureUsd: 0.15,
  historicalResolutionEvidence: null,
});

export const ADDITIONAL_CODING_BENCHMARK_GRANT = Object.freeze({
  benchmarkId: "33d94c9a-0de6-41d9-a843-fe9880994242",
  registrationSourceRevision: "9fa4945bd8becab34ee536ce86dc45d6c8a5bd43",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  unresolvedExposureUsd: 0,
  activationSha256: "8e2feaaa7d017d3fedc304c36d40062efffeaf49b7840d3ed32362caf0fc4bba",
});

// Separately approved post-PR111 trial. Historical grant objects and receipts
// remain immutable; activation uses a fresh identity, never a replay allowance.
export const POST_FIX_CODING_BENCHMARK_GRANT = Object.freeze({
  benchmarkId: "88390661-7819-42f5-a7d3-eb2f3d985e5f",
  registrationSourceRevision: "adea96e56de8f9b64d96e301ab401abcec23e759",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  unresolvedExposureUsd: 0,
  activationSha256: "9dfb3e2c40f14cc997373ad074b84dc80090c1b1ddf1e42f32cd7a57edea4d60",
});

// New owner request: one current-component pilot, not a historical grant replay.
export const CURRENT_CODING_BENCHMARK_GRANT = Object.freeze({
  benchmarkId: "90add88e-27a3-4f9b-9437-7e41e5878433",
  registrationSourceRevision: "3388b92103a4f864a366597ad96d615882658e16",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  unresolvedExposureUsd: 0,
  activationSha256: "49135ba940f93ec15e8a8e62556c0d531463567a1d282955c122c7e39ad46bad",
});

// Owner-requested maximum-observed reuse pilot. New one-use grant; no old allowance is reclaimed.
export const REUSE_SPEED_BENCHMARK_GRANT = Object.freeze({
  benchmarkId: "eb659a8f-a4b1-4ba5-81d9-f7ade1f0879d",
  registrationSourceRevision: "1366afc9ff9991b6f42a9136cdb8ba7b63a6668f",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.05,
  unresolvedExposureUsd: 0,
  activationSha256: "f0dc109379b29efc9ec0468ad3fdb94bcf3d93e34002a5cd9dac984c29205182",
});

// Explicit new owner request: harden, then run a new live comparison. Old grants remain immutable.
export const HARDENED_REUSE_BENCHMARK_GRANT = Object.freeze({
  benchmarkId: "d89f2a9c-3e8e-4e91-a41d-3f0836c1b3ea",
  registrationSourceRevision: "478ed987bcf3d6959fd2cd2294f97596d94e4b5a",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.05,
  unresolvedExposureUsd: 0,
  activationSha256: "f5a1918d1b396a8344b2cf1d38282726b656c09ea8cb6f9c7b220826c81f63e8",
});

// Owner-requested fresh qualification after failed d89f2a9c. Old exposure is never reclaimed.
export const OBSERVED_REUSE_BENCHMARK_GRANT = Object.freeze({
  benchmarkId: "68990425-bf42-4ec5-a4f1-e6af301780ac",
  registrationSourceRevision: "4adf3c149030d2984807753caac24d62521d6b80",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.05,
  unresolvedExposureUsd: 0,
  activationSha256: "19af2967caa26e9c325a5ff25eb84e52db2916e2cbad8e2cec082bb0d2be6abe",
});

export function activeCodingBenchmarkContinuation(environment: Record<string, string | undefined>) {
  if (environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256?.trim().toLowerCase()
      === OBSERVED_REUSE_BENCHMARK_GRANT.activationSha256) return OBSERVED_REUSE_BENCHMARK_GRANT;
  if (environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256?.trim().toLowerCase()
      === HARDENED_REUSE_BENCHMARK_GRANT.activationSha256) return HARDENED_REUSE_BENCHMARK_GRANT;
  if (environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256?.trim().toLowerCase()
      === REUSE_SPEED_BENCHMARK_GRANT.activationSha256) return REUSE_SPEED_BENCHMARK_GRANT;
  if (environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256?.trim().toLowerCase()
      === CURRENT_CODING_BENCHMARK_GRANT.activationSha256) return CURRENT_CODING_BENCHMARK_GRANT;
  if (environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256?.trim().toLowerCase()
      === POST_FIX_CODING_BENCHMARK_GRANT.activationSha256) return POST_FIX_CODING_BENCHMARK_GRANT;
  return environment.SARA_CODING_BENCHMARK_ADDITIONAL_GRANT_SHA256?.trim().toLowerCase()
    === ADDITIONAL_CODING_BENCHMARK_GRANT.activationSha256
    ? ADDITIONAL_CODING_BENCHMARK_GRANT
    : CODING_BENCHMARK_CONTINUATION;
}

type ReadinessInput = {
  environment: Record<string, string | undefined>;
  constitutionVerified: boolean;
  emergencyStopped: boolean;
};

export class CodingBenchmarkNotReadyError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CodingBenchmarkNotReadyError"; }
}

export function inspectCodingBenchmarkReadiness(input: ReadinessInput) {
  const env = input.environment;
  const active = activeCodingBenchmarkContinuation(env);
  const token = env.SARA_OWNER_TOKEN?.trim() ?? "";
  const expected = env.SARA_OWNER_TOKEN_SHA256?.trim().toLowerCase() ?? "";
  const ownerAuthenticated = token.length > 0 && /^[a-f0-9]{64}$/u.test(expected)
    && timingSafeEqual(Buffer.from(sha256(token), "hex"), Buffer.from(expected, "hex"));
  const sourceRevision = env.RAILWAY_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";
  const sourceIdentified = /^[a-f0-9]{40}$/u.test(sourceRevision);
  const blockers: string[] = [];
  if (!ownerAuthenticated) blockers.push("OWNER_AUTHENTICATION_UNAVAILABLE");
  if (!env.OPENAI_API_KEY?.trim()) blockers.push("MODEL_CREDENTIAL_UNAVAILABLE");
  if (!sourceIdentified) blockers.push("SOURCE_IDENTITY_UNAVAILABLE");
  if (!input.constitutionVerified) blockers.push("CONSTITUTION_UNVERIFIED");
  if (input.emergencyStopped) blockers.push("EMERGENCY_STOP");
  if ([CURRENT_CODING_BENCHMARK_GRANT.benchmarkId, REUSE_SPEED_BENCHMARK_GRANT.benchmarkId, HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId, OBSERVED_REUSE_BENCHMARK_GRANT.benchmarkId].some(id => id === active.benchmarkId) && env.SARA_REPARODYNAMIC_CODING_MODE !== "canary") blockers.push("CURRENT_PILOT_CANARY_REQUIRED");
  if (active.unresolvedExposureUsd > 0) blockers.push("UNRECONCILED_MODEL_EXPOSURE");
  const additional = active.benchmarkId !== CODING_BENCHMARK_CONTINUATION.benchmarkId;
  return {
    schemaVersion: additional ? 2 : 1,
    benchmarkId: active.benchmarkId,
    ready: blockers.length === 0,
    blockers,
    sourceRevision: sourceIdentified ? sourceRevision : null,
    maximumSpendUsd: active.maximumSpendUsd,
    maximumModelSpendUsdPerArm: active.maximumModelSpendUsdPerArm,
    unresolvedExposureUsd: active.unresolvedExposureUsd,
    confirmedChargeUsd: null,
    availableAuthorizationUsd: Math.max(0, active.maximumSpendUsd - active.unresolvedExposureUsd),
    ...(additional ? { historicalHold: {
      benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
      unresolvedExposureUsd: CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd,
      confirmedChargeUsd: null,
    } } : {}),
    model: "gpt-5.6-luna", reasoning: "medium", maximumAttemptsPerArm: 3,
    order: ["luna_reparodynamic", "luna"], compactOutput: false, compilerCaching: false,
    ...(active.benchmarkId === CURRENT_CODING_BENCHMARK_GRANT.benchmarkId ? {
      experiment: "current_components_cold_pilot", adaptiveOutputAvailable: true, nativeIntermediateChecks: true,
      finalLegacyRequired: true, kernelJobMeasured: false, persistentReuseMeasured: false,
    } : {}),
    ...([REUSE_SPEED_BENCHMARK_GRANT.benchmarkId, HARDENED_REUSE_BENCHMARK_GRANT.benchmarkId, OBSERVED_REUSE_BENCHMARK_GRANT.benchmarkId].some(id => id === active.benchmarkId) ? {
      experiment: "maximum_observed_reuse_pilot", arms: ["regenerate", "ordinary_memory", "optimized"],
      jobsPerArm: 4, maximumAttemptsPerArm: 12, maximumAttemptsPerJob: 3,
      adaptiveOutputAvailable: true, nativeIntermediateChecks: true, finalLegacyRequired: true,
      kernelJobMeasured: false, persistentReuseMeasured: true,
      absoluteMaximumEstablished: false,
    } : {}),
    ...(active.benchmarkId === OBSERVED_REUSE_BENCHMARK_GRANT.benchmarkId ? {
      providerDeadlineMilliseconds: 60000, dispatchAccountingV2: true, providerBodyBoundBytes: 1048576,
    } : {}),
    evidenceRequired: additional
      ? "This grant is separate and one-use. Preserve the prior $0.15 unresolved hold and never replay the historical benchmark."
      : "Authoritative pre-deploy execution or provider request/usage evidence for the original task, source and deployment. Missing receipts are insufficient.",
  };
}

export function assertCodingBenchmarkDispatch(input: ReadinessInput & { benchmarkId: string }): void {
  const active = activeCodingBenchmarkContinuation(input.environment);
  if (input.benchmarkId !== active.benchmarkId) throw new CodingBenchmarkNotReadyError("BENCHMARK_SCOPE_MISMATCH");
  const readiness = inspectCodingBenchmarkReadiness(input);
  if (!readiness.ready) throw new CodingBenchmarkNotReadyError(readiness.blockers.join(","));
}

export async function assertCodingBenchmarkRuntimeAuthority(input: {
  benchmarkId: string;
  environment: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const port = Number(input.environment.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CodingBenchmarkNotReadyError("OWNER_RUNTIME_UNAVAILABLE");
  const response = await (input.fetchImpl ?? fetch)(`http://127.0.0.1:${port}/health`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new CodingBenchmarkNotReadyError("OWNER_RUNTIME_UNAVAILABLE");
  const health = await response.json() as Record<string, unknown>;
  assertCodingBenchmarkDispatch({ benchmarkId: input.benchmarkId, environment: input.environment,
    constitutionVerified: health.constitutionVerified === true && health.ok === true,
    emergencyStopped: health.emergencyStopped !== false,
  });
}
