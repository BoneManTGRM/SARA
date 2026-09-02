import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createCloudflareFreeCandidateGenerator } from "../src/cloudflare-free-generator.ts";
import { GithubDraftPullRequestPublisher } from "../src/github-draft-publisher.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import type { CandidatePublication } from "../src/site-directive.ts";
import type { SkillCandidateProposal } from "../src/types.ts";

const MAX_ATTEMPTS = 2;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function directiveId(input: string): string {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const workspace = resolve(required("GITHUB_WORKSPACE"));
const runnerTemp = resolve(required("RUNNER_TEMP"));
const repository = required("GITHUB_REPOSITORY");
const ref = required("GITHUB_REF");
const runId = required("GITHUB_RUN_ID");
const objective = required("SARA_BUILD_OBJECTIVE");

if (repository !== "BoneManTGRM/SARA" || ref !== "refs/heads/main") {
  throw new Error("Cloudflare self-build may run only from BoneManTGRM/SARA main.");
}
if (process.env.SARA_PUBLIC_DRAFT_APPROVED !== "true") {
  throw new Error("Explicit owner approval for a public draft is required.");
}
if (!objective.trim() || objective.length > 1_000) {
  throw new Error("Owner objective must contain 1–1,000 characters.");
}

const stateDirectory = resolve(runnerTemp, "sara-cloudflare-self-build-state");
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });

const kernel = await SaraKernel.boot({ stateDirectory });
let previousProposal: SkillCandidateProposal | undefined;
let repairFeedback: string | undefined;
let candidate: Omit<CandidatePublication, "directiveId"> | undefined;

function boundedVerifierFeedback(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Behavioral verification mismatches: [^\n\r]*/u);
  return (match?.[0] ?? "Independent isolated verification rejected at least one behavioral vector.").slice(0, 8_192);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
    objective,
    expectedOwnerValue: 1,
    requiredCapabilities: ["generated-pure-skill"],
    acceptanceCriteria: [
      "Satisfy the owner objective with a deterministic pure TypeScript runSkill function.",
      "Include exact behavioral tests for success, boundary, and rejection paths, dry-run before return.",
      "Use no imports, network, filesystem, secrets, timers, outreach, contracts, spending, deployment, accounts, or payments.",
    ],
    maximumBudgetUsd: 0,
    external: true,
  });
  const cloudflare = createCloudflareFreeCandidateGenerator({
    accountId: required("CLOUDFLARE_ACCOUNT_ID"),
    apiToken: required("CLOUDFLARE_API_TOKEN"),
    workersPlan: required("SARA_WORKERS_PLAN"),
    repairProposal: previousProposal,
    repairFeedback,
  });
  try {
    const execution = await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, {
      ...cloudflare,
      id: `${cloudflare.id}-attempt-${attempt}`,
      async generate(input) {
        previousProposal = await cloudflare.generate(input);
        return previousProposal;
      },
    });
    if (execution.job.status !== "verified" || execution.mutation.stage !== "SHADOW") {
      throw new Error("Kernel did not produce a verified SHADOW candidate.");
    }
    candidate = {
      candidateDigest: execution.mutation.candidateDigest,
      artifactDirectory: resolve(stateDirectory, execution.artifactRelativePath),
      mutationId: execution.mutation.id,
      jobId: execution.job.id,
      stage: "SHADOW",
    };
    break;
  } catch (error) {
    if (attempt === MAX_ATTEMPTS || !previousProposal) throw error;
    repairFeedback = boundedVerifierFeedback(error);
    console.log("Initial untrusted candidate was rejected; starting the single bounded repair attempt.");
  }
}

if (!candidate) throw new Error("No verified SHADOW candidate was produced.");

const id = directiveId(`${repository}:${runId}:${objective}`);
const publication = await new GithubDraftPullRequestPublisher({ repository: workspace }).publish({
  directiveId: id,
  ...candidate,
});

console.log(`Verified SHADOW draft created: ${publication.draftPrUrl}`);
