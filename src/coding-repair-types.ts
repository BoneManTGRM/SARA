import type { ProgramCandidateProposal } from "./types.ts";

export type CodingFailureKind =
  | "syntax"
  | "type"
  | "test"
  | "behavior"
  | "policy"
  | "security"
  | "integrity"
  | "timeout"
  | "unknown";

export type CodingFailureSignal = {
  kind: CodingFailureKind;
  code: string;
  file: string;
  line: number;
  column: number;
  evidenceDigest: string;
  fingerprint: string;
  severity: "low" | "medium" | "high" | "critical";
  existedBeforeRepair: boolean;
};

export type ProgramVerificationResult = {
  passed: boolean;
  score: number;
  artifactDigest: string;
  failures: CodingFailureSignal[];
  completedChecks: Array<"source_policy" | "syntax" | "typecheck" | "behavior_tests" | "artifact_integrity">;
  evidenceDigests: string[];
};

export type CodingRepairStrategy = "deterministic" | "luna_surgical" | "luna_deep" | "challenger" | "stop";

export type CodingRepairDecision = {
  strategy: CodingRepairStrategy;
  locality: number;
  risk: number;
  remainingCycles: number;
  remainingCostUsd: number;
  reasonCode: string;
};

export type CodingRepairProposal = {
  schemaVersion: 1;
  baseArtifactDigest: string;
  failureFingerprint: string;
  strategy: "surgical" | "deep";
  changes: Array<{
    path: string;
    expectedContentDigest: string;
    replacementText: string;
  }>;
  limitations: string[];
};

export type CodingRepairReceipt = {
  cycle: number;
  beforeArtifactDigest: string;
  failureFingerprint: string;
  proposalDigest: string;
  afterArtifactDigest: string | null;
  strategy: CodingRepairStrategy;
  changedFiles: number;
  changedLines: number;
  verifierEvidenceDigests: string[];
  inputTokens: number;
  outputTokens: number;
  accountedCostUsd: number;
  rye: number;
  outcome: "accepted_improvement" | "verified_complete" | "rolled_back" | "stopped";
  reasonCode: string;
};

export type ReparodynamicCodingMode = "off" | "shadow" | "canary";

export type CodingRepairLimits = {
  maximumCycles: number;
  surgicalFiles: number;
  surgicalChangedLines: number;
  deepFiles: number;
  deepChangedLines: number;
  maximumModelSpendUsd: number;
  protectedPaths: readonly string[];
};

export type CodingRepairRun = {
  baseline: ProgramCandidateProposal;
  champion: ProgramCandidateProposal;
  state: "BASELINE" | "PROVISIONAL_CHAMPION" | "VERIFIED_CANDIDATE" | "STOPPED";
  verification: ProgramVerificationResult;
  receipts: CodingRepairReceipt[];
  accountedCostUsd: number;
};
