import { canonicalJson, sha256 } from "./canonical.ts";
import type { Job, SkillTestVector } from "./types.ts";
import type { StoredEvent } from "./store.ts";

export type LearningContract = {
  capabilityId: string;
  objective: string;
  publicCriteria: string[];
  acceptanceTests: SkillTestVector[];
  estimatedEffort: number;
};
export type LearningCampaignInput = { id: string; maximumRequests: number; contracts: LearningContract[] };
export type LearningCampaign = LearningCampaignInput & { digest: string };
const safeId = /^[a-z][a-z0-9-]{2,79}$/u;

export const LEARNING_CAMPAIGN_MAXIMUM_REQUESTS = 100;
export const LEARNING_CAMPAIGN_MAXIMUM_CONTRACTS = 32;
export const LEARNING_DAILY_RESERVATION_LIMIT = 20;
export const LEARNING_MAXIMUM_ATTEMPTS_PER_ROOT = 4;

/** Owner-frozen data, never a producer-supplied acceptance oracle. */
export function compileLearningCampaign(input: LearningCampaignInput): LearningCampaign {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join() !== "contracts,id,maximumRequests" ||
      typeof input.id !== "string" || !safeId.test(input.id) || !Number.isSafeInteger(input.maximumRequests) || input.maximumRequests < 1 || input.maximumRequests > LEARNING_CAMPAIGN_MAXIMUM_REQUESTS ||
      !Array.isArray(input.contracts) || input.contracts.length < 1 || input.contracts.length > LEARNING_CAMPAIGN_MAXIMUM_CONTRACTS) {
    throw new Error("Invalid bounded learning campaign.");
  }
  if (Buffer.byteLength(canonicalJson(input)) > 128 * 1024) throw new Error("Learning campaign exceeds its data limit.");
  const copy = structuredClone(input);
  const ids = new Set<string>();
  const objectives = new Set<string>();
  for (const contract of copy.contracts) {
    if (!contract || Object.keys(contract).sort().join() !== "acceptanceTests,capabilityId,estimatedEffort,objective,publicCriteria" ||
        typeof contract.capabilityId !== "string" || !safeId.test(contract.capabilityId) || ids.has(contract.capabilityId) ||
        typeof contract.objective !== "string" || !contract.objective.trim() || contract.objective.length > 1000 ||
        !Number.isFinite(contract.estimatedEffort) || contract.estimatedEffort <= 0 || contract.estimatedEffort > 1000 ||
        !Array.isArray(contract.publicCriteria) || contract.publicCriteria.length < 1 || contract.publicCriteria.length > 16 ||
        contract.publicCriteria.some(value => typeof value !== "string" || !value.trim() || value.length > 500) ||
        !Array.isArray(contract.acceptanceTests) || contract.acceptanceTests.length < 2 || contract.acceptanceTests.length > 64 || Buffer.byteLength(canonicalJson(contract.acceptanceTests)) > 32 * 1024) {
      throw new Error("Invalid frozen learning contract.");
    }
    ids.add(contract.capabilityId);
    const objectiveKey=contract.objective.trim().replace(/\s+/gu," ").toLowerCase();
    if (objectives.has(objectiveKey)) throw new Error("Duplicate learning objective aliases are prohibited.");
    objectives.add(objectiveKey);
    const names = new Set<string>();
    for (const test of contract.acceptanceTests) {
      if (!test || Object.keys(test).sort().join() !== "expected,input,name" || typeof test.name !== "string" ||
          !test.name.trim() || test.name.length > 120 || names.has(test.name)) throw new Error("Invalid independent acceptance cases.");
      names.add(test.name);
    }
  }
  return { ...copy, digest: sha256(canonicalJson(copy)) };
}

export const learningContractDigest = (contract: LearningContract): string => sha256(canonicalJson(contract));
export const learningCampaignCurriculumDigest = (campaign: Pick<LearningCampaignInput, "id" | "contracts">): string =>
  sha256(canonicalJson({ id: campaign.id, contracts: campaign.contracts }));

