import { compileLearningCampaign, currentLearningCampaign, campaignAccounting, learningContractDigest, selectLearningGap, type LearningCampaignInput } from "./learning-campaign.ts";
import { qualifyLearningArtifact, executeLearningArtifact, qualificationEnvironmentDigest } from "./learning-qualification.ts";
import { maintenanceJobs, maintenanceRequestDigest, validateMaintenanceRequest, type MaintenanceRequest, type MaintenanceJob } from "./website-maintenance.ts";
import { KernelBuildQueue } from "./kernel-build-queue.ts";
import { boundedCandidateFailureFeedback, isCandidateMetadataFailureFeedback } from "./cloudflare-free-generator.ts";
import { performance } from "node:perf_hooks";
import { KernelVerificationPool } from "./kernel-verification-pool.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compileWorkCard } from "./capabilities.ts";
import {
  compileBusinessCandidate,
  compileStandingMandate,
  evaluateRoutineAction,
  type AutonomyDecision,
  type AutonomyException,
  type BusinessCandidate,
  type BusinessCandidateInput,
  type RoutineActionRequest,
  type StandingMandate,
  type StandingMandateInput,
} from "./autonomy.ts";
import { canonicalJson, sha256 } from "./canonical.ts";
import {
  buildDeterministicSkillScaffold,
  buildVerifiedSkillCandidate,
  verifyGenomeLabArtifact,
} from "./genome-lab.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import { CORE_MEMORY_SEEDS, CORE_MEMORY_SOURCE, recallMemories, validateMemoryMetadata } from "./memory-fabric.ts";
import {
  REPARODYNAMICS_DOCTRINE_DIGEST,
  REPARODYNAMICS_MEMORY_SEEDS,
  REPARODYNAMICS_SOURCE,
  REPARODYNAMICS_VERSION,
} from "./reparodynamics.ts";
import { loadConstitution, type SaraConstitution } from "./constitution.ts";
import {
  assertMoney,
  calculateProfitWaterfall,
  ownerFundedRecurringMonthly,
  type ProfitWaterfall,
} from "./economics.ts";
import { evaluatePolicy, PolicyDeniedError } from "./policy.ts";
import {
  catalogOperationalSkills,
  operationalSkillRecordFromManifest,
  routeOperationalSkills,
  type OperationalSkillCatalog,
  type OperationalSkillRecord,
  type OperationalSkillRoute,
} from "./operational-skills.ts";
import {
  executeWorkerModelTask,
  planWorkerModelTask,
  WorkerModelExecutionError,
  workerModelRouteKey,
  type WorkerDataClassification,
  type WorkerModelClient,
  type WorkerModelExecutionEvidence,
  type WorkerTaskKind,
} from "./model-router.ts";
import {
  authorizeRevenuePilot,
  authorizeRevenuePilotDelivery,
  claimRevenuePilotRole as claimPilotRole,
  completeRevenuePilotRole as completePilotRole,
  createRevenuePilotJob as createPilotJob,
  markRevenuePilotDelivered,
  type RevenuePilotInput,
  type RevenuePilotJob,
  type RevenuePilotLease,
} from "./revenue-pilot.ts";
import {
  revenueCapabilityMigrationDecision,
  verifiedRevenueCapabilities,
} from "./revenue-capability-bootstrap.ts";
import {
  authorizedRevenuePaymentIntent,
  confirmRevenuePaymentIntent,
  createRevenuePaymentIntent as compileRevenuePaymentIntent,
  paymentClientSecretMatches,
  paymentIntentEvidenceDigest,
  type RevenuePaymentIntent,
} from "./revenue-payment.ts";
import type { CommercialTerms } from "./commercial-terms.ts";
import type { VerifiedUsdcPayment } from "./usdc-payment.ts";
import {
  createRevenueDelivery as compileRevenueDelivery,
  recordRevenueDeliveryDownload,
  revokeRevenueDelivery as compileRevokedRevenueDelivery,
  type RevenueDelivery,
} from "./revenue-delivery.ts";
import { EventStoreIntegrityError, type StoredEvent } from "./store.ts";
import {
  provisionalFamilyScenarioTarget,
  type FamilyEligibility,
  type ProvisionalFamilyDistribution,
  type SpouseStatus,
} from "./succession.ts";
import type {
  ActionRequest,
  CandidateGenerator,
  Capability,
  Job,
  LedgerEntry,
  MemoryRecord,
  MemoryRecall,
  MemoryRecallQuery,
  Mutation,
  MutationEvidence,
  MutationStage,
  OwnerApproval,
  PolicyDecision,
  Principal,
  WorkCard,
} from "./types.ts";

export const SARA_PRINCIPAL: Principal = Object.freeze({ id: "sara", kind: "sara", authenticated: true });
const STAGES: MutationStage[] = ["SANDBOX", "SHADOW", "CANARY", "LIMITED_PRODUCTION", "BROADER_PRODUCTION"];
const GENESIS_HASH = "0".repeat(64);
const KERNEL_CONSTRUCTION_TOKEN = Symbol("SARA_KERNEL_CONSTRUCTION");
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const OWNER_PRINCIPAL_TOKEN_DIGESTS = new WeakMap<object, string>();

export function authenticateOwnerPrincipal(token: string, ownerIdentity = "OWNER"): Principal {
  if (!token) throw new Error("Owner token is required.");
  const principal: Principal = Object.freeze({
    id: ownerIdentity,
    kind: "owner",
    authenticated: true,
  });
  OWNER_PRINCIPAL_TOKEN_DIGESTS.set(
    principal,
    createHash("sha256").update(token, "utf8").digest("hex"),
  );
  return principal;
}

type UnhashedEvent<T> = Omit<StoredEvent<T>, "hash">;

/**
 * The only write-capable event store is private to this module. Consumers can
 * inspect cloned audit events through SaraKernel but cannot obtain append,
 * lock, or storage-path capabilities that bypass policy enforcement.
 */
class KernelEventStore {
  readonly eventPath: string;
  readonly lockDirectory: string;
  private writeTail: Promise<unknown> = Promise.resolve();
  private readonly exclusiveContext = new AsyncLocalStorage<boolean>();

  constructor(
    readonly stateDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.eventPath = join(stateDirectory, "events.ndjson");
    this.lockDirectory = `${this.eventPath}.lock`;
  }

