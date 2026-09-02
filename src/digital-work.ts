import type { OwnerApproval } from "./types.ts";

export type DigitalJobKind =
  | "software_change"
  | "software_testing"
  | "documentation"
  | "localization"
  | "public_research"
  | "data_transformation"
  | "repository_assessment";

export type DigitalJobStatus =
  | "qualified"
  | "authorized"
  | "running"
  | "human_review_required"
  | "review_ready"
  | "delivery_authorized"
  | "delivered"
  | "paid"
  | "rejected"
  | "failed";

export type DigitalJobSafetyDeclaration = {
  publicOrOwnerProvidedNonSensitiveInput: boolean;
  requiresCredentials: boolean;
  containsPrivateCustomerData: boolean;
  requiresHumanIdentity: boolean;
  requiresRegulatedJudgment: boolean;
  requiresSecurityExploitation: boolean;
  requiresExternalAccountCreation: boolean;
};

export type DigitalWorkRequest = {
  kind: DigitalJobKind;
  objective: string;
  sourceUrl?: string;
  buyerReference?: string;
  authorizedScope: string;
  expectedDeliverables: string[];
  acceptanceCriteria: string[];
  acceptanceCriteriaAutomatable: boolean;
  maximumBudgetUsd: number;
  offeredCompensationUsd?: number;
  safety: DigitalJobSafetyDeclaration;
};

export type DigitalWorkCard = {
  schemaVersion: 1;
  kind: DigitalJobKind;
  objective: string;
  sourceUrl?: string;
  buyerReference?: string;
  authorizedScope: string;
  expectedDeliverables: string[];
  acceptanceCriteria: string[];
  maximumBudgetUsd: 0;
  offeredCompensationUsd?: number;
  allowedTools: string[];
  prohibitedActions: string[];
  requiresOwnerAcceptance: boolean;
  requiresHumanReview: boolean;
  executionBoundary: "ISOLATED_DRAFT_ONLY";
};

export type DigitalWorkVerification = {
  command: string;
  exitCode: number;
  outputDigest: string;
};

export type DigitalWorkResult = {
  artifactDigest: string;
  artifactReference: string;
  summary: string;
  verification: DigitalWorkVerification[];
};

export type DigitalWorkJob = {
  id: string;
  status: DigitalJobStatus;
  card: DigitalWorkCard;
  executorId?: string;
  result?: DigitalWorkResult;
  humanReview?: {
    reviewer: "owner" | "qualified_human";
    decision: "approved" | "rejected";
    evidenceDigest: string;
  };
  delivery?: {
    artifactDigest: string;
    evidenceDigest?: string;
  };
  payment?: {
    amountUsd: number;
    evidenceDigest: string;
  };
};

export type DigitalWorkExecutorHandoff = {
  schemaVersion: 1;
  role: "bounded_digital_job_executor";
  jobId: string;
  constitutionDigest: string;
  kind: DigitalJobKind;
  objective: string;
  authorizedScope: string;
  expectedDeliverables: string[];
  acceptanceCriteria: string[];
  maximumBudgetUsd: 0;
  allowedTools: string[];
  prohibitedActions: string[];
  requiredOutput: string[];
};

export type DigitalWorkExecutor = {
  id: string;
  maximumCostUsd: number;
  supportedKinds: DigitalJobKind[];
  execute(handoff: DigitalWorkExecutorHandoff): Promise<DigitalWorkResult>;
};

type JobDefinition = {
  allowedTools: string[];
  alwaysRequiresHumanReview: boolean;
};

const DEFINITIONS: Record<DigitalJobKind, JobDefinition> = {
  software_change: {
    allowedTools: ["repository_read", "isolated_repository_write", "test_runner", "draft_pull_request"],
    alwaysRequiresHumanReview: false,
  },
  software_testing: {
    allowedTools: ["repository_read", "test_runner", "evidence_writer"],
    alwaysRequiresHumanReview: false,
  },
  documentation: {
    allowedTools: ["repository_read", "document_writer", "link_checker"],
    alwaysRequiresHumanReview: false,
  },
  localization: {
    allowedTools: ["repository_read", "localization_writer", "format_checker"],
    alwaysRequiresHumanReview: false,
  },
  public_research: {
    allowedTools: ["public_web_read", "evidence_writer", "citation_checker"],
    alwaysRequiresHumanReview: false,
  },
  data_transformation: {
    allowedTools: ["owner_provided_input", "isolated_transform", "schema_validator"],
    alwaysRequiresHumanReview: false,
  },
  repository_assessment: {
    allowedTools: ["repository_read", "static_analysis", "evidence_writer"],
    alwaysRequiresHumanReview: true,
  },
};

export const DIGITAL_JOB_KINDS = Object.freeze(Object.keys(DEFINITIONS) as DigitalJobKind[]);

export const DIGITAL_WORK_PROHIBITED_ACTIONS = Object.freeze([
  "accept terms or contracts",
  "claim work without owner authorization",
  "contact a buyer without owner authorization",
  "use credentials or private customer data",
  "create external accounts",
  "impersonate a human",
  "make legal, medical, financial, or other regulated judgments",
  "perform exploit validation or intrusive security testing",
  "spend or move money",
  "merge, deploy, or publish production changes",
]);

