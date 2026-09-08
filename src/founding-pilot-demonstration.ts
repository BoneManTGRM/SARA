import { canonicalJson, sha256 } from "./canonical.ts";
import {
  compileRepositoryReadinessReport,
  type RepositoryReadinessReport,
} from "./repository-readiness-report.ts";

export const SARA_DEMONSTRATION_REVISION = "5a1144cb795789964d54d6fb8bcded9fb90462c0";

export type FoundingPilotDemonstration = {
  schemaVersion: 1;
  artifactKind: "UNPAID_DEMONSTRATION";
  customerInvolved: false;
  ownerReviewCompleted: false;
  externalPublicationAuthorized: false;
  reportDigest: string;
  report: RepositoryReadinessReport;
  safestNextStep: string;
};

function evidenceUrl(path: string, lineAnchor = ""): string {
  return `https://github.com/BoneManTGRM/SARA/blob/${SARA_DEMONSTRATION_REVISION}/${path}${lineAnchor}`;
}

export function buildSaraFoundingPilotDemonstration(): FoundingPilotDemonstration {
  const workflowUrl = evidenceUrl(".github/workflows/ci.yml");
  const codeqlUrl = evidenceUrl(".github/workflows/codeql.yml");
  const report = compileRepositoryReadinessReport({
    repository: "https://github.com/BoneManTGRM/SARA",
    immutableCommitSha: SARA_DEMONSTRATION_REVISION,
    categoryEvidence: [
      {
        category: "code",
        status: "reviewed",
        evidenceUrls: [evidenceUrl("src/founding-pilot.ts")],
        note: "The bounded sample reviewed the founding-pilot intake compiler as representative application code.",
      },
      {
        category: "dependencies",
        status: "reviewed",
        evidenceUrls: [evidenceUrl("package.json")],
        note: "The bounded sample reviewed the public package manifest; dependency alerts and registry state were not inspected.",
      },
      {
        category: "secret_exposure",
        status: "reviewed",
        evidenceUrls: [workflowUrl, codeqlUrl],
        note: "The bounded sample inspected two public workflows for obvious credential literals; it did not scan Git history or provider settings.",
      },
      {
        category: "release_controls",
        status: "reviewed",
        evidenceUrls: [workflowUrl, codeqlUrl],
        note: "The bounded sample reviewed the primary CI and CodeQL workflows at the named revision.",
      },
    ],
    findings: [
      {
        id: "workflow-actions-use-movable-tags",
        category: "release_controls",
        priority: "high",
        confidence: "confirmed",
        title: "CI action dependencies use movable version tags",
        observation: "The primary CI workflow references actions/checkout and actions/setup-node by v4 tags rather than immutable full commit SHAs.",
        recommendation: "Pin each third-party action to a verified full-length commit SHA and retain its release tag in a comment for maintainability.",
        evidenceUrl: evidenceUrl(".github/workflows/ci.yml", "#L12-L13"),
      },
      {
        id: "ci-token-permissions-implicit",
        category: "release_controls",
        priority: "medium",
        confidence: "supported",
        title: "Primary CI token permissions are implicit",
        observation: "The primary CI job does not declare a permissions block, so its effective GITHUB_TOKEN permissions depend on repository or organization defaults.",
        recommendation: "Declare the minimum permissions required by the test job, such as read-only repository contents, after owner review.",
        evidenceUrl: evidenceUrl(".github/workflows/ci.yml", "#L8-L18"),
      },
    ],
    evidenceLimitations: [
      "This unpaid demonstration sampled four public files and did not inspect repository settings, security alerts, complete history, private data, or production systems.",
      "The two workflow observations are a bounded readiness sample, not a claim that the repository is unsafe or that no other risks exist.",
    ],
  });

  return {
    schemaVersion: 1,
    artifactKind: "UNPAID_DEMONSTRATION",
    customerInvolved: false,
    ownerReviewCompleted: false,
    externalPublicationAuthorized: false,
    reportDigest: sha256(canonicalJson(report)),
    report,
    safestNextStep: "The owner must review each finding against the immutable source before deciding whether to turn this into a public sample. Nothing in this artifact authorizes publication, delivery, remediation, or customer contact.",
  };
}