  private async initialize(): Promise<void> {
    await mkdir(dirname(this.eventPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.eventPath), 0o700);
    const handle = await open(this.eventPath, "a", 0o600);
    try {
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
  }

  private async readAllUnlocked(): Promise<StoredEvent[]> {
    const raw = await readFile(this.eventPath, "utf8");
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
        event = JSON.parse(lines[index]) as StoredEvent;
      } catch (error) {
        throw new EventStoreIntegrityError(`Event ${index + 1} is invalid JSON: ${(error as Error).message}`);
      }
      if (event.sequence !== index + 1) {
        throw new EventStoreIntegrityError(`Event sequence ${event.sequence} is invalid at line ${index + 1}.`);
      }
      if (event.previousHash !== previousHash) {
        throw new EventStoreIntegrityError(`Event ${event.sequence} does not continue the audit hash chain.`);
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

  private processIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  private async recoverAbandonedLock(): Promise<boolean> {
    let abandoned = false;
    try {
      const owner = JSON.parse(await readFile(join(this.lockDirectory, "owner.json"), "utf8")) as {
        pid?: unknown;
      };
      abandoned = typeof owner.pid === "number" && Number.isInteger(owner.pid) && !this.processIsAlive(owner.pid);
    } catch {
      try {
        const lockStat = await stat(this.lockDirectory);
        abandoned = Date.now() - lockStat.mtimeMs > 30_000;
      } catch {
        return false;
      }
    }
    if (!abandoned) return false;
    const quarantine = `${this.lockDirectory}.abandoned-${randomUUID()}`;
    try {
      await rename(this.lockDirectory, quarantine);
      await rm(quarantine, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        await mkdir(this.lockDirectory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.recoverAbandonedLock()) continue;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the SARA state writer lock.");
        await delay(10);
        continue;
      }
      try {
        await writeFile(
          join(this.lockDirectory, "owner.json"),
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
        return await operation();
      } finally {
        await rm(this.lockDirectory, { recursive: true, force: true });
      }
    }
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.initialize();
    return this.withFileLock(() => this.exclusiveContext.run(true, operation));
  }

  async readAll(): Promise<StoredEvent[]> {
    await this.initialize();
    if (this.exclusiveContext.getStore()) return this.readAllUnlocked();
    return this.withFileLock(() => this.readAllUnlocked());
  }

  private async appendUnlocked<T>(type: string, actor: Principal, data: T): Promise<StoredEvent<T>> {
    const events = await this.readAllUnlocked();
    const previousHash = events.at(-1)?.hash ?? GENESIS_HASH;
    const event: UnhashedEvent<T> = {
      id: randomUUID(),
      sequence: events.length + 1,
      occurredAt: this.now().toISOString(),
      type,
      actor,
      data,
      previousHash,
    };
    const stored: StoredEvent<T> = { ...event, hash: sha256(canonicalJson(event)) };
    const handle = await open(this.eventPath, "a", 0o600);
    try {
      await handle.write(`${JSON.stringify(stored)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return stored;
  }

  async append<T>(type: string, actor: Principal, data: T): Promise<StoredEvent<T>> {
    if (this.exclusiveContext.getStore()) return this.appendUnlocked(type, actor, data);
    const operation = this.writeTail.then(async () => {
      await this.initialize();
      return this.withFileLock(() => this.appendUnlocked(type, actor, data));
    });
    this.writeTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

function validatedFamilyEligibility(eligibility: FamilyEligibility): FamilyEligibility {
  const recognizedStatuses = new Set<SpouseStatus>([
    "eligible",
    "deceased_or_incapacitated",
    "legally_separated",
    "owner_revoked",
  ]);
  if (!recognizedStatuses.has(eligibility.spouseStatus)) {
    throw new Error("Unrecognized spouse status; family distribution remains on hold.");
  }
  if (typeof eligibility.ownerEligible !== "boolean" || typeof eligibility.childEligible !== "boolean") {
    throw new Error("Family eligibility flags must be authoritative booleans.");
  }
  const referenceDigest = eligibility.statusEvidence?.referenceDigest ?? "";
  if (!/^[a-f0-9]{64}$/i.test(referenceDigest) || /^0{64}$/i.test(referenceDigest)) {
    throw new Error("A non-zero digest-bound family-status evidence reference is required.");
  }
  const requiredEvidenceKind =
    eligibility.spouseStatus === "eligible"
      ? "baseline_registry"
      : eligibility.spouseStatus === "owner_revoked"
        ? "authenticated_owner_revocation"
        : "authoritative_record";
  if (eligibility.statusEvidence.kind !== requiredEvidenceKind) {
    throw new Error(`Spouse status requires ${requiredEvidenceKind} evidence.`);
  }
  return {
    ...eligibility,
    statusEvidence: { ...eligibility.statusEvidence, referenceDigest: referenceDigest.toLowerCase() },
  };
}

function ownerAttestedFamilyDistribution(
  ownerDistributionUsd: number,
  eligibility: FamilyEligibility,
  ownerId: string,
  targetId: string,
): ProvisionalFamilyDistribution {
  assertMoney(ownerDistributionUsd, "Owner distribution");
  const totalCents = Math.round(ownerDistributionUsd * 100);
  const totalUsd = totalCents / 100;
  const finish = (
    allocations: ProvisionalFamilyDistribution["allocations"],
    heldForLegalDirectionUsd = 0,
  ): ProvisionalFamilyDistribution => ({
    model: "SPOUSE_PRIMARY_REASON_AWARE_FALLBACK",
    legalActivationStatus: "UNCONFIGURED_PENDING_LEGAL_INSTRUMENT",
    evidenceAttestation: {
      status: "OWNER_ATTESTED_SCENARIO_ONLY",
      externalAuthorityVerified: false,
      ownerId,
      targetId,
      referenceDigest: eligibility.statusEvidence.referenceDigest,
    },
    allocations,
    heldForLegalDirectionUsd,
  });

  if (eligibility.spouseStatus === "eligible") {
    return finish([{ role: "spouse", amountUsd: totalUsd }]);
  }
  if (eligibility.spouseStatus === "legally_separated" || eligibility.spouseStatus === "owner_revoked") {
    if (eligibility.ownerEligible) return finish([{ role: "owner", amountUsd: totalUsd }]);
    if (eligibility.childEligible) return finish([{ role: "child", amountUsd: totalUsd }]);
    return finish([], totalUsd);
  }
  if (eligibility.ownerEligible && eligibility.childEligible) {
    const ownerCents = Math.ceil(totalCents / 2);
    return finish([
      { role: "owner", amountUsd: ownerCents / 100 },
      { role: "child", amountUsd: (totalCents - ownerCents) / 100 },
    ]);
  }
  if (eligibility.ownerEligible) return finish([{ role: "owner", amountUsd: totalUsd }]);
  if (eligibility.childEligible) return finish([{ role: "child", amountUsd: totalUsd }]);
  return finish([], totalUsd);
}

function reservedSelfDevelopmentBudget(jobs: Job[]): number {
  const total = jobs
    .filter((job) => job.status === "authorized" || job.status === "running")
    .reduce((sum, job) => sum + job.workCard.maximumBudgetUsd, 0);
  assertMoney(total, "Reserved self-development budget");
  return Math.round(total * 100) / 100;
}

type KernelState = {
  emergencyStopped: boolean;
  memories: MemoryRecord[];
  ledger: LedgerEntry[];
  capabilities: Capability[];
  jobs: Job[];
  mutations: Mutation[];
  revenuePilotJobs: RevenuePilotJob[];
  revenuePaymentIntents: RevenuePaymentIntent[];
  revenueDeliveries: RevenueDelivery[];
  standingMandate: StandingMandate | null;
  autonomyDecisions: AutonomyDecision[];
  autonomyExceptions: AutonomyException[];
  businessCandidates: BusinessCandidate[];
  events: StoredEvent[];
};

export type SaraStatus = {
  constitution: { version: number; digest: string; verified: true };
  emergencyStopped: boolean;
  ownerFundedRecurringMonthlyUsd: number;
  realizedProfit: ProfitWaterfall;
  reservedSelfDevelopmentBudgetUsd: number;
  availableCompoundReserveUsd: number;
  memoryCount: number;
  learning: {
    reparodynamicsVersion: number;
    doctrineDigest: string;
    doctrineMemoryCount: number;
    verifiedOutcomeCount: number;
  };
  capabilities: Capability[];
  jobs: Job[];
  mutations: Mutation[];
  revenuePilotJobs: RevenuePilotJob[];
  revenuePaymentIntents: RevenuePaymentIntent[];
  revenueDeliveries: RevenueDelivery[];
  standingMandate: StandingMandate | null;
  autonomyDecisions: AutonomyDecision[];
  autonomyExceptions: AutonomyException[];
  businessCandidates: BusinessCandidate[];
  audit: { eventCount: number; headHash: string | null };
};

export class SaraKernel {
  private mutationTail: Promise<void> = Promise.resolve();
  readonly #store: KernelEventStore;
  #verificationPool?: KernelVerificationPool;
  #previewVerificationPool?: KernelVerificationPool;
  readonly #buildQueue = new KernelBuildQueue();
  readonly #constitution: SaraConstitution;
  readonly #ownerTokenSha256: string;
  readonly constitutionDigest: string;

  private constructor(
    constructionToken: symbol,
    store: KernelEventStore,
    constitution: SaraConstitution,
    constitutionDigest: string,
    ownerTokenSha256: string,
  ) {
    if (constructionToken !== KERNEL_CONSTRUCTION_TOKEN) {
      throw new Error("SaraKernel may only be constructed through verified boot.");
    }
    this.#store = store;
    this.#constitution = constitution;
    this.constitutionDigest = constitutionDigest;
    this.#ownerTokenSha256 = ownerTokenSha256;
  }

  /** A deeply frozen constitutional view; callers cannot change authority. */
  get constitution(): SaraConstitution {
    return this.#constitution;
  }

  /** A detached read-only audit snapshot with no append or storage capability. */
  async inspectAudit(): Promise<StoredEvent[]> {
    return structuredClone(await this.#store.readAll());
  }

  static async boot(options: {
    stateDirectory: string;
    ownerTokenSha256?: string;
    constitutionPath?: string;
    bootstrapRevenueCapabilities?: boolean;
    /** Trusted boot configuration only; never derived from a coding request. */
    selfBuildVerificationWorkers?: 0 | 1 | 2;
    now?: () => Date;
  }): Promise<SaraKernel> {
    if (![0, 1, 2].includes(options.selfBuildVerificationWorkers ?? 0)) throw new Error("KERNEL_VERIFICATION_WORKERS_INVALID");
    const requestedOwnerTokenSha256 = options.ownerTokenSha256 ?? process.env.SARA_OWNER_TOKEN_SHA256;
    if (
      requestedOwnerTokenSha256 !== undefined &&
      (!SHA256_HEX.test(requestedOwnerTokenSha256) || /^0{64}$/i.test(requestedOwnerTokenSha256))
    ) {
      throw new Error("Boot requires a non-zero SHA-256 owner authentication digest.");
    }
    const requestedDigest = requestedOwnerTokenSha256?.toLowerCase();
    const loaded = await loadConstitution(options.constitutionPath);
    const store = new KernelEventStore(options.stateDirectory, options.now);
    return store.runExclusive(async () => {
      const existingEvents = await store.readAll();
      const existingBoot = existingEvents.find((event) => event.type === "system_booted");
      const boundDigest = (existingBoot?.data as { ownerTokenSha256?: unknown } | undefined)?.ownerTokenSha256;
      if (existingBoot && (typeof boundDigest !== "string" || !SHA256_HEX.test(boundDigest))) {
        throw new EventStoreIntegrityError("State is missing its owner authentication authority binding.");
      }
      if (requestedDigest && boundDigest && requestedDigest !== boundDigest) {
        throw new Error("Owner authentication digest does not match the authority bound to this state.");
      }
      const ownerTokenSha256 =
        typeof boundDigest === "string" ? boundDigest : requestedDigest ?? randomBytes(32).toString("hex");
      const kernel = new SaraKernel(
        KERNEL_CONSTRUCTION_TOKEN,
        store,
        loaded.constitution,
        loaded.digest,
        ownerTokenSha256,
      );
      await store.append("system_booted", SARA_PRINCIPAL, {
        constitutionDigest: loaded.digest,
        constitutionVersion: loaded.constitution.version,
        ownerTokenSha256,
      });
      const seeded = existingEvents.some((event) => event.type === "core_memory_seeded");
      if (!seeded) {
        await store.append("core_memory_seeded", SARA_PRINCIPAL, {
          source: CORE_MEMORY_SOURCE,
          memories: CORE_MEMORY_SEEDS,
        });
      }
      const reparodynamicsSeeded = existingEvents.some((event) => event.type === "reparodynamics_memory_seeded");
      if (!reparodynamicsSeeded) {
        await store.append("reparodynamics_memory_seeded", SARA_PRINCIPAL, {
          version: REPARODYNAMICS_VERSION,
          source: REPARODYNAMICS_SOURCE,
          doctrineDigest: REPARODYNAMICS_DOCTRINE_DIGEST,
          memories: REPARODYNAMICS_MEMORY_SEEDS,
        });
      }
      if (options.bootstrapRevenueCapabilities) {
        const currentCapabilities = new Map<string, Capability>();
        for (const event of await store.readAll()) {
          if (event.type === "capability_registered") {
            const capability = event.data as Capability;
            currentCapabilities.set(capability.id, capability);
          }
        }
        for (const capability of await verifiedRevenueCapabilities()) {
          if (revenueCapabilityMigrationDecision(currentCapabilities.get(capability.id), capability) === "register") {
            await store.append("capability_registered", SARA_PRINCIPAL, capability);
            currentCapabilities.set(capability.id, capability);
          }
        }
      }
      if (options.selfBuildVerificationWorkers) {
        kernel.#verificationPool = new KernelVerificationPool(options.stateDirectory, { concurrency: options.selfBuildVerificationWorkers });
      }
      return kernel;
    });
  }

  /** Drains owned verifier work; never retries or aborts generated-code cleanup. */
  async closeVerificationWorkers(): Promise<void> { await Promise.all([this.#verificationPool?.close(), this.#previewVerificationPool?.close(), this.#buildQueue.close()]); }
  verificationWorkerStatus() { return this.#verificationPool?.snapshot() ?? null; }
  previewVerificationWorkerStatus() { return this.#previewVerificationPool?.snapshot() ?? null; }

  authenticateOwnerToken(token: string): Principal {
    const received = createHash("sha256").update(token, "utf8").digest();
    const expected = Buffer.from(this.#ownerTokenSha256, "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new PolicyDeniedError(
        { allowed: false, code: "OWNER_AUTHENTICATION_FAILED", reason: "Owner token verification failed." },
        "owner_authentication",
      );
    }
    return authenticateOwnerPrincipal(token, this.#constitution.ownerAuthority.ownerIdentity);
  }

  private isVerifiedOwner(principal: Principal): boolean {
    return (
      OWNER_PRINCIPAL_TOKEN_DIGESTS.get(principal) === this.#ownerTokenSha256 &&
      principal.kind === "owner" &&
      principal.authenticated &&
      principal.id === this.#constitution.ownerAuthority.ownerIdentity
    );
  }

  private async state(): Promise<KernelState> {
    const events = await this.#store.readAll();
    const memories: MemoryRecord[] = [];
    const ledger: LedgerEntry[] = [];
    const capabilityMap = new Map<string, Capability>();
    const jobMap = new Map<string, Job>();
    const mutationMap = new Map<string, Mutation>();
    const revenuePilotMap = new Map<string, RevenuePilotJob>();
    const revenuePaymentIntentMap = new Map<string, RevenuePaymentIntent>();
    const revenueDeliveryMap = new Map<string, RevenueDelivery>();
    let standingMandate: StandingMandate | null = null;
    const autonomyDecisions: AutonomyDecision[] = [];
    const autonomyExceptions: AutonomyException[] = [];
    const businessCandidateMap = new Map<string, BusinessCandidate>();
    let emergencyStopped = false;

    for (const event of events) {
      if (event.type === "memory_recorded") memories.push(event.data as MemoryRecord);
      if (event.type === "core_memory_seeded") {
        const data = event.data as { memories?: unknown };
        if (!Array.isArray(data.memories)) throw new EventStoreIntegrityError("Core memory seed event is malformed.");
        memories.push(...structuredClone(data.memories as MemoryRecord[]));
      }
      if (event.type === "reparodynamics_memory_seeded") {
        const data = event.data as { version?: unknown; source?: unknown; doctrineDigest?: unknown; memories?: unknown };
        const observedDigest = Array.isArray(data.memories)
          ? sha256(canonicalJson({ version: data.version, source: data.source, memories: data.memories }))
          : null;
        if (
          data.version !== REPARODYNAMICS_VERSION ||
          data.source !== REPARODYNAMICS_SOURCE ||
          data.doctrineDigest !== REPARODYNAMICS_DOCTRINE_DIGEST ||
          observedDigest !== REPARODYNAMICS_DOCTRINE_DIGEST ||
          !Array.isArray(data.memories)
        ) {
          throw new EventStoreIntegrityError("Reparodynamics memory seed event is malformed or conflicts with this runtime.");
        }
        memories.push(...structuredClone(data.memories as MemoryRecord[]));
      }
      if (event.type === "ledger_recorded") ledger.push(event.data as LedgerEntry);
      if (event.type === "capability_registered") {
        const capability = event.data as Capability;
        capabilityMap.set(capability.id, capability);
      }
      if (event.type === "learning_gap_selected") {
        const job = (event.data as {job:Job}).job;
        jobMap.set(job.id, { ...job, workCard: { ...job.workCard } });
      }
      if (event.type === "job_created") {
        const job = event.data as Job;
        jobMap.set(job.id, { ...job, workCard: { ...job.workCard } });
      }
      if (event.type === "job_status_changed") {
        const data = event.data as { jobId: string; status: Job["status"] };
        const job = jobMap.get(data.jobId);
        if (!job) throw new Error(`Audit event references missing job ${data.jobId}.`);
        job.status = data.status;
      }
      if (event.type === "mutation_created") {
        const mutation = event.data as Mutation;
        mutationMap.set(mutation.id, { ...mutation, evidence: [...mutation.evidence] });
      }
      if (event.type === "mutation_evidence_recorded") {
        const data = event.data as { mutationId: string; evidence: MutationEvidence };
        const mutation = mutationMap.get(data.mutationId);
        if (!mutation) throw new Error(`Audit event references missing mutation ${data.mutationId}.`);
        mutation.evidence.push(data.evidence);
      }
      if (event.type === "mutation_stage_changed") {
        const data = event.data as { mutationId: string; stage: MutationStage };
        const mutation = mutationMap.get(data.mutationId);
        if (!mutation) throw new Error(`Audit event references missing mutation ${data.mutationId}.`);
        mutation.stage = data.stage;
      }
      if (event.type === "revenue_pilot_snapshot") {
        const job = event.data as RevenuePilotJob;
        revenuePilotMap.set(job.id, structuredClone(job));
      }
      if (event.type === "revenue_payment_intent_snapshot") {
        const intent = event.data as RevenuePaymentIntent;
        revenuePaymentIntentMap.set(intent.id, structuredClone(intent));
      }
      if (event.type === "revenue_delivery_snapshot") {
        const delivery = event.data as RevenueDelivery;
        revenueDeliveryMap.set(delivery.id, structuredClone(delivery));
      }
      if (event.type === "standing_mandate_snapshot") standingMandate = structuredClone(event.data as StandingMandate);
      if (event.type === "autonomy_decision") autonomyDecisions.push(structuredClone(event.data as AutonomyDecision));
      if (event.type === "autonomy_exception_opened") autonomyExceptions.push(structuredClone(event.data as AutonomyException));
      if (event.type === "business_candidate_compiled") {
        const candidate = event.data as BusinessCandidate;
        businessCandidateMap.set(candidate.id, structuredClone(candidate));
      }
      if (event.type === "emergency_stop_changed") {
        emergencyStopped = (event.data as { active: boolean }).active;
      }
    }

    const learningCampaign=currentLearningCampaign(events);
    if (learningCampaign) {
      const environmentDigest=await qualificationEnvironmentDigest();
      for (const contract of learningCampaign.contracts) {
        const qualified=events.filter(e=>e.type==="learning_qualification_passed" &&
          (e.data as {capabilityId:string}).capabilityId===contract.capabilityId).at(-1)?.data as
          {mutationId:string;candidateDigest:string;contractDigest:string;receipt:{environmentDigest:string;evidenceDigest:string}} | undefined;
        const mutation=qualified ? mutationMap.get(qualified.mutationId) : undefined;
        const available=Boolean(qualified && mutation && ["CANARY","LIMITED_PRODUCTION","BROADER_PRODUCTION"].includes(mutation.stage) &&
          qualified.candidateDigest===mutation.candidateDigest && qualified.contractDigest===learningContractDigest(contract) &&
          qualified.receipt.environmentDigest===environmentDigest && !events.some(e=>e.type==="learning_skill_reuse_failed" &&
            (e.data as {mutationId:string}).mutationId===mutation.id));
        if (qualified) capabilityMap.set(contract.capabilityId,{id:contract.capabilityId,name:contract.objective,
          status:available ? "available" : "limited", evidence:[qualified.receipt.evidenceDigest],
          limitations:["Pure bounded input/output only. Operational use requires current independent qualification and exact owner promotion. No revenue demonstrated."]});
      }
    }
    return {
      emergencyStopped,
      memories,
      ledger,
      capabilities: [...capabilityMap.values()],
      jobs: [...jobMap.values()],
      mutations: [...mutationMap.values()],
      revenuePilotJobs: [...revenuePilotMap.values()],
      revenuePaymentIntents: [...revenuePaymentIntentMap.values()],
      revenueDeliveries: [...revenueDeliveryMap.values()],
      standingMandate,
      autonomyDecisions,
      autonomyExceptions,
      businessCandidates: [...businessCandidateMap.values()],
      events,
    };
  }

  private async authorize(principal: Principal, request: ActionRequest): Promise<PolicyDecision> {
    const state = await this.state();
    const effectivePrincipal: Principal =
      principal.kind === "owner" && !this.isVerifiedOwner(principal)
        ? { id: principal.id, kind: principal.kind, authenticated: false }
        : principal;
    const decision = evaluatePolicy({
      constitution: this.#constitution,
      principal: effectivePrincipal,
      request,
      currentOwnerRecurringMonthlyUsd: ownerFundedRecurringMonthly(state.ledger),
      emergencyStopped: state.emergencyStopped,
    });
    await this.#store.append("policy_decision", effectivePrincipal, { request, decision });
    if (!decision.allowed) throw new PolicyDeniedError(decision, request.action);
    return decision;
  }

  private async authorizeAutonomousRoutine(
    principal: Principal,
    state: KernelState,
    request: RoutineActionRequest,
    throwOnDenied = true,
  ): Promise<AutonomyDecision> {
    if (principal.kind !== "sara" || !principal.authenticated) {
      throw new Error("Only the authenticated SARA principal may request autonomous execution.");
    }
    const existing = [...state.autonomyDecisions].reverse().find((decision) => decision.requestId === request.id);
    if (existing) {
      if (existing.outcome !== "automatic" && throwOnDenied) throw new Error(`${existing.code}: ${existing.reason}`);
      return structuredClone(existing);
    }
    const date = request.requestedAt.slice(0, 10);
    const completedToday = state.autonomyDecisions.filter((decision) =>
      decision.outcome === "automatic" && decision.decidedAt.slice(0, 10) === date
    ).length;
    const decision = evaluateRoutineAction({
      mandate: state.standingMandate,
      request,
      emergencyStopped: state.emergencyStopped,
      completedToday,
      activeActions: 0,
    });
    await this.#store.append("autonomy_decision", principal, decision);
    if (decision.outcome !== "automatic") {
      const exception: AutonomyException = {
        id: `exception:${request.id}`,
        request: structuredClone(request),
        decision,
        status: "open",
      };
      await this.#store.append("autonomy_exception_opened", principal, exception);
      if (throwOnDenied) throw new Error(`${decision.code}: ${decision.reason}`);
    }
    return decision;
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(() => this.#store.runExclusive(operation));
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  recordMemory(principal: Principal, input: Omit<MemoryRecord, "id">, external = false): Promise<MemoryRecord> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, { action: "record_memory", targetId: input.scope, external });
      if (!input.statement.trim() || !input.source.trim() || !input.scope.trim()) {
        throw new Error("Memory statement, source, and scope are required.");
      }
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new RangeError("Memory confidence must be between 0 and 1.");
      }
      validateMemoryMetadata(input);
      const memory: MemoryRecord = { ...input, id: randomUUID() };
      await this.#store.append("memory_recorded", principal, memory);
      return memory;
    });
  }

  recordMemoryOnce(principal: Principal, input: Omit<MemoryRecord, "id">, external = false): Promise<MemoryRecord> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, { action: "record_memory", targetId: input.scope, external });
      if (!input.statement.trim() || !input.source.trim() || !input.scope.trim()) {
        throw new Error("Memory statement, source, and scope are required.");
      }
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new RangeError("Memory confidence must be between 0 and 1.");
      }
      validateMemoryMetadata(input);
      const id = `memory-${sha256(canonicalJson(input))}`;
      const existing = (await this.state()).memories.find((memory) => memory.id === id);
      if (existing) return structuredClone(existing);
      const memory: MemoryRecord = { ...input, id };
      await this.#store.append("memory_recorded", principal, memory);
      return memory;
    });
  }

  async listWebsiteMaintenance(): Promise<MaintenanceJob[]> {
    return maintenanceJobs(await this.#store.readAll());
  }

  submitWebsiteMaintenance(principal: Principal, request: MaintenanceRequest, approvedDigest: string): Promise<MaintenanceJob> {
    return this.serializeMutation(async () => {
      const normalized = validateMaintenanceRequest(request);
      const digest = maintenanceRequestDigest(normalized);
      if (!this.isVerifiedOwner(principal) || approvedDigest !== digest) throw new Error("EXACT_OWNER_MAINTENANCE_APPROVAL_REQUIRED");
      await this.authorize(principal, {action:"production_promotion",targetId:`website-maintenance:${digest}`,external:true,
        approval:{approvalId:`maintenance-${digest}`,approvedAt:new Date().toISOString(),action:"production_promotion",targetId:`website-maintenance:${digest}`,ownerId:principal.id}});
      const existing=maintenanceJobs(await this.#store.readAll()).find(job=>job.request.id===request.id);
      if(existing){if(maintenanceRequestDigest(existing.request)!==digest)throw new Error("MAINTENANCE_ID_CONFLICT");return existing;}
      const now=new Date().toISOString();
      const job:MaintenanceJob={request:normalized,revision:0,state:"QUEUED",candidateDigest:null,deploymentReceipt:null,notificationReceipt:null,rollbackReceipt:null,attempts:0,retryAt:null,blockedFrom:null,reason:null,createdAt:now,updatedAt:now};
      await this.#store.append("website_maintenance_snapshot",principal,job);return structuredClone(job);
    });
  }

  advanceWebsiteMaintenance(principal:Principal,id:string,revision:number,patch:Partial<MaintenanceJob>):Promise<MaintenanceJob>{
    return this.serializeMutation(async()=>{
      if(principal.kind!=="sara"||principal.id!==SARA_PRINCIPAL.id)throw new Error("MAINTENANCE_EXECUTOR_REQUIRED");
      await this.authorize(principal,{action:"sandbox_development",targetId:id,external:false});
      const current=maintenanceJobs(await this.#store.readAll()).find(job=>job.request.id===id);
      if(!current||current.revision!==revision)throw new Error("STALE_MAINTENANCE_STATE");
      const next={QUEUED:["PREPARED","BLOCKED"],PREPARED:["PUBLISH_INTENT","BLOCKED"],PUBLISH_INTENT:["PUBLISHED","ROLLBACK_INTENT","BLOCKED"],PUBLISHED:["NOTIFY_INTENT","BLOCKED"],NOTIFY_INTENT:["DELIVERED","BLOCKED"],ROLLBACK_INTENT:["ROLLED_BACK","BLOCKED"],ROLLED_BACK:[],DELIVERED:[],BLOCKED:[]} as Record<string,string[]>;
      if(!patch.state||!next[current.state]?.includes(patch.state))throw new Error("INVALID_MAINTENANCE_TRANSITION");
      const job:MaintenanceJob={...current,state:patch.state,revision:revision+1,attempts:0,retryAt:null,reason:null,updatedAt:new Date().toISOString()};
      if(patch.state==="PREPARED"){if(!patch.candidateDigest||!/^[a-f0-9]{64}$/.test(patch.candidateDigest))throw new Error("CANDIDATE_DIGEST_REQUIRED");job.candidateDigest=patch.candidateDigest;}
      if(patch.state==="PUBLISHED"||patch.state==="ROLLBACK_INTENT"){if(typeof patch.deploymentReceipt!=="string"||!patch.deploymentReceipt||patch.deploymentReceipt.length>300)throw new Error("DEPLOYMENT_RECEIPT_REQUIRED");job.deploymentReceipt=patch.deploymentReceipt;}
      if(patch.state==="DELIVERED"){if(typeof patch.notificationReceipt!=="string"||!patch.notificationReceipt||patch.notificationReceipt.length>300)throw new Error("NOTIFICATION_RECEIPT_REQUIRED");job.notificationReceipt=patch.notificationReceipt;}
      if(patch.state==="ROLLED_BACK"){if(typeof patch.rollbackReceipt!=="string"||!patch.rollbackReceipt||patch.rollbackReceipt.length>300)throw new Error("ROLLBACK_RECEIPT_REQUIRED");job.rollbackReceipt=patch.rollbackReceipt;job.reason="PUBLICATION_FAILED_RESTORED_SOURCE";}
      if(patch.state==="BLOCKED"){job.blockedFrom=current.state;job.reason=typeof patch.reason==="string"?patch.reason.slice(0,100):"PROVIDER_UNAVAILABLE";}
      await this.#store.append("website_maintenance_snapshot",principal,job);return structuredClone(job);
    });
  }

  resumeWebsiteMaintenance(principal:Principal,id:string,approvedDigest:string):Promise<MaintenanceJob>{
    return this.serializeMutation(async()=>{
      const current=maintenanceJobs(await this.#store.readAll()).find(job=>job.request.id===id);
      if(!current||!this.isVerifiedOwner(principal)||approvedDigest!==maintenanceRequestDigest(current.request))throw new Error("EXACT_OWNER_MAINTENANCE_APPROVAL_REQUIRED");
      await this.authorize(principal,{action:"production_promotion",targetId:`website-maintenance:${approvedDigest}`,external:true,
        approval:{approvalId:`maintenance-resume-${id}-${current.revision}`,approvedAt:new Date().toISOString(),action:"production_promotion",targetId:`website-maintenance:${approvedDigest}`,ownerId:principal.id}});
      if(current.state!=="BLOCKED"||!current.blockedFrom||["BLOCKED","DELIVERED","ROLLED_BACK"].includes(current.blockedFrom))throw new Error("MAINTENANCE_NOT_RECOVERABLE");
      const job:MaintenanceJob={...current,state:current.blockedFrom,blockedFrom:null,attempts:0,retryAt:null,reason:null,revision:current.revision+1,updatedAt:new Date().toISOString()};
      await this.#store.append("website_maintenance_snapshot",principal,job);return structuredClone(job);
    });
  }

  deferWebsiteMaintenance(principal:Principal,id:string,revision:number):Promise<void>{
    return this.serializeMutation(async()=>{
      if(principal.kind!=="sara"||principal.id!==SARA_PRINCIPAL.id)throw new Error("MAINTENANCE_EXECUTOR_REQUIRED");
      await this.authorize(principal,{action:"sandbox_development",targetId:id,external:false});
      const current=maintenanceJobs(await this.#store.readAll()).find(job=>job.request.id===id);
      if(!current||current.revision!==revision)throw new Error("STALE_MAINTENANCE_STATE");
      if(["DELIVERED","ROLLED_BACK","BLOCKED"].includes(current.state))throw new Error("TERMINAL_MAINTENANCE_STATE");
      const attempts=current.attempts+1;
      const job:MaintenanceJob={...current,revision:revision+1,attempts,
        state:attempts>=5?"BLOCKED":current.state,blockedFrom:attempts>=5?current.state:null,
        reason:attempts>=5?"RETRY_LIMIT_RECONCILE_REQUIRED":"PROVIDER_OR_VERIFICATION_FAILURE",
        retryAt:new Date(Date.now()+Math.min(300000,5000*2**(attempts-1))).toISOString(),updatedAt:new Date().toISOString()};
      await this.#store.append("website_maintenance_snapshot",principal,job);
    });
  }

  async recallMemory(input: MemoryRecallQuery): Promise<MemoryRecall> {
    const state = await this.state();
    return recallMemories(state.memories, input);
  }

  private async operationalSkillRecords(): Promise<{
    records: OperationalSkillRecord[];
    invalidArtifacts: number;
  }> {
    const state = await this.state();
    const records: OperationalSkillRecord[] = [];
    let invalidArtifacts = 0;
    for (const mutation of state.mutations) {
      if (!mutation.artifactRelativePath) continue;
      try {
        await verifyGenomeLabArtifact(
          this.#store.stateDirectory,
          mutation.artifactRelativePath,
          mutation.candidateDigest,
        );
        const parts = mutation.artifactRelativePath.split(/[\\/]/u);
        const manifest = JSON.parse(
          await readFile(join(this.#store.stateDirectory, parts[0]!, parts[1]!, "manifest.json"), "utf8"),
        ) as unknown;
        const record = operationalSkillRecordFromManifest(manifest, mutation);
        if (record) records.push(record);
      } catch {
        invalidArtifacts += 1;
      }
    }
    return { records, invalidArtifacts };
  }

  async inspectOperationalSkills(): Promise<OperationalSkillCatalog> {
    const { records, invalidArtifacts } = await this.operationalSkillRecords();
    return catalogOperationalSkills(records, invalidArtifacts);
  }

  async routeOperationalSkillContext(query: string, limit = 5): Promise<OperationalSkillRoute[]> {
    const { records } = await this.operationalSkillRecords();
    return routeOperationalSkills(records, query, limit);
  }

  recordLedgerEntry(principal: Principal, input: Omit<LedgerEntry, "id">): Promise<LedgerEntry> {
    return this.serializeMutation(async () => {
      assertMoney(input.amountUsd, "Ledger amount");
      const targetId = `ledger:${input.kind}:${input.description}`;
      if (input.realized) {
        await this.authorize(principal, {
          action: "record_realized_financial_event",
          targetId,
          external: false,
        });
      }
      if (input.source === "owner" && input.recurringMonthly) {
        await this.authorize(principal, {
          action: "owner_recurring_commitment",
          targetId,
          external: false,
          monthlyRecurringUsd: input.amountUsd,
        });
      } else if (!input.realized) {
        await this.authorize(principal, { action: "record_ledger", targetId, external: false });
      }
      const entry: LedgerEntry = { ...input, id: randomUUID() };
      await this.#store.append("ledger_recorded", principal, entry);
      return entry;
    });
  }

  registerCapability(principal: Principal, capability: Capability): Promise<Capability> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, { action: "sandbox_development", targetId: capability.id, external: false });
      if (!capability.id.trim() || !capability.name.trim()) throw new Error("Capability id and name are required.");
      if (capability.status === "available" && capability.evidence.length === 0) {
        throw new Error("An available capability requires verification evidence.");
      }
      await this.#store.append("capability_registered", principal, capability);
      return capability;
    });
  }

  createRevenuePilotJob(principal: Principal, input: RevenuePilotInput): Promise<RevenuePilotJob> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "external_read",
        targetId: `revenue-pilot-opportunity:${input.opportunityId}`,
        external: true,
      });
      const state = await this.state();
      const availableCapabilities = state.capabilities
        .filter((capability) => capability.status === "available")
        .map((capability) => capability.id);
      const existing = state.revenuePilotJobs.find(
        (job) => job.plan.opportunityId === input.opportunityId.trim(),
      );
      if (existing) {
        const isCapabilityReview =
          existing.status === "owner_review" &&
          existing.revenueEvidenceId === null &&
          existing.completedRoles.length === 2;
        if (!isCapabilityReview) return structuredClone(existing);
        const candidate = createPilotJob(input, availableCapabilities);
        const refreshed: RevenuePilotJob = {
          ...structuredClone(existing),
          input: candidate.input,
          plan: candidate.plan,
          completedRoles: candidate.completedRoles,
          receipts: candidate.receipts,
          status: candidate.status,
          updatedAt: new Date().toISOString(),
        };
        await this.#store.append("revenue_pilot_snapshot", principal, refreshed);
        return refreshed;
      }
      const job = createPilotJob(input, availableCapabilities);
      for (const learning of job.plan.decision === "reject" ? [] : job.plan.learningObjectives) {
        const alreadyQueued = state.jobs.some(
          (candidate) =>
            candidate.workCard.requiredCapabilities.includes(learning.capabilityId) &&
            candidate.status !== "failed",
        );
        if (alreadyQueued) continue;
        const workCard = compileWorkCard({
          objective: learning.objective,
          expectedOwnerValue: job.plan.priceUsd,
          requiredCapabilities: [learning.capabilityId],
          acceptanceCriteria: learning.acceptanceCriteria,
          maximumBudgetUsd: learning.maximumBudgetUsd,
          availableCapabilities: state.capabilities,
          prohibitedActions: [...this.#constitution.protectedActions],
        });
        const learningJob: Job = {
          id: randomUUID(),
          kind: "self_development",
          status: "authorized",
          workCard,
        };
        await this.#store.append("job_created", principal, learningJob);
      }
      await this.#store.append("revenue_pilot_snapshot", principal, job);
      return structuredClone(job);
    });
  }

  createRevenuePaymentIntent(
    principal: Principal,
    input: {
      id: string;
      jobId: string;
      recipientAddress: string;
      clientSecretDigest: string;
      customerReferenceDigest: string;
      terms: CommercialTerms;
      lifetimeMinutes?: number;
    },
  ): Promise<RevenuePaymentIntent> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "external_write",
        targetId: `revenue-payment-intent:${input.id}`,
        external: true,
      });
      const state = await this.state();
      const existing = state.revenuePaymentIntents.find((candidate) => candidate.id === input.id);
      if (existing) return structuredClone(existing);
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === input.jobId);
      if (!job) throw new Error(`Revenue pilot ${input.jobId} does not exist.`);
      const now = new Date();
      const activePaidJob = state.revenuePilotJobs.find((candidate) =>
        candidate.id !== job.id &&
        candidate.revenueEvidenceId !== null &&
        ["queued", "running", "owner_review", "delivery_ready"].includes(candidate.status)
      );
      if (activePaidJob) throw new Error("The one-job commercial lane is still fulfilling another paid job.");
      const active = state.revenuePaymentIntents.find((candidate) =>
        candidate.jobId !== job.id &&
        (candidate.status === "confirmed" ||
          (candidate.status === "awaiting_payment" && Date.parse(candidate.expiresAt) >= now.getTime()))
      );
      if (active) throw new Error("The one-job commercial lane already has an active payment intent.");
      const intent = compileRevenuePaymentIntent({
        ...input,
        job,
        now,
      });
      await this.#store.append("revenue_payment_intent_snapshot", principal, intent);
      return structuredClone(intent);
    });
  }

  async inspectRevenuePaymentIntent(id: string, clientSecret: string): Promise<RevenuePaymentIntent> {
    const intent = (await this.state()).revenuePaymentIntents.find((candidate) => candidate.id === id);
    if (!intent || !paymentClientSecretMatches(intent, clientSecret)) {
      throw new PolicyDeniedError(
        { allowed: false, code: "PAYMENT_INTENT_AUTHENTICATION_FAILED", reason: "Payment intent authentication failed." },
        "payment_intent_authentication",
      );
    }
    return structuredClone(intent);
  }

  confirmRevenuePayment(
    principal: Principal,
    intentId: string,
    clientSecret: string,
    payment: VerifiedUsdcPayment,
  ): Promise<RevenuePaymentIntent> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "external_read",
        targetId: `verify-onchain-payment:${intentId}`,
        external: true,
      });
      const state = await this.state();
      const intent = state.revenuePaymentIntents.find((candidate) => candidate.id === intentId);
      if (!intent || !paymentClientSecretMatches(intent, clientSecret)) throw new Error("Payment intent authentication failed.");
      const duplicate = state.revenuePaymentIntents.find((candidate) =>
        candidate.id !== intent.id &&
        candidate.payment?.transactionReferenceDigest === payment.transactionReferenceDigest
      );
      if (duplicate) throw new Error("The transaction is already bound to another payment intent.");
      const confirmed = confirmRevenuePaymentIntent(intent, payment);
      if (confirmed.status !== intent.status) {
        await this.#store.append("revenue_payment_intent_snapshot", principal, confirmed);
      }
      return structuredClone(confirmed);
    });
  }

  authorizeRevenuePilotFromConfirmedPayment(
    principal: Principal,
    jobId: string,
    paymentIntentId: string,
    approval: OwnerApproval,
  ): Promise<{ job: RevenuePilotJob; paymentIntent: RevenuePaymentIntent }> {
    return this.serializeMutation(async () => {
      const targetId = `revenue-pilot:${jobId}:fulfillment`;
      await this.authorize(principal, {
        action: "contract_commitment",
        targetId,
        external: true,
        approval,
      });
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Revenue pilot ${jobId} does not exist.`);
      const intent = state.revenuePaymentIntents.find((candidate) => candidate.id === paymentIntentId);
      if (!intent || intent.jobId !== job.id) throw new Error("Exact job-bound payment intent is required.");
      if (intent.status === "authorized" && intent.revenueEvidenceId && job.revenueEvidenceId === intent.revenueEvidenceId) {
        return { job: structuredClone(job), paymentIntent: structuredClone(intent) };
      }
      if (intent.status !== "confirmed" || !intent.payment) throw new Error("Confirmed on-chain payment is required.");
      if (intent.amountUsd !== job.plan.priceUsd || intent.termsDigest.length !== 64) {
        throw new Error("Payment intent does not match the job price and accepted terms.");
      }
      const ledgerTarget = `ledger:revenue:revenue-pilot:${jobId}:${intent.payment.transactionReferenceDigest}`;
      await this.authorize(principal, {
        action: "record_realized_financial_event",
        targetId: ledgerTarget,
        external: false,
      });
      if (state.ledger.some((entry) => entry.description.includes(intent.payment!.transactionReferenceDigest))) {
        throw new Error("The on-chain payment is already recorded.");
      }
      const revenue: LedgerEntry = {
        id: randomUUID(),
        kind: "revenue",
        source: "customer",
        amountUsd: intent.amountUsd,
        realized: true,
        recurringMonthly: false,
        description: `Revenue pilot ${jobId}; verified Base USDC evidence ${intent.payment.transactionReferenceDigest}; intent evidence ${paymentIntentEvidenceDigest(intent)}`,
        occurredAt: intent.payment.verifiedAt,
      };
      const authorizedJob = authorizeRevenuePilot(job, {
        collectedRevenueUsd: revenue.amountUsd,
        revenueEvidenceId: revenue.id,
        ownerApprovalTarget: approval.targetId,
      });
      const authorizedIntent = authorizedRevenuePaymentIntent(intent, revenue.id);
      await this.#store.append("ledger_recorded", principal, revenue);
      await this.#store.append("revenue_pilot_snapshot", principal, authorizedJob);
      await this.#store.append("revenue_payment_intent_snapshot", principal, authorizedIntent);
      return { job: structuredClone(authorizedJob), paymentIntent: structuredClone(authorizedIntent) };
    });
  }

  authorizeRevenuePilotFromConfirmedPaymentUnderMandate(
    principal: Principal,
    jobId: string,
    paymentIntentId: string,
    requestedAt = new Date().toISOString(),
  ): Promise<{ job: RevenuePilotJob; paymentIntent: RevenuePaymentIntent; decision: AutonomyDecision }> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Revenue pilot ${jobId} does not exist.`);
      const intent = state.revenuePaymentIntents.find((candidate) => candidate.id === paymentIntentId);
      if (!intent || intent.jobId !== job.id) throw new Error("Exact job-bound payment intent is required.");
      if (intent.status === "authorized" && intent.revenueEvidenceId && job.revenueEvidenceId === intent.revenueEvidenceId) {
        const prior = [...state.autonomyDecisions].reverse().find((candidate) => candidate.requestId === `fixed-service-fulfillment:${intent.id}`);
        if (!prior || prior.outcome !== "automatic") throw new Error("Authorized payment is missing its autonomous decision receipt.");
        return { job: structuredClone(job), paymentIntent: structuredClone(intent), decision: structuredClone(prior) };
      }
      if (intent.status !== "confirmed" || !intent.payment) throw new Error("Confirmed on-chain payment is required.");
      if (intent.amountUsd !== job.plan.priceUsd || intent.termsDigest.length !== 64) {
        throw new Error("Payment intent does not match the job price and accepted terms.");
      }
      const decision = await this.authorizeAutonomousRoutine(principal, state, {
        id: `fixed-service-fulfillment:${intent.id}`,
        kind: "fixed_service_fulfillment",
        targetId: `revenue-pilot:${job.id}:fulfillment`,
        channel: "approved_api",
        serviceId: job.plan.serviceId,
        estimatedCostUsd: job.plan.maximumExecutionCostUsd,
        external: true,
        requestedAt,
        platform: "owner_site",
      });
      const duplicate = state.ledger.find((entry) => entry.description.includes(intent.payment!.transactionReferenceDigest));
      if (duplicate) throw new Error("The on-chain payment is already recorded.");
      const revenue: LedgerEntry = {
        id: randomUUID(),
        kind: "revenue",
        source: "customer",
        amountUsd: intent.amountUsd,
        realized: true,
        recurringMonthly: false,
        description: `Revenue pilot ${jobId}; cryptographically verified Base USDC evidence ${intent.payment.transactionReferenceDigest}; intent evidence ${paymentIntentEvidenceDigest(intent)}; mandate ${decision.mandateId}`,
        occurredAt: intent.payment.verifiedAt,
      };
      const authorizedJob = authorizeRevenuePilot(job, {
        collectedRevenueUsd: revenue.amountUsd,
        revenueEvidenceId: revenue.id,
        ownerApprovalTarget: `revenue-pilot:${job.id}:fulfillment`,
      });
      const authorizedIntent = authorizedRevenuePaymentIntent(intent, revenue.id);
      await this.#store.append("ledger_recorded", principal, revenue);
      await this.#store.append("revenue_pilot_snapshot", principal, authorizedJob);
      await this.#store.append("revenue_payment_intent_snapshot", principal, authorizedIntent);
      return {
        job: structuredClone(authorizedJob),
        paymentIntent: structuredClone(authorizedIntent),
        decision: structuredClone(decision),
      };
    });
  }

  authorizeRevenuePilotDelivery(
    principal: Principal,
    input: {
      deliveryId: string;
      jobId: string;
      reportDigest: string;
      accessSecretDigest: string;
      lifetimeHours?: number;
      maximumDownloads?: number;
    },
    approval: OwnerApproval,
  ): Promise<{ job: RevenuePilotJob; delivery: RevenueDelivery }> {
    return this.serializeMutation(async () => {
      const targetId = `revenue-pilot:${input.jobId}:delivery`;
      await this.authorize(principal, {
        action: "contract_commitment",
        targetId,
        external: true,
        approval,
      });
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === input.jobId);
      if (!job) throw new Error(`Revenue pilot ${input.jobId} does not exist.`);
      const existing = state.revenueDeliveries.find((candidate) => candidate.id === input.deliveryId);
      if (existing) {
        if (existing.jobId !== job.id || existing.accessSecretDigest !== input.accessSecretDigest) {
          throw new Error("Delivery id is already bound to different access evidence.");
        }
        return { job: structuredClone(job), delivery: structuredClone(existing) };
      }
      if (state.revenueDeliveries.some((candidate) => candidate.jobId === job.id && candidate.status !== "revoked")) {
        throw new Error("This job already has active delivery access.");
      }
      const delivery = compileRevenueDelivery({
        id: input.deliveryId,
        job,
        reportDigest: input.reportDigest,
        accessSecretDigest: input.accessSecretDigest,
        approvalId: approval.approvalId,
        ...(input.lifetimeHours === undefined ? {} : { lifetimeHours: input.lifetimeHours }),
        ...(input.maximumDownloads === undefined ? {} : { maximumDownloads: input.maximumDownloads }),
      });
      const authorizedJob = authorizeRevenuePilotDelivery(job, {
        approvalId: approval.approvalId,
        ownerApprovalTarget: approval.targetId,
      });
      await this.#store.append("revenue_pilot_snapshot", principal, authorizedJob);
      await this.#store.append("revenue_delivery_snapshot", principal, delivery);
      return { job: structuredClone(authorizedJob), delivery: structuredClone(delivery) };
    });
  }

  authorizeRevenuePilotDeliveryUnderMandate(
    principal: Principal,
    input: {
      deliveryId: string;
      jobId: string;
      reportDigest: string;
      accessSecretDigest: string;
      lifetimeHours?: number;
      maximumDownloads?: number;
    },
    requestedAt = new Date().toISOString(),
  ): Promise<{ job: RevenuePilotJob; delivery: RevenueDelivery; decision: AutonomyDecision }> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === input.jobId);
      if (!job) throw new Error(`Revenue pilot ${input.jobId} does not exist.`);
      const existing = state.revenueDeliveries.find((candidate) => candidate.jobId === job.id && candidate.status !== "revoked");
      if (existing) {
        if (existing.reportDigest !== input.reportDigest || existing.accessSecretDigest !== input.accessSecretDigest) {
          throw new Error("Existing delivery is bound to different report or access evidence.");
        }
        const prior = [...state.autonomyDecisions].reverse().find((candidate) => candidate.requestId === `verified-report-delivery:${job.id}:${input.reportDigest}`);
        if (!prior || prior.outcome !== "automatic") throw new Error("Existing delivery is missing its autonomous decision receipt.");
        return { job: structuredClone(job), delivery: structuredClone(existing), decision: structuredClone(prior) };
      }
      const decision = await this.authorizeAutonomousRoutine(principal, state, {
        id: `verified-report-delivery:${job.id}:${input.reportDigest}`,
        kind: "verified_report_delivery",
        targetId: `revenue-pilot:${job.id}:delivery:${input.reportDigest}`,
        channel: "approved_api",
        serviceId: job.plan.serviceId,
        estimatedCostUsd: 0,
        external: true,
        requestedAt,
        platform: "owner_site",
      });
      const approvalId = `standing-mandate:${decision.mandateId}:${sha256(canonicalJson(decision))}`;
      const delivery = compileRevenueDelivery({
        id: input.deliveryId,
        job,
        reportDigest: input.reportDigest,
        accessSecretDigest: input.accessSecretDigest,
        approvalId,
        ...(input.lifetimeHours === undefined ? {} : { lifetimeHours: input.lifetimeHours }),
        ...(input.maximumDownloads === undefined ? {} : { maximumDownloads: input.maximumDownloads }),
      });
      const authorizedJob = authorizeRevenuePilotDelivery(job, {
        approvalId,
        ownerApprovalTarget: `revenue-pilot:${job.id}:delivery`,
      });
      await this.#store.append("revenue_pilot_snapshot", principal, authorizedJob);
      await this.#store.append("revenue_delivery_snapshot", principal, delivery);
      return { job: structuredClone(authorizedJob), delivery: structuredClone(delivery), decision: structuredClone(decision) };
    });
  }

  authorizeAutomatedNicoFulfillmentUnderMandate(
    principal: Principal,
    jobId: string,
    runId: string,
    requestedAt = new Date().toISOString(),
  ): Promise<AutonomyDecision> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === jobId);
      if (!job || job.status !== "owner_review" || !job.revenueEvidenceId) {
        throw new Error("Paid owner-review job is required for automated NICO fulfillment.");
      }
      if (job.plan.serviceId !== "public-repository-readiness-snapshot") {
        throw new Error("Automated NICO fulfillment is restricted to the fixed readiness service.");
      }
      if (!/^comprun_[0-9a-f]{32}$/u.test(runId)) throw new Error("Automated NICO run ID is invalid.");
      return this.authorizeAutonomousRoutine(principal, state, {
        id: `nico-automated-fulfillment:${job.id}:${runId}`,
        kind: "fixed_service_fulfillment",
        targetId: `nico:${runId}:automated-delivery-package`,
        channel: "approved_api",
        serviceId: job.plan.serviceId,
        estimatedCostUsd: 0,
        external: true,
        requestedAt,
        platform: "owner_site",
      });
    });
  }

  accessRevenueDelivery(id: string, secret: string): Promise<{ job: RevenuePilotJob; delivery: RevenueDelivery }> {
    return this.serializeMutation(async () => {
      await this.authorize(SARA_PRINCIPAL, {
        action: "external_write",
        targetId: `revenue-delivery:${id}:download`,
        external: true,
      });
      const state = await this.state();
      const delivery = state.revenueDeliveries.find((candidate) => candidate.id === id);
      if (!delivery) throw new Error("Delivery access authentication failed.");
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === delivery.jobId);
      if (!job) throw new Error("Delivery job is unavailable.");
      const downloaded = recordRevenueDeliveryDownload(delivery, secret);
      const deliveredJob = markRevenuePilotDelivered(job);
      await this.#store.append("revenue_delivery_snapshot", SARA_PRINCIPAL, downloaded);
      if (job.status !== "delivered") await this.#store.append("revenue_pilot_snapshot", SARA_PRINCIPAL, deliveredJob);
      return { job: structuredClone(deliveredJob), delivery: structuredClone(downloaded) };
    });
  }

  revokeRevenueDelivery(principal: Principal, deliveryId: string): Promise<RevenueDelivery> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "protected_security_control_change",
        targetId: `revenue-delivery:${deliveryId}:revoke`,
        external: false,
        approval: {
          approvalId: `authenticated-owner-revocation:${deliveryId}`,
          action: "protected_security_control_change",
          targetId: `revenue-delivery:${deliveryId}:revoke`,
          approvedAt: new Date().toISOString(),
          ownerId: principal.id,
        },
      });
      const delivery = (await this.state()).revenueDeliveries.find((candidate) => candidate.id === deliveryId);
      if (!delivery) throw new Error("Delivery does not exist.");
      const revoked = compileRevokedRevenueDelivery(delivery);
      if (revoked.status !== delivery.status) await this.#store.append("revenue_delivery_snapshot", principal, revoked);
      return structuredClone(revoked);
    });
  }

  authorizeRevenuePilotJob(
    principal: Principal,
    jobId: string,
    revenueEvidenceId: string,
    approval: OwnerApproval,
  ): Promise<RevenuePilotJob> {
    return this.serializeMutation(async () => {
      const targetId = `revenue-pilot:${jobId}:fulfillment`;
      await this.authorize(principal, {
        action: "contract_commitment",
        targetId,
        external: true,
        approval,
      });
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Revenue pilot ${jobId} does not exist.`);
      if (state.revenuePilotJobs.some((candidate) => candidate.id !== jobId && candidate.revenueEvidenceId === revenueEvidenceId)) {
        throw new Error("Collected revenue evidence is already bound to another revenue pilot.");
      }
      const revenue = state.ledger.find((entry) => entry.id === revenueEvidenceId);
      if (
        !revenue ||
        revenue.kind !== "revenue" ||
        revenue.source !== "customer" ||
        !revenue.realized ||
        !revenue.description.includes(jobId)
      ) {
        throw new Error("Exact realized customer revenue evidence for this pilot is required.");
      }
      const authorized = authorizeRevenuePilot(job, {
        collectedRevenueUsd: revenue.amountUsd,
        revenueEvidenceId: revenue.id,
        ownerApprovalTarget: approval.targetId,
      });
      await this.#store.append("revenue_pilot_snapshot", principal, authorized);
      return structuredClone(authorized);
    });
  }

  authorizeRevenuePilotWithCollectedRevenue(
    principal: Principal,
    jobId: string,
    payment: { amountUsd: number; occurredAt: string; paymentReferenceDigest: string },
    approval: OwnerApproval,
  ): Promise<RevenuePilotJob> {
    return this.serializeMutation(async () => {
      assertMoney(payment.amountUsd, "Collected revenue");
      if (!SHA256_HEX.test(payment.paymentReferenceDigest) || /^0{64}$/i.test(payment.paymentReferenceDigest)) {
        throw new Error("A non-zero SHA-256 payment reference digest is required.");
      }
      if (!Number.isFinite(Date.parse(payment.occurredAt))) throw new Error("Payment occurredAt must be an ISO timestamp.");
      const targetId = `revenue-pilot:${jobId}:fulfillment`;
      await this.authorize(principal, {
        action: "contract_commitment",
        targetId,
        external: true,
        approval,
      });
      const ledgerTarget = `ledger:revenue:revenue-pilot:${jobId}:${payment.paymentReferenceDigest.toLowerCase()}`;
      await this.authorize(principal, {
        action: "record_realized_financial_event",
        targetId: ledgerTarget,
        external: false,
      });
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Revenue pilot ${jobId} does not exist.`);
      if (job.revenueEvidenceId) return structuredClone(job);
      if (job.status !== "offer_ready") throw new Error("Only an offer-ready revenue pilot can be authorized.");
      if (payment.amountUsd < job.plan.priceUsd) {
        throw new Error(`At least $${job.plan.priceUsd.toFixed(2)} in collected revenue is required before fulfillment.`);
      }
      const description = `Revenue pilot ${jobId}; payment evidence ${payment.paymentReferenceDigest.toLowerCase()}`;
      if (state.ledger.some((entry) => entry.description === description)) {
        throw new Error("The payment reference is already recorded.");
      }
      const revenue: LedgerEntry = {
        id: randomUUID(),
        kind: "revenue",
        source: "customer",
        amountUsd: payment.amountUsd,
        realized: true,
        recurringMonthly: false,
        description,
        occurredAt: new Date(payment.occurredAt).toISOString(),
      };
      const authorized = authorizeRevenuePilot(job, {
        collectedRevenueUsd: revenue.amountUsd,
        revenueEvidenceId: revenue.id,
        ownerApprovalTarget: approval.targetId,
      });
      await this.#store.append("ledger_recorded", principal, revenue);
      await this.#store.append("revenue_pilot_snapshot", principal, authorized);
      return structuredClone(authorized);
    });
  }

  claimRevenuePilotRole(
    principal: Principal,
    workerId: string,
    leaseSeconds = 300,
    expected?: { jobId: string; role: RevenuePilotLease["role"] },
  ): Promise<{ job: RevenuePilotJob; lease: RevenuePilotLease }> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `revenue-pilot-worker:${workerId}`,
        external: false,
      });
      const state = await this.state();
      const now = new Date();
      const job = state.revenuePilotJobs.find((candidate) => {
        const available = candidate.status === "queued" ||
          (candidate.status === "running" && candidate.activeLease !== null && Date.parse(candidate.activeLease.expiresAt) <= now.getTime());
        return available && (!expected || (candidate.id === expected.jobId && candidate.nextRole === expected.role));
      });
      if (!job) throw new Error("No revenue pilot role is available for execution.");
      const claimed = claimPilotRole(job, workerId, now, leaseSeconds);
      await this.#store.append("revenue_pilot_snapshot", principal, claimed.job);
      return structuredClone(claimed);
    });
  }

  completeRevenuePilotRole(
    principal: Principal,
    jobId: string,
    result: Parameters<typeof completePilotRole>[1],
  ): Promise<RevenuePilotJob> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `revenue-pilot:${jobId}:${result.role}`,
        external: false,
      });
      const state = await this.state();
      const job = state.revenuePilotJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Revenue pilot ${jobId} does not exist.`);
      const completed = completePilotRole(job, result);
      await this.#store.append("revenue_pilot_snapshot", principal, completed);
      return structuredClone(completed);
    });
  }

  async runRevenuePilotRoleWithModel(
    principal: Principal,
    input: {
      jobId: string;
      leaseId: string;
      prompt: string;
      taskKind: WorkerTaskKind;
      dataClassification: WorkerDataClassification;
      maximumTaskCostUsd: number;
      allowGeminiFreeTier: boolean;
      clients: readonly WorkerModelClient[];
      verificationPassed: boolean | null | ((outputText: string) => boolean | null);
      persistOutput?: (output: {
        outputText: string;
        evidence: WorkerModelExecutionEvidence;
        role: RevenuePilotLease["role"];
      }) => Promise<void | { reportDigest?: string }>;
    },
  ): Promise<{
    outputText: string;
    evidence: WorkerModelExecutionEvidence;
    job: RevenuePilotJob;
  }> {
    await this.authorize(principal, {
      action: "external_write",
      targetId: `revenue-pilot:${input.jobId}:model-worker`,
      external: true,
    });
    const now = new Date();
    const state = await this.state();
    const job = state.revenuePilotJobs.find((candidate) => candidate.id === input.jobId);
    if (!job) throw new Error(`Revenue pilot ${input.jobId} does not exist.`);
    if (job.status !== "running" || !job.activeLease || job.activeLease.id !== input.leaseId) {
      throw new Error("The routed model execution does not match an active role lease.");
    }
    const remainingJobBudgetUsd = Math.round(
      (job.plan.maximumExecutionCostUsd - job.actualExecutionCostUsd) * 100,
    ) / 100;
    if (input.maximumTaskCostUsd > remainingJobBudgetUsd) {
      throw new RangeError("The model task cost cap exceeds the revenue pilot's remaining execution budget.");
    }
    const modelPlan = planWorkerModelTask({
      taskKind: input.taskKind,
      dataClassification: input.dataClassification,
      maximumTaskCostUsd: input.maximumTaskCostUsd,
      allowGeminiFreeTier: input.allowGeminiFreeTier,
      pricedAt: now,
    });
    const clients = new Map(input.clients.map((client) => [client.routeKey, client]));
    const maximumWorkerWallTimeMs = modelPlan.routes.reduce((total, route) => {
      const client = clients.get(workerModelRouteKey(route));
      if (!client) return total;
      if (
        !Number.isInteger(client.maximumWallTimeMs) ||
        client.maximumWallTimeMs < 100 ||
        client.maximumWallTimeMs > 120_000
      ) {
        throw new RangeError("Model clients must declare a wall-time limit between 100 and 120000 milliseconds.");
      }
      return total + client.maximumWallTimeMs;
    }, 0);
    const leaseRemainingMs = Date.parse(job.activeLease.expiresAt) - now.getTime();
    if (leaseRemainingMs < maximumWorkerWallTimeMs + 5_000) {
      throw new Error("The active role lease is too short for the bounded model route.");
    }

    let execution;
    try {
      execution = await executeWorkerModelTask(modelPlan, input.prompt, input.clients);
    } catch (error) {
      if (!(error instanceof WorkerModelExecutionError)) throw error;
      const conservativeWholeCentCost = Math.ceil(
        (error.evidence.accountedCostUsd - Number.EPSILON) * 100,
      ) / 100;
      await this.completeRevenuePilotRole(principal, input.jobId, {
        leaseId: input.leaseId,
        role: job.activeLease.role,
        outputDigest: error.evidence.failureDigest,
        costUsd: conservativeWholeCentCost,
        verificationPassed: typeof input.verificationPassed === "function" ? null : input.verificationPassed,
        completedAt: new Date().toISOString(),
        modelFailure: error.evidence,
        executionFailed: true,
        failureStage: "model_execution",
      });
      throw new Error("All bounded model routes failed; their conservative cost was recorded and the job stopped.");
    }
    const conservativeWholeCentCost = Math.ceil(
      (execution.evidence.accountedCostUsd - Number.EPSILON) * 100,
    ) / 100;
    const verificationPassed = typeof input.verificationPassed === "function"
      ? input.verificationPassed(execution.outputText)
      : input.verificationPassed;
    let persistenceResult: void | { reportDigest?: string } = undefined;
    if (input.persistOutput) {
      try {
        persistenceResult = await input.persistOutput({
          outputText: execution.outputText,
          evidence: execution.evidence,
          role: job.activeLease.role,
        });
      } catch {
        await this.completeRevenuePilotRole(principal, input.jobId, {
          leaseId: input.leaseId,
          role: job.activeLease.role,
          outputDigest: execution.evidence.outputDigest,
          costUsd: conservativeWholeCentCost,
          verificationPassed: null,
          completedAt: new Date().toISOString(),
          modelExecution: execution.evidence,
          executionFailed: true,
          failureStage: "artifact_persistence",
        });
        throw new Error("Private artifact persistence failed; model cost was recorded and the job stopped.");
      }
    }
    const completed = await this.completeRevenuePilotRole(principal, input.jobId, {
      leaseId: input.leaseId,
      role: job.activeLease.role,
      outputDigest: execution.evidence.outputDigest,
      costUsd: conservativeWholeCentCost,
      verificationPassed,
      completedAt: new Date().toISOString(),
      modelExecution: execution.evidence,
      ...(persistenceResult?.reportDigest ? { reportDigest: persistenceResult.reportDigest } : {}),
    });
    return { outputText: execution.outputText, evidence: execution.evidence, job: completed };
  }

  createSelfDevelopmentJob(
    principal: Principal,
    input: {
      objective: string;
      expectedOwnerValue: number;
      requiredCapabilities: string[];
      acceptanceCriteria: string[];
      maximumBudgetUsd: number;
      external?: boolean;
    },
  ): Promise<Job> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: input.objective,
        external: input.external ?? false,
      });
      const state = await this.state();
      assertMoney(input.maximumBudgetUsd, "Self-development maximum budget");
      const compoundReserve = calculateProfitWaterfall(
        state.ledger,
        this.#constitution.ownerAuthority.defaultReinvestmentRate,
      ).reinvestmentUsd;
      const reservedBudget = reservedSelfDevelopmentBudget(state.jobs);
      const availableBudget = Math.max(
        0,
        Math.round(
          (compoundReserve + this.#constitution.ownerAuthority.unearnedExpansionBudgetUsd - reservedBudget) * 100,
        ) / 100,
      );
      if (input.maximumBudgetUsd > availableBudget) {
        throw new RangeError(
          `Self-development budget exceeds the $${availableBudget.toFixed(2)} unreserved SARA Compound Reserve.`,
        );
      }
      const workCard = compileWorkCard({
        ...input,
        availableCapabilities: state.capabilities,
        prohibitedActions: [...this.#constitution.protectedActions],
      });
      const job: Job = { id: randomUUID(), kind: "self_development", status: "authorized", workCard };
      await this.#store.append("job_created", principal, job);
      return job;
    });
  }

  createMutation(
    principal: Principal,
    input: { jobId: string; summary: string; candidateDigest: string },
  ): Promise<Mutation> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, { action: "sandbox_development", targetId: input.jobId, external: false });
      const state = await this.state();
      if (!state.jobs.some((job) => job.id === input.jobId)) throw new Error(`Job ${input.jobId} does not exist.`);
      if (!/^[a-f0-9]{64}$/i.test(input.candidateDigest)) throw new Error("Candidate digest must be a SHA-256 hex digest.");
      if (!input.summary.trim()) throw new Error("Mutation summary is required.");
      const mutation: Mutation = {
        id: randomUUID(),
        jobId: input.jobId,
        summary: input.summary.trim(),
        candidateDigest: input.candidateDigest.toLowerCase(),
        stage: "SANDBOX",
        evidence: [],
        createdAt: new Date().toISOString(),
      };
      await this.#store.append("mutation_created", principal, mutation);
      return mutation;
    });
  }

  executeDeterministicSkillScaffold(
    principal: Principal,
    jobId: string,
  ): Promise<{ mutation: Mutation; evidence: MutationEvidence; artifactRelativePath: string }> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, { action: "sandbox_development", targetId: jobId, external: false });
      const state = await this.state();
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Job ${jobId} does not exist.`);
      const handoff = compileExecutorHandoff(job, this.constitutionDigest);
      const candidateId = randomUUID();
      const artifact = await buildDeterministicSkillScaffold(
        handoff,
        `${this.#store.stateDirectory}/genome-lab`,
        candidateId,
      );
      const mutation: Mutation = {
        id: candidateId,
        jobId,
        summary: `Deterministic skill scaffold: ${job.workCard.objective}`,
        candidateDigest: artifact.candidateDigest,
        artifactRelativePath: artifact.artifactRelativePath,
        stage: "SANDBOX",
        evidence: [],
        createdAt: new Date().toISOString(),
      };
      await this.#store.append("mutation_created", principal, mutation);
      const evidence: MutationEvidence = {
        id: randomUUID(),
        command: "kernel:typescript-semantic-compile",
        exitCode: 0,
        outputDigest: artifact.verificationOutputDigest,
        candidateDigest: artifact.candidateDigest,
        observedAt: new Date().toISOString(),
        attestation: "kernel_executed",
      };
      await this.#store.append("mutation_evidence_recorded", principal, { mutationId: mutation.id, evidence });
      return {
        mutation: { ...mutation, evidence: [evidence] },
        evidence,
        artifactRelativePath: artifact.artifactRelativePath,
      };
    });
  }

  async runSelfBuildCycle(
    principal: Principal,
    jobId: string,
    generator: CandidateGenerator,
  ): Promise<{
    job: Job;
    mutation: Mutation;
    evidence: MutationEvidence;
    artifactRelativePath: string;
    generatorId: string;
    timing: { schemaVersion: 1; boundary: string; totalMilliseconds: number; generationMilliseconds: number;
      kernelVerificationMilliseconds: number; acceptanceAndReceiptsMilliseconds: number; pooled: boolean };
  }> {
    const cycleStarted = performance.now();
    let generationMilliseconds = 0, kernelVerificationMilliseconds = 0, acceptanceAndReceiptsMilliseconds = 0;
    let uncommittedArtifact: string | undefined;
    let proposedDigest: string | undefined;
    let acceptanceStarted = false;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(generator.id)) {
      throw new Error("Candidate generator id must be 2–128 safe identifier characters.");
    }
    assertMoney(generator.maximumCostUsd, "Candidate generator maximum cost");
    generator = { id: generator.id, external: generator.external, maximumCostUsd: generator.maximumCostUsd,
      generate: generator.generate.bind(generator),
      ...(generator.generateWithPreview ? { generateWithPreview: generator.generateWithPreview.bind(generator) } : {}) };

    const handoff = await this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `self-build:${jobId}:${generator.id}`,
        external: generator.external,
      });
      const state = await this.state();
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Job ${jobId} does not exist.`);
      if (job.status !== "authorized") throw new Error(`Job ${jobId} is not authorized for a new self-build cycle.`);
      if (job.learningCampaignId && !state.events.some(e => e.type === "autonomous_learning_reserved" &&
          (e.data as {jobId:string;campaignId:string}).jobId === job.id && (e.data as {campaignId:string}).campaignId === job.learningCampaignId)) {
        throw new Error("LEARNING_RESERVATION_REQUIRED");
      }
      if (generator.maximumCostUsd > job.workCard.maximumBudgetUsd) {
        throw new RangeError(
          `Candidate generator cost exceeds the job's $${job.workCard.maximumBudgetUsd.toFixed(2)} maximum budget.`,
        );
      }
      const compiled = compileExecutorHandoff(job, this.constitutionDigest);
      const recalled = recallMemories(state.memories, {
        query: [
          job.workCard.objective,
          ...job.workCard.acceptanceCriteria,
          ...job.workCard.missingCapabilities,
        ].join(" "),
        scope: "global",
        categories: ["constitutional", "strategic", "economic", "procedural", "failure", "skill"],
        limit: 12,
      });
      const memoryContext = {
        contextDigest: recalled.contextDigest,
        memories: [...recalled.anchors, ...recalled.relevant].slice(0, 12),
      };
      const previous = job.learningParentJobId ? state.events.find(e => e.type === "learning_candidate_observed" &&
        (e.data as {jobId:string}).jobId === job.learningParentJobId)?.data as {proposal:import("./types.ts").SkillCandidateProposal;sourceDigest:string} | undefined : undefined;
      const previousFailure = state.memories.find(m => m.id === `learning-failure-${job.learningParentJobId}`);
      await this.#store.append("job_status_changed", principal, {
        jobId,
        from: job.status,
        status: "running",
        generatorId: generator.id,
        maximumCostUsd: generator.maximumCostUsd,
        memoryContextDigest: memoryContext.contextDigest,
        memoryIds: memoryContext.memories.map((memory) => memory.id),
      });
      return { ...compiled, memoryContext,
        previousAttempt: previous && previousFailure ? {...previous, feedback:previousFailure.statement.slice(0,1500)} : undefined,
        learning: job.workCard.requiredCapabilities.includes("autonomous-learning"),
        admissionMandateEpoch: state.events.filter(e => e.type === "standing_mandate_snapshot").at(-1)?.hash ?? null,
        admissionStopEpoch: state.events.filter(e => e.type === "emergency_stop_changed").at(-1)?.hash ?? null };
    });

    let previewTask: Promise<Awaited<ReturnType<typeof buildVerifiedSkillCandidate>>> | undefined;
    let previewDigest: string | undefined;
    let generationOpen = true;
    let candidateId = randomUUID();
    let authorityEpoch: string | null = null;
    const beforeVerification = () => this.serializeMutation(async () => {
      await this.authorize(principal, { action: "sandbox_development", targetId: `self-build:${jobId}:${generator.id}:dispatch`, external: false });
      const state = await this.state();
      if (state.jobs.find(j => j.id === jobId)?.status !== "running") throw new Error("SELF_BUILD_JOB_NOT_RUNNING");
      authorityEpoch = state.events.filter(e => e.type === "emergency_stop_changed").at(-1)?.hash ?? null;
      if (authorityEpoch !== handoff.admissionStopEpoch) throw new Error("SELF_BUILD_AUTHORITY_CHANGED_DURING_GENERATION");
      if (handoff.learning && (state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null) !== handoff.admissionMandateEpoch) throw new Error("LEARNING_AUTHORITY_CHANGED");
    });
    const discardPreview = async () => {
      if (!previewTask) return;
      // A rejected worker owns its cleanup. A successful unused artifact is ours.
      const speculative = await previewTask.then(value => value, () => undefined);
      if (speculative) await rm(speculative.artifactDirectory, { recursive: true, force: true });
      previewTask = undefined;
    };
    try {
      const generationStarted = performance.now();
      const generationInput = {
        objective: handoff.objective,
        acceptanceCriteria: [...handoff.acceptanceCriteria],
        missingCapabilities: [...handoff.missingCapabilities],
        constitutionDigest: handoff.constitutionDigest,
        memoryContext: structuredClone(handoff.memoryContext),
        ...(handoff.previousAttempt ? {previousAttempt:structuredClone(handoff.previousAttempt)} : {}),
      };
      // Detach both preview and final result before any authority or disk await.
      const proposal = structuredClone(await (generator.generateWithPreview
        ? generator.generateWithPreview(generationInput, candidate => {
          if (!generationOpen || previewTask || candidate.candidateKind !== "typescript_program") return;
          const snapshot = structuredClone(candidate);
          previewDigest = sha256(canonicalJson(snapshot));
          this.#previewVerificationPool ??= new KernelVerificationPool(this.#store.stateDirectory, { concurrency: 1, maximumQueued: 8 });
          previewTask = this.#previewVerificationPool.verify({ handoff, candidate: snapshot, candidateId }, beforeVerification);
          void previewTask.catch(() => {});
        })
        : generator.generate(generationInput)));
      generationOpen = false;
      proposedDigest = sha256(canonicalJson(proposal));
      if (handoff.learning && proposal.candidateKind !== "typescript_program" && Buffer.byteLength(canonicalJson(proposal)) <= 64 * 1024) {
        await this.serializeMutation(() => this.#store.append("learning_candidate_observed", principal, {
          jobId, proposal, proposedDigest, sourceDigest:sha256(proposal.source),
          unchangedSource:handoff.previousAttempt ? sha256(proposal.source) === handoff.previousAttempt.sourceDigest : false }));
      }
      generationMilliseconds = performance.now() - generationStarted;
      const matchedPreview = Boolean(previewTask && previewDigest === sha256(canonicalJson(proposal)));
      const pooled = matchedPreview || Boolean(this.#verificationPool && proposal.candidateKind === "typescript_program");
      const verificationStarted = performance.now();
      if (previewTask && !matchedPreview) {
        await discardPreview();
        candidateId = randomUUID();
      }
      // Preview completion is never acceptance; successful generation and all
      // original authority, identity, artifact and receipt gates still follow.
      const prepared = matchedPreview
        ? await previewTask!
        : pooled
          ? await this.#verificationPool!.verify({ handoff, candidate: proposal as import("./types.ts").ProgramCandidateProposal, candidateId }, beforeVerification)
          : await this.#buildQueue.run(async () => {
            await beforeVerification();
            return buildVerifiedSkillCandidate(handoff, proposal, `${this.#store.stateDirectory}/genome-lab`, candidateId);
          });
      kernelVerificationMilliseconds = performance.now() - verificationStarted;
      uncommittedArtifact = prepared.artifactDirectory;
      const acceptanceClock = performance.now();
      const result = await this.serializeMutation(async () => {
        await this.authorize(principal, {
          action: "sandbox_development",
          targetId: `self-build:${jobId}:${generator.id}:verify`,
          external: false,
        });
        const state = await this.state();
        const runningJob = state.jobs.find((candidate) => candidate.id === jobId);
        if (!runningJob || runningJob.status !== "running") {
          throw new Error(`Job ${jobId} is no longer running.`);
        }
        if ((state.events.filter(e => e.type === "emergency_stop_changed").at(-1)?.hash ?? null) !== authorityEpoch) {
          throw new Error("SELF_BUILD_AUTHORITY_CHANGED_DURING_VERIFICATION");
        }
        if (handoff.learning && (state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null) !== handoff.admissionMandateEpoch) throw new Error("LEARNING_AUTHORITY_CHANGED");
        const artifact = prepared;
        await verifyGenomeLabArtifact(this.#store.stateDirectory, artifact.artifactRelativePath, artifact.candidateDigest);
        const programCandidate = proposal.candidateKind === "typescript_program";
        const candidateName = programCandidate ? proposal.programName : proposal.skillName;
        const mutation: Mutation = {
          id: candidateId,
          jobId,
          summary: programCandidate
            ? `Generated program candidate: ${candidateName}`
            : `Generated skill candidate: ${candidateName}`,
          candidateDigest: artifact.candidateDigest,
          artifactRelativePath: artifact.artifactRelativePath,
          stage: "SANDBOX",
          evidence: [],
          createdAt: new Date().toISOString(),
        };
        const evidence: MutationEvidence = {
          id: randomUUID(),
          command: programCandidate
            ? "kernel:isolated-typescript-program-verification"
            : "kernel:isolated-typescript-behavioral-verification",
          exitCode: 0,
          outputDigest: artifact.verificationOutputDigest,
          candidateDigest: artifact.candidateDigest,
          observedAt: new Date().toISOString(),
          attestation: "kernel_executed",
        };
        // Once acceptance events may reference this artifact, never remove it
        // on an uncertain later receipt failure; retain evidence for recovery.
        acceptanceStarted = true;
        await this.#store.append("mutation_created", principal, mutation);
        await this.#store.append("mutation_evidence_recorded", principal, { mutationId: mutation.id, evidence });
        await this.#store.append("mutation_stage_changed", principal, {
          mutationId: mutation.id,
          from: "SANDBOX",
          stage: "SHADOW",
          approval: null,
        });
        await this.#store.append("job_status_changed", principal, {
          jobId,
          from: "running",
          status: "verified",
          mutationId: mutation.id,
        });
        if (runningJob.workCard.requiredCapabilities.includes("autonomous-learning")) {
        const skillMemory: MemoryRecord = {
          id: `learning-skill-${mutation.id}`, category: "skill", scope: "global",
          source: `sara://learning-skill/${sha256(runningJob.workCard.objective)}/${mutation.id}`,
          statement: `${runningJob.workCard.objective.slice(0,300)}: Retained kernel-verified SHADOW artifact ${artifact.candidateDigest}. Producer tests passed; external acceptance, operational execution and profit are not established.`,
          confidence: 1, verification: "measured", observedAt: evidence.observedAt, lastValidatedAt: evidence.observedAt,
          dependencies: [`candidate:${artifact.candidateDigest}`, `mutation:${mutation.id}`],
          tags: ["verified-outcome", "shadow", "learning-skill"], status: "active",
        };
        await this.#store.append("memory_recorded", principal, skillMemory);
        }
        await this.#store.append("self_build_cycle_completed", principal, {
          jobId,
          mutationId: mutation.id,
          generatorId: generator.id,
          generatorMaximumCostUsd: generator.maximumCostUsd,
          artifactRelativePath: artifact.artifactRelativePath,
          candidateDigest: artifact.candidateDigest,
          resultingStage: "SHADOW",
          productionAuthority: false,
        });
        return {
          job: { ...runningJob, status: "verified" as const },
          mutation: { ...mutation, stage: "SHADOW" as const, evidence: [evidence] },
          evidence,
          artifactRelativePath: artifact.artifactRelativePath,
          generatorId: generator.id,
        };
      });
      acceptanceAndReceiptsMilliseconds = performance.now() - acceptanceClock;
      return { ...result, timing: { schemaVersion: 1, boundary: "kernel_call_through_all_acceptance_event_commits_before_http_serialization",
        totalMilliseconds: performance.now() - cycleStarted, generationMilliseconds, kernelVerificationMilliseconds,
        acceptanceAndReceiptsMilliseconds, pooled } };
    } catch (error) {
      generationOpen = false;
      if (!uncommittedArtifact) await discardPreview();
      if (uncommittedArtifact && !acceptanceStarted) await rm(uncommittedArtifact, { recursive: true, force: true });
      await this.serializeMutation(async () => {
        const state = await this.state();
        const runningJob = state.jobs.find((candidate) => candidate.id === jobId);
        if (runningJob?.status === "running") {
          await this.#store.append("job_status_changed", principal, {
            jobId,
            from: "running",
            status: "failed",
            generatorId: generator.id,
            reason: error instanceof Error ? error.message.slice(0, 500) : "Unknown candidate failure",
          });
          await this.authorize(principal, { action: "record_memory", targetId: "global", external: false });
          const memory: MemoryRecord = {
            id: `learning-failure-${jobId}`, category: "failure", scope: "global",
            source: `sara://learning-failure/${sha256(runningJob.workCard.objective)}/${jobId}`,
            statement: `${runningJob.workCard.objective.slice(0, 300)}: ${boundedCandidateFailureFeedback(error).slice(0, 1_000)}`,
            confidence: 1, verification: "measured", observedAt: new Date().toISOString(),
            lastValidatedAt: new Date().toISOString(),
            tags: ["learning-failure"], status: "active",
            dependencies: proposedDigest ? [`candidate:${proposedDigest}`] : [],
          };
          await this.#store.append("memory_recorded", principal, memory);
          if (runningJob.learningCampaignId) {
            const feedbackDigest=sha256(boundedCandidateFailureFeedback(error));
            const prior=state.events.find(e=>e.type==="learning_attempt_failed" && (e.data as {jobId:string}).jobId===runningJob.learningParentJobId);
            await this.#store.append("learning_attempt_failed",principal,{jobId,feedbackDigest,
              repeatedFeedback:Boolean(prior && (prior.data as {feedbackDigest:string}).feedbackDigest===feedbackDigest),
              candidateDigest:proposedDigest ?? null});
          }
        }
      });
      throw error;
    }
  }

  /** Exact owner approval freezes the hidden oracle and campaign budget once. */
  configureLearningCampaign(principal: Principal, input: LearningCampaignInput, approvedDigest: string) {
    return this.serializeMutation(async () => {
      const campaign = compileLearningCampaign(input);
      if (!this.isVerifiedOwner(principal) || approvedDigest !== campaign.digest) throw new Error("EXACT_LEARNING_CAMPAIGN_APPROVAL_REQUIRED");
      await this.authorize(principal, { action: "required_owner_approval_change", targetId: `learning-campaign:${campaign.digest}`, external: false,
        approval: { approvalId: randomUUID(), action: "required_owner_approval_change", targetId: `learning-campaign:${campaign.digest}`,
          ownerId: principal.id, approvedAt: new Date().toISOString() } });
      const existing = currentLearningCampaign((await this.state()).events);
      if (existing && existing.digest !== campaign.digest) throw new Error("Learning campaign is immutable; counters and frozen contracts cannot be replaced.");
      if (!existing) await this.#store.append("learning_campaign_configured", principal, campaign);
      return { id: campaign.id, digest: campaign.digest, maximumRequests: campaign.maximumRequests };
    });
  }

  async learningCampaignStatus() {
    const state = await this.state();
    const campaign = currentLearningCampaign(state.events);
    return { configured: Boolean(campaign), campaign: campaign ? { id: campaign.id, digest: campaign.digest,
      maximumRequests: campaign.maximumRequests, ...campaignAccounting(campaign, state.events),
      contracts: campaign.contracts.map(c => ({ capabilityId: c.capabilityId, contractDigest: learningContractDigest(c) })) } : null,
      selections: state.events.filter(e => e.type === "learning_gap_selected").map(e => e.data),
      qualifications: state.events.filter(e => e.type === "learning_qualification_passed" || e.type === "learning_qualification_failed").map(e => ({ type: e.type, ...e.data as object })),
      reuses: state.events.filter(e => e.type === "learning_skill_reused").map(e => e.data),
      emergencyStopped: state.emergencyStopped };
  }

  private async learningAuthority(targetId: string) {
    const state = await this.state();
    const request: RoutineActionRequest = { id: `learning-control:${targetId}`, kind: "business_candidate_development", targetId,
      channel: "internal", serviceId: "skill-learning", estimatedCostUsd: 0, external: false,
      requestedAt: new Date().toISOString(), platform: "owner_site" };
    if (evaluateRoutineAction({ mandate: state.standingMandate, request, emergencyStopped: state.emergencyStopped }).outcome !== "automatic") {
      throw new Error("ACTIVE_LEARNING_MANDATE_REQUIRED");
    }
    return { state, mandateDigest: state.standingMandate!.digest,
      mandateEpoch: state.events.filter(e => e.type === "standing_mandate_snapshot").at(-1)?.hash ?? null,
      stopEpoch: state.events.filter(e => e.type === "emergency_stop_changed").at(-1)?.hash ?? null };
  }

  /** Chooses a frozen learning contract for an actual unmet authorized task. */
  selectNextLearningObjective() {
    return this.serializeMutation(async () => {
      const { state } = await this.learningAuthority("select");
      const campaign = currentLearningCampaign(state.events);
      if (!campaign || campaignAccounting(campaign, state.events).remaining === 0) return null;
      // Resolve existing selected work before choosing another curriculum entry.
      if (state.jobs.some(j => j.learningCampaignId === campaign.id && ["authorized", "running"].includes(j.status))) return null;
      const choice = selectLearningGap(campaign, state.jobs, state.events);
      if (!choice) return null;
      await this.authorize(SARA_PRINCIPAL, { action: "sandbox_development", targetId: choice.sourceJob.id, external: false });
      const contractDigest = learningContractDigest(choice.contract);
      const job: Job = { id: randomUUID(), kind: "self_development", status: "authorized",
        learningCampaignId: campaign.id, learningCapabilityId: choice.contract.capabilityId,
        learningContractDigest: contractDigest, learningSourceJobId: choice.sourceJob.id,
        workCard: compileWorkCard({ objective: choice.contract.objective, expectedOwnerValue: choice.sourceJob.workCard.expectedOwnerValue,
          requiredCapabilities: ["autonomous-learning", choice.contract.capabilityId], acceptanceCriteria: choice.contract.publicCriteria,
          maximumBudgetUsd: 0, availableCapabilities: state.capabilities, prohibitedActions: [...this.#constitution.protectedActions] }) };
      // One atomic event carries the job and selection, eliminating a crash gap.
      await this.#store.append("learning_gap_selected", SARA_PRINCIPAL, { campaignId: campaign.id, capabilityId: choice.contract.capabilityId,
        contractDigest, sourceJobId: choice.sourceJob.id, score: choice.score,
        reason: "Unmet authorized capability; ranked by declared owner value divided by estimated effort. Value is not measured profit.", job });
      return job;
    });
  }

  async qualifyLearningJob(jobId: string) {
    const independentFailure = "Independent acceptance failed; hidden answers withheld.";
    const prepared = await this.serializeMutation(async () => {
      const auth = await this.learningAuthority(jobId);
      const { state } = auth;
      const job = state.jobs.find(j => j.id === jobId);
      const campaign = currentLearningCampaign(state.events);
      const contract = campaign?.contracts.find(c => c.capabilityId === job?.learningCapabilityId);
      const mutation = state.mutations.find(m => m.jobId === jobId && ["SHADOW", "CANARY", "LIMITED_PRODUCTION", "BROADER_PRODUCTION"].includes(m.stage));
      if (!job || job.status !== "verified" || !contract || job.learningCampaignId !== campaign?.id ||
          learningContractDigest(contract) !== job.learningContractDigest || !mutation?.artifactRelativePath) throw new Error("ELIGIBLE_LEARNING_ARTIFACT_REQUIRED");
      const environmentDigest = await qualificationEnvironmentDigest();
      const contractDigest = learningContractDigest(contract);
      const previous = state.events.filter(e => {
        if (!["learning_qualification_passed", "learning_qualification_failed"].includes(e.type)) return false;
        const data = e.data as { mutationId: string; candidateDigest: string; contractDigest: string; environmentDigest?: string; receipt?: { environmentDigest: string } };
        return data.mutationId === mutation.id && data.candidateDigest === mutation.candidateDigest && data.contractDigest === contractDigest &&
          (data.environmentDigest ?? data.receipt?.environmentDigest) === environmentDigest;
      }).at(-1);
      return { ...auth, job, contract, contractDigest, mutation, environmentDigest, previous };
    });
    if (prepared.previous) {
      if (prepared.previous.type === "learning_qualification_failed") {
        // Recover a crash between the durable rejection and its bounded follow-up.
        await this.queueLearningFollowup(jobId, prepared.mandateDigest, new Error(independentFailure));
      }
      return { status: prepared.previous.type === "learning_qualification_passed" ? "qualified" : "rejected" };
    }
    let receipt: Awaited<ReturnType<typeof qualifyLearningArtifact>> | undefined;
    try {
      receipt = await qualifyLearningArtifact({ artifactDirectory: join(this.#store.stateDirectory, prepared.mutation.artifactRelativePath!),
        candidateDigest: prepared.mutation.candidateDigest, contractDigest: prepared.contractDigest, tests: prepared.contract.acceptanceTests });
    } catch { /* Keep hidden acceptance answers and arbitrary child errors private. */ }
    const result = await this.serializeMutation(async () => {
      const current = await this.learningAuthority(jobId);
      if (current.mandateDigest !== prepared.mandateDigest || current.mandateEpoch !== prepared.mandateEpoch || current.stopEpoch !== prepared.stopEpoch) throw new Error("LEARNING_AUTHORITY_CHANGED");
      if (await qualificationEnvironmentDigest() !== prepared.environmentDigest || (receipt && receipt.environmentDigest !== prepared.environmentDigest)) {
        throw new Error("LEARNING_ENVIRONMENT_CHANGED");
      }
      const previous = current.state.events.filter(e => {
        if (!["learning_qualification_passed", "learning_qualification_failed"].includes(e.type)) return false;
        const data = e.data as { mutationId: string; candidateDigest: string; contractDigest: string; environmentDigest?: string; receipt?: { environmentDigest: string } };
        return data.mutationId === prepared.mutation.id && data.candidateDigest === prepared.mutation.candidateDigest &&
          data.contractDigest === prepared.contractDigest && (data.environmentDigest ?? data.receipt?.environmentDigest) === prepared.environmentDigest;
      }).at(-1);
      if (previous) return { status: previous.type === "learning_qualification_passed" ? "qualified" : "rejected" };
      if (!receipt && !current.state.memories.some(memory => memory.id === `learning-failure-${jobId}`)) {
        await this.authorize(SARA_PRINCIPAL, { action: "record_memory", targetId: "global", external: false });
        const now = new Date().toISOString();
        const memory: MemoryRecord = {
          id: `learning-failure-${jobId}`, category: "failure", scope: "global",
          source: `sara://learning-failure/${sha256(prepared.job.workCard.objective)}/${jobId}`,
          statement: `${prepared.job.workCard.objective.slice(0, 300)}: ${independentFailure} Recheck the frozen public requirements; producer test success did not establish independent acceptance.`,
          confidence: 1, verification: "measured", observedAt: now, lastValidatedAt: now,
          tags: ["learning-failure", "independent-acceptance"], status: "active",
          dependencies: [`candidate:${prepared.mutation.candidateDigest}`, `contract:${prepared.contractDigest}`, `environment:${prepared.environmentDigest}`],
        };
        // Memory precedes the rejection event, so a retained rejection always has its lesson.
        await this.#store.append("memory_recorded", SARA_PRINCIPAL, memory);
      }
      await this.#store.append(receipt ? "learning_qualification_passed" : "learning_qualification_failed", SARA_PRINCIPAL,
        { mutationId: prepared.mutation.id, jobId, capabilityId: prepared.contract.capabilityId,
          candidateDigest: prepared.mutation.candidateDigest, contractDigest: prepared.contractDigest, environmentDigest: prepared.environmentDigest,
          ...(receipt ? {receipt} : {reason: independentFailure}) });
      return { status: receipt ? "qualified" : "rejected" };
    });
    if (result.status === "rejected") await this.queueLearningFollowup(jobId, prepared.mandateDigest, new Error(independentFailure));
    return result;
  }

  /** Scheduler entrypoint: recovery/qualification precedes new generation. */
  async runLearningWorkerTick(generator: CandidateGenerator) {
    const state = await this.state();
    const campaign = currentLearningCampaign(state.events);
    if (!campaign) return this.runNextAutonomousLearningCycle(generator);
    try { await this.learningAuthority("worker"); } catch { return {status:"blocked" as const}; }
    const environmentDigest = await qualificationEnvironmentDigest();
    const pending = state.jobs.find(job => {
      if (job.learningCampaignId !== campaign.id || job.status !== "verified") return false;
      const mutation = state.mutations.find(m => m.jobId === job.id && ["SHADOW", "CANARY", "LIMITED_PRODUCTION", "BROADER_PRODUCTION"].includes(m.stage));
      const contract = campaign.contracts.find(c => c.capabilityId === job.learningCapabilityId);
      if (!mutation || !contract) return false;
      const previous = state.events.filter(event => {
        if (!["learning_qualification_passed", "learning_qualification_failed"].includes(event.type)) return false;
        const data = event.data as { mutationId: string; candidateDigest: string; contractDigest: string; environmentDigest?: string; receipt?: { environmentDigest: string } };
        return data.mutationId === mutation.id && data.candidateDigest === mutation.candidateDigest &&
          data.contractDigest === learningContractDigest(contract) && (data.environmentDigest ?? data.receipt?.environmentDigest) === environmentDigest;
      }).at(-1);
      return !previous || (previous.type === "learning_qualification_failed" && !job.learningParentJobId &&
        job.workCard.expectedOwnerValue > 0 && !state.jobs.some(child => child.learningParentJobId === job.id));
    });
    if (pending) return this.qualifyLearningJob(pending.id);
    await this.selectNextLearningObjective();
    const result = await this.runNextAutonomousLearningCycle(generator);
    if (result.status === "verified_shadow" && result.jobId) return this.qualifyLearningJob(result.jobId);
    return result;
  }

  /** Route a task's single pure capability without asking its caller to select an implementation. */
  async executeTaskWithLearnedSkill(principal: Principal, jobId: string, input: unknown) {
    const state = await this.state();
    await this.authorize(principal,{action:"sandbox_development",targetId:`task:${jobId}`,external:false});
    const job = state.jobs.find(j=>j.id===jobId);
    if (!job || job.learningCampaignId || job.status !== "authorized" || job.workCard.requiredCapabilities.length !== 1) {
      throw new Error("AUTHORIZED_SINGLE_CAPABILITY_TASK_REQUIRED");
    }
    const capabilityId=job.workCard.requiredCapabilities[0]!;
    const result=await this.invokeLearnedSkill(principal,capabilityId,input);
    await this.serializeMutation(()=>this.#store.append("learning_task_routed",principal,{
      jobId,capabilityId,mutationId:result.mutationId,candidateDigest:result.candidateDigest,
      outputDigest:sha256(canonicalJson(result.output)),taskAcceptanceEstablished:false}));
    return result;
  }

  /** Exact-capability routing only selects independently qualified, owner-promoted code. */
  async invokeLearnedSkill(principal: Principal, capabilityId: string, input: unknown) {
    input = structuredClone(input);
    const prepared = await this.serializeMutation(async () => {
      await this.authorize(principal, {action:"sandbox_development",targetId:`learning-invoke:${capabilityId}`,external:false});
      const auth = await this.learningAuthority(capabilityId);
      const environmentDigest = await qualificationEnvironmentDigest();
      const campaign = currentLearningCampaign(auth.state.events);
      const contract = campaign?.contracts.find(c => c.capabilityId === capabilityId);
      const event = auth.state.events.filter(e => e.type === "learning_qualification_passed" &&
        (e.data as {capabilityId:string}).capabilityId === capabilityId).at(-1);
      const qualification = event?.data as {mutationId:string;candidateDigest:string;contractDigest:string;receipt:{environmentDigest:string}} | undefined;
      const mutation = auth.state.mutations.find(m => m.id === qualification?.mutationId);
      if (!contract || !qualification || qualification.contractDigest !== learningContractDigest(contract) ||
          qualification.receipt.environmentDigest !== environmentDigest || !mutation?.artifactRelativePath ||
          mutation.candidateDigest !== qualification.candidateDigest || !["CANARY","LIMITED_PRODUCTION","BROADER_PRODUCTION"].includes(mutation.stage)) {
        throw new Error("QUALIFIED_APPROVED_CURRENT_SKILL_REQUIRED");
      }
      if (auth.state.events.some(e=>e.type==="learning_skill_reuse_failed" &&
          (e.data as {mutationId:string}).mutationId===mutation.id)) throw new Error("LEARNED_SKILL_MAINTENANCE_REQUIRED");
      return {...auth, mutation, environmentDigest};
    });
    let result: Awaited<ReturnType<typeof executeLearningArtifact>>;
    try {
      result = await executeLearningArtifact({ artifactDirectory: join(this.#store.stateDirectory,prepared.mutation.artifactRelativePath!),
        candidateDigest: prepared.mutation.candidateDigest, input });
    } catch (error) {
      await this.serializeMutation(() => this.#store.append("learning_skill_reuse_failed", principal, {
        capabilityId, mutationId: prepared.mutation.id, candidateDigest: prepared.mutation.candidateDigest,
        environmentDigest: prepared.environmentDigest, reason: "Isolated execution failed; maintenance review required." }));
      throw error;
    }
    return this.serializeMutation(async () => {
      const current = await this.learningAuthority(capabilityId);
      if (current.mandateDigest !== prepared.mandateDigest || current.mandateEpoch !== prepared.mandateEpoch || current.stopEpoch !== prepared.stopEpoch ||
          result.environmentDigest !== prepared.environmentDigest) throw new Error("LEARNING_AUTHORITY_OR_ENVIRONMENT_CHANGED");
      await this.#store.append("learning_skill_reused", principal, {capabilityId, mutationId:prepared.mutation.id,
        candidateDigest:prepared.mutation.candidateDigest, environmentDigest:result.environmentDigest,
        inputDigest:sha256(canonicalJson(input)), outputDigest:sha256(canonicalJson(result.output))});
      return {output:result.output,mutationId:prepared.mutation.id,candidateDigest:prepared.mutation.candidateDigest};
    });
  }

  /** Consume one delegated backlog entry; reservations survive failure/restart. */
  async runNextAutonomousLearningCycle(generator: CandidateGenerator): Promise<{
    status: "idle" | "blocked" | "failed" | "verified_shadow"; jobId?: string;
  }> {
    if (generator.maximumCostUsd !== 0) throw new Error("Autonomous learning requires a zero-cost generator.");
    const reservation = await this.serializeMutation(async () => {
      const state = await this.state();
      if (state.emergencyStopped) return null;
      const now = new Date().toISOString();
      const reservations = state.events.filter(event => event.type === "autonomous_learning_reserved");
      const campaign = currentLearningCampaign(state.events);
      if (campaign && campaignAccounting(campaign, state.events).remaining === 0) return null;
      const reservedIds = new Set(reservations.map(event => (event.data as {jobId:string}).jobId));
      // A lost process leaves its reservation consumed and stops dispatch until reconciled.
      if (state.jobs.some(job => job.kind === "self_development" &&
        (job.status === "running" || (reservedIds.has(job.id) && job.status === "authorized")))) return null;
      if (reservations.filter(event => event.occurredAt.slice(0,10) === now.slice(0,10)).length >= 2) return null;
      const job = state.jobs.filter(job => job.kind === "self_development" && job.status === "authorized" &&
        (campaign ? job.learningCampaignId === campaign.id : !job.learningCampaignId) &&
        job.workCard.maximumBudgetUsd === 0 && job.workCard.requiredCapabilities.includes("autonomous-learning") && !reservedIds.has(job.id))
        .sort((a,b) => b.workCard.expectedOwnerValue - a.workCard.expectedOwnerValue || a.id.localeCompare(b.id))[0];
      if (!job) return undefined;
      const request: RoutineActionRequest = {id:`learning:${job.id}`,kind:"business_candidate_development",targetId:job.id,
        channel:"internal",serviceId:"skill-learning",estimatedCostUsd:0,external:generator.external,requestedAt:now,platform:"owner_site"};
      if (evaluateRoutineAction({mandate:state.standingMandate,request,emergencyStopped:state.emergencyStopped}).outcome !== "automatic") return null;
      const decision = await this.authorizeAutonomousRoutine(SARA_PRINCIPAL,state,request,false);
      if (decision.outcome !== "automatic") return null;
      await this.#store.append("autonomous_learning_reserved",SARA_PRINCIPAL,{jobId:job.id,mandateDigest:state.standingMandate!.digest,...(campaign ? {campaignId:campaign.id,contractDigest:job.learningContractDigest} : {})});
      return {jobId:job.id,mandateDigest:state.standingMandate!.digest,request,
        mandateEpoch:state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null,
        stopEpoch:state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null};
    });
    if (!reservation) return {status:reservation === undefined ? "idle" : "blocked"};
    try {
      const result = await this.runSelfBuildCycle(SARA_PRINCIPAL,reservation.jobId,{
        id:generator.id,external:generator.external,maximumCostUsd:0,
        generate:async input => {
          const checkMandate = () => this.serializeMutation(async () => {
            const state = await this.state();
            const decision = evaluateRoutineAction({mandate:state.standingMandate,request:{...reservation.request,requestedAt:new Date().toISOString()},emergencyStopped:state.emergencyStopped});
            if (decision.outcome !== "automatic" || state.standingMandate?.digest !== reservation.mandateDigest ||
                (state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null) !== reservation.mandateEpoch ||
                (state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null) !== reservation.stopEpoch) throw new Error("Learning mandate changed before dispatch.");
          });
          await checkMandate();
          const proposal = await generator.generate(input);
          await checkMandate();
          return proposal;
        },
      });
      return {status:result.job.status === "verified" && result.mutation.stage === "SHADOW" ? "verified_shadow" : "failed",jobId:reservation.jobId};
    } catch (error) {
      await this.queueLearningFollowup(reservation.jobId, reservation.mandateDigest, error);
      return {status:"failed",jobId:reservation.jobId};
    }
  }

  private queueLearningFollowup(jobId: string, mandateDigest: string, error: unknown): Promise<void> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const parent = state.jobs.find(job => job.id === jobId);
      const independentFailure = error instanceof Error && error.message === "Independent acceptance failed; hidden answers withheld.";
      if (!parent || !(parent.status === "failed" || (parent.status === "verified" && independentFailure)) || parent.learningParentJobId || parent.workCard.expectedOwnerValue <= 0 ||
        state.jobs.some(job => job.learningParentJobId === jobId)) return;
      const feedback = boundedCandidateFailureFeedback(error);
      if (!independentFailure && !isCandidateMetadataFailureFeedback(feedback) && !/^(?:Generated skill is not a pure isolated candidate:|Generated skill contains invalid TypeScript syntax\.|Generated skill failed TypeScript verification with |Behavioral verification mismatches:)/u.test(feedback)) return;
      const failure = state.memories.find(memory => memory.id === `learning-failure-${jobId}`);
      if (!failure?.dependencies.some(value => value.startsWith("candidate:"))) return;
      const now = new Date().toISOString();
      const request: RoutineActionRequest = {id:`learning-followup:${jobId}`,kind:"business_candidate_development",targetId:jobId,
        channel:"internal",serviceId:"skill-learning",estimatedCostUsd:0,external:false,requestedAt:now,platform:"owner_site"};
      if (state.standingMandate?.digest !== mandateDigest || evaluateRoutineAction({mandate:state.standingMandate,request,emergencyStopped:state.emergencyStopped}).outcome !== "automatic") return;
      await this.authorize(SARA_PRINCIPAL,{action:"sandbox_development",targetId:jobId,external:false});
      const workCard = compileWorkCard({...parent.workCard,availableCapabilities:state.capabilities});
      const child: Job = {id:randomUUID(),kind:"self_development",status:"authorized",workCard,
        learningParentJobId:jobId,learningRootJobId:parent.learningRootJobId ?? jobId,
        ...(parent.learningCampaignId ? {learningCampaignId:parent.learningCampaignId,learningCapabilityId:parent.learningCapabilityId,
          learningContractDigest:parent.learningContractDigest,learningSourceJobId:parent.learningSourceJobId} : {})};
      await this.#store.append("job_created",SARA_PRINCIPAL,child);
    });
  }

  recordMutationEvidence(
    principal: Principal,
    mutationId: string,
    input: Omit<MutationEvidence, "id" | "attestation">,
  ): Promise<MutationEvidence> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, { action: "sandbox_development", targetId: mutationId, external: false });
      const state = await this.state();
      const mutation = state.mutations.find((candidate) => candidate.id === mutationId);
      if (!mutation) throw new Error(`Mutation ${mutationId} does not exist.`);
      if (input.candidateDigest !== mutation.candidateDigest) {
        throw new Error("Evidence is not bound to the current candidate digest.");
      }
      if (!input.command.trim() || !/^[a-f0-9]{64}$/i.test(input.outputDigest)) {
        throw new Error("Evidence requires a command and SHA-256 output digest.");
      }
      const evidence: MutationEvidence = {
        ...input,
        id: randomUUID(),
        attestation:
          this.isVerifiedOwner(principal)
            ? "owner_attested"
            : "candidate_self_attested",
      };
      await this.#store.append("mutation_evidence_recorded", principal, { mutationId, evidence });
      return evidence;
    });
  }

  promoteMutation(
    principal: Principal,
    mutationId: string,
    nextStage: MutationStage,
    approval?: OwnerApproval,
  ): Promise<Mutation> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const mutation = state.mutations.find((candidate) => candidate.id === mutationId);
      if (!mutation) throw new Error(`Mutation ${mutationId} does not exist.`);
      const currentIndex = STAGES.indexOf(mutation.stage);
      if (STAGES[currentIndex + 1] !== nextStage) {
        throw new Error(`Mutation must advance exactly one stage from ${mutation.stage}.`);
      }
      const verifiedEvidence = mutation.evidence.some(
        (evidence) => evidence.exitCode === 0 && evidence.candidateDigest === mutation.candidateDigest,
      );
      if (!verifiedEvidence) throw new Error("A candidate-bound passing verification result is required before promotion.");
      if (mutation.artifactRelativePath) {
        await verifyGenomeLabArtifact(
          this.#store.stateDirectory,
          mutation.artifactRelativePath,
          mutation.candidateDigest,
        );
      }

      const production = STAGES.indexOf(nextStage) >= STAGES.indexOf("CANARY");
      const learningJob = state.jobs.find(job => job.id === mutation.jobId);
      if (production && learningJob?.learningCampaignId) {
        const environmentDigest = await qualificationEnvironmentDigest();
        if (!state.events.some(e => e.type === "learning_qualification_passed" &&
            (e.data as {mutationId:string;candidateDigest:string;receipt:{environmentDigest:string}}).mutationId === mutation.id &&
            (e.data as {candidateDigest:string}).candidateDigest === mutation.candidateDigest &&
            (e.data as {receipt:{environmentDigest:string}}).receipt.environmentDigest === environmentDigest)) {
          throw new Error("INDEPENDENT_LEARNING_QUALIFICATION_REQUIRED");
        }
      }

      const independentlyVerified = mutation.evidence.some(
        (evidence) =>
          evidence.exitCode === 0 &&
          evidence.candidateDigest === mutation.candidateDigest &&
          (evidence.attestation === "kernel_executed" || evidence.attestation === "owner_attested"),
      );
      if (production && !independentlyVerified) {
        throw new Error("Production promotion requires kernel-executed or owner-attested verification evidence.");
      }
      if (production && !mutation.artifactRelativePath) {
        throw new Error("Production promotion requires a locally re-verifiable Genome Lab artifact.");
      }
      const request: ActionRequest = {
        action: production ? "production_promotion" : "sandbox_development",
        targetId: production ? `${mutationId}:${nextStage}` : mutationId,
        external: production,
      };
      if (approval) request.approval = approval;
      await this.authorize(principal, request);
      await this.#store.append("mutation_stage_changed", principal, {
        mutationId,
        from: mutation.stage,
        stage: nextStage,
        approval: approval ?? null,
      });
      const refreshed = await this.state();
      return refreshed.mutations.find((candidate) => candidate.id === mutationId)!;
    });
  }

  calculateProvisionalFamilyDistribution(
    principal: Principal,
    ownerDistributionUsd: number,
    eligibility: FamilyEligibility,
    approval?: OwnerApproval,
  ): Promise<ProvisionalFamilyDistribution> {
    return this.serializeMutation(async () => {
      assertMoney(ownerDistributionUsd, "Owner distribution");
      const verifiedInput = validatedFamilyEligibility(eligibility);
      const targetId = provisionalFamilyScenarioTarget(ownerDistributionUsd, verifiedInput);
      const request: ActionRequest = {
        action: "beneficiary_change",
        targetId,
        external: false,
      };
      if (approval) request.approval = approval;
      await this.authorize(principal, request);
      const result = ownerAttestedFamilyDistribution(
        ownerDistributionUsd,
        verifiedInput,
        principal.id,
        targetId,
      );
      await this.#store.append("family_succession_scenario_calculated", principal, {
        ownerDistributionUsd,
        eligibility: verifiedInput,
        result,
      });
      return result;
    });
  }

  setEmergencyStop(principal: Principal, active: boolean): Promise<void> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "emergency_stop_change",
        targetId: "constitutional-emergency-stop",
        external: false,
      });
      await this.#store.append("emergency_stop_changed", principal, { active });
    });
  }

  authorizeOwnerNicoOperation(
    principal: Principal,
    targetId: string,
    mode: "external_read" | "external_write",
  ): Promise<void> {
    return this.serializeMutation(async () => {
      if (!this.isVerifiedOwner(principal)) {
        throw new Error("Authenticated owner authority is required for NICO operations.");
      }
      await this.authorize(principal, { action: mode, targetId, external: true });
    });
  }

  /** Owner-controlled allocation in the existing audit store; this grants no task authority. */
  configureModelBudget(principal: Principal, input: {
    monthlyLimitUsd: number; openingChargeUsd: number;
    inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number;
  }, approval?: OwnerApproval): Promise<void> {
    return this.serializeMutation(async () => {
      const {monthlyLimitUsd,openingChargeUsd,inputUsdPerMillionTokens,outputUsdPerMillionTokens}=input;
      if (![monthlyLimitUsd,openingChargeUsd].every(value=>Number.isFinite(value)&&value>=0&&value<=50&&Math.abs(value*100-Math.round(value*100))<1e-8) ||
        ![inputUsdPerMillionTokens,outputUsdPerMillionTokens].every(value=>Number.isFinite(value)&&value>0&&value<=1000)) {
        throw new Error("Model allocation requires whole-cent amounts from $0 through $50 and positive reviewed token prices.");
      }
      await this.authorize(principal,{action:"owner_funded_ceiling_change",targetId:`model-budget:${sha256(canonicalJson(input))}`,external:false,...(approval?{approval}:{})});
      const now=new Date().toISOString();
      const events=(await this.state()).events;
      const opening=events.filter(event=>event.type==="model_budget_opening_charge"&&event.occurredAt.slice(0,7)===now.slice(0,7))
        .reduce((sum,event)=>sum+(event.data as {amountMicrousd:number}).amountMicrousd,0);
      // An allocation edit can tighten a cap, but cannot erase an earlier opening charge.
      const additional=Math.round(openingChargeUsd*1_000_000)-opening;
      if(additional<0) throw new Error("A recorded opening charge cannot be reduced.");
      if(additional>0) await this.#store.append("model_budget_opening_charge",principal,{amountMicrousd:additional});
      await this.#store.append("model_budget_configured",principal,{monthlyLimitUsd,inputUsdPerMillionTokens,outputUsdPerMillionTokens});
    });
  }

  async modelBudgetStatus(): Promise<{
    configured:boolean; month:string; monthlyLimitUsd:number; reservedUsd:number; remainingUsd:number;
  }> {
    const state=await this.state();
    const month=new Date().toISOString().slice(0,7);
    const config=state.events.filter(event=>event.type==="model_budget_configured").at(-1)?.data as {monthlyLimitUsd:number}|undefined;
    const reserved=state.events.filter(event=>["model_budget_reserved","model_budget_opening_charge"].includes(event.type)&&event.occurredAt.slice(0,7)===month)
      .reduce((sum,event)=>sum+(event.data as {amountMicrousd:number}).amountMicrousd,0);
    const limit=config?.monthlyLimitUsd??0;
    return {configured:Boolean(config),month,monthlyLimitUsd:limit,reservedUsd:reserved/1_000_000,remainingUsd:Math.max(0,Math.round(limit*1_000_000)-reserved)/1_000_000};
  }

  /** Wrap each runtime paid client. Existing per-task authorization still applies. */
  guardPaidModelClient(client: WorkerModelClient): WorkerModelClient {
    if(client.routeKey!=="openai:gpt-5.6-luna:paid") throw new Error("No reviewed shared-budget pricing route for this client.");
    return {
      routeKey:client.routeKey,maximumWallTimeMs:client.maximumWallTimeMs*2,
      countInputTokens:prompt=>client.countInputTokens(prompt),
      execute:async input=>{
        if(!(await this.modelBudgetStatus()).configured) throw new Error("Owner model allocation is not configured; no paid generation dispatched.");
        const inputTokens=await client.countInputTokens(input.prompt);
        if(!Number.isSafeInteger(inputTokens)||inputTokens<0||!Number.isSafeInteger(input.maximumOutputTokens)||input.maximumOutputTokens<1) throw new Error("Cannot reserve uncertain model token bounds.");
        const reservationId=await this.serializeMutation(async()=>{
          const state=await this.state();
          if(state.emergencyStopped) throw new Error("Emergency stop blocks model dispatch.");
          if(state.events.some(event=>event.type==="model_budget_bound_violation")) throw new Error("Model usage exceeded its reserved bounds; owner reconciliation is required.");
          const config=state.events.filter(event=>event.type==="model_budget_configured").at(-1)?.data as {
            monthlyLimitUsd:number;inputUsdPerMillionTokens:number;outputUsdPerMillionTokens:number;
          }|undefined;
          if(!config) throw new Error("Owner model allocation is not configured.");
          const status=await this.modelBudgetStatus();
          const amountMicrousd=Math.ceil(inputTokens*config.inputUsdPerMillionTokens+input.maximumOutputTokens*config.outputUsdPerMillionTokens);
          if(!Number.isSafeInteger(amountMicrousd)||amountMicrousd<1||amountMicrousd>Math.round(status.remainingUsd*1_000_000)) throw new Error("Shared model allowance exhausted; no paid generation dispatched.");
          const id=randomUUID();
          await this.#store.append("model_budget_reserved",SARA_PRINCIPAL,{id,routeKey:client.routeKey,amountMicrousd,inputTokens,maximumOutputTokens:input.maximumOutputTokens,promptDigest:sha256(input.prompt)});
          return id;
        });
        // Never release a reservation on errors, crashes, or absent usage evidence.
        const result=await client.execute(input);
        await this.serializeMutation(async()=>{
          if(!Number.isSafeInteger(result.inputTokens)||result.inputTokens<0||result.inputTokens>inputTokens||
            !Number.isSafeInteger(result.billableOutputTokens)||result.billableOutputTokens<0||result.billableOutputTokens>input.maximumOutputTokens) {
            await this.#store.append("model_budget_bound_violation",SARA_PRINCIPAL,{reservationId});
            throw new Error("Model returned usage outside the reserved token bounds.");
          }
          await this.#store.append("model_budget_usage_observed",SARA_PRINCIPAL,{reservationId,inputTokens:result.inputTokens,billableOutputTokens:result.billableOutputTokens});
        });
        return result;
      },
    };
  }

  activateStandingMandate(
    principal: Principal,
    input: StandingMandateInput,
    approval?: OwnerApproval,
  ): Promise<StandingMandate> {
    return this.serializeMutation(async () => {
      const targetId = `standing-mandate:${input.id}`;
      await this.authorize(principal, {
        action: "required_owner_approval_change",
        targetId,
        external: false,
        ...(approval ? { approval } : {}),
      });
      if (input.ownerId !== principal.id) throw new Error("The mandate owner must match the authenticated owner.");
      const mandate = compileStandingMandate(input);
      const existing = (await this.state()).standingMandate;
      if (existing && !existing.revokedAt && existing.id !== mandate.id) {
        throw new Error("Revoke the active standing mandate before activating another one.");
      }
      if (existing?.id === mandate.id && existing.digest === mandate.digest && !existing.revokedAt) return existing;
      await this.#store.append("standing_mandate_snapshot", principal, mandate);
      return mandate;
    });
  }

  revokeStandingMandate(principal: Principal, mandateId: string, reason: string): Promise<StandingMandate> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "required_owner_approval_change",
        targetId: `standing-mandate:${mandateId}:revoke`,
        external: false,
        approval: {
          approvalId: randomUUID(),
          action: "required_owner_approval_change",
          targetId: `standing-mandate:${mandateId}:revoke`,
          approvedAt: new Date().toISOString(),
          ownerId: principal.id,
        },
      });
      const existing = (await this.state()).standingMandate;
      if (!existing || existing.id !== mandateId) throw new Error("Standing mandate not found.");
      if (existing.revokedAt) return existing;
      const safeReason = reason.trim();
      if (safeReason.length < 3 || safeReason.length > 300) throw new Error("A concise revocation reason is required.");
      const revoked: StandingMandate = { ...existing, revokedAt: new Date().toISOString(), revocationReason: safeReason };
      await this.#store.append("standing_mandate_snapshot", principal, revoked);
      return revoked;
    });
  }

  evaluateAutonomousAction(principal: Principal, request: RoutineActionRequest): Promise<AutonomyDecision> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      return this.authorizeAutonomousRoutine(principal, state, request, false);
    });
  }

  createBusinessCandidate(principal: Principal, input: BusinessCandidateInput, requestedAt = new Date().toISOString()): Promise<BusinessCandidate> {
    return this.serializeMutation(async () => {
      if (principal.kind !== "sara" || !principal.authenticated) throw new Error("Only SARA may compile an autonomous business candidate.");
      const state = await this.state();
      const existing = state.businessCandidates.find((candidate) => candidate.id === input.id);
      if (existing) return existing;
      const request: RoutineActionRequest = {
        id: `business-candidate:${input.id}`,
        kind: "business_candidate_development",
        targetId: input.id,
        channel: "public_web",
        serviceId: input.serviceId,
        estimatedCostUsd: 0,
        external: false,
        requestedAt,
        platform: "owner_site",
      };
      const completedToday = state.autonomyDecisions.filter((decision) =>
        decision.outcome === "automatic" && decision.decidedAt.slice(0, 10) === requestedAt.slice(0, 10)
      ).length;
      const decision = evaluateRoutineAction({
        mandate: state.standingMandate,
        request,
        emergencyStopped: state.emergencyStopped,
        completedToday,
        activeActions: 0,
      });
      await this.#store.append("autonomy_decision", principal, decision);
      if (decision.outcome !== "automatic") {
        const exception: AutonomyException = { id: `exception:${request.id}`, request, decision, status: "open" };
        await this.#store.append("autonomy_exception_opened", principal, exception);
        throw new PolicyDeniedError(
          { allowed: false, code: decision.code, reason: decision.reason },
          "business_candidate_development",
        );
      }
      const candidate = compileBusinessCandidate(input);
      await this.#store.append("business_candidate_compiled", principal, candidate);
      return candidate;
    });
  }

  async getStatus(reinvestmentRate = this.#constitution.ownerAuthority.defaultReinvestmentRate): Promise<SaraStatus> {
    await this.mutationTail;
    const state = await this.state();
    const realizedProfit = calculateProfitWaterfall(state.ledger, reinvestmentRate);
    const reservedSelfDevelopmentBudgetUsd = reservedSelfDevelopmentBudget(state.jobs);
    return {
      constitution: { version: this.#constitution.version, digest: this.constitutionDigest, verified: true },
      emergencyStopped: state.emergencyStopped,
      ownerFundedRecurringMonthlyUsd: ownerFundedRecurringMonthly(state.ledger),
      realizedProfit,
      reservedSelfDevelopmentBudgetUsd,
      availableCompoundReserveUsd: Math.max(
        0,
        Math.round(
          (realizedProfit.reinvestmentUsd +
            this.#constitution.ownerAuthority.unearnedExpansionBudgetUsd -
            reservedSelfDevelopmentBudgetUsd) *
            100,
        ) / 100,
      ),
      memoryCount: state.memories.length,
      learning: {
        reparodynamicsVersion: REPARODYNAMICS_VERSION,
        doctrineDigest: REPARODYNAMICS_DOCTRINE_DIGEST,
        doctrineMemoryCount: state.memories.filter((memory) => memory.source === REPARODYNAMICS_SOURCE).length,
        verifiedOutcomeCount: state.memories.filter((memory) => memory.tags?.includes("verified-outcome")).length,
      },
      capabilities: state.capabilities,
      jobs: state.jobs,
      mutations: state.mutations,
      revenuePilotJobs: state.revenuePilotJobs,
      revenuePaymentIntents: state.revenuePaymentIntents,
      revenueDeliveries: state.revenueDeliveries,
      standingMandate: state.standingMandate,
      autonomyDecisions: state.autonomyDecisions,
      autonomyExceptions: state.autonomyExceptions,
      businessCandidates: state.businessCandidates,
      audit: { eventCount: state.events.length, headHash: state.events.at(-1)?.hash ?? null },
    };
  }
}
