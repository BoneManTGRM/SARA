import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./canonical.ts";

// One continuation, not a reusable spending grant. Only reviewed authoritative
// execution/provider evidence may change this record. Environment flags, a new
// UUID and missing files cannot clear the historical exposure.
export const CODING_BENCHMARK_CONTINUATION = Object.freeze({
  benchmarkId: "41267154-ba42-496a-bb79-1656898ac716",
  originalSourceRevision: "30a7cb3c21a77b65bf7ba2c4c393897850e61eeb",
  originalAuthorityDigest: "6ceb8530c59902abd842483a059e337a30f4979eceaa0f93979269dd2e5c4f0c",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  unresolvedExposureUsd: 0.15,
  historicalResolutionEvidence: null,
});

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
  if (CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd > 0) blockers.push("UNRECONCILED_MODEL_EXPOSURE");
  return {
    schemaVersion: 1, benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
    ready: blockers.length === 0, blockers,
    sourceRevision: sourceIdentified ? sourceRevision : null,
    maximumSpendUsd: 0.15, maximumModelSpendUsdPerArm: 0.075,
    unresolvedExposureUsd: CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd,
    confirmedChargeUsd: null,
    availableAuthorizationUsd: Math.max(0, 0.15 - CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd),
    model: "gpt-5.6-luna", reasoning: "medium", maximumAttemptsPerArm: 3,
    order: ["luna_reparodynamic", "luna"],
    compactOutput: false, compilerCaching: false,
    evidenceRequired: "Authoritative pre-deploy execution or provider request/usage evidence for the original task, source and deployment. Missing receipts are insufficient.",
  };
}

export function assertCodingBenchmarkDispatch(input: ReadinessInput & { benchmarkId: string }): void {
  if (input.benchmarkId !== CODING_BENCHMARK_CONTINUATION.benchmarkId) {
    throw new CodingBenchmarkNotReadyError("BENCHMARK_SCOPE_MISMATCH");
  }
  const readiness = inspectCodingBenchmarkReadiness(input);
  if (!readiness.ready) throw new CodingBenchmarkNotReadyError(readiness.blockers.join(","));
}

/** CLI invocations must use the existing owner authority and a live kernel read,
 * not a synthetic emergency-stop flag or a newly booted competing event writer. */
export async function assertCodingBenchmarkRuntimeAuthority(input: {
  benchmarkId: string;
  environment: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const port = Number(input.environment.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CodingBenchmarkNotReadyError("OWNER_RUNTIME_UNAVAILABLE");
  }
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
