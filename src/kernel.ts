import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compileWorkCard } from "./capabilities.ts";
import { canonicalJson, sha256 } from "./canonical.ts";
import {
  buildDeterministicSkillScaffold,
  buildVerifiedSkillCandidate,
  executeVerifiedSkillCandidate,
  verifyGenomeLabArtifact,
} from "./genome-lab.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import {
  compileDigitalWorkCard,
  compileDigitalWorkHandoff,
  digitalJobAcceptanceTarget,
  digitalJobDeliveryTarget,
  type DigitalWorkExecutor,
  type DigitalWorkJob,
  type DigitalWorkRequest,
  type DigitalWorkResult,
} from "./digital-work.ts";
import { CORE_MEMORY_SEEDS, CORE_MEMORY_SOURCE, recallMemories, validateMemoryMetadata } from "./memory-fabric.ts";
import { loadConstitution, type SaraConstitution } from "./constitution.ts";
import {
  assertMoney,
  calculateProfitWaterfall,
  ownerFundedRecurringMonthly,
  type ProfitWaterfall,
} from "./economics.ts";
import { evaluatePolicy, PolicyDeniedError } from "./policy.ts";
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
  SkillExecutionResult,
  SkillRecord,
  WorkCard,
} from "./types.ts";

export const SARA_PRINCIPAL: Principal = Object.freeze({ id: "sara", kind: "sara", authenticated: true });
const STAGES: MutationStage[] = ["SANDBOX", "SHADOW", "CANARY", "LIMITED_PRODUCTION", "BROADER_PRODUCTION"];
const GENESIS_HASH = "0".repeat(64);
const KERNEL_CONSTRUCTION_TOKEN = Symbol("SARA_KERNEL_CONSTRUCTION");
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const CAPABILITY_ID = /^[a-z][a-z0-9-]{1,63}$/u;
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

function skillStatusForStage(stage: MutationStage): SkillRecord["status"] {
  if (stage === "CANARY") return "canary";
  if (stage === "LIMITED_PRODUCTION" || stage === "BROADER_PRODUCTION") return "available";
  return "shadow";
}

function capabilityForSkill(skill: SkillRecord): Capability | undefined {
  if (!skill.capabilityId) return undefined;
  return {
    id: skill.capabilityId,
    name: skill.capabilityName ?? skill.skillName,
    status: skill.status === "available" ? "available" : skill.status === "quarantined" ? "missing" : "limited",
    evidence: [
      `skill:${skill.id}`,
      `mutation:${skill.mutationId}`,
      `candidate-sha256:${skill.candidateDigest}`,
    ],
    limitations: [...skill.limitations],
  };
}

