import type { Job } from "./types.ts";

export type ExecutorHandoff = {
  schemaVersion: 1;
  role: "sandboxed_coding_executor";
  jobId: string;
  constitutionDigest: string;
  objective: string;
  acceptanceCriteria: string[];
  missingCapabilities: string[];
  maximumBudgetUsd: number;
  prohibitedActions: string[];
  requiredProcess: string[];
  requiredOutput: string[];
};

export function compileExecutorHandoff(job: Job, constitutionDigest: string): ExecutorHandoff {
  if (job.kind !== "self_development" || job.status !== "authorized") {
    throw new Error("Only an authorized self-development job can be handed to a coding executor.");
  }
  if (!/^[a-f0-9]{64}$/i.test(constitutionDigest)) {
    throw new Error("A verified Constitution digest is required for executor handoff.");
  }

  return {
    schemaVersion: 1,
    role: "sandboxed_coding_executor",
    jobId: job.id,
    constitutionDigest: constitutionDigest.toLowerCase(),
    objective: job.workCard.objective,
    acceptanceCriteria: [...job.workCard.acceptanceCriteria],
    missingCapabilities: [...job.workCard.missingCapabilities],
    maximumBudgetUsd: job.workCard.maximumBudgetUsd,
    prohibitedActions: [...job.workCard.prohibitedActions],
    requiredProcess: [
      "Work only in an isolated candidate branch or sandbox.",
      "Make the smallest coherent change that satisfies the acceptance criteria.",
      "Do not create external accounts, spend money, move funds, impersonate a human, or alter protected authority.",
      "Run focused tests and the repository verification command.",
      "Do not promote, merge, deploy, or self-approve the candidate.",
    ],
    requiredOutput: [
      "candidate digest",
      "changed files",
      "exact verification commands and exit codes",
      "known limitations and remaining risks",
    ],
  };
}
