export type PilotGoal = "security_baseline" | "release_readiness" | "dependency_health" | "other";

export type FoundingPilotInput = {
  repoUrl: string;
  repositoryIsPublic: boolean;
  repositoryOwnerPermissionConfirmed: boolean;
  requiresPrivateAccess: boolean;
  containsRegulatedOrPrivateData: boolean;
  requestsProductionChanges: boolean;
  requestsExploitValidation: boolean;
  primaryGoal: PilotGoal;
  budgetUsd: number;
  desiredTurnaroundDays: number;
  recentCommitDays: number | null;
};

export type FoundingPilotCard = {
  schemaVersion: 1;
  offer: "$149 Public Repository Readiness Snapshot";
  priceUsd: 149;
  repository: string | null;
  fitScore: number;
  decision: "qualified" | "owner_review" | "reject";
  disqualifyingRisks: string[];
  evidenceGaps: string[];
  includedDeliverables: string[];
  excludedActivities: string[];
  estimatedDeliveryHours: 3;
  expectedOwnerReviewMinutes: 30;
  safestNextStep: string;
};

const INCLUDED_DELIVERABLES = [
  "Public repository evidence inventory",
  "Code, dependency, secret-exposure, and release-control readiness summary",
  "Prioritized owner-reviewed findings with source locations",
  "Thirty-minute owner review and delivery decision",
] as const;

const EXCLUDED_ACTIVITIES = [
  "Private-repository or customer-data access",
  "Penetration testing or exploit validation",
  "Production changes, remediation, deployment, or credential handling",
  "Legal, compliance, warranty, or certification claims",
] as const;

export function normalizePublicGitHubRepository(value: string): string | null {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      parts.length !== 2 ||
      !/^[A-Za-z0-9_.-]+$/u.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]+(?:\.git)?$/u.test(parts[1])
    ) {
      return null;
    }
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/u, "")}`;
  } catch {
    return null;
  }
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and non-negative.`);
}

export function compileFoundingPilot(
  input: FoundingPilotInput,
  commercialTerms: { minimumBudgetUsd: number; budgetGapMessage: string } = {
    minimumBudgetUsd: 149,
    budgetGapMessage: "Available budget is below the fixed $149 pilot price",
  },
): FoundingPilotCard {
  requireFiniteNonNegative(input.budgetUsd, "budgetUsd");
  requireFiniteNonNegative(commercialTerms.minimumBudgetUsd, "minimumBudgetUsd");
  if (!commercialTerms.budgetGapMessage.trim()) throw new Error("budgetGapMessage is required.");
  requireFiniteNonNegative(input.desiredTurnaroundDays, "desiredTurnaroundDays");
  if (input.recentCommitDays !== null) requireFiniteNonNegative(input.recentCommitDays, "recentCommitDays");

  const repository = normalizePublicGitHubRepository(input.repoUrl);
  const disqualifyingRisks: string[] = [];
  const evidenceGaps: string[] = [];

  if (!input.repositoryIsPublic) disqualifyingRisks.push("Repository is not publicly reviewable");
  if (input.requiresPrivateAccess) disqualifyingRisks.push("Private access or credentials would be required");
  if (input.containsRegulatedOrPrivateData) disqualifyingRisks.push("Scope may expose regulated or private data");
  if (input.requestsProductionChanges) disqualifyingRisks.push("Requested scope includes production changes");
  if (input.requestsExploitValidation) disqualifyingRisks.push("Requested scope includes exploit validation");
  if (!repository) evidenceGaps.push("Provide one canonical public GitHub repository URL");
  if (!input.repositoryOwnerPermissionConfirmed) evidenceGaps.push("Repository-owner permission is not confirmed");
  if (input.recentCommitDays === null) evidenceGaps.push("Repository activity recency is unknown");
  if (input.primaryGoal === "other") evidenceGaps.push("Define a security, dependency, or release-readiness goal");
  if (input.budgetUsd < commercialTerms.minimumBudgetUsd) evidenceGaps.push(commercialTerms.budgetGapMessage);

  let fitScore = 25;
  if (repository) fitScore += 15;
  if (input.repositoryIsPublic) fitScore += 20;
  if (input.repositoryOwnerPermissionConfirmed) fitScore += 20;
  if (input.primaryGoal !== "other") fitScore += 10;
  if (input.recentCommitDays !== null && input.recentCommitDays <= 180) fitScore += 10;
  if (input.budgetUsd < commercialTerms.minimumBudgetUsd) fitScore -= 20;
  fitScore -= disqualifyingRisks.length * 40;
  fitScore = Math.max(0, Math.min(100, fitScore));

  const decision = disqualifyingRisks.length
    ? "reject"
    : evidenceGaps.length === 0 && fitScore >= 80
      ? "qualified"
      : "owner_review";

  const safestNextStep =
    decision === "reject"
      ? "Decline this pilot scope; do not request credentials, private data, exploitation, or production access."
      : decision === "qualified"
        ? "Owner may review the fixed scope and, if desired, send the intake link and payment request personally."
        : "Resolve the listed evidence gaps before the owner offers or accepts the pilot.";

  return {
    schemaVersion: 1,
    offer: "$149 Public Repository Readiness Snapshot",
    priceUsd: 149,
    repository,
    fitScore,
    decision,
    disqualifyingRisks,
    evidenceGaps,
    includedDeliverables: [...INCLUDED_DELIVERABLES],
    excludedActivities: [...EXCLUDED_ACTIVITIES],
    estimatedDeliveryHours: 3,
    expectedOwnerReviewMinutes: 30,
    safestNextStep,
  };
}
