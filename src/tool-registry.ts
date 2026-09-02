export type SaraToolDescriptor = {
  id: string;
  name: string;
  status: "available" | "configuration_required";
  mode: "read_only" | "sandbox_write" | "internal_state";
  purpose: string;
  invocationBoundary: string;
  requiredApproval: string;
  prohibitedActions: string[];
};

const COMMON_PROHIBITIONS = [
  "outreach",
  "applications",
  "contracts",
  "payments",
  "customer delivery",
  "customer-system access",
  "production mutation",
] as const;

function descriptor(input: Omit<SaraToolDescriptor, "prohibitedActions">): SaraToolDescriptor {
  return { ...input, prohibitedActions: [...COMMON_PROHIBITIONS] };
}

export function listSaraTools(options: { lunaConfigured: boolean }): SaraToolDescriptor[] {
  return [
    descriptor({
      id: "luna-worker",
      name: "Bounded Luna Worker",
      status: options.lunaConfigured ? "available" : "configuration_required",
      mode: "read_only",
      purpose: "Analyze bounded work packets and produce private artifacts within token, cost, retry, and time limits.",
      invocationBoundary: "Only an owner-approved job backed by collected revenue may invoke paid work.",
      requiredApproval: "job-bound fulfillment approval",
    }),
    descriptor({
      id: "public-github-evidence",
      name: "Public GitHub Evidence Collector",
      status: "available",
      mode: "read_only",
      purpose: "Collect a bounded anonymous snapshot pinned to an immutable public repository commit.",
      invocationBoundary: "Public GitHub repositories only; no credentials, private repositories, or mutations.",
      requiredApproval: "authorized revenue job",
    }),
    descriptor({
      id: "durable-job-queue",
      name: "Durable Job Queue",
      status: "available",
      mode: "internal_state",
      purpose: "Persist work state, leases, retries, receipts, and restart recovery.",
      invocationBoundary: "Kernel policy and emergency-stop enforcement.",
      requiredApproval: "existing kernel authority",
    }),
    descriptor({
      id: "independent-verifier",
      name: "Independent Verifier",
      status: options.lunaConfigured ? "available" : "configuration_required",
      mode: "read_only",
      purpose: "Check a specialist artifact using a different logical worker and fail closed on rejection.",
      invocationBoundary: "Runs after specialist evidence and cannot authorize delivery.",
      requiredApproval: "authorized revenue job",
    }),
    descriptor({
      id: "genome-lab-skill-builder",
      name: "Genome Lab Skill Builder",
      status: "available",
      mode: "sandbox_write",
      purpose: "Verify a bounded deterministic skill candidate in isolation.",
      invocationBoundary: "Zero-cost candidate work that stops at SHADOW.",
      requiredApproval: "owner-authenticated candidate submission",
    }),
    descriptor({
      id: "genome-lab-program-builder",
      name: "Genome Lab Program Builder",
      status: "available",
      mode: "sandbox_write",
      purpose: "Type-check and test a dependency-free multi-file TypeScript candidate without network or filesystem-write authority.",
      invocationBoundary: "Zero-cost candidate work that stops at SHADOW and cannot modify SARA production.",
      requiredApproval: "owner-authenticated candidate submission",
    }),
  ];
}
