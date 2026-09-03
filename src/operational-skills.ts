import { canonicalJson, sha256 } from "./canonical.ts";
import type { Mutation, MutationStage, OperationalSkillMetadata, OperationalSkillSource } from "./types.ts";

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const SAFE_TERM = /^[a-z0-9][a-z0-9 ._+/#-]{0,63}$/u;
const LOADABLE_STAGES = new Set<MutationStage>(["CANARY", "LIMITED_PRODUCTION", "BROADER_PRODUCTION"]);
const APPROVED_LICENSES = new Set([
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LicenseRef-SARA-Proprietary",
  "MIT",
]);

export type CompiledOperationalSkillProvenance = OperationalSkillMetadata & {
  provenanceDigest: string;
  instructionAuthority: false;
  productionAuthority: false;
  allowedRuntimeAuthorities: [];
};

export type OperationalSkillRecord = {
  schemaVersion: 1;
  mutationId: string;
  candidateDigest: string;
  name: string;
  summary: string;
  stage: MutationStage;
  loadable: boolean;
  productionAuthority: false;
  executionAuthority: "none";
  provenance: CompiledOperationalSkillProvenance;
};

export type OperationalSkillRoute = {
  skillId: string;
  mutationId: string;
  name: string;
  summary: string;
  stage: MutationStage;
  provenanceDigest: string;
  sourceCount: number;
  executionAuthority: "none";
  productionAuthority: false;
  matchedTerms: string[];
};

export type OperationalSkillCatalogEntry = Omit<OperationalSkillRoute, "matchedTerms">;

export type OperationalSkillCatalog = {
  schemaVersion: 1;
  totalCandidates: number;
  loadableSkills: OperationalSkillCatalogEntry[];
  shadowCandidates: OperationalSkillCatalogEntry[];
  invalidArtifacts: number;
  safeguards: {
    immutableSourcesRequired: true;
    licenseClearanceRequired: true;
    executionChecksRequired: true;
    selectiveLoading: true;
    ownerPromotionRequired: true;
    externalInstructionsAreData: true;
    runtimeAuthorityGranted: false;
  };
};

export function catalogOperationalSkills(
  records: readonly OperationalSkillRecord[],
  invalidArtifacts = 0,
): OperationalSkillCatalog {
  if (!Number.isInteger(invalidArtifacts) || invalidArtifacts < 0) {
    throw new RangeError("Invalid operational-skill artifact count must be a non-negative integer.");
  }
  const entry = (record: OperationalSkillRecord): OperationalSkillCatalogEntry => ({
    skillId: record.provenance.skillId,
    mutationId: record.mutationId,
    name: record.name,
    summary: record.summary,
    stage: record.stage,
    provenanceDigest: record.provenance.provenanceDigest,
    sourceCount: record.provenance.sources.length,
    executionAuthority: "none",
    productionAuthority: false,
  });
  return {
    schemaVersion: 1,
    totalCandidates: records.length,
    loadableSkills: records.filter((record) => record.loadable).map(entry),
    shadowCandidates: records.filter((record) => !record.loadable).map(entry),
    invalidArtifacts,
    safeguards: {
      immutableSourcesRequired: true,
      licenseClearanceRequired: true,
      executionChecksRequired: true,
      selectiveLoading: true,
      ownerPromotionRequired: true,
      externalInstructionsAreData: true,
      runtimeAuthorityGranted: false,
    },
  };
}

function safeHttpsUrl(value: string, label: string): string {
  if (!value || value.length > 500) throw new Error(`${label} must be a bounded HTTPS URL.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a bounded HTTPS URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} must use HTTPS and contain no embedded credentials.`);
  }
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname.endsWith(".local")
  ) {
    throw new Error(`${label} may not reference a local address.`);
  }
  return parsed.toString();
}