type KernelState = {
  emergencyStopped: boolean;
  memories: MemoryRecord[];
  ledger: LedgerEntry[];
  capabilities: Capability[];
  jobs: Job[];
  digitalJobs: DigitalWorkJob[];
  skills: SkillRecord[];
  mutations: Mutation[];
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
  capabilities: Capability[];
  jobs: Job[];
  digitalJobs: DigitalWorkJob[];
  skills: SkillRecord[];
  mutations: Mutation[];
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
    const digitalJobMap = new Map<string, DigitalWorkJob>();
    const skillMap = new Map<string, SkillRecord>();
    const mutationMap = new Map<string, Mutation>();
    let emergencyStopped = false;

    for (const event of events) {
      if (event.type === "memory_recorded") memories.push(event.data as MemoryRecord);
      if (event.type === "core_memory_seeded") {
        const data = event.data as { memories?: unknown };
        if (!Array.isArray(data.memories)) throw new EventStoreIntegrityError("Core memory seed event is malformed.");
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
      if (event.type === "digital_job_created" || event.type === "digital_job_updated") {
        const job = event.data as DigitalWorkJob;
        digitalJobMap.set(job.id, structuredClone(job));
      }
      if (event.type === "skill_registered" || event.type === "skill_updated") {
        const skill = event.data as SkillRecord;
        skillMap.set(skill.id, structuredClone(skill));
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
      digitalJobs: [...digitalJobMap.values()],
      skills: [...skillMap.values()],
      mutations: [...mutationMap.values()],
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

  async recallMemory(input: MemoryRecallQuery): Promise<MemoryRecall> {
    const state = await this.state();
    return recallMemories(state.memories, input);
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
      await this.#store.append("capability_registered", principal, capability);
      return capability;
    });
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

  createDigitalWorkJob(principal: Principal, request: DigitalWorkRequest): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `digital-job:qualify:${request.kind}`,
        external: false,
      });
      const card = compileDigitalWorkCard(request);
      const job: DigitalWorkJob = { id: randomUUID(), status: "qualified", card };
      await this.#store.append("digital_job_created", principal, job);
      return structuredClone(job);
    });
  }

  authorizeDigitalWorkJob(
    principal: Principal,
    jobId: string,
    approval?: OwnerApproval,
  ): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
      if (job.status !== "qualified") throw new Error(`Digital job ${jobId} is not awaiting authorization.`);
      if (job.card.requiresOwnerAcceptance) {
        await this.authorize(principal, {
          action: "contract_commitment",
          targetId: digitalJobAcceptanceTarget(job.id),
          external: true,
          approval,
        });
      } else {
        await this.authorize(principal, {
          action: "sandbox_development",
          targetId: `digital-job:${job.id}:authorize-internal`,
          external: false,
        });
      }
      const updated: DigitalWorkJob = { ...job, status: "authorized" };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  startDigitalWorkJob(
    principal: Principal,
    jobId: string,
    executorId: string,
    maximumCostUsd: number,
  ): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `digital-job:${jobId}:execute`,
        external: false,
      });
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/u.test(executorId)) {
        throw new Error("Digital job executor id must contain 2–128 safe identifier characters.");
      }
      assertMoney(maximumCostUsd, "Digital job executor maximum cost");
      if (maximumCostUsd !== 0) throw new Error("Digital job execution is locked to a $0 maximum cost.");
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
      if (job.status !== "authorized") throw new Error(`Digital job ${jobId} is not authorized for execution.`);
      compileDigitalWorkHandoff(job, this.constitutionDigest);
      const updated: DigitalWorkJob = { ...job, status: "running", executorId };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  completeDigitalWorkJob(
    principal: Principal,
    jobId: string,
    result: DigitalWorkResult,
  ): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `digital-job:${jobId}:complete`,
        external: false,
      });
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
      if (job.status !== "running") throw new Error(`Digital job ${jobId} is not running.`);
      if (!SHA256_HEX.test(result.artifactDigest) || /^0{64}$/u.test(result.artifactDigest)) {
        throw new Error("Digital job result requires a non-zero SHA-256 artifact digest.");
      }
      if (result.summary.trim().length < 5 || result.summary.length > 2_000) {
        throw new Error("Digital job result summary must contain 5–2,000 characters.");
      }
      let reference: URL;
      try {
        reference = new URL(result.artifactReference);
      } catch {
        throw new Error("Digital job artifact reference must be an absolute bounded URL.");
      }
      if (
        !["https:", "draft:", "artifact:"].includes(reference.protocol) ||
        reference.username ||
        reference.password ||
        result.artifactReference.length > 2_048
      ) {
        throw new Error("Digital job artifact reference is outside the bounded artifact schemes.");
      }
      if (!Array.isArray(result.verification) || result.verification.length === 0 || result.verification.length > 20) {
        throw new Error("Digital job result requires 1–20 verification records.");
      }
      for (const item of result.verification) {
        if (
          item.command.trim().length < 2 ||
          item.command.length > 500 ||
          item.exitCode !== 0 ||
          !SHA256_HEX.test(item.outputDigest) ||
          /^0{64}$/u.test(item.outputDigest)
        ) {
          throw new Error("Digital job verification must contain successful commands and non-zero SHA-256 output digests.");
        }
      }
      const normalized: DigitalWorkResult = {
        artifactDigest: result.artifactDigest.toLowerCase(),
        artifactReference: result.artifactReference,
        summary: result.summary.trim(),
        verification: result.verification.map((item) => ({ ...item, command: item.command.trim(), outputDigest: item.outputDigest.toLowerCase() })),
      };
      const updated: DigitalWorkJob = {
        ...job,
        result: normalized,
        status: job.card.requiresHumanReview ? "human_review_required" : "review_ready",
      };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  recordDigitalWorkHumanReview(
    principal: Principal,
    jobId: string,
    review: NonNullable<DigitalWorkJob["humanReview"]>,
  ): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      if (!this.isVerifiedOwner(principal)) {
        throw new PolicyDeniedError(
          { allowed: false, code: "OWNER_REQUIRED", reason: "A verified human owner must record the bootstrap human review." },
          "digital_job_human_review",
        );
      }
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
      if (job.status !== "human_review_required") throw new Error(`Digital job ${jobId} is not awaiting human review.`);
      if (!SHA256_HEX.test(review.evidenceDigest) || /^0{64}$/u.test(review.evidenceDigest)) {
        throw new Error("Human review requires a non-zero SHA-256 evidence digest.");
      }
      if (review.reviewer !== "owner" && review.reviewer !== "qualified_human") throw new Error("Human reviewer is invalid.");
      if (review.decision !== "approved" && review.decision !== "rejected") throw new Error("Human review decision is invalid.");
      const normalized = { ...review, evidenceDigest: review.evidenceDigest.toLowerCase() };
      const updated: DigitalWorkJob = {
        ...job,
        humanReview: normalized,
        status: review.decision === "approved" ? "review_ready" : "rejected",
      };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  authorizeDigitalWorkDelivery(
    principal: Principal,
    jobId: string,
    approval: OwnerApproval,
  ): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
      if (job.status !== "review_ready") throw new Error(`Digital job ${jobId} is not ready for delivery authorization.`);
      await this.authorize(principal, {
        action: "contract_commitment",
        targetId: digitalJobDeliveryTarget(job),
        external: true,
        approval,
      });
      const updated: DigitalWorkJob = { ...job, status: "delivery_authorized" };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  recordDigitalWorkDelivery(principal: Principal, jobId: string, evidenceDigest: string): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "external_write",
        targetId: `digital-job:${jobId}:record-delivery`,
        external: true,
      });
      if (!SHA256_HEX.test(evidenceDigest) || /^0{64}$/u.test(evidenceDigest)) {
        throw new Error("Delivery requires a non-zero SHA-256 evidence digest.");
      }
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job?.result) throw new Error(`Digital job ${jobId} has no verified result.`);
      if (job.status !== "delivery_authorized") throw new Error(`Digital job ${jobId} is not authorized for delivery.`);
      const updated: DigitalWorkJob = {
        ...job,
        status: "delivered",
        delivery: { artifactDigest: job.result.artifactDigest, evidenceDigest: evidenceDigest.toLowerCase() },
      };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  recordDigitalWorkPayment(
    principal: Principal,
    jobId: string,
    amountUsd: number,
    evidenceDigest: string,
  ): Promise<DigitalWorkJob> {
    return this.serializeMutation(async () => {
      assertMoney(amountUsd, "Digital job payment");
      if (amountUsd <= 0) throw new Error("Digital job payment must be greater than zero.");
      if (!SHA256_HEX.test(evidenceDigest) || /^0{64}$/u.test(evidenceDigest)) {
        throw new Error("Payment requires a non-zero SHA-256 settlement evidence digest.");
      }
      const targetId = `digital-job:${jobId}:payment:${amountUsd.toFixed(2)}:${evidenceDigest.toLowerCase()}`;
      await this.authorize(principal, { action: "record_realized_financial_event", targetId, external: false });
      const state = await this.state();
      const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
      if (job.status !== "delivered") throw new Error(`Digital job ${jobId} is not awaiting settled payment.`);
      const entry: LedgerEntry = {
        id: randomUUID(),
        kind: "revenue",
        source: "customer",
        amountUsd,
        realized: true,
        recurringMonthly: false,
        description: `Settled payment for digital job ${job.id}`,
        occurredAt: new Date().toISOString(),
      };
      await this.#store.append("ledger_recorded", principal, entry);
      const updated: DigitalWorkJob = {
        ...job,
        status: "paid",
        payment: { amountUsd, evidenceDigest: evidenceDigest.toLowerCase() },
      };
      await this.#store.append("digital_job_updated", principal, updated);
      return structuredClone(updated);
    });
  }

  async runDigitalWorkJob(
    principal: Principal,
    jobId: string,
    executor: DigitalWorkExecutor,
  ): Promise<DigitalWorkJob> {
    const state = await this.state();
    const job = state.digitalJobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error(`Digital job ${jobId} does not exist.`);
    if (!executor.supportedKinds.includes(job.card.kind)) {
      throw new Error(`Executor ${executor.id} does not support ${job.card.kind}.`);
    }
    const handoff = compileDigitalWorkHandoff(job, this.constitutionDigest);
    await this.startDigitalWorkJob(principal, jobId, executor.id, executor.maximumCostUsd);
    try {
      const result = await executor.execute(structuredClone(handoff));
      return await this.completeDigitalWorkJob(principal, jobId, result);
    } catch (error) {
      await this.serializeMutation(async () => {
        const current = (await this.state()).digitalJobs.find((candidate) => candidate.id === jobId);
        if (current?.status === "running") {
          await this.#store.append("digital_job_updated", principal, { ...current, status: "failed" } satisfies DigitalWorkJob);
        }
      });
      throw error;
    }
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
        const mutation: Mutation = {
          id: candidateId,
          jobId,
          summary: `Generated skill candidate: ${proposal.skillName}`,
          candidateDigest: artifact.candidateDigest,
          artifactRelativePath: artifact.artifactRelativePath,
          stage: "SANDBOX",
          evidence: [],
          createdAt: new Date().toISOString(),
        };
        const evidence: MutationEvidence = {
          id: randomUUID(),
          command: "kernel:isolated-typescript-behavioral-verification",
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
        const skill: SkillRecord = {
          id: mutation.id,
          mutationId: mutation.id,
          jobId,
          skillName: proposal.skillName,
          summary: proposal.summary.trim(),
          limitations: [...proposal.limitations],
          testNames: proposal.tests.map((test) => test.name),
          artifactRelativePath: artifact.artifactRelativePath,
          candidateDigest: artifact.candidateDigest,
          status: "shadow",
          source: {
            generatorId: generator.id,
            external: generator.external,
            maximumCostUsd: generator.maximumCostUsd,
          },
          createdAt: mutation.createdAt,
          executionCount: 0,
        };
        await this.#store.append("skill_registered", principal, skill);
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

  bindSkillCapability(
    principal: Principal,
    skillId: string,
    capabilityId: string,
    capabilityName: string,
  ): Promise<SkillRecord> {
    return this.serializeMutation(async () => {
      if (!this.isVerifiedOwner(principal)) {
        throw new PolicyDeniedError(
          { allowed: false, code: "OWNER_REQUIRED", reason: "A verified owner must bind a skill to a capability identity." },
          "skill_capability_binding",
        );
      }
      if (!CAPABILITY_ID.test(capabilityId)) {
        throw new Error("Capability id must contain 2–64 lowercase letters, numbers, or hyphens and start with a letter.");
      }
      const normalizedName = capabilityName.trim();
      if (normalizedName.length < 2 || normalizedName.length > 100) {
        throw new Error("Capability name must contain 2–100 characters.");
      }
      const state = await this.state();
      const skill = state.skills.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error(`Skill ${skillId} does not exist.`);
      if (skill.status === "quarantined") throw new Error("A quarantined skill cannot be bound to a capability.");
      if (skill.capabilityId && skill.capabilityId !== capabilityId) {
        throw new Error("A skill capability identity is immutable after owner binding.");
      }
      const collision = state.skills.find(
        (candidate) => candidate.id !== skill.id && candidate.capabilityId === capabilityId && candidate.status !== "quarantined",
      );
      if (collision) throw new Error(`Capability ${capabilityId} is already bound to skill ${collision.id}.`);
      const unrelated = state.capabilities.find(
        (capability) => capability.id === capabilityId && !capability.evidence.includes(`skill:${skill.id}`),
      );
      if (unrelated) throw new Error(`Capability ${capabilityId} already exists outside this skill lifecycle.`);
      await verifyGenomeLabArtifact(this.#store.stateDirectory, skill.artifactRelativePath, skill.candidateDigest);
      const updated: SkillRecord = { ...skill, capabilityId, capabilityName: normalizedName };
      const capability = capabilityForSkill(updated)!;
      await this.#store.append("skill_updated", principal, updated);
      await this.#store.append("capability_registered", principal, capability);
      return structuredClone(updated);
    });
  }

  async executeRegisteredSkill(
    principal: Principal,
    capabilityId: string,
    input: unknown,
  ): Promise<SkillExecutionResult> {
    const serializedInput = canonicalJson(input);
    const inputDigest = sha256(serializedInput);
    const skill = await this.serializeMutation(async () => {
      await this.authorize(principal, {
        action: "sandbox_development",
        targetId: `skill:${capabilityId}:execute`,
        external: false,
      });
      const state = await this.state();
      const selected = state.skills.find((candidate) => candidate.capabilityId === capabilityId);
      if (!selected) throw new Error(`No verified skill is bound to capability ${capabilityId}.`);
      if (selected.status !== "available") throw new Error(`Skill capability ${capabilityId} is not available for execution.`);
      const capability = state.capabilities.find((candidate) => candidate.id === capabilityId);
      if (capability?.status !== "available") throw new Error(`Capability ${capabilityId} is not available for execution.`);
      return structuredClone(selected);
    });

    try {
      const output = await executeVerifiedSkillCandidate(
        this.#store.stateDirectory,
        skill.artifactRelativePath,
        skill.candidateDigest,
        input,
      );
      const outputDigest = sha256(canonicalJson(output));
      const observedAt = new Date().toISOString();
      await this.serializeMutation(async () => {
        const state = await this.state();
        const current = state.skills.find((candidate) => candidate.id === skill.id);
        if (!current || current.status !== "available") throw new Error("Skill availability changed during execution.");
        await this.#store.append("skill_updated", principal, {
          ...current,
          executionCount: current.executionCount + 1,
          lastExecution: { succeeded: true, inputDigest, outputDigest, observedAt },
        } satisfies SkillRecord);
        await this.#store.append("skill_execution_recorded", principal, {
          skillId: current.id,
          capabilityId,
          succeeded: true,
          inputDigest,
          outputDigest,
          observedAt,
        });
      });
      return { skillId: skill.id, capabilityId, output, inputDigest, outputDigest };
    } catch (error) {
      const observedAt = new Date().toISOString();
      await this.serializeMutation(async () => {
        const state = await this.state();
        const current = state.skills.find((candidate) => candidate.id === skill.id);
        if (!current || current.status !== "available") return;
        const quarantined: SkillRecord = {
          ...current,
          status: "quarantined",
          executionCount: current.executionCount + 1,
          lastExecution: { succeeded: false, inputDigest, observedAt },
        };
        await this.#store.append("skill_updated", principal, quarantined);
        const capability = capabilityForSkill(quarantined);
        if (capability) await this.#store.append("capability_registered", principal, capability);
        await this.#store.append("skill_execution_recorded", principal, {
          skillId: current.id,
          capabilityId,
          succeeded: false,
          inputDigest,
          observedAt,
          errorDigest: sha256(error instanceof Error ? error.message : String(error)),
        });
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
      const registeredSkill = state.skills.find((candidate) => candidate.mutationId === mutationId);
      if (registeredSkill?.status === "quarantined") {
        throw new Error("A quarantined skill candidate cannot be promoted; build and verify a replacement candidate.");
      }
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
      if (registeredSkill) {
        const updatedSkill: SkillRecord = { ...registeredSkill, status: skillStatusForStage(nextStage) };
        await this.#store.append("skill_updated", principal, updatedSkill);
        const capability = capabilityForSkill(updatedSkill);
        if (capability) await this.#store.append("capability_registered", principal, capability);
      }
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
      capabilities: state.capabilities,
      jobs: state.jobs,
      digitalJobs: state.digitalJobs,
      skills: state.skills,
      mutations: state.mutations,
      audit: { eventCount: state.events.length, headHash: state.events.at(-1)?.hash ?? null },
    };
  }
}
