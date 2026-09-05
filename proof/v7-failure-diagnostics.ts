export type BenchmarkStage =
  | "baseline_verification" | "model_request" | "candidate_validation"
  | "candidate_verification" | "final_verification" | "unknown";

const stages = new Set<string>([
  "baseline_verification", "model_request", "candidate_validation",
  "candidate_verification", "final_verification", "unknown",
]);

const reasons = new Map<string, string>([
  ["Coding repair schema version is unsupported.", "SCHEMA_VERSION"],
  ["Coding repair proposal targets a stale artifact.", "STALE_ARTIFACT"],
  ["Coding repair proposal targets an unknown failure.", "UNKNOWN_FAILURE"],
  ["Coding repair proposal attempted a strategy escalation.", "STRATEGY_ESCALATION"],
  ["Coding repair proposal exceeds its file limit.", "FILE_LIMIT"],
  ["Coding repair proposal contains an unknown or duplicate file.", "UNKNOWN_OR_DUPLICATE_FILE"],
  ["Coding repair proposal targets a protected path.", "PROTECTED_PATH"],
  ["Coding repair proposal contains a stale file digest.", "STALE_FILE_DIGEST"],
  ["Coding repair replacement cannot be empty.", "EMPTY_REPLACEMENT"],
  ["Coding repair limitations are malformed.", "MALFORMED_LIMITATIONS"],
  ["Coding repair proposal exceeds its changed-line limit.", "CHANGED_LINE_LIMIT"],
  ["Coding repair model exceeded or malformed its accounted cost.", "MODEL_COST_LIMIT"],
  ["Luna repair output failed the bounded proposal contract.", "MODEL_OUTPUT_CONTRACT"],
]);

/** Emit only allowlisted categories. Never serialize an exception or provider text. */
export function describeBenchmarkFailure(
  error: unknown,
  stage: BenchmarkStage,
): {stage: BenchmarkStage; code: string} {
  const safeStage: BenchmarkStage = stages.has(stage) ? stage : "unknown";
  let code = "UNCLASSIFIED_ERROR";
  try {
    if (error instanceof Error) {
      // Inspect only an own data property; do not execute a getter on an unknown error.
      const descriptor = Object.getOwnPropertyDescriptor(error, "message");
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string"
          && descriptor.value.length <= 500) {
        code = reasons.get(descriptor.value) ?? code;
      }
    }
  } catch {
    // Proxies and nonstandard errors must not derail evidence capture.
  }
  return {stage: safeStage, code};
}

/** The original live authorization has been consumed. This branch is offline-only. */
export function assertOfflineRecovery(args: readonly string[]): void {
  if (args.includes("--live")) {
    throw new Error("V7 live authorization has been consumed; this recovery branch is offline-only.");
  }
}
