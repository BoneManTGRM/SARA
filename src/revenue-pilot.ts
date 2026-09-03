import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "./canonical.ts";
import { compileFoundingPilot, type FoundingPilotInput } from "./founding-pilot.ts";
import type {
  WorkerModelExecutionEvidence,
  WorkerModelFailureEvidence,
} from "./model-router.ts";
import {
  getRevenueService,
  serviceSupportsGoal,
  type RevenueServiceId,
} from "./revenue-service-catalog.ts";

export const PILOT_MONTHLY_OWNER_BUDGET_CEILING_USD = 50 as const;
export const PILOT_MAXIMUM_EXECUTION_COST_USD = 3 as const;
export const PILOT_ROLES = [
  "opportunity_scout",
  "commercial_analyst",
  "work_director",
  "specialist_worker",
  "independent_verifier",
  "delivery_operator",
] as const;

export const PILOT_REQUIRED_CAPABILITIES = [
  "public-repository-inventory",
  "readiness-analysis",
  "independent-report-verification",
  "delivery-package-generation",
] as const;

export type RevenuePilotRole = (typeof PILOT_ROLES)[number];

export type RevenuePilotInput = Omit<FoundingPilotInput, "budgetUsd"> & {
  opportunityId: string;
  sourceUrl: string;
  sourceAllowsAutomatedDiscovery: boolean;
  discoveredFromPublicSource: boolean;
  customerBudgetUsd: number;
  requestedServiceId?: RevenueServiceId;
};

export type LearningObjective = {
  capabilityId: string;
  objective: string;
  acceptanceCriteria: string[];
  maximumBudgetUsd: 0;
  maximumPromotionStage: "SHADOW";
};

export type RevenuePilotPlan = {
  schemaVersion: 1;
  serviceId: RevenueServiceId;
  serviceName: string;
  opportunityId: string;
  sourceUrl: string | null;
  decision: "offer_ready" | "owner_review" | "reject";
  priceUsd: number;
  maximumExecutionCostUsd: number;
  monthlyOwnerBudgetCeilingUsd: 50;
  mayBeginFulfillment: false;
  fitScore: number;
  repository: string | null;
  disqualifyingRisks: string[];
  evidenceGaps: string[];
  requiredCapabilities: string[];
  includedDeliverables: string[];
  missingCapabilities: string[];
  learningObjectives: LearningObjective[];
  roles: RevenuePilotRole[];
  safestNextStep: string;
};

export type RevenuePilotLease = {
  id: string;
  workerId: string;
  role: Exclude<RevenuePilotRole, "opportunity_scout" | "commercial_analyst">;
  claimedAt: string;
  expiresAt: string;
};

export type RevenuePilotReceipt = {
  role: RevenuePilotRole;
  workerId: string;
  outputDigest: string;
  costUsd: number;
  verificationPassed: boolean | null;
  completedAt: string;
  modelExecution?: WorkerModelExecutionEvidence;
  modelFailure?: WorkerModelFailureEvidence;
  failureStage?: "model_execution" | "artifact_persistence";
  reportDigest?: string;
};

export type RevenuePilotJob = {
  id: string;
  input: RevenuePilotInput;
  plan: RevenuePilotPlan;
  status: "offer_ready" | "owner_review" | "delivery_ready" | "delivered" | "rejected" | "queued" | "running" | "failed";
  nextRole: RevenuePilotLease["role"] | null;
  completedRoles: RevenuePilotRole[];
  receipts: RevenuePilotReceipt[];
  activeLease: RevenuePilotLease | null;
  actualExecutionCostUsd: number;
  revenueEvidenceId: string | null;
  externalDeliveryAuthorized: boolean;
  deliveryApprovalId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const EXECUTION_ROLES: RevenuePilotLease["role"][] = [
  "work_director",
  "specialist_worker",
  "independent_verifier",
  "delivery_operator",
];
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT_GOALS = new Set<RevenuePilotInput["primaryGoal"]>([
  "security_baseline",
  "release_readiness",
  "dependency_health",
  "other",
]);

function canonicalHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function assertMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-9) {
    throw new RangeError(`${field} must be a finite non-negative amount in whole cents.`);
  }
}

function copyJob(job: RevenuePilotJob): RevenuePilotJob {
  return structuredClone(job);
}

function learningObjective(capabilityId: string, serviceName: string): LearningObjective {
  return {
    capabilityId,
    objective: `Build and independently verify the bounded ${capabilityId} capability for the ${serviceName}.`,
    acceptanceCriteria: [
      `The ${capabilityId} behavior passes deterministic or isolated behavioral tests.`,
      "The candidate uses no production credentials, customer outreach, payment authority, merge authority, or deployment authority.",
      "The verified candidate stops at SHADOW for owner review.",
    ],
    maximumBudgetUsd: 0,
    maximumPromotionStage: "SHADOW",
  };
}

