export type ReadinessCategory = "code" | "dependencies" | "secret_exposure" | "release_controls";
export type ReadinessPriority = "urgent" | "high" | "medium" | "low";
export type ReadinessConfidence = "confirmed" | "supported" | "tentative";

export type ReadinessCategoryEvidence = {
  category: ReadinessCategory;
  status: "reviewed" | "unavailable";
  evidenceUrls: readonly string[];
  note: string;
};

export type ReadinessFinding = {
  id: string;
  category: ReadinessCategory;
  priority: ReadinessPriority;
  confidence: ReadinessConfidence;
  title: string;
  observation: string;
  recommendation: string;
  evidenceUrl: string;
};

export type RepositoryReadinessReportInput = {
  repository: string;
  immutableCommitSha: string;
  categoryEvidence: readonly ReadinessCategoryEvidence[];
  findings: readonly ReadinessFinding[];
  evidenceLimitations: readonly string[];
};

export type RepositoryReadinessReport = {
  schemaVersion: 1;
  offer: "$149 Public Repository Readiness Snapshot";
  repository: string;
  immutableCommitSha: string;
  status: "ready_for_owner_review" | "needs_evidence";
  readiness: "baseline_observed" | "attention_required" | "incomplete";
  categoryEvidence: ReadinessCategoryEvidence[];
  findings: ReadinessFinding[];
  evidenceGaps: string[];
  limitations: string[];
  externalDeliveryAuthorized: false;
  safestNextStep: string;
};

const CATEGORIES: readonly ReadinessCategory[] = [
  "code",
  "dependencies",
  "secret_exposure",
  "release_controls",
];

const PRIORITY_RANK: Record<ReadinessPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const OVERCLAIM = /\b(?:no vulnerabilities|vulnerability[- ]free|no secrets|fully secure|certified|compliant|penetration tested|guaranteed safe)\b/iu;
const FINDING_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const LINE_ANCHOR = /^#L[1-9]\d*(?:-L[1-9]\d*)?$/u;

function cleanText(value: string, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const cleaned = value.trim().replace(/\s+/gu, " ");
  if (!cleaned) throw new Error(`${label} is required.`);
  if (cleaned.length > 500) throw new Error(`${label} exceeds 500 characters.`);
  if (OVERCLAIM.test(cleaned)) throw new Error(`${label} contains an unsupported assurance claim.`);
  return cleaned;
}

function canonicalRepository(value: string): { canonical: string; owner: string; repo: string } {
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
      !/^[A-Za-z0-9_.-]+$/u.test(parts[1])
    ) {
      throw new Error("Repository must be one canonical public GitHub repository URL.");
    }
    return {
      canonical: `https://github.com/${parts[0]}/${parts[1]}`,
      owner: parts[0].toLowerCase(),
      repo: parts[1].toLowerCase(),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("canonical public GitHub")) throw error;
    throw new Error("Repository must be one canonical public GitHub repository URL.");
  }
}

