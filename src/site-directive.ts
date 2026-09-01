import { resolve } from "node:path";
import { SARA_PRINCIPAL, type SaraKernel } from "./kernel.ts";
import type { CandidateGenerator, SkillCandidateProposal } from "./types.ts";

export const SITE_EXECUTOR_KIND = "deterministic_release_evidence_normalizer_v1" as const;
export const SITE_GENERATOR_ID = "deterministic-release-evidence-normalizer-v1" as const;
const PROOF_OBJECTIVE = "Create a deterministic release-evidence normalizer that trims and lowercases string input and rejects non-string input.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const DRAFT_PR = /^https:\/\/github\.com\/BoneManTGRM\/SARA\/pull\/[1-9][0-9]*$/u;

export type ClaimedSiteDirective = {
  id: string;
  objective: string;
  status: "EXECUTOR_CLAIMED";
  maximumBudgetUsd: 0;
  publicRepoApproved: true;
  executorKind: typeof SITE_EXECUTOR_KIND;
  workCard: {
    schemaVersion: 1;
    kind: "self_development";
    acceptanceCriteria: string[];
    maximumBudgetUsd: 0;
    publicRepoApproved: true;
    executorKind: typeof SITE_EXECUTOR_KIND;
    prohibitedActions: string[];
  };
};

export type DraftPullRequestEvidence = {
  draftPrUrl: string;
  commitSha: string;
  sourceTreeDigest: string;
  verification: Array<{ command: string; exitCode: 0; outputDigest: string }>;
};

export type CandidatePublication = {
  directiveId: string;
  candidateDigest: string;
  artifactDirectory: string;
  mutationId: string;
  jobId: string;
  stage: "SHADOW";
};

export type DraftPullRequestPublisher = {
  publish(candidate: CandidatePublication): Promise<DraftPullRequestEvidence>;
};

export type SiteDirectiveShadowResult = {
  schemaVersion: 1;
  status: "SHADOW";
  maximumCostUsd: 0;
  generatorId: typeof SITE_GENERATOR_ID;
  candidateDigest: string;
  sourceTreeDigest: string;
  commitSha: string;
  draftPrUrl: string;
  verification: DraftPullRequestEvidence["verification"];
  lessons: string[];
};

function validateDirective(directive: ClaimedSiteDirective): void {
  if (!UUID_V4.test(directive.id)) throw new Error("Site directive id must be a UUID v4.");
  if (directive.status !== "EXECUTOR_CLAIMED") throw new Error("Site directive is not executor-claimed.");
  if (directive.maximumBudgetUsd !== 0 || directive.workCard.maximumBudgetUsd !== 0) {
    throw new Error("The site directive runner accepts zero-cost work only.");
  }
  if (directive.publicRepoApproved !== true || directive.workCard.publicRepoApproved !== true) {
    throw new Error("Explicit public-repository approval is required.");
  }
  if (directive.executorKind !== SITE_EXECUTOR_KIND || directive.workCard.executorKind !== SITE_EXECUTOR_KIND) {
    throw new Error("Site directive executor kind is unsupported.");
  }
  if (directive.objective !== PROOF_OBJECTIVE) {
    throw new Error("The deterministic generator is not authorized for this objective.");
  }
  if (
    directive.workCard.schemaVersion !== 1 ||
    directive.workCard.kind !== "self_development" ||
    !Array.isArray(directive.workCard.acceptanceCriteria) ||
    directive.workCard.acceptanceCriteria.length < 1 ||
    directive.workCard.acceptanceCriteria.length > 12 ||
    directive.workCard.acceptanceCriteria.some((criterion) => !criterion.trim() || criterion.length > 500)
  ) {
    throw new Error("Site directive work card is malformed.");
  }
}

function proposal(): SkillCandidateProposal {
  return {
    schemaVersion: 1,
    skillName: "Release Evidence Normalizer",
    summary: "A pure deterministic normalizer for bounded release-evidence labels.",
    source: [
      "export function runSkill(input: unknown): unknown {",
      '  if (typeof input !== "string") return null;',
      "  return input.trim().toLowerCase();",
      "}",
      "",
    ].join("\n"),
    tests: [
      { name: "normalizes text", input: "  RELEASE PASS  ", expected: "release pass" },
      { name: "rejects non-string input", input: 42, expected: null },
    ],
    limitations: ["Normalizes string labels only; it does not interpret or verify release evidence."],
  };
}

function deterministicGenerator(): CandidateGenerator {
  return {
    id: SITE_GENERATOR_ID,
    external: false,
    maximumCostUsd: 0,
    async generate() {
      return proposal();
    },
  };
}

function validatePublication(evidence: DraftPullRequestEvidence): void {
  if (!DRAFT_PR.test(evidence.draftPrUrl)) throw new Error("Publisher did not return a trusted SARA draft PR URL.");
  if (!GIT_COMMIT.test(evidence.commitSha)) throw new Error("Publisher commit must be a Git object digest.");
  if (!SHA256.test(evidence.sourceTreeDigest)) throw new Error("Publisher source tree digest must be SHA-256.");
  if (
    !Array.isArray(evidence.verification) ||
    evidence.verification.length < 1 ||
    evidence.verification.length > 12 ||
    evidence.verification.some((check) =>
      !check.command.trim() || check.command.length > 200 || check.exitCode !== 0 || !SHA256.test(check.outputDigest),
    )
  ) {
    throw new Error("Publisher verification evidence is incomplete.");
  }
}

export async function runClaimedSiteDirective(
  kernel: SaraKernel,
  stateDirectory: string,
  directive: ClaimedSiteDirective,
  publisher: DraftPullRequestPublisher,
): Promise<SiteDirectiveShadowResult> {
  validateDirective(directive);
  const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
    objective: directive.objective,
    expectedOwnerValue: 1,
    requiredCapabilities: ["release-evidence-normalizer"],
    acceptanceCriteria: [...directive.workCard.acceptanceCriteria],
    maximumBudgetUsd: 0,
    external: true,
  });
  const execution = await kernel.runSelfBuildCycle(
    SARA_PRINCIPAL,
    job.id,
    deterministicGenerator(),
  );
  if (execution.job.status !== "verified" || execution.mutation.stage !== "SHADOW") {
    throw new Error("Kernel did not produce a verified SHADOW candidate.");
  }
  const publication = await publisher.publish({
    directiveId: directive.id,
    candidateDigest: execution.mutation.candidateDigest,
    artifactDirectory: resolve(stateDirectory, execution.artifactRelativePath),
    mutationId: execution.mutation.id,
    jobId: job.id,
    stage: "SHADOW",
  });
  validatePublication(publication);
  return {
    schemaVersion: 1,
    status: "SHADOW",
    maximumCostUsd: 0,
    generatorId: SITE_GENERATOR_ID,
    candidateDigest: execution.mutation.candidateDigest,
    sourceTreeDigest: publication.sourceTreeDigest,
    commitSha: publication.commitSha,
    draftPrUrl: publication.draftPrUrl,
    verification: publication.verification,
    lessons: [
      "The fixed zero-cost generator produced a kernel-verified candidate and stopped at SHADOW.",
      "Draft publication did not grant merge, deployment, spending, or production authority.",
    ],
  };
}
