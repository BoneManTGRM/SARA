import { canonicalJson, sha256 } from "./canonical.ts";
import { platformAutomationPolicy, type CommercialPlatform } from "./platform-policy.ts";

export const ROUTINE_ACTION_KINDS = [
  "opportunity_research",
  "business_candidate_development",
  "inbound_customer_reply",
  "calendar_scheduling",
  "bounded_outreach",
] as const;

export type RoutineActionKind = (typeof ROUTINE_ACTION_KINDS)[number];
export type HardBoundaryActionKind =
  | "money_transfer"
  | "financial_account_creation"
  | "custom_contract"
  | "credential_access"
  | "human_impersonation"
  | "platform_prohibited_automation";

export type RoutineActionRequest = {
  id: string;
  kind: RoutineActionKind | HardBoundaryActionKind;
  targetId: string;
  channel: string;
  serviceId: string;
  estimatedCostUsd: number;
  external: boolean;
  requestedAt: string;
  platform: CommercialPlatform;
};

export type StandingMandateInput = {
  id: string;
  allowedActions: RoutineActionKind[];
  allowedChannels: string[];
  allowedServiceIds: string[];
  maximumCostPerActionUsd: number;
  maximumDailyActions: number;
  maximumConcurrentActions: number;
  startsAt: string;
  expiresAt: string;
  ownerId: string;
};

export type StandingMandate = StandingMandateInput & {
  schemaVersion: 1;
  digest: string;
  revokedAt: string | null;
  revocationReason: string | null;
};

export type AutonomyOutcome = "automatic" | "notify" | "owner_approval" | "deny";

export type AutonomyDecision = {
  requestId: string;
  mandateId: string | null;
  outcome: AutonomyOutcome;
  code: string;
  reason: string;
  decidedAt: string;
};

export type AutonomyException = {
  id: string;
  request: RoutineActionRequest;
  decision: AutonomyDecision;
  status: "open" | "resolved";
};

export type BusinessCandidateInput = {
  id: string;
  name: string;
  customerProblem: string;
  serviceId: string;
  publicEvidenceUrls: string[];
  expectedPriceUsd: number;
  estimatedDeliveryCostUsd: number;
};

export type BusinessCandidate = BusinessCandidateInput & {
  schemaVersion: 1;
  stage: "SHADOW";
  maximumDevelopmentCostUsd: 0;
  mayCreateAccounts: false;
  mayContactCustomers: false;
  mayAcceptContracts: false;
  evidenceDigest: string;
  nextGate: "owner_review";
};