function validateEvidenceUrl(
  value: string,
  repository: { owner: string; repo: string },
  immutableCommitSha: string,
  requireLineAnchor: boolean,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Evidence URL must be an immutable GitHub permalink.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const validPath =
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "github.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    parts.length >= 5 &&
    parts[0].toLowerCase() === repository.owner &&
    parts[1].toLowerCase() === repository.repo &&
    (parts[2] === "blob" || parts[2] === "tree") &&
    parts[3].toLowerCase() === immutableCommitSha &&
    parts.slice(4).every((part) => part !== "." && part !== "..");
  if (!validPath || (requireLineAnchor ? !LINE_ANCHOR.test(url.hash) : Boolean(url.hash))) {
    throw new Error(
      requireLineAnchor
        ? "Finding evidence must use the same repository and immutable commit with a line anchor."
        : "Evidence must use the same repository and immutable commit.",
    );
  }
  return url.toString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compileRepositoryReadinessReport(
  input: RepositoryReadinessReportInput,
): RepositoryReadinessReport {
  if (!input || typeof input !== "object") throw new TypeError("Report input is required.");
  const repository = canonicalRepository(input.repository);
  const immutableCommitSha = input.immutableCommitSha.toLowerCase();
  if (!COMMIT_SHA.test(immutableCommitSha)) throw new Error("immutableCommitSha must be a 40-character SHA.");
  if (!Array.isArray(input.categoryEvidence) || input.categoryEvidence.length !== CATEGORIES.length) {
    throw new Error("Exactly one evidence record is required for each readiness category.");
  }
  if (!Array.isArray(input.findings) || input.findings.length > 20) {
    throw new Error("findings must contain at most 20 items.");
  }
  if (!Array.isArray(input.evidenceLimitations)) throw new TypeError("evidenceLimitations must be an array.");

  const seenCategories = new Set<ReadinessCategory>();
  const categoryEvidence = input.categoryEvidence.map((record) => {
    if (!CATEGORIES.includes(record.category)) throw new Error("Evidence contains an unsupported category.");
    if (seenCategories.has(record.category)) throw new Error(`Duplicate evidence category: ${record.category}.`);
    seenCategories.add(record.category);
    if (record.status !== "reviewed" && record.status !== "unavailable") {
      throw new Error(`Evidence status for ${record.category} is invalid.`);
    }
    if (!Array.isArray(record.evidenceUrls)) throw new TypeError("evidenceUrls must be an array.");
    const evidenceUrls = [...new Set(record.evidenceUrls.map((url) =>
      validateEvidenceUrl(url, repository, immutableCommitSha, false)
    ))].sort(compareText);
    if (record.status === "reviewed" && evidenceUrls.length === 0) {
      throw new Error(`Reviewed category ${record.category} requires immutable evidence.`);
    }
    if (record.status === "unavailable" && evidenceUrls.length !== 0) {
      throw new Error(`Unavailable category ${record.category} cannot claim evidence.`);
    }
    return {
      category: record.category,
      status: record.status,
      evidenceUrls,
      note: cleanText(record.note, `${record.category} evidence note`),
    };
  }).sort((left, right) => CATEGORIES.indexOf(left.category) - CATEGORIES.indexOf(right.category));

  const seenFindingIds = new Set<string>();
  const findings = input.findings.map((finding) => {
    if (!FINDING_ID.test(finding.id)) throw new Error("Finding id must be a lowercase slug.");
    if (seenFindingIds.has(finding.id)) throw new Error(`Duplicate finding id: ${finding.id}.`);
    seenFindingIds.add(finding.id);
    if (!CATEGORIES.includes(finding.category)) throw new Error("Finding contains an unsupported category.");
    if (!(finding.priority in PRIORITY_RANK)) throw new Error("Finding priority is invalid.");
    if (!["confirmed", "supported", "tentative"].includes(finding.confidence)) {
      throw new Error("Finding confidence is invalid.");
    }
    const category = categoryEvidence.find((record) => record.category === finding.category);
    if (category?.status !== "reviewed") {
      throw new Error(`Finding ${finding.id} cannot rely on unavailable ${finding.category} evidence.`);
    }
    const evidenceUrl = validateEvidenceUrl(finding.evidenceUrl, repository, immutableCommitSha, true);
    const evidenceFileUrl = new URL(evidenceUrl);
    evidenceFileUrl.hash = "";
    if (!category.evidenceUrls.includes(evidenceFileUrl.toString())) {
      throw new Error(`Finding ${finding.id} cites evidence outside its category evidence record.`);
    }
    return {
      id: finding.id,
      category: finding.category,
      priority: finding.priority,
      confidence: finding.confidence,
      title: cleanText(finding.title, `${finding.id} title`),
      observation: cleanText(finding.observation, `${finding.id} observation`),
      recommendation: cleanText(finding.recommendation, `${finding.id} recommendation`),
      evidenceUrl,
    };
  }).sort((left, right) =>
    PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
    CATEGORIES.indexOf(left.category) - CATEGORIES.indexOf(right.category) ||
    compareText(left.id, right.id)
  );

  const evidenceGaps = categoryEvidence
    .filter((record) => record.status === "unavailable")
    .map((record) => `${record.category}: ${record.note}`);
  const evidenceLimitations = [...new Set(input.evidenceLimitations.map((value, index) =>
    cleanText(value, `evidence limitation ${index + 1}`)
  ))].sort(compareText);
  const limitations = [
    "This is a bounded review of one named public revision, not a complete repository or history audit.",
    "The absence of a reported finding is not evidence that vulnerabilities, exposed secrets, or release risks do not exist.",
    "This report is not penetration testing, remediation, certification, legal advice, or a compliance warranty.",
    ...evidenceLimitations,
  ];
  const status = evidenceGaps.length === 0 ? "ready_for_owner_review" : "needs_evidence";
  const readiness = status === "needs_evidence"
    ? "incomplete"
    : findings.some((finding) => finding.priority === "urgent" || finding.priority === "high")
      ? "attention_required"
      : "baseline_observed";

  return {
    schemaVersion: 1,
    offer: "$149 Public Repository Readiness Snapshot",
    repository: repository.canonical,
    immutableCommitSha,
    status,
    readiness,
    categoryEvidence,
    findings,
    evidenceGaps,
    limitations,
    externalDeliveryAuthorized: false,
    safestNextStep: status === "needs_evidence"
      ? "Resolve every evidence gap and recompile the report before owner review."
      : "The owner must review every finding and explicitly approve any external delivery; this compiler sends nothing and changes no repository.",
  };
}
