export type CodingRepairModelAttemptLesson = {
  schemaVersion: 1;
  cycle: number;
  requestedStrategy: "surgical" | "deep";
  proposalDigest: string;
  changedPaths: string[];
  changedLines: number;
  scoreDelta: number;
  lostChecks: string[];
  newlyReachedChecks: string[];
  outcome: string;
  reasonCode: string;
  beforeFailures: Array<{ code: string }>;
  afterFailures: Array<{ code: string }>;
  sourceSignals: string[];
  sourceSignalsDigest: string;
  attemptedHypotheses: string[];
};

export function projectCodingRepairAttemptLessonsForModel(
  _lessons: readonly unknown[],
): CodingRepairModelAttemptLesson[] {
  return [];
}
