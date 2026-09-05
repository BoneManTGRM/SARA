import { canonicalJson, sha256 } from "./canonical.ts";

// Only exact controller-owned messages are admitted. No provider prose is retained.
const REASONS = new Map<string, string>([
  ["Coding repair model returned invalid token accounting.", "MODEL_TOKENS_INVALID"],
  ["Coding repair schema version is unsupported.", "UNSUPPORTED_SCHEMA"],
  ["Coding repair proposal targets a stale artifact.", "STALE_ARTIFACT"],
  ["Coding repair proposal targets an unknown failure.", "UNKNOWN_FAILURE"],
  ["Coding repair proposal attempted a strategy escalation.", "STRATEGY_MISMATCH"],
  ["Coding repair proposal exceeds its file limit.", "FILE_LIMIT"],
  ["Coding repair proposal contains an unknown or duplicate file.", "UNKNOWN_OR_DUPLICATE_FILE"],
  ["Coding repair proposal targets a protected path.", "PROTECTED_PATH"],
  ["Coding repair proposal contains a stale file digest.", "STALE_FILE_DIGEST"],
  ["Coding repair replacement cannot be empty.", "EMPTY_REPLACEMENT"],
  ["Coding repair limitations are malformed.", "INVALID_LIMITATIONS"],
  ["Coding repair proposal exceeds its changed-line limit.", "CHANGED_LINE_LIMIT"],
  ["Coding repair model exceeded or malformed its accounted cost.", "MODEL_COST_INVALID"],
]);
function safeMessage(error: unknown): string | null {
  try {
    if (!(error instanceof Error)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" && descriptor.value.length <= 500 ? descriptor.value : null;
  } catch { return null; }
}
export function classifyCodingRepairRejection(error: unknown): string {
  const message = safeMessage(error);
  return message === null ? "UNKNOWN_REJECTION" : REASONS.get(message) ?? "UNKNOWN_REJECTION";
}
function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function cost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function digest(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}
export function buildCodingRepairRejectionEvidence(input: {
  error: unknown; cycle: number; retainedArtifactDigest: string; proposalDigest: string | null;
  inputTokens: unknown; outputTokens: unknown; accountedCostUsd: unknown; knownRunSpendUsd: number;
}) {
  const inputTokens = counter(input.inputTokens), outputTokens = counter(input.outputTokens);
  const accountedCostUsd = cost(input.accountedCostUsd);
  const evidence = {
    schemaVersion: 1 as const, disclosure: "structured_only" as const,
    reasonCode: classifyCodingRepairRejection(input.error),
    cycle: Number.isInteger(input.cycle) && input.cycle >= 1 && input.cycle <= 3 ? input.cycle : null,
    retainedArtifactDigest: digest(input.retainedArtifactDigest), proposalDigest: digest(input.proposalDigest),
    inputTokens, outputTokens, accountedCostUsd, knownRunSpendUsd: cost(input.knownRunSpendUsd),
    usageUnknown: inputTokens === null || outputTokens === null || accountedCostUsd === null,
  };
  return { ...evidence, evidenceDigest: sha256(canonicalJson(evidence)) };
}
export class CodingRepairRejectedAttemptError extends Error {
  readonly evidence: ReturnType<typeof buildCodingRepairRejectionEvidence>;
  constructor(input: Parameters<typeof buildCodingRepairRejectionEvidence>[0]) {
    const message = safeMessage(input.error);
    super(message !== null && REASONS.has(message) ? message : "Coding repair proposal rejected at the controller boundary.");
    this.evidence = Object.freeze(buildCodingRepairRejectionEvidence(input));
    // Legacy benchmark catch blocks recorded only Error.name. Keep the code there too.
    this.name = `CodingRepairRejectedAttemptError:${this.evidence.reasonCode}`;
  }
}