export type LearningCampaignCapacityExtension = {
  campaignId: string;
  baseDigest: string;
  curriculumDigest: string;
  previousMaximumRequests: number;
  maximumRequests: number;
  extensionDigest: string;
};

export function compileLearningCampaignCapacityExtension(
  campaign: LearningCampaign,
  maximumRequests: number,
): LearningCampaignCapacityExtension {
  if (!Number.isSafeInteger(maximumRequests) || maximumRequests <= campaign.maximumRequests ||
      maximumRequests > LEARNING_CAMPAIGN_MAXIMUM_REQUESTS) {
    throw new Error(`Learning campaign capacity must increase to at most ${LEARNING_CAMPAIGN_MAXIMUM_REQUESTS} requests.`);
  }
  const unsigned = {
    campaignId: campaign.id,
    baseDigest: campaign.digest,
    curriculumDigest: learningCampaignCurriculumDigest(campaign),
    previousMaximumRequests: campaign.maximumRequests,
    maximumRequests,
  };
  return { ...unsigned, extensionDigest: sha256(canonicalJson(unsigned)) };
}
export function currentLearningCampaign(events: StoredEvent[]): LearningCampaign | undefined {
  const configured = events.filter(event => event.type === "learning_campaign_configured").at(-1)?.data as LearningCampaign | undefined;
  if (!configured) return undefined;
  let maximumRequests = configured.maximumRequests;
  const curriculumDigest = learningCampaignCurriculumDigest(configured);
  for (const event of events) {
    if (event.type !== "learning_campaign_capacity_extended") continue;
    const data = event.data as Partial<LearningCampaignCapacityExtension>;
    if (data.campaignId !== configured.id || data.baseDigest !== configured.digest ||
        data.curriculumDigest !== curriculumDigest || data.previousMaximumRequests !== maximumRequests ||
        !Number.isSafeInteger(data.maximumRequests) || data.maximumRequests! <= maximumRequests ||
        data.maximumRequests! > LEARNING_CAMPAIGN_MAXIMUM_REQUESTS) continue;
    const unsigned = { campaignId: data.campaignId, baseDigest: data.baseDigest, curriculumDigest: data.curriculumDigest,
      previousMaximumRequests: data.previousMaximumRequests, maximumRequests: data.maximumRequests };
    if (data.extensionDigest !== sha256(canonicalJson(unsigned))) continue;
    maximumRequests = data.maximumRequests!;
  }
  return maximumRequests === configured.maximumRequests ? configured : { ...configured, maximumRequests };
}
export function campaignAccounting(campaign: LearningCampaign, events: StoredEvent[]) {
  const reservations = events.filter(event => event.type === "autonomous_learning_reserved" &&
    (event.data as { campaignId?: string }).campaignId === campaign.id);
  return { reserved: reservations.length, remaining: Math.max(0, campaign.maximumRequests - reservations.length),
    today: reservations.filter(event => event.occurredAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length };
}

/** Select only actual unmet task requirements; no model calls or invented demand. */
export function selectLearningGap(campaign: LearningCampaign, jobs: Job[], events: StoredEvent[]) {
  const attempted = new Set(events.filter(event => event.type === "learning_gap_selected")
    .map(event => (event.data as { capabilityId: string }).capabilityId));
  const choices = campaign.contracts.filter(contract => !attempted.has(contract.capabilityId)).flatMap(contract =>
    jobs.filter(job => !job.learningCampaignId && !job.workCard.requiredCapabilities.includes("autonomous-learning") &&
      job.status !== "verified" && job.status !== "running" && job.workCard.expectedOwnerValue > 0 &&
      job.workCard.missingCapabilities.includes(contract.capabilityId))
      .map(job => ({ contract, sourceJob: job, score: job.workCard.expectedOwnerValue / contract.estimatedEffort })));
  return choices.sort((a, b) => b.score - a.score || a.contract.capabilityId.localeCompare(b.contract.capabilityId) ||
    a.sourceJob.id.localeCompare(b.sourceJob.id))[0];
}
