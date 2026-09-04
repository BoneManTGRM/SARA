import {
  claimRevenuePilotRole,
  compileRevenuePilot,
  completeRevenuePilotRole,
  createRevenuePilotJob,
  type RevenuePilotInput,
  type RevenuePilotJob,
  type RevenuePilotLease,
  type RevenuePilotPlan,
  type RevenuePilotRoleCompletion,
} from "./revenue-pilot.ts";
import { getRevenueService } from "./revenue-service-catalog.ts";

const SAFE_TEST_AUTHORIZATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type RevenuePilotTestingInput = Omit<RevenuePilotInput, "customerBudgetUsd">;

export type RevenuePilotTestingPlan = Omit<RevenuePilotPlan, "priceUsd" | "safestNextStep"> & {
  billingMode: "testing_no_charge";
  externalDeliveryAllowed: false;
  revenueRecognitionAllowed: false;
  safestNextStep: string;
};

export type RevenuePilotTestingStatus =
  | "testing_ready"
  | "queued"
  | "running"
  | "failed"
  | "testing_complete";

export type RevenuePilotTestingJob = Omit<
  RevenuePilotJob,
  | "input"
  | "plan"
  | "status"
  | "revenueEvidenceId"
  | "externalDeliveryAuthorized"
  | "deliveryApprovalId"
  | "deliveredAt"
> & {
  input: RevenuePilotTestingInput;
  plan: RevenuePilotTestingPlan;
  status: RevenuePilotTestingStatus;
  revenueEvidenceId: null;
  externalDeliveryAuthorized: false;
  deliveryApprovalId: null;
  deliveredAt: null;
  testingAuthorizationId: string | null;
};

function withoutCallerPrice(input: RevenuePilotTestingInput): RevenuePilotTestingInput {
  const { customerBudgetUsd: _ignored, ...testingInput } = input as RevenuePilotTestingInput & {
    customerBudgetUsd?: unknown;
  };
  return structuredClone(testingInput);
}

function commercialQualificationInput(input: RevenuePilotTestingInput): RevenuePilotInput {
  const testingInput = withoutCallerPrice(input);
  const service = getRevenueService(testingInput.requestedServiceId ?? "public-repository-readiness-snapshot");
  return {
    ...testingInput,
    customerBudgetUsd: service.priceUsd,
  };
}

function testingSafestNextStep(plan: RevenuePilotPlan): string {
  if (plan.decision === "reject") {
    return "Decline this testing scope and record the reasons without outreach or execution.";
  }
  if (plan.decision === "owner_review") {
    return "Resolve the listed evidence and capability gaps before starting the owner-only test.";
  }
  return "Owner may authorize an isolated no-charge test run; it cannot recognize revenue or authorize external delivery.";
}

function testingPlan(plan: RevenuePilotPlan): RevenuePilotTestingPlan {
  const { priceUsd: _commercialPrice, safestNextStep: _commercialNextStep, ...boundedPlan } = structuredClone(plan);
  return {
    ...boundedPlan,
    billingMode: "testing_no_charge",
    externalDeliveryAllowed: false,
    revenueRecognitionAllowed: false,
    safestNextStep: testingSafestNextStep(plan),
  };
}

export function compileRevenuePilotForTesting(
  input: RevenuePilotTestingInput,
  availableCapabilities?: readonly string[],
): RevenuePilotTestingPlan {
  return testingPlan(compileRevenuePilot(commercialQualificationInput(input), availableCapabilities));
}

function testingJobFromCommercial(
  job: RevenuePilotJob,
  testingInput: RevenuePilotTestingInput,
): RevenuePilotTestingJob {
  const status: RevenuePilotTestingStatus = job.status === "offer_ready"
    ? "testing_ready"
    : job.status === "rejected"
      ? "failed"
      : "testing_complete";
  return {
    id: job.id,
    input: withoutCallerPrice(testingInput),
    plan: testingPlan(job.plan),
    status,
    nextRole: job.nextRole,
    completedRoles: [...job.completedRoles],
    receipts: structuredClone(job.receipts),
    activeLease: job.activeLease ? structuredClone(job.activeLease) : null,
    actualExecutionCostUsd: job.actualExecutionCostUsd,
    revenueEvidenceId: null,
    externalDeliveryAuthorized: false,
    deliveryApprovalId: null,
    deliveredAt: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    testingAuthorizationId: null,
  };
}

export function createRevenuePilotTestingJob(
  input: RevenuePilotTestingInput,
  availableCapabilities?: readonly string[],
  now = new Date(),
): RevenuePilotTestingJob {
  const testingInput = withoutCallerPrice(input);
  const commercialJob = createRevenuePilotJob(
    commercialQualificationInput(testingInput),
    availableCapabilities,
    now,
  );
  return testingJobFromCommercial(commercialJob, testingInput);
}