function boundedStrings(values: string[], label: string, maximum: number): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > maximum) {
    throw new Error(`${label} must contain 1–${maximum} items.`);
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length < 3 || value.length > 500)) {
    throw new Error(`${label} items must contain 3–500 characters.`);
  }
  return normalized;
}

function validateUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || value.length > 2_048) {
    throw new Error("Job source URL must be a bounded public HTTPS URL without credentials or a fragment.");
  }
  return url.toString();
}

function assertZeroCost(value: number): asserts value is 0 {
  if (!Number.isFinite(value) || value !== 0) {
    throw new Error("Digital jobs must remain at the $0 owner-funded execution boundary until realized revenue exists.");
  }
}

function validateSafety(safety: DigitalJobSafetyDeclaration): void {
  if (!safety.publicOrOwnerProvidedNonSensitiveInput) {
    throw new Error("Digital job input must be public or owner-provided and non-sensitive.");
  }
  const blocked = Object.entries(safety)
    .filter(([key, value]) => key !== "publicOrOwnerProvidedNonSensitiveInput" && value === true)
    .map(([key]) => key);
  if (blocked.length > 0) throw new Error(`Digital job requires prohibited authority: ${blocked.join(", ")}.`);
}

export function compileDigitalWorkCard(request: DigitalWorkRequest): DigitalWorkCard {
  const objective = request.objective.trim();
  const authorizedScope = request.authorizedScope.trim();
  if (objective.length < 5 || objective.length > 1_200) throw new Error("Job objective must contain 5–1,200 characters.");
  if (authorizedScope.length < 3 || authorizedScope.length > 1_200) throw new Error("Authorized scope must contain 3–1,200 characters.");
  if (!(request.kind in DEFINITIONS)) throw new Error("Unsupported digital job kind.");
  assertZeroCost(request.maximumBudgetUsd);
  validateSafety(request.safety);
  if (request.offeredCompensationUsd !== undefined && (!Number.isFinite(request.offeredCompensationUsd) || request.offeredCompensationUsd < 0)) {
    throw new Error("Offered compensation must be finite and non-negative when supplied.");
  }
  const definition = DEFINITIONS[request.kind];
  const buyerReference = request.buyerReference?.trim() || undefined;
  if (buyerReference && buyerReference.length > 300) throw new Error("Buyer reference exceeds 300 characters.");
  return {
    schemaVersion: 1,
    kind: request.kind,
    objective,
    ...(request.sourceUrl ? { sourceUrl: validateUrl(request.sourceUrl) } : {}),
    ...(buyerReference ? { buyerReference } : {}),
    authorizedScope,
    expectedDeliverables: boundedStrings(request.expectedDeliverables, "Expected deliverables", 12),
    acceptanceCriteria: boundedStrings(request.acceptanceCriteria, "Acceptance criteria", 20),
    maximumBudgetUsd: 0,
    ...(request.offeredCompensationUsd === undefined ? {} : { offeredCompensationUsd: request.offeredCompensationUsd }),
    allowedTools: [...definition.allowedTools],
    prohibitedActions: [...DIGITAL_WORK_PROHIBITED_ACTIONS],
    requiresOwnerAcceptance: Boolean(buyerReference || request.sourceUrl),
    requiresHumanReview: definition.alwaysRequiresHumanReview || !request.acceptanceCriteriaAutomatable,
    executionBoundary: "ISOLATED_DRAFT_ONLY",
  };
}

export function digitalJobAcceptanceTarget(jobId: string): string {
  return `digital-job:${jobId}:accept`;
}

export function digitalJobDeliveryTarget(job: DigitalWorkJob): string {
  if (!job.result) throw new Error("A verified job result is required before delivery authorization.");
  return `digital-job:${job.id}:deliver:${job.result.artifactDigest}`;
}

export function approvalMatches(approval: OwnerApproval, action: OwnerApproval["action"], targetId: string, ownerId: string): boolean {
  return approval.action === action && approval.targetId === targetId && approval.ownerId === ownerId;
}

export function compileDigitalWorkHandoff(job: DigitalWorkJob, constitutionDigest: string): DigitalWorkExecutorHandoff {
  if (job.status !== "authorized") throw new Error("Only an authorized digital job can be handed to an executor.");
  if (!/^[a-f0-9]{64}$/iu.test(constitutionDigest)) throw new Error("A verified Constitution digest is required.");
  return {
    schemaVersion: 1,
    role: "bounded_digital_job_executor",
    jobId: job.id,
    constitutionDigest: constitutionDigest.toLowerCase(),
    kind: job.card.kind,
    objective: job.card.objective,
    authorizedScope: job.card.authorizedScope,
    expectedDeliverables: [...job.card.expectedDeliverables],
    acceptanceCriteria: [...job.card.acceptanceCriteria],
    maximumBudgetUsd: 0,
    allowedTools: [...job.card.allowedTools],
    prohibitedActions: [...job.card.prohibitedActions],
    requiredOutput: [
      "content-addressed artifact reference and SHA-256 digest",
      "changed or produced files",
      "exact verification commands with exit codes and output digests",
      "limitations, evidence gaps, and delivery risks",
    ],
  };
}