function normalizedSource(source: OperationalSkillSource): OperationalSkillSource {
  const sourceKeys = [
    "attribution",
    "contentSha256",
    "immutableRevision",
    "kind",
    "licenseEvidenceUri",
    "licenseSpdx",
    "uri",
  ];
  if (!source || typeof source !== "object" || Object.keys(source).sort().join("\n") !== sourceKeys.join("\n")) {
    throw new Error("Operational-skill source metadata contains unsupported fields.");
  }
  if (!new Set(["repository", "paper", "experiment"]).has(source.kind)) {
    throw new Error("Operational-skill source kind is unsupported.");
  }
  const contentSha256 = source.contentSha256.toLowerCase();
  if (!SHA256.test(contentSha256) || /^0{64}$/u.test(contentSha256)) {
    throw new Error("Every operational-skill source requires a non-zero SHA-256 content digest.");
  }
  if (!APPROVED_LICENSES.has(source.licenseSpdx)) {
    throw new Error(`Source license ${source.licenseSpdx || "(missing)"} is not approved for SARA operational skills.`);
  }
  if (!source.attribution.trim() || source.attribution.length > 300) {
    throw new Error("Every operational-skill source requires bounded attribution.");
  }
  const immutableRevision = source.immutableRevision.trim();
  if (source.kind === "repository" && !GIT_COMMIT.test(immutableRevision)) {
    throw new Error("Repository operational-skill sources require an immutable 40-character commit.");
  }
  if (
    source.kind !== "repository" &&
    (!immutableRevision || immutableRevision.length > 200 || /^(?:head|latest|main|master)$/iu.test(immutableRevision))
  ) {
    throw new Error("Paper and experiment sources require a bounded immutable revision.");
  }
  const uri = safeHttpsUrl(source.uri, "Source URI");
  const licenseEvidenceUri = safeHttpsUrl(source.licenseEvidenceUri, "License evidence URI");
  if (source.kind === "repository" && !licenseEvidenceUri.toLowerCase().includes(immutableRevision.toLowerCase())) {
    throw new Error("Repository license evidence must be pinned to the same immutable commit.");
  }
  return {
    kind: source.kind,
    uri,
    immutableRevision: source.kind === "repository" ? immutableRevision.toLowerCase() : immutableRevision,
    contentSha256,
    licenseSpdx: source.licenseSpdx,
    licenseEvidenceUri,
    attribution: source.attribution.trim(),
  };
}

function boundedTextList(values: string[], label: string, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximumItems) {
    throw new Error(`${label} must contain 1–${maximumItems} entries.`);
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value || value.length > maximumLength)) {
    throw new Error(`${label} entries must be non-empty and at most ${maximumLength} characters.`);
  }
  if (new Set(normalized.map((value) => value.toLowerCase())).size !== normalized.length) {
    throw new Error(`${label} entries must be unique.`);
  }
  return normalized;
}