export function compileRevenuePilot(
  input: RevenuePilotInput,
  availableCapabilities?: readonly string[],
): RevenuePilotPlan {
  if (!SAFE_ID.test(input.opportunityId)) {
    throw new Error("opportunityId must be 1–128 safe identifier characters.");
  }
  assertMoney(input.customerBudgetUsd, "customerBudgetUsd");
  if (!PILOT_GOALS.has(input.primaryGoal)) throw new Error("primaryGoal is not recognized.");
  const service = getRevenueService(input.requestedServiceId ?? "public-repository-readiness-snapshot");
  if (input.sourceUrl.length > 2_048) throw new Error("sourceUrl exceeds 2048 characters.");
  const sourceUrl = canonicalHttpsUrl(input.sourceUrl);
  const pilot = compileFoundingPilot(
    { ...input, budgetUsd: input.customerBudgetUsd },
    {
      minimumBudgetUsd: service.priceUsd,
      budgetGapMessage: `Available budget is below the fixed $${service.priceUsd} ${service.name} price`,
    },
  );
  const disqualifyingRisks = [...pilot.disqualifyingRisks];
  const evidenceGaps = [...pilot.evidenceGaps];
  if (!input.sourceAllowsAutomatedDiscovery) {
    disqualifyingRisks.push("The opportunity source does not permit automated discovery");
  }
  if (!input.discoveredFromPublicSource) {
    disqualifyingRisks.push("The opportunity was not discovered from a public source");
  }
  if (!sourceUrl) evidenceGaps.push("Provide one canonical HTTPS opportunity source URL");
  if (!serviceSupportsGoal(service, input.primaryGoal)) {
    evidenceGaps.push(`The requested service does not support the ${input.primaryGoal} goal`);
  }

  const available = new Set(availableCapabilities ?? service.requiredCapabilities);
  const missingCapabilities = service.requiredCapabilities.filter((capability) => !available.has(capability));
  if (missingCapabilities.length > 0) {
    evidenceGaps.push(`Missing verified capabilities: ${missingCapabilities.join(", ")}`);
  }

  const decision = disqualifyingRisks.length > 0
    ? "reject"
    : pilot.decision === "qualified" && evidenceGaps.length === 0
      ? "offer_ready"
      : "owner_review";
  const safestNextStep = decision === "reject"
    ? "Decline the opportunity and record the reasons without outreach or execution."
    : decision === "offer_ready"
      ? "Owner may review the fixed offer; fulfillment remains blocked until payment is collected and separately authorized."
      : "Resolve evidence and capability gaps before offering or beginning work.";

  return {
    schemaVersion: 1,
    serviceId: service.id,
    serviceName: service.name,
    opportunityId: input.opportunityId.trim(),
    sourceUrl,
    decision,
    priceUsd: service.priceUsd,
    maximumExecutionCostUsd: service.maximumExecutionCostUsd,
    monthlyOwnerBudgetCeilingUsd: PILOT_MONTHLY_OWNER_BUDGET_CEILING_USD,
    mayBeginFulfillment: false,
    fitScore: pilot.fitScore,
    repository: pilot.repository,
    disqualifyingRisks,
    evidenceGaps,
    requiredCapabilities: [...service.requiredCapabilities],
    includedDeliverables: [...service.deliverables],
    missingCapabilities: [...missingCapabilities],
    learningObjectives: missingCapabilities.map((capability) => learningObjective(capability, service.name)),
    roles: [...PILOT_ROLES],
    safestNextStep,
  };
}

