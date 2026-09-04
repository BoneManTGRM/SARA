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
    now?: () => Date;
  }): Promise<SaraKernel> {
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
      return kernel;
    });
  }

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
  }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(generator.id)) {
      throw new Error("Candidate generator id must be 2–128 safe identifier characters.");
    }
    assertMoney(generator.maximumCostUsd, "Candidate generator maximum cost");

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
      await this.#store.append("job_status_changed", principal, {
        jobId,
        from: job.status,
        status: "running",
        generatorId: generator.id,
        maximumCostUsd: generator.maximumCostUsd,
        memoryContextDigest: memoryContext.contextDigest,
        memoryIds: memoryContext.memories.map((memory) => memory.id),
      });
      return { ...compiled, memoryContext };
    });

    try {
      const proposal = await generator.generate({
        objective: handoff.objective,
        acceptanceCriteria: [...handoff.acceptanceCriteria],
        missingCapabilities: [...handoff.missingCapabilities],
        constitutionDigest: handoff.constitutionDigest,
        memoryContext: structuredClone(handoff.memoryContext),
      });

      return await this.serializeMutation(async () => {
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
        const candidateId = randomUUID();
        const artifact = await buildVerifiedSkillCandidate(
          handoff,
          proposal,
          `${this.#store.stateDirectory}/genome-lab`,
          candidateId,
        );
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
          job: { ...runningJob, status: "verified" },
          mutation: { ...mutation, stage: "SHADOW", evidence: [evidence] },
          evidence,
          artifactRelativePath: artifact.artifactRelativePath,
          generatorId: generator.id,
        };
      });
    } catch (error) {
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
        }
      });
      throw error;
    }
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
