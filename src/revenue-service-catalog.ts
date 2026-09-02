import type { PilotGoal } from "./founding-pilot.ts";

export const REVENUE_SERVICE_CATALOG = [
  {
    id: "public-repository-readiness-snapshot",
    name: "Public Repository Readiness Snapshot",
    priceUsd: 149,
    maximumExecutionCostUsd: 3,
    supportedGoals: ["security_baseline", "release_readiness", "dependency_health"] as const,
    requiredCapabilities: [
      "public-repository-inventory",
      "readiness-analysis",
      "independent-report-verification",
      "delivery-package-generation",
    ] as const,
    deliverables: [
      "public repository evidence inventory",
      "readiness summary",
      "prioritized findings with immutable source locations",
      "private owner-review package",
    ] as const,
  },
  {
    id: "documentation-clarity-review",
    name: "Documentation Clarity Review",
    priceUsd: 79,
    maximumExecutionCostUsd: 1,
    supportedGoals: ["release_readiness"] as const,
    requiredCapabilities: [
      "public-repository-inventory",
      "documentation-clarity-analysis",
      "independent-report-verification",
      "delivery-package-generation",
    ] as const,
    deliverables: [
      "README and public documentation evidence map",
      "onboarding and usage clarity findings",
      "prioritized documentation improvements",
      "private owner-review package",
    ] as const,
  },
  {
    id: "ci-workflow-readiness-review",
    name: "CI Workflow Readiness Review",
    priceUsd: 99,
    maximumExecutionCostUsd: 2,
    supportedGoals: ["security_baseline", "release_readiness"] as const,
    requiredCapabilities: [
      "public-repository-inventory",
      "ci-workflow-analysis",
      "independent-report-verification",
      "delivery-package-generation",
    ] as const,
    deliverables: [
      "public workflow evidence map",
      "test and release-control observations",
      "prioritized workflow risks and gaps",
      "private owner-review package",
    ] as const,
  },
  {
    id: "dependency-hygiene-brief",
    name: "Dependency Hygiene Brief",
    priceUsd: 79,
    maximumExecutionCostUsd: 1,
    supportedGoals: ["dependency_health"] as const,
    requiredCapabilities: [
      "public-repository-inventory",
      "dependency-health-analysis",
      "independent-report-verification",
      "delivery-package-generation",
    ] as const,
    deliverables: [
      "public manifest evidence map",
      "dependency-management observations",
      "prioritized hygiene gaps",
      "private owner-review package",
    ] as const,
  },
] as const;

export type RevenueServiceId = (typeof REVENUE_SERVICE_CATALOG)[number]["id"];
export type RevenueServiceProfile = (typeof REVENUE_SERVICE_CATALOG)[number];

export function getRevenueService(serviceId: string): RevenueServiceProfile {
  const service = REVENUE_SERVICE_CATALOG.find((candidate) => candidate.id === serviceId);
  if (!service) throw new Error("The requested revenue service is not recognized.");
  return service;
}

export function serviceSupportsGoal(service: RevenueServiceProfile, goal: PilotGoal): boolean {
  return (service.supportedGoals as readonly PilotGoal[]).includes(goal);
}

export function listRevenueServices(): Array<{
  id: RevenueServiceId;
  name: string;
  priceUsd: number;
  maximumExecutionCostUsd: number;
  supportedGoals: readonly PilotGoal[];
  requiredCapabilities: readonly string[];
  deliverables: readonly string[];
  authority: "owner_review_only";
}> {
  return REVENUE_SERVICE_CATALOG.map((service) => ({
    ...service,
    supportedGoals: [...service.supportedGoals],
    requiredCapabilities: [...service.requiredCapabilities],
    deliverables: [...service.deliverables],
    authority: "owner_review_only",
  }));
}