export function createRevenuePilotJob(
  input: RevenuePilotInput,
  availableCapabilities?: readonly string[],
  now = new Date(),
): RevenuePilotJob {
  const plan = compileRevenuePilot(input, availableCapabilities);
  const initialReceipts: RevenuePilotReceipt[] = [
    {
      role: "opportunity_scout",
      workerId: "sara-kernel",
      outputDigest: sha256(canonicalJson({
        opportunityId: input.opportunityId,
        sourceUrl: plan.sourceUrl,
        public: input.discoveredFromPublicSource,
        automationPermitted: input.sourceAllowsAutomatedDiscovery,
      })),
      costUsd: 0,
      verificationPassed: null,
      completedAt: now.toISOString(),
    },
    {
      role: "commercial_analyst",
      workerId: "sara-kernel",
      outputDigest: sha256(canonicalJson({
        decision: plan.decision,
        fitScore: plan.fitScore,
        risks: plan.disqualifyingRisks,
        gaps: plan.evidenceGaps,
      })),
      costUsd: 0,
      verificationPassed: null,
      completedAt: now.toISOString(),
    },
  ];
  const status = plan.decision === "offer_ready"
    ? "offer_ready"
    : plan.decision === "reject"
      ? "rejected"
      : "owner_review";
  return {
    id: randomUUID(),
    input: {
      ...structuredClone(input),
      sourceUrl: plan.sourceUrl ?? "",
      repoUrl: plan.repository ?? "",
    },
    plan,
    status,
    nextRole: null,
    completedRoles: initialReceipts.map((receipt) => receipt.role),
    receipts: initialReceipts,
    activeLease: null,
    actualExecutionCostUsd: 0,
    revenueEvidenceId: null,
    externalDeliveryAuthorized: false,
    deliveryApprovalId: null,
    deliveredAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function authorizeRevenuePilotDelivery(
  job: RevenuePilotJob,
  approval: { approvalId: string; ownerApprovalTarget: string },
  now = new Date(),
): RevenuePilotJob {
  if (job.status !== "owner_review" || job.externalDeliveryAuthorized) {
    throw new Error("Only a completed owner-review job may be approved for external delivery.");
  }
  if (approval.ownerApprovalTarget !== `revenue-pilot:${job.id}:delivery` || !approval.approvalId.trim()) {
    throw new Error("A distinct target-bound owner approval is required for delivery.");
  }
  const verifier = job.receipts.find((receipt) => receipt.role === "independent_verifier");
  const report = job.receipts.find((receipt) => receipt.role === "delivery_operator");
  if (verifier?.verificationPassed !== true || !report?.reportDigest) {
    throw new Error("Passing independent verification and a compiled report are required for delivery.");
  }
  const authorized = copyJob(job);
  authorized.externalDeliveryAuthorized = true;
  authorized.deliveryApprovalId = approval.approvalId.trim();
  authorized.status = "delivery_ready";
  authorized.updatedAt = now.toISOString();
  return authorized;
}

export function markRevenuePilotDelivered(job: RevenuePilotJob, now = new Date()): RevenuePilotJob {
  if (!job.externalDeliveryAuthorized || !job.deliveryApprovalId || (job.status !== "delivery_ready" && job.status !== "delivered")) {
    throw new Error("The revenue pilot is not authorized for customer delivery.");
  }
  if (job.status === "delivered") return copyJob(job);
  const delivered = copyJob(job);
  delivered.status = "delivered";
  delivered.deliveredAt = now.toISOString();
  delivered.updatedAt = now.toISOString();
  return delivered;
}

export function authorizeRevenuePilot(
  job: RevenuePilotJob,
  authorization: {
    collectedRevenueUsd: number;
    revenueEvidenceId: string;
    ownerApprovalTarget: string;
  },
  now = new Date(),
): RevenuePilotJob {
  assertMoney(authorization.collectedRevenueUsd, "collectedRevenueUsd");
  if (job.status !== "offer_ready") throw new Error("Only an offer-ready revenue pilot can be authorized.");
  if (authorization.collectedRevenueUsd < job.plan.priceUsd) {
    throw new Error(`At least $${job.plan.priceUsd.toFixed(2)} in collected revenue is required before fulfillment.`);
  }
  if (!authorization.revenueEvidenceId.trim()) throw new Error("Collected revenue evidence is required.");
  if (authorization.ownerApprovalTarget !== `revenue-pilot:${job.id}:fulfillment`) {
    throw new Error("A target-bound owner approval is required for fulfillment.");
  }
  const authorized = copyJob(job);
  if (now.getTime() < Date.parse(job.updatedAt)) throw new Error("Authorization time cannot precede the job state.");
  authorized.status = "queued";
  authorized.nextRole = "work_director";
  authorized.revenueEvidenceId = authorization.revenueEvidenceId.trim();
  authorized.updatedAt = now.toISOString();
  return authorized;
}

export function claimRevenuePilotRole(
  job: RevenuePilotJob,
  workerId: string,
  now = new Date(),
  leaseSeconds = 300,
): { job: RevenuePilotJob; lease: RevenuePilotLease } {
  if (!SAFE_ID.test(workerId)) throw new Error("workerId must be 1–128 safe identifier characters.");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3_600) {
    throw new RangeError("leaseSeconds must be an integer between 1 and 3600.");
  }
  if (job.status !== "queued" && job.status !== "running") {
    throw new Error("The revenue pilot is not available for execution.");
  }
  if (now.getTime() < Date.parse(job.updatedAt)) throw new Error("Lease time cannot precede the job state.");
  if (!job.nextRole) throw new Error("The revenue pilot has no executable role remaining.");
  if (job.activeLease && Date.parse(job.activeLease.expiresAt) > now.getTime()) {
    throw new Error(`The ${job.activeLease.role} role is already leased.`);
  }

  const lease: RevenuePilotLease = {
    id: randomUUID(),
    workerId: workerId.trim(),
    role: job.nextRole,
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + leaseSeconds * 1_000).toISOString(),
  };
  const claimed = copyJob(job);
  claimed.status = "running";
  claimed.activeLease = lease;
  claimed.updatedAt = now.toISOString();
  return { job: claimed, lease };
}

