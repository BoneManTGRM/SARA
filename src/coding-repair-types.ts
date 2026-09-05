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

export type CodingVerificationCheck =
  | "source_policy"
  | "syntax"
  | "typecheck"
  | "behavior_tests"
  | "artifact_integrity";

export type ProgramVerificationResult = {
  passed: boolean;
  score: number;
  artifactDigest: string;
  failures: CodingFailureSignal[];
  completedChecks: CodingVerificationCheck[];
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

export type CodingRepairAttemptOutcome =
  | "accepted_improvement"
  | "rolled_back"
  | "duplicate_rejected"
  | "advanced_latest_state";

export type CodingRepairHypothesis =
  | "input_validation"
  | "exact_sum_invariant"
  | "deterministic_ordering"
  | "state_cleanup"
  | "retry_safety"
  | "cross_module_consistency"
  | "type_contract"
  | "syntax_integrity"
  | "security_boundary"
  | "behavioral_invariant";

export type CodingRepairFailureSummary = {
  kind: CodingFailureKind;
  code: string;
  file: string;
  line: number;
  severity: CodingFailureSignal["severity"];
};

export type CodingRepairSourceChangeSummary = {
  schemaVersion: 1;
  path: string;
  beforeContentDigest: string;
  afterContentDigest: string;
  addedSignals: string[];
  removedSignals: string[];
  signalDigest: string;
};

export type CodingRepairAttemptLesson = {
  schemaVersion: 1;
  cycle: number;
  requestedStrategy: "surgical" | "deep";
  proposalDigest: string;
  championArtifactDigest: string;
  proposedArtifactDigest: string | null;
  changedPaths: string[];
  changedFiles: number;
  changedLines: number;
  beforeScore: number;
  afterScore: number;
  scoreDelta: number;
  beforeFailureFingerprints: string[];
  afterFailureFingerprints: string[];
  beforeCompletedChecks: CodingVerificationCheck[];
  afterCompletedChecks: CodingVerificationCheck[];
  preservedChecks: CodingVerificationCheck[];
  lostChecks: CodingVerificationCheck[];
  newlyReachedChecks: CodingVerificationCheck[];
  outcome: CodingRepairAttemptOutcome;
  reasonCode: string;
  rye: number;
  beforeFailures?: CodingRepairFailureSummary[];
  afterFailures?: CodingRepairFailureSummary[];
  sourceChanges?: CodingRepairSourceChangeSummary[];
  sourceChangesDigest?: string;
};

export type CodingRepairModelAttemptLesson = {
  schemaVersion: 1;
  cycle: number;
  requestedStrategy: "surgical" | "deep";
  proposalDigest: string;
  changedPaths: string[];
  changedLines: number;
  scoreDelta: number;
  lostChecks: CodingVerificationCheck[];
  newlyReachedChecks: CodingVerificationCheck[];
  outcome: CodingRepairAttemptOutcome;
  reasonCode: string;
  beforeFailures: CodingRepairFailureSummary[];
  afterFailures: CodingRepairFailureSummary[];
  sourceSignals: string[];
  sourceSignalsDigest: string;
  attemptedHypotheses: CodingRepairHypothesis[];
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
  outcome: "accepted_improvement" | "verified_complete" | "rolled_back" | "duplicate_rejected" | "stopped";
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
  baselineVerification: ProgramVerificationResult;
  champion: ProgramCandidateProposal;
  state: "BASELINE" | "PROVISIONAL_CHAMPION" | "VERIFIED_CANDIDATE" | "STOPPED";
  verification: ProgramVerificationResult;
  receipts: CodingRepairReceipt[];
  attemptLessons: CodingRepairAttemptLesson[];
  attemptLessonsDigest: string;
  accountedCostUsd: number;
  elapsedMilliseconds: number;
};
