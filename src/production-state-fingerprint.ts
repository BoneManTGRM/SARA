import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256 } from "./canonical.ts";
import { campaignAccounting, currentLearningCampaign } from "./learning-campaign.ts";
import { EventStoreIntegrityError, type StoredEvent } from "./store.ts";
import type { MutationStage } from "./types.ts";

const GENESIS_HASH = "0".repeat(64);
const SHA256_HEX = /^[a-f0-9]{64}$/iu;
const MUTATION_STAGES: MutationStage[] = [
  "SANDBOX",
  "SHADOW",
  "CANARY",
  "LIMITED_PRODUCTION",
  "BROADER_PRODUCTION",
];

export type ProductionStateFingerprint = Readonly<{
  fingerprintSchemaVersion: 1;
  eventLogFormat: "sara-hash-chain-ndjson-v1";
  constitution: Readonly<{ version: number | null; digest: string | null }>;
  audit: Readonly<{ eventCount: number; headHash: string | null }>;
  campaign: Readonly<{
    id: string;
    digest: string;
    maximumRequests: number;
    reserved: number;
    remaining: number;
  }> | null;
  mandate: Readonly<{
    id: string;
    digest: string;
    expiresAt: string;
    revokedAt: string | null;
  }> | null;
  memoryCount: number;
  reservations: number;
  qualifications: Readonly<{ passed: number; failed: number }>;
  mutations: Readonly<{
    total: number;
    byStage: Readonly<Record<MutationStage, number>>;
    recent: ReadonlyArray<Readonly<{
      id: string;
      jobId: string;
      stage: MutationStage;
      candidateDigest: string;
    }>>;
  }>;
  fingerprintDigest: string;
}>;

type MutationProjection = {
  id: string;
  jobId: string;
  stage: MutationStage;
  candidateDigest: string;
};

function parseEventLog(raw: string): StoredEvent[] {
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0)) {
    throw new EventStoreIntegrityError("The event log contains an unexpected blank record.");
  }

  const events: StoredEvent[] = [];
  let previousHash = GENESIS_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    let event: StoredEvent;
    try {
      event = JSON.parse(lines[index]!) as StoredEvent;
    } catch {
      throw new EventStoreIntegrityError(`Event ${index + 1} is invalid JSON.`);
    }
    if (event.sequence !== index + 1) {
      throw new EventStoreIntegrityError(`Event sequence ${event.sequence} is invalid at line ${index + 1}.`);
    }
    if (event.previousHash !== previousHash) {
      throw new EventStoreIntegrityError(`Event ${event.sequence} does not continue the audit hash chain.`);
    }
    if (!SHA256_HEX.test(event.hash)) {
      throw new EventStoreIntegrityError(`Event ${event.sequence} has an invalid audit hash.`);
    }
    const { hash, ...unhashed } = event;
    const expectedHash = sha256(canonicalJson(unhashed));
    if (hash !== expectedHash) {
      throw new EventStoreIntegrityError(`Event ${event.sequence} failed its audit hash check.`);
    }
    events.push(event);
    previousHash = hash;
  }
  return events;
}

/**
 * A concurrent append can briefly expose an incomplete final record to a
 * lock-free observer. Retry only when the observed invalid bytes change; the
 * same invalid snapshot twice is treated as persistent corruption.
 */
async function readVerifiedEventSnapshot(eventPath: string): Promise<StoredEvent[] | null> {
  let previousInvalidDigest: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let raw: string;
    try {
      raw = await readFile(eventPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return parseEventLog(raw);
    } catch (error) {
      if (!(error instanceof EventStoreIntegrityError)) throw error;
      const invalidDigest = sha256(raw);
      if (invalidDigest === previousInvalidDigest || attempt === 2) throw error;
      previousInvalidDigest = invalidDigest;
      await delay(10);
    }
  }
  throw new EventStoreIntegrityError("Unable to obtain a stable event-log snapshot.");
}

function mutationProjection(events: StoredEvent[]): MutationProjection[] {
  const mutations = new Map<string, MutationProjection>();
  for (const event of events) {
    if (event.type === "mutation_created") {
      const data = event.data as Partial<MutationProjection>;
      if (
        typeof data.id !== "string" ||
        typeof data.jobId !== "string" ||
        typeof data.candidateDigest !== "string" ||
        !SHA256_HEX.test(data.candidateDigest) ||
        !MUTATION_STAGES.includes(data.stage as MutationStage)
      ) {
        throw new EventStoreIntegrityError("A mutation creation event is malformed.");
      }
      mutations.set(data.id, {
        id: data.id,
        jobId: data.jobId,
        stage: data.stage as MutationStage,
        candidateDigest: data.candidateDigest.toLowerCase(),
      });
    }
    if (event.type === "mutation_stage_changed") {
      const data = event.data as { mutationId?: unknown; stage?: unknown };
      const mutation = typeof data.mutationId === "string" ? mutations.get(data.mutationId) : undefined;
      if (!mutation || !MUTATION_STAGES.includes(data.stage as MutationStage)) {
        throw new EventStoreIntegrityError("A mutation stage event references invalid state.");
      }
      mutation.stage = data.stage as MutationStage;
    }
  }
  return [...mutations.values()];
}