export type RevenuePilotRoleCompletion = {
  leaseId: string;
  role: RevenuePilotLease["role"];
  outputDigest: string;
  costUsd: number;
  verificationPassed: boolean | null;
  completedAt: string;
  modelExecution?: WorkerModelExecutionEvidence;
  modelFailure?: WorkerModelFailureEvidence;
  executionFailed?: boolean;
  failureStage?: "model_execution" | "artifact_persistence";
  reportDigest?: string;
};

function validateActiveLease(
  job: RevenuePilotJob,
  result: RevenuePilotRoleCompletion,
): { completedAt: number; lease: RevenuePilotLease } {
  assertMoney(result.costUsd, "costUsd");
  if (job.status !== "running" || !job.activeLease) throw new Error("The revenue pilot has no active lease.");
  if (job.activeLease.id !== result.leaseId || job.activeLease.role !== result.role) {
    throw new Error("The completion does not match the active role lease.");
  }
  if (!SHA256_HEX.test(result.outputDigest) || /^0{64}$/i.test(result.outputDigest)) {
    throw new Error("A non-zero SHA-256 output digest is required.");
  }
  const completedAt = Date.parse(result.completedAt);
  if (!Number.isFinite(completedAt)) throw new Error("completedAt must be an ISO timestamp.");
  if (completedAt < Date.parse(job.activeLease.claimedAt) || completedAt > Date.parse(job.activeLease.expiresAt)) {
    throw new Error("The role lease expired before completion was recorded.");
  }
  return { completedAt, lease: job.activeLease };
}

function validatedNextCost(job: RevenuePilotJob, result: RevenuePilotRoleCompletion): number {
  const nextCost = Math.round((job.actualExecutionCostUsd + result.costUsd) * 100) / 100;
  if (nextCost > job.plan.maximumExecutionCostUsd) {
    throw new RangeError(`The role would exceed the $${job.plan.maximumExecutionCostUsd.toFixed(2)} execution cap.`);
  }
  return nextCost;
}

function validateIndependentVerification(job: RevenuePilotJob, result: RevenuePilotRoleCompletion): void {
  if (
    result.role === "independent_verifier" &&
    !result.executionFailed &&
    typeof result.verificationPassed !== "boolean"
  ) {
    throw new Error("The independent verifier must provide a pass or fail result.");
  }
  if (
    result.role === "independent_verifier" &&
    job.receipts.some(
      (receipt) => receipt.role === "specialist_worker" && receipt.workerId === job.activeLease?.workerId,
    )
  ) {
    throw new Error("The independent verifier must be a different logical worker from the specialist worker.");
  }
  if (result.role !== "independent_verifier" && result.verificationPassed !== null) {
    throw new Error("Only the independent verifier may provide a verification result.");
  }
}

function conservativeWholeCentCost(accountedCostUsd: number): number {
  return Math.ceil((accountedCostUsd - Number.EPSILON) * 100) / 100;
}

function validateModelExecution(result: RevenuePilotRoleCompletion): void {
  if (!result.modelExecution) return;
  const evidence = result.modelExecution;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.outputDigest !== result.outputDigest.toLowerCase() ||
    !Number.isInteger(evidence.attemptCount) ||
    evidence.attemptCount < 1 ||
    evidence.attemptCount > 2 ||
    evidence.attempts.length !== evidence.attemptCount ||
    !Number.isFinite(evidence.accountedCostUsd) ||
    evidence.accountedCostUsd < 0
  ) {
    throw new Error("Model execution evidence does not match the completed role.");
  }
  if (result.costUsd !== conservativeWholeCentCost(evidence.accountedCostUsd)) {
    throw new Error("The role cost must conservatively account for the routed model execution.");
  }
}

