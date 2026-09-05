import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./canonical.ts";

export const CODING_BENCHMARK_HISTORICAL_HOLD = Object.freeze({
  benchmarkId: "41267154-ba42-496a-bb79-1656898ac716",
  maximumSpendUsd: 0.15,
  unresolvedExposureUsd: 0.15,
  confirmedChargeUsd: null,
  resolutionEvidence: null,
});

// Separate owner authorization from issue #105. This is one additional matched
// comparison, not a renewal or clearing of the historical hold above.
export const CODING_BENCHMARK_CONTINUATION = Object.freeze({
  benchmarkId: "33d94c9a-0de6-41d9-a843-fe9880994242",
  registrationSourceRevision: "9fa4945bd8becab34ee536ce86dc45d6c8a5bd43",
  maximumSpendUsd: 0.15,
  maximumModelSpendUsdPerArm: 0.075,
  unresolvedExposureUsd: 0,
  authorizationEvidence: "SARA issue #105 and owner messages: Yes please make it happen / Continue doing what you were doing.",
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
    schemaVersion: 2,
    benchmarkId: CODING_BENCHMARK_CONTINUATION.benchmarkId,
    ready: blockers.length === 0,
    blockers,
    sourceRevision: sourceIdentified ? sourceRevision : null,
    maximumSpendUsd: CODING_BENCHMARK_CONTINUATION.maximumSpendUsd,
    maximumModelSpendUsdPerArm: CODING_BENCHMARK_CONTINUATION.maximumModelSpendUsdPerArm,
    unresolvedExposureUsd: CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd,
    confirmedChargeUsd: null,
    availableAuthorizationUsd: Math.max(0, CODING_BENCHMARK_CONTINUATION.maximumSpendUsd - CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd),
    historicalHold: {
      benchmarkId: CODING_BENCHMARK_HISTORICAL_HOLD.benchmarkId,
      unresolvedExposureUsd: CODING_BENCHMARK_HISTORICAL_HOLD.unresolvedExposureUsd,
      confirmedChargeUsd: CODING_BENCHMARK_HISTORICAL_HOLD.confirmedChargeUsd,
    },
    model: "gpt-5.6-luna",
    reasoning: "medium",
    maximumAttemptsPerArm: 3,
    order: ["luna_reparodynamic", "luna"],
    compactOutput: false,
    compilerCaching: false,
    evidenceRequired: "The new authorization is independent. Preserve the prior $0.15 hold; do not replay or clear benchmark 41267154-ba42-496a-bb79-1656898ac716.",
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
