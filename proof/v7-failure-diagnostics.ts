import {classifyCodingRepairRejection} from "../src/coding-repair-rejection.ts";
export type BenchmarkStage =
  | "baseline_verification" | "model_request" | "candidate_validation"
  | "candidate_verification" | "final_verification" | "unknown";

const stages = new Set<string>([
  "baseline_verification", "model_request", "candidate_validation",
  "candidate_verification", "final_verification", "unknown",
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
        const classified = classifyCodingRepairRejection(error);
        code = classified === "UNKNOWN_REJECTION"
          ? descriptor.value === "Luna repair output failed the bounded proposal contract." ? "MODEL_OUTPUT_CONTRACT" : code
          : classified;
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