function validateExecutionFailure(result: RevenuePilotRoleCompletion): void {
  if (result.executionFailed && !result.failureStage) {
    throw new Error("A failed routed role requires a failure stage.");
  }
  if (!result.executionFailed && result.failureStage) {
    throw new Error("A successful routed role cannot contain a failure stage.");
  }
  if (result.failureStage === "model_execution" && !result.modelFailure) {
    throw new Error("A model-execution failure requires matching model failure evidence.");
  }
  if (result.failureStage === "artifact_persistence" && !result.modelExecution) {
    throw new Error("An artifact-persistence failure requires matching model execution evidence.");
  }
  if (result.modelFailure && result.failureStage !== "model_execution") {
    throw new Error("Model failure evidence requires the model-execution failure stage.");
  }
  if (result.modelExecution && result.modelFailure) {
    throw new Error("A routed role cannot contain both success and failure evidence.");
  }
}

function validateReportDigest(job: RevenuePilotJob, result: RevenuePilotRoleCompletion): void {
  const requiresReadinessReport =
    job.plan.serviceId === "public-repository-readiness-snapshot" &&
    result.role === "delivery_operator" &&
    !result.executionFailed;
  if (requiresReadinessReport && (!result.reportDigest || !SHA256_HEX.test(result.reportDigest) || /^0{64}$/i.test(result.reportDigest))) {
    throw new Error("The repository-readiness delivery role requires a non-zero compiled report digest.");
  }
  if (result.reportDigest && !requiresReadinessReport) {
    throw new Error("A report digest is allowed only for a successful repository-readiness delivery role.");
  }
}

function validateModelFailure(result: RevenuePilotRoleCompletion): void {
  if (!result.modelFailure) return;
  const evidence = result.modelFailure;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.failureDigest !== result.outputDigest.toLowerCase() ||
    !Number.isInteger(evidence.attemptCount) ||
    evidence.attemptCount < 1 ||
    evidence.attemptCount > 2 ||
    evidence.attempts.length !== evidence.attemptCount ||
    evidence.attempts.some((attempt) => attempt.outcome === "succeeded") ||
    !Number.isFinite(evidence.accountedCostUsd) ||
    evidence.accountedCostUsd < 0
  ) {
    throw new Error("Model failure evidence does not match the failed role.");
  }
  if (result.costUsd !== conservativeWholeCentCost(evidence.accountedCostUsd)) {
    throw new Error("The role cost must conservatively account for failed routed model attempts.");
  }
}

function applyRoleCompletion(
  job: RevenuePilotJob,
  result: RevenuePilotRoleCompletion,
  lease: RevenuePilotLease,
  completedAt: number,
  nextCost: number,
): RevenuePilotJob {

  const completed = copyJob(job);
  completed.receipts.push({
    role: result.role,
    workerId: lease.workerId,
    outputDigest: result.outputDigest.toLowerCase(),
    costUsd: result.costUsd,
    verificationPassed: result.verificationPassed,
    completedAt: new Date(completedAt).toISOString(),
    ...(result.modelExecution ? { modelExecution: structuredClone(result.modelExecution) } : {}),
    ...(result.modelFailure ? { modelFailure: structuredClone(result.modelFailure) } : {}),
    ...(result.failureStage ? { failureStage: result.failureStage } : {}),
    ...(result.reportDigest ? { reportDigest: result.reportDigest.toLowerCase() } : {}),
  });
  if (!result.executionFailed) completed.completedRoles.push(result.role);
  completed.actualExecutionCostUsd = nextCost;
  completed.activeLease = null;
  completed.updatedAt = new Date(completedAt).toISOString();
  const failed = result.executionFailed ||
    (result.role === "independent_verifier" && result.verificationPassed === false);
  if (failed) {
    completed.status = "failed";
    completed.nextRole = null;
    return completed;
  }
  const roleIndex = EXECUTION_ROLES.indexOf(result.role);
  const nextRole = EXECUTION_ROLES[roleIndex + 1] ?? null;
  completed.nextRole = nextRole;
  completed.status = nextRole ? "queued" : "owner_review";
  return completed;
}

export function completeRevenuePilotRole(
  job: RevenuePilotJob,
  result: RevenuePilotRoleCompletion,
): RevenuePilotJob {
  const { completedAt, lease } = validateActiveLease(job, result);
  const nextCost = validatedNextCost(job, result);
  validateIndependentVerification(job, result);
  validateModelExecution(result);
  validateExecutionFailure(result);
  validateReportDigest(job, result);
  validateModelFailure(result);
  return applyRoleCompletion(job, result, lease, completedAt, nextCost);
}