function countMemories(events: StoredEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type === "memory_recorded") count += 1;
    if (event.type === "core_memory_seeded" || event.type === "reparodynamics_memory_seeded") {
      const memories = (event.data as { memories?: unknown }).memories;
      if (!Array.isArray(memories)) {
        throw new EventStoreIntegrityError("A durable memory seed event is malformed.");
      }
      count += memories.length;
    }
  }
  return count;
}

function emptyFingerprint(): ProductionStateFingerprint {
  const unsigned = {
    fingerprintSchemaVersion: 1 as const,
    eventLogFormat: "sara-hash-chain-ndjson-v1" as const,
    constitution: { version: null, digest: null },
    audit: { eventCount: 0, headHash: null },
    campaign: null,
    mandate: null,
    memoryCount: 0,
    reservations: 0,
    qualifications: { passed: 0, failed: 0 },
    mutations: {
      total: 0,
      byStage: {
        SANDBOX: 0,
        SHADOW: 0,
        CANARY: 0,
        LIMITED_PRODUCTION: 0,
        BROADER_PRODUCTION: 0,
      },
      recent: [],
    },
  };
  return Object.freeze({ ...unsigned, fingerprintDigest: sha256(canonicalJson(unsigned)) });
}

export async function readProductionStateFingerprint(stateDirectory: string): Promise<ProductionStateFingerprint> {
  const events = await readVerifiedEventSnapshot(join(stateDirectory, "events.ndjson"));
  if (!events || events.length === 0) return emptyFingerprint();

  const latestBoot = events.filter((event) => event.type === "system_booted").at(-1);
  const boot = latestBoot?.data as { constitutionVersion?: unknown; constitutionDigest?: unknown } | undefined;
  if (
    !boot ||
    !Number.isSafeInteger(boot.constitutionVersion) ||
    typeof boot.constitutionDigest !== "string" ||
    !SHA256_HEX.test(boot.constitutionDigest)
  ) {
    throw new EventStoreIntegrityError("The latest boot event is missing its Constitution identity.");
  }

  const campaign = currentLearningCampaign(events);
  const accounting = campaign ? campaignAccounting(campaign, events) : null;
  const latestMandate = events.filter((event) => event.type === "standing_mandate_snapshot").at(-1);
  let mandate: ProductionStateFingerprint["mandate"] = null;
  if (latestMandate) {
    const data = latestMandate.data as {
      id?: unknown;
      digest?: unknown;
      expiresAt?: unknown;
      revokedAt?: unknown;
    };
    if (
      typeof data.id !== "string" ||
      typeof data.digest !== "string" ||
      !SHA256_HEX.test(data.digest) ||
      typeof data.expiresAt !== "string" ||
      !(data.revokedAt === undefined || data.revokedAt === null || typeof data.revokedAt === "string")
    ) {
      throw new EventStoreIntegrityError("The latest standing mandate event is malformed.");
    }
    mandate = {
      id: data.id,
      digest: data.digest.toLowerCase(),
      expiresAt: data.expiresAt,
      revokedAt: typeof data.revokedAt === "string" ? data.revokedAt : null,
    };
  }

  const mutationList = mutationProjection(events);
  const byStage: Record<MutationStage, number> = {
    SANDBOX: 0,
    SHADOW: 0,
    CANARY: 0,
    LIMITED_PRODUCTION: 0,
    BROADER_PRODUCTION: 0,
  };
  for (const mutation of mutationList) byStage[mutation.stage] += 1;

  const unsigned = {
    fingerprintSchemaVersion: 1 as const,
    eventLogFormat: "sara-hash-chain-ndjson-v1" as const,
    constitution: {
      version: boot.constitutionVersion as number,
      digest: boot.constitutionDigest.toLowerCase(),
    },
    audit: {
      eventCount: events.length,
      headHash: events.at(-1)!.hash,
    },
    campaign: campaign && accounting
      ? {
          id: campaign.id,
          digest: campaign.digest,
          maximumRequests: campaign.maximumRequests,
          reserved: accounting.reserved,
          remaining: accounting.remaining,
        }
      : null,
    mandate,
    memoryCount: countMemories(events),
    reservations: events.filter((event) => event.type === "autonomous_learning_reserved").length,
    qualifications: {
      passed: events.filter((event) => event.type === "learning_qualification_passed").length,
      failed: events.filter((event) => event.type === "learning_qualification_failed").length,
    },
    mutations: {
      total: mutationList.length,
      byStage,
      recent: mutationList.slice(-16),
    },
  };
  return Object.freeze({ ...unsigned, fingerprintDigest: sha256(canonicalJson(unsigned)) });
}
