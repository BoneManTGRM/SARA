import type { ProtectedAction } from "./constitution.ts";

export type PrincipalKind = "owner" | "sara" | "child";

export type Principal = {
  id: string;
  kind: PrincipalKind;
  authenticated: boolean;
};

export type ActionType =
  | ProtectedAction
  | "internal_read"
  | "external_read"
  | "external_write"
  | "sandbox_development"
  | "record_memory"
  | "record_ledger"
  | "record_realized_financial_event"
  | "owner_recurring_commitment"
  | "emergency_stop_change"
  | "human_impersonation"
  | "tax_evasion";

export type OwnerApproval = {
  approvalId: string;
  action: ActionType;
  targetId: string;
  approvedAt: string;
  ownerId: string;
};

export type ActionRequest = {
  action: ActionType;
  targetId: string;
  external: boolean;
  monthlyRecurringUsd?: number;
  approval?: OwnerApproval;
};

export type PolicyDecision = {
  allowed: boolean;
  code: string;
  reason: string;
};

export type MemoryRecord = {
  id: string;
  category:
    | "working"
    | "semantic"
    | "procedural"
    | "episodic"
    | "economic"
    | "customer"
    | "research"
    | "failure"
    | "repair"
    | "skill"
    | "evolutionary"
    | "strategic"
    | "constitutional"
    | "distribution";
  statement: string;
  source: string;
  observedAt: string;
  confidence: number;
  verification: "measured" | "inferred" | "estimated" | "predicted" | "simulated";
  scope: string;
  dependencies: string[];
  lastValidatedAt: string;
  revalidateAfter?: string;
  importance?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  status?: "active" | "superseded" | "retired";
  supersedes?: string[];
};

export type MemoryRecallQuery = {
  query: string;
  scope: string;
  categories?: MemoryRecord["category"][];
  limit?: number;
  now?: Date;
};

export type MemoryRecall = {
  query: string;
  scope: string;
  anchors: MemoryRecord[];
  relevant: MemoryRecord[];
  staleExcluded: number;
  supersededExcluded: number;
  contextDigest: string;
};

export type CandidateMemoryContext = {
  contextDigest: string;
  memories: MemoryRecord[];
};

export type LedgerEntry = {
  id: string;
  kind:
    | "revenue"
    | "fulfillment_cost"
    | "platform_fee"
    | "required_liability"
    | "core_operation"
    | "reserve"
    | "owner_distribution"
    | "reinvestment";
  source: "owner" | "customer" | "sara";
  amountUsd: number;
  realized: boolean;
  recurringMonthly: boolean;
  description: string;
  occurredAt: string;
};

export type CapabilityStatus = "available" | "limited" | "missing";

export type Capability = {
  id: string;
  name: string;
  status: CapabilityStatus;
  evidence: string[];
  limitations: string[];
};

export type WorkCard = {
  id: string;
  objective: string;
  expectedOwnerValue: number;
  requiredCapabilities: string[];
  missingCapabilities: string[];
  acceptanceCriteria: string[];
  maximumBudgetUsd: number;
  prohibitedActions: ProtectedAction[];
  createdAt: string;
};

export type Job = {
  id: string;
  kind: "self_development";
  status: "authorized" | "running" | "blocked" | "verified" | "failed";
  workCard: WorkCard;
};

export type SkillTestVector = {
  name: string;
  input: unknown;
  expected: unknown;
};

export type SkillCandidateProposal = {
  schemaVersion: 1;
  skillName: string;
  summary: string;
  source: string;
  tests: SkillTestVector[];
  limitations: string[];
};

export type CandidateGenerator = {
  id: string;
  external: boolean;
  maximumCostUsd: number;
  generate(input: {
    objective: string;
    acceptanceCriteria: string[];
    missingCapabilities: string[];
    constitutionDigest: string;
    memoryContext: CandidateMemoryContext;
  }): Promise<SkillCandidateProposal>;
};

export type MutationStage = "SANDBOX" | "SHADOW" | "CANARY" | "LIMITED_PRODUCTION" | "BROADER_PRODUCTION";

export type MutationEvidence = {
  id: string;
  command: string;
  exitCode: number;
  outputDigest: string;
  candidateDigest: string;
  observedAt: string;
  attestation: "candidate_self_attested" | "owner_attested" | "kernel_executed";
};

export type Mutation = {
  id: string;
  jobId: string;
  summary: string;
  candidateDigest: string;
  artifactRelativePath?: string;
  stage: MutationStage;
  evidence: MutationEvidence[];
  createdAt: string;
};