export function authorizeRevenuePilotForTesting(
  job: RevenuePilotTestingJob,
  authorization: {
    testingAuthorizationId: string;
    ownerApprovalTarget: string;
  },
  now = new Date(),
): RevenuePilotTestingJob {
  if (
    job.plan.billingMode !== "testing_no_charge" ||
    job.plan.externalDeliveryAllowed !== false ||
    job.plan.revenueRecognitionAllowed !== false
  ) {
    throw new Error("Testing authorization requires the exact no-charge, no-revenue, no-delivery plan.");
  }
  if (job.status !== "testing_ready") {
    throw new Error("Only a testing-ready revenue pilot may enter the testing workflow.");
  }
  if (!SAFE_TEST_AUTHORIZATION_ID.test(authorization.testingAuthorizationId)) {
    throw new Error("testingAuthorizationId must be 1–128 safe identifier characters.");
  }
  if (authorization.ownerApprovalTarget !== `revenue-pilot-test:${job.id}:fulfillment`) {
    throw new Error("A target-bound owner approval is required for no-charge testing.");
  }
  if (now.getTime() < Date.parse(job.updatedAt)) {
    throw new Error("Testing authorization time cannot precede the job state.");
  }
  const authorized = structuredClone(job);
  authorized.status = "queued";
  authorized.nextRole = "work_director";
  authorized.testingAuthorizationId = authorization.testingAuthorizationId.trim();
  authorized.updatedAt = now.toISOString();
  return authorized;
}

function asCoreExecutionJob(job: RevenuePilotTestingJob): RevenuePilotJob {
  const service = getRevenueService(job.plan.serviceId);
  const { billingMode: _billingMode, externalDeliveryAllowed: _externalDeliveryAllowed,
    revenueRecognitionAllowed: _revenueRecognitionAllowed, ...plan } = structuredClone(job.plan);
  if (job.status !== "queued" && job.status !== "running" && job.status !== "failed") {
    throw new Error("The no-charge testing job is not in an executable state.");
  }
  return {
    id: job.id,
    input: {
      ...structuredClone(job.input),
      customerBudgetUsd: 0,
    },
    plan: {
      ...plan,
      priceUsd: service.priceUsd,
    },
    status: job.status,
    nextRole: job.nextRole,
    completedRoles: [...job.completedRoles],
    receipts: structuredClone(job.receipts),
    activeLease: job.activeLease ? structuredClone(job.activeLease) : null,
    actualExecutionCostUsd: job.actualExecutionCostUsd,
    revenueEvidenceId: null,
    externalDeliveryAuthorized: false,
    deliveryApprovalId: null,
    deliveredAt: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function withCoreExecutionState(
  testingJob: RevenuePilotTestingJob,
  coreJob: RevenuePilotJob,
): RevenuePilotTestingJob {
  if (
    coreJob.status !== "queued" &&
    coreJob.status !== "running" &&
    coreJob.status !== "failed" &&
    coreJob.status !== "owner_review"
  ) {
    throw new Error("The core worker returned an invalid state for no-charge testing.");
  }
  const updated = structuredClone(testingJob);
  updated.status = coreJob.status === "owner_review" ? "testing_complete" : coreJob.status;
  updated.nextRole = coreJob.nextRole;
  updated.completedRoles = [...coreJob.completedRoles];
  updated.receipts = structuredClone(coreJob.receipts);
  updated.activeLease = coreJob.activeLease ? structuredClone(coreJob.activeLease) : null;
  updated.actualExecutionCostUsd = coreJob.actualExecutionCostUsd;
  updated.updatedAt = coreJob.updatedAt;
  updated.revenueEvidenceId = null;
  updated.externalDeliveryAuthorized = false;
  updated.deliveryApprovalId = null;
  updated.deliveredAt = null;
  return updated;
}

export function claimRevenuePilotTestingRole(
  job: RevenuePilotTestingJob,
  workerId: string,
  now = new Date(),
  leaseSeconds = 300,
): { job: RevenuePilotTestingJob; lease: RevenuePilotLease } {
  if (!job.testingAuthorizationId) {
    throw new Error("The no-charge testing job requires owner test authorization before execution.");
  }
  const claimed = claimRevenuePilotRole(asCoreExecutionJob(job), workerId, now, leaseSeconds);
  return {
    job: withCoreExecutionState(job, claimed.job),
    lease: claimed.lease,
  };
}

export function completeRevenuePilotTestingRole(
  job: RevenuePilotTestingJob,
  result: RevenuePilotRoleCompletion,
): RevenuePilotTestingJob {
  if (!job.testingAuthorizationId) {
    throw new Error("The no-charge testing job requires owner test authorization before execution.");
  }
  return withCoreExecutionState(job, completeRevenuePilotRole(asCoreExecutionJob(job), result));
}