const HARD_DENY = new Set<HardBoundaryActionKind>([
  "money_transfer",
  "financial_account_creation",
  "credential_access",
  "human_impersonation",
  "platform_prohibited_automation",
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function validTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

function uniqueSafe(values: string[], label: string): string[] {
  const result = [...new Set(values.map((value) => value.trim()))];
  if (!result.length || result.some((value) => !SAFE_ID.test(value))) {
    throw new Error(`${label} must contain one or more safe identifiers.`);
  }
  return result;
}

export function compileStandingMandate(input: StandingMandateInput): StandingMandate {
  if (!SAFE_ID.test(input.id) || !SAFE_ID.test(input.ownerId)) throw new Error("Mandate and owner IDs must be safe identifiers.");
  const allowedActions = [...new Set(input.allowedActions)];
  if (!allowedActions.length || allowedActions.some((action) => !ROUTINE_ACTION_KINDS.includes(action))) {
    throw new Error("A mandate may contain only recognized routine actions.");
  }
  if (!Number.isFinite(input.maximumCostPerActionUsd) || input.maximumCostPerActionUsd < 0 || input.maximumCostPerActionUsd > 3) {
    throw new Error("Maximum cost per routine action must be between $0 and $3.");
  }
  if (!Number.isInteger(input.maximumDailyActions) || input.maximumDailyActions < 1 || input.maximumDailyActions > 10) {
    throw new Error("Maximum daily actions must be an integer from 1 through 10.");
  }
  if (!Number.isInteger(input.maximumConcurrentActions) || input.maximumConcurrentActions !== 1) {
    throw new Error("Initial autonomous concurrency must remain exactly one.");
  }
  const starts = validTime(input.startsAt, "startsAt");
  const expires = validTime(input.expiresAt, "expiresAt");
  if (expires <= starts || expires - starts > 31 * 86_400_000) {
    throw new Error("A standing mandate must expire after it starts and within 31 days.");
  }
  const unsigned = {
    ...input,
    allowedActions,
    allowedChannels: uniqueSafe(input.allowedChannels, "allowedChannels"),
    allowedServiceIds: uniqueSafe(input.allowedServiceIds, "allowedServiceIds"),
    maximumCostPerActionUsd: Math.round(input.maximumCostPerActionUsd * 100) / 100,
  };
  return {
    schemaVersion: 1,
    ...unsigned,
    digest: sha256(canonicalJson(unsigned)),
    revokedAt: null,
    revocationReason: null,
  };
}

export function evaluateRoutineAction(input: {
  mandate: StandingMandate | null;
  request: RoutineActionRequest;
  emergencyStopped: boolean;
  completedToday?: number;
  activeActions?: number;
}): AutonomyDecision {
  const { mandate, request } = input;
  const decidedAt = request.requestedAt;
  const finish = (outcome: AutonomyOutcome, code: string, reason: string): AutonomyDecision => ({
    requestId: request.id,
    mandateId: mandate?.id ?? null,
    outcome,
    code,
    reason,
    decidedAt,
  });
  if (input.emergencyStopped) return finish("deny", "EMERGENCY_STOP", "The owner emergency stop blocks autonomous work.");
  if (HARD_DENY.has(request.kind as HardBoundaryActionKind)) {
    return finish("deny", "HARD_BOUNDARY", `${request.kind} cannot be delegated through a standing mandate.`);
  }
  if (request.kind === "custom_contract") {
    return finish("owner_approval", "CUSTOM_CONTRACT", "Custom contractual terms require exact owner approval.");
  }
  const platformDecision = platformAutomationPolicy(request.platform);
  if (request.kind === "opportunity_research" && platformDecision.research === "denied") {
    return finish("deny", "PLATFORM_AUTOMATION_DENIED", platformDecision.reason);
  }
  if (request.kind === "opportunity_research" && platformDecision.research === "approval_required") {
    return finish("owner_approval", "PLATFORM_EVIDENCE_REQUIRED", platformDecision.reason);
  }
  if (request.kind === "bounded_outreach" && platformDecision.outreach !== "allowed") {
    return finish(
      platformDecision.outreach === "denied" ? "deny" : "owner_approval",
      "PLATFORM_OUTREACH_NOT_AUTHORIZED",
      platformDecision.reason,
    );
  }
  if (!mandate || mandate.revokedAt) return finish("owner_approval", "NO_ACTIVE_MANDATE", "No active standing mandate covers this action.");
  const requestedAt = validTime(request.requestedAt, "requestedAt");
  if (requestedAt < validTime(mandate.startsAt, "startsAt") || requestedAt >= validTime(mandate.expiresAt, "expiresAt")) {
    return finish("owner_approval", "MANDATE_TIME_BOUNDARY", "The standing mandate is not active at the requested time.");
  }
  if (!mandate.allowedActions.includes(request.kind as RoutineActionKind)) {
    return finish("owner_approval", "ACTION_OUT_OF_SCOPE", "The action is outside the standing mandate.");
  }
  if (!mandate.allowedChannels.includes(request.channel) || !mandate.allowedServiceIds.includes(request.serviceId)) {
    return finish("owner_approval", "TARGET_OUT_OF_SCOPE", "The channel or service is outside the standing mandate.");
  }
  if (!Number.isFinite(request.estimatedCostUsd) || request.estimatedCostUsd < 0 || request.estimatedCostUsd > mandate.maximumCostPerActionUsd) {
    return finish("owner_approval", "COST_LIMIT", "The estimated cost exceeds the standing mandate.");
  }
  if ((input.completedToday ?? 0) >= mandate.maximumDailyActions) {
    return finish("owner_approval", "DAILY_LIMIT", "The standing mandate daily action limit has been reached.");
  }
  if ((input.activeActions ?? 0) >= mandate.maximumConcurrentActions) {
    return finish("owner_approval", "CONCURRENCY_LIMIT", "The standing mandate concurrency limit has been reached.");
  }
  return finish("automatic", "MANDATE_ALLOWED", "The routine action is inside the active owner-issued standing mandate.");
}

export function compileBusinessCandidate(input: BusinessCandidateInput): BusinessCandidate {
  if (!SAFE_ID.test(input.id) || !SAFE_ID.test(input.serviceId)) throw new Error("Candidate and service IDs must be safe identifiers.");
  if (input.name.trim().length < 3 || input.customerProblem.trim().length < 12) throw new Error("Candidate name and customer problem are required.");
  if (!Number.isFinite(input.expectedPriceUsd) || input.expectedPriceUsd <= 0) throw new Error("Expected price must be positive.");
  if (!Number.isFinite(input.estimatedDeliveryCostUsd) || input.estimatedDeliveryCostUsd < 0 || input.estimatedDeliveryCostUsd > input.expectedPriceUsd) {
    throw new Error("Estimated delivery cost must be finite and no greater than price.");
  }
  const publicEvidenceUrls = [...new Set(input.publicEvidenceUrls)];
  if (!publicEvidenceUrls.length || publicEvidenceUrls.some((value) => {
    try { return new URL(value).protocol !== "https:"; } catch { return true; }
  })) throw new Error("At least one HTTPS public evidence URL is required.");
  const normalized = { ...input, name: input.name.trim(), customerProblem: input.customerProblem.trim(), publicEvidenceUrls };
  return {
    schemaVersion: 1,
    ...normalized,
    stage: "SHADOW",
    maximumDevelopmentCostUsd: 0,
    mayCreateAccounts: false,
    mayContactCustomers: false,
    mayAcceptContracts: false,
    evidenceDigest: sha256(canonicalJson(normalized)),
    nextGate: "owner_review",
  };
}