export function compileOperationalSkillProvenance(
  metadata: OperationalSkillMetadata,
): CompiledOperationalSkillProvenance {
  if (!metadata || metadata.schemaVersion !== 1) {
    throw new Error("Operational-skill metadata schema version is unsupported.");
  }
  const metadataKeys = ["activationTerms", "knownFailureModes", "schemaVersion", "skillId", "sources"];
  if (Object.keys(metadata).sort().join("\n") !== metadataKeys.join("\n")) {
    throw new Error("Operational-skill metadata contains unsupported fields.");
  }
  if (!SAFE_ID.test(metadata.skillId)) {
    throw new Error("Operational skill id must be a 2–64 character lowercase identifier.");
  }
  const activationTerms = boundedTextList(metadata.activationTerms, "Activation terms", 16, 64)
    .map((term) => term.toLowerCase());
  if (activationTerms.some((term) => !SAFE_TERM.test(term))) {
    throw new Error("Activation terms contain unsupported characters.");
  }
  const knownFailureModes = boundedTextList(metadata.knownFailureModes, "Known failure modes", 16, 300);
  if (!Array.isArray(metadata.sources) || metadata.sources.length < 1 || metadata.sources.length > 8) {
    throw new Error("Operational skills require 1–8 immutable sources.");
  }
  const sources = metadata.sources.map(normalizedSource);
  const sourceKeys = sources.map((source) => `${source.kind}:${source.uri}:${source.immutableRevision}:${source.contentSha256}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error("Operational-skill sources must be unique.");
  }
  const bound = {
    schemaVersion: 1 as const,
    skillId: metadata.skillId,
    activationTerms,
    knownFailureModes,
    sources,
    instructionAuthority: false as const,
    productionAuthority: false as const,
    allowedRuntimeAuthorities: [] as [],
  };
  return { ...bound, provenanceDigest: sha256(canonicalJson(bound)) };
}

function queryTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+(?:[._+#/-][a-z0-9]+)*/gu) ?? []);
}

export function routeOperationalSkills(
  records: readonly OperationalSkillRecord[],
  query: string,
  limit = 5,
): OperationalSkillRoute[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 1_000) {
    throw new Error("Operational-skill routing requires a bounded query.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new RangeError("Operational-skill route limit must be between 1 and 8.");
  }
  const tokens = queryTokens(normalizedQuery);
  return records
    .filter((record) => record.loadable && LOADABLE_STAGES.has(record.stage))
    .map((record) => {
      const matchedTerms = record.provenance.activationTerms.filter((term) => {
        const termTokens = [...queryTokens(term)];
        return termTokens.length > 0 && termTokens.every((token) => tokens.has(token));
      });
      return { record, matchedTerms };
    })
    .filter(({ matchedTerms }) => matchedTerms.length > 0)
    .sort((left, right) =>
      right.matchedTerms.length - left.matchedTerms.length ||
      left.record.provenance.skillId.localeCompare(right.record.provenance.skillId)
    )
    .slice(0, limit)
    .map(({ record, matchedTerms }) => ({
      skillId: record.provenance.skillId,
      mutationId: record.mutationId,
      name: record.name,
      summary: record.summary,
      stage: record.stage,
      provenanceDigest: record.provenance.provenanceDigest,
      sourceCount: record.provenance.sources.length,
      executionAuthority: "none" as const,
      productionAuthority: false as const,
      matchedTerms,
    }));
}

export function operationalSkillIsLoadable(stage: MutationStage): boolean {
  return LOADABLE_STAGES.has(stage);
}

export function operationalSkillRecordFromManifest(
  manifest: unknown,
  mutation: Mutation,
): OperationalSkillRecord | null {
  const value = manifest as {
    kind?: unknown;
    skillName?: unknown;
    summary?: unknown;
    operational?: unknown;
  };
  if (value.kind !== "generated_skill_candidate" || value.operational === undefined) return null;
  if (typeof value.skillName !== "string" || typeof value.summary !== "string") {
    throw new Error("Operational-skill manifest is missing its bounded identity.");
  }
  const supplied = value.operational as CompiledOperationalSkillProvenance;
  const suppliedKeys = [
    "activationTerms",
    "allowedRuntimeAuthorities",
    "instructionAuthority",
    "knownFailureModes",
    "productionAuthority",
    "provenanceDigest",
    "schemaVersion",
    "skillId",
    "sources",
  ];
  if (Object.keys(supplied).sort().join("\n") !== suppliedKeys.join("\n")) {
    throw new Error("Operational-skill manifest contains unsupported authority fields.");
  }
  const compiled = compileOperationalSkillProvenance({
    schemaVersion: supplied.schemaVersion,
    skillId: supplied.skillId,
    activationTerms: supplied.activationTerms,
    knownFailureModes: supplied.knownFailureModes,
    sources: supplied.sources,
  });
  if (
    supplied.provenanceDigest !== compiled.provenanceDigest ||
    supplied.instructionAuthority !== false ||
    supplied.productionAuthority !== false ||
    !Array.isArray(supplied.allowedRuntimeAuthorities) ||
    supplied.allowedRuntimeAuthorities.length !== 0
  ) {
    throw new Error("Operational-skill manifest provenance or authority binding is invalid.");
  }
  return {
    schemaVersion: 1,
    mutationId: mutation.id,
    candidateDigest: mutation.candidateDigest,
    name: value.skillName,
    summary: value.summary,
    stage: mutation.stage,
    loadable: operationalSkillIsLoadable(mutation.stage),
    productionAuthority: false,
    executionAuthority: "none",
    provenance: compiled,
  };
}
