import type { SaraConstitution } from "./constitution.ts";
import type { ActionRequest, PolicyDecision, Principal } from "./types.ts";

const ALLOWED_DURING_STOP = new Set(["internal_read", "record_memory", "emergency_stop_change"]);

export function evaluatePolicy(input: {
  constitution: SaraConstitution;
  principal: Principal;
  request: ActionRequest;
  currentOwnerRecurringMonthlyUsd: number;
  emergencyStopped: boolean;
}): PolicyDecision {
  const { constitution, principal, request, currentOwnerRecurringMonthlyUsd, emergencyStopped } = input;
  const isOwner =
    principal.kind === "owner" &&
    principal.authenticated &&
    principal.id === constitution.ownerAuthority.ownerIdentity;
  const isSara = principal.kind === "sara" && principal.authenticated && principal.id === "sara";

  if (
    request.action === "human_impersonation" ||
    request.action === "tax_evasion" ||
    request.action === "legally_prohibited_activity"
  ) {
    return {
      allowed: false,
      code: "PROHIBITED_HARMFUL_ACTION",
      reason: "Illegal activity, human impersonation, deceptive identity, income concealment, and tax evasion are never authorized.",
    };
  }

  if (emergencyStopped && (request.external || !ALLOWED_DURING_STOP.has(request.action))) {
    return {
      allowed: false,
      code: "EMERGENCY_STOP",
      reason: "New external actions, spending, protected changes, children, and mutations are frozen by the owner.",
    };
  }

  if (constitution.protectedActions.includes(request.action as never)) {
    if (!isOwner) {
      return { allowed: false, code: "OWNER_REQUIRED", reason: `${request.action} is constitutionally owner-only.` };
    }
    const approval = request.approval;
    if (
      !approval ||
      approval.action !== request.action ||
      approval.targetId !== request.targetId ||
      approval.ownerId !== principal.id
    ) {
      return { allowed: false, code: "APPROVAL_REQUIRED", reason: "A target-bound owner approval is required." };
    }
  }

  if (request.action === "emergency_stop_change" && !isOwner) {
    return { allowed: false, code: "OWNER_REQUIRED", reason: "Only the authenticated owner can change emergency stop." };
  }

  if (request.action === "record_realized_financial_event" && !isOwner) {
    return {
      allowed: false,
      code: "OWNER_REQUIRED",
      reason: "Only the authenticated owner may attest that a financial event is realized during bootstrap.",
    };
  }

  if (
    (request.action === "select_compounding_rate" || request.action === "compound_reinvestment_purchase") &&
    !isSara &&
    !isOwner
  ) {
    return {
      allowed: false,
      code: "SARA_OR_OWNER_REQUIRED",
      reason: "Only the SARA governor or the authenticated owner may allocate Compound Reserve authority.",
    };
  }

  if (request.action === "owner_recurring_commitment") {
    if (!isOwner) {
      return { allowed: false, code: "OWNER_REQUIRED", reason: "Owner-funded commitments require the owner." };
    }
    const proposed = request.monthlyRecurringUsd;
    if (
      proposed === undefined ||
      !Number.isFinite(proposed) ||
      proposed < 0 ||
      !Number.isFinite(currentOwnerRecurringMonthlyUsd) ||
      currentOwnerRecurringMonthlyUsd < 0
    ) {
      return { allowed: false, code: "INVALID_COST", reason: "Monthly recurring cost must be finite and non-negative." };
    }
    const ceiling = constitution.ownerAuthority.ownerFundedRecurringMonthlyUsdMaximum;
    if (currentOwnerRecurringMonthlyUsd + proposed > ceiling) {
      return {
        allowed: false,
        code: "OWNER_BUDGET_EXCEEDED",
        reason: `The commitment would exceed the protected $${ceiling}/month owner-funded ceiling.`,
      };
    }
  }

  return { allowed: true, code: "ALLOWED", reason: "The action is within current authority and limits." };
}

export class PolicyDeniedError extends Error {
  constructor(
    readonly decision: PolicyDecision,
    readonly action: string,
  ) {
    super(`${decision.code}: ${decision.reason}`);
    this.name = "PolicyDeniedError";
  }
}
