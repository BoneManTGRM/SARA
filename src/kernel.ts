import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compileWorkCard } from "./capabilities.ts";
import { canonicalJson, sha256 } from "./canonical.ts";
import {
  compoundMandateApprovalTarget,
  decideCompoundingRate,
  validateCompoundMandateInput,
} from "./compounding.ts";
import {
  buildDeterministicSkillScaffold,
  buildVerifiedSkillCandidate,
  verifyGenomeLabArtifact,
} from "./genome-lab.ts";
import { compileExecutorHandoff } from "./handoff.ts";
import { CORE_MEMORY_SEEDS, CORE_MEMORY_SOURCE, recallMemories, validateMemoryMetadata } from "./memory-fabric.ts";
import { loadConstitution, type SaraConstitution } from "./constitution.ts";
import {
  assertMoney,
  calculateProfitWaterfall,
  compoundReinvestmentSpent,
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
  CompoundMandate,
  CompoundMandateInput,
  CompoundPurchase,
  CompoundPurchaseExecutor,
  CompoundingDecision,
  CompoundingOpportunity,
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

function reservedCompoundPurchaseBudget(purchases: CompoundPurchase[]): number {
  const total = purchases
    .filter(
      (purchase) =>
        purchase.status === "reserved" || purchase.status === "reconciliation_required",
    )
    .reduce((sum, purchase) => sum + purchase.amountUsd, 0);
  assertMoney(total, "Reserved Compound purchase budget");
  return Math.round(total * 100) / 100;
}

function mandateCommittedUsd(purchases: CompoundPurchase[], mandateId: string): number {
  const total = purchases
    .filter(
      (purchase) =>
        purchase.mandateId === mandateId &&
        (
          purchase.status === "reserved" ||
          purchase.status === "settled" ||
          purchase.status === "reconciliation_required"
        ),
    )
    .reduce((sum, purchase) => sum + purchase.amountUsd, 0);
  assertMoney(total, "Mandate committed amount");
  return Math.round(total * 100) / 100;
}

function currentReinvestmentRate(
  decisions: CompoundingDecision[],
  defaultRate: number,
): number {
  return decisions.at(-1)?.reinvestmentRate ?? defaultRate;
}

type KernelState = {
  emergencyStopped: boolean;
  memories: MemoryRecord[];
  ledger: LedgerEntry[];
  compoundingDecisions: CompoundingDecision[];
  compoundMandates: CompoundMandate[];
  compoundPurchases: CompoundPurchase[];
  capabilities: Capability[];
  jobs: Job[];
  mutations: Mutation[];
  events: StoredEvent[];
};

export type SaraStatus = {
  constitution: { version: number; digest: string; verified: true };
  emergencyStopped: boolean;
  ownerFundedRecurringMonthlyUsd: number;
  realizedProfit: ProfitWaterfall;
  compoundingDecision: CompoundingDecision | null;
  compoundReinvestmentSpentUsd: number;
  reservedCompoundPurchaseBudgetUsd: number;
  reservedSelfDevelopmentBudgetUsd: number;
  availableCompoundReserveUsd: number;
  compoundMandates: CompoundMandate[];
  compoundPurchases: CompoundPurchase[];
  memoryCount: number;
  capabilities: Capability[];
  jobs: Job[];
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
    const compoundingDecisions: CompoundingDecision[] = [];
    const compoundMandateMap = new Map<string, CompoundMandate>();
    const compoundPurchaseMap = new Map<string, CompoundPurchase>();
    const capabilityMap = new Map<string, Capability>();
    const jobMap = new Map<string, Job>();
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
      if (event.type === "compounding_decision_recorded") {
        compoundingDecisions.push(structuredClone(event.data as CompoundingDecision));
      }
      if (event.type === "compound_mandate_created") {
        const mandate = event.data as CompoundMandate;
        compoundMandateMap.set(mandate.id, structuredClone(mandate));
      }
      if (event.type === "compound_mandate_revoked") {
        const data = event.data as { mandateId: string; revokedAt: string };
        const mandate = compoundMandateMap.get(data.mandateId);
        if (!mandate) throw new Error(`Audit event references missing mandate ${data.mandateId}.`);
        mandate.status = "revoked";
        mandate.revokedAt = data.revokedAt;
      }
      if (event.type === "compound_purchase_reserved") {
        const purchase = event.data as CompoundPurchase;
        compoundPurchaseMap.set(purchase.id, structuredClone(purchase));
      }
      if (event.type === "compound_purchase_settled") {
        const data = event.data as {
          purchaseId: string;
          settledAt: string;
          externalReference: string;
        };
        const purchase = compoundPurchaseMap.get(data.purchaseId);
        if (!purchase) throw new Error(`Audit event references missing purchase ${data.purchaseId}.`);
        purchase.status = "settled";
        purchase.settledAt = data.settledAt;
        purchase.externalReference = data.externalReference;
      }
      if (event.type === "compound_purchase_failed") {
        const data = event.data as { purchaseId: string; failureCode: string };
        const purchase = compoundPurchaseMap.get(data.purchaseId);
        if (!purchase) throw new Error(`Audit event references missing purchase ${data.purchaseId}.`);
        purchase.status = "failed";
        purchase.failureCode = data.failureCode;
      }
      if (event.type === "compound_purchase_reconciliation_required") {
        const data = event.data as { purchaseId: string; failureCode: string };
        const purchase = compoundPurchaseMap.get(data.purchaseId);
        if (!purchase) throw new Error(`Audit event references missing purchase ${data.purchaseId}.`);
        purchase.status = "reconciliation_required";
        purchase.failureCode = data.failureCode;
      }
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
      if (event.type === "emergency_stop_changed") {
        emergencyStopped = (event.data as { active: boolean }).active;
      }
    }

    return {
      emergencyStopped,
      memories,
      ledger,
      compoundingDecisions,
      compoundMandates: [...compoundMandateMap.values()],
      compoundPurchases: [...compoundPurchaseMap.values()],
      capabilities: [...capabilityMap.values()],
      jobs: [...jobMap.values()],
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

  recordCompoundingDecision(
    principal: Principal,
    opportunity: CompoundingOpportunity,
  ): Promise<CompoundingDecision> {
    return this.serializeMutation(async () => {
      if (principal.kind === "sara" && principal !== SARA_PRINCIPAL) {
        throw new PolicyDeniedError(
          { allowed: false, code: "SARA_AUTHORITY_REQUIRED", reason: "The canonical SARA governor is required." },
          "select_compounding_rate",
        );
      }
      await this.authorize(principal, {
        action: "select_compounding_rate",
        targetId: opportunity.objective,
        external: false,
      });
      const decision = decideCompoundingRate(opportunity, {
        id: randomUUID(),
        decidedAt: new Date().toISOString(),
      });
      await this.#store.append("compounding_decision_recorded", principal, decision);
      return decision;
    });
  }

  createCompoundMandate(
    principal: Principal,
    input: CompoundMandateInput,
    approval: OwnerApproval,
  ): Promise<CompoundMandate> {
    return this.serializeMutation(async () => {
      const validated = validateCompoundMandateInput(input);
      const targetId = compoundMandateApprovalTarget(validated);
      await this.authorize(principal, {
        action: "money_transfer",
        targetId,
        external: true,
        approval,
      });
      const mandate: CompoundMandate = {
        ...validated,
        id: randomUUID(),
        status: "active",
        approvalId: approval.approvalId,
        createdAt: new Date().toISOString(),
      };
      await this.#store.append("compound_mandate_created", principal, mandate);
      return mandate;
    });
  }

  revokeCompoundMandate(
    principal: Principal,
    mandateId: string,
    approval: OwnerApproval,
  ): Promise<CompoundMandate> {
    return this.serializeMutation(async () => {
      const targetId = `compound-mandate-revoke:${mandateId}`;
      await this.authorize(principal, {
        action: "money_transfer",
        targetId,
        external: true,
        approval,
      });
      const state = await this.state();
      const mandate = state.compoundMandates.find((candidate) => candidate.id === mandateId);
      if (!mandate) throw new Error(`Compound mandate ${mandateId} does not exist.`);
      if (mandate.status === "revoked") return mandate;
      const revokedAt = new Date().toISOString();
      await this.#store.append("compound_mandate_revoked", principal, { mandateId, revokedAt });
      return { ...mandate, status: "revoked", revokedAt };
    });
  }

  async executeMandatedCompoundPurchase(
    principal: Principal,
    input: {
      mandateId: string;
      targetId: string;
      amountUsd: number;
      description: string;
    },
    executor: CompoundPurchaseExecutor,
  ): Promise<CompoundPurchase> {
    const purchase = await this.serializeMutation(async () => {
      if (principal.kind === "sara" && principal !== SARA_PRINCIPAL) {
        throw new PolicyDeniedError(
          { allowed: false, code: "SARA_AUTHORITY_REQUIRED", reason: "The canonical SARA governor is required." },
          "compound_reinvestment_purchase",
        );
      }
      await this.authorize(principal, {
        action: "compound_reinvestment_purchase",
        targetId: input.targetId,
        external: true,
      });
      assertMoney(input.amountUsd, "Compound purchase amount");
      if (input.amountUsd <= 0) throw new RangeError("Compound purchase amount must be greater than zero.");
      if (!input.description.trim() || input.description.length > 500) {
        throw new Error("Compound purchase description must contain 1–500 characters.");
      }
      const state = await this.state();
      const mandate = state.compoundMandates.find((candidate) => candidate.id === input.mandateId);
      if (!mandate) throw new Error(`Compound mandate ${input.mandateId} does not exist.`);
      if (mandate.status !== "active") throw new Error("Compound mandate is not active.");
      if (Date.parse(mandate.expiresAt) <= Date.now()) throw new Error("Compound mandate has expired.");
      if (
        mandate.providerId !== executor.providerId ||
        mandate.operation !== executor.operation ||
        mandate.targetId !== input.targetId
      ) {
        throw new Error("Executor, operation, and target must exactly match the owner-issued mandate.");
      }
      if (input.amountUsd > mandate.maximumPerActionUsd) {
        throw new RangeError("Compound purchase exceeds the mandate per-action limit.");
      }
      const mandateCommitted = mandateCommittedUsd(state.compoundPurchases, mandate.id);
      if (Math.round((mandateCommitted + input.amountUsd) * 100) / 100 > mandate.maximumTotalUsd) {
        throw new RangeError("Compound purchase exceeds the mandate total limit.");
      }
      const reinvestmentRate = currentReinvestmentRate(
        state.compoundingDecisions,
        this.#constitution.ownerAuthority.defaultReinvestmentRate,
      );
      const allocated = calculateProfitWaterfall(state.ledger, reinvestmentRate).reinvestmentUsd;
      const available = Math.max(
        0,
        Math.round(
          (
            allocated +
            this.#constitution.ownerAuthority.unearnedExpansionBudgetUsd -
            compoundReinvestmentSpent(state.ledger) -
            reservedSelfDevelopmentBudget(state.jobs) -
            reservedCompoundPurchaseBudget(state.compoundPurchases)
          ) * 100,
        ) / 100,
      );
      if (input.amountUsd > available) {
        throw new RangeError(`Compound purchase exceeds the $${available.toFixed(2)} available Compound Reserve.`);
      }
      const reserved: CompoundPurchase = {
        id: randomUUID(),
        mandateId: mandate.id,
        providerId: mandate.providerId,
        operation: mandate.operation,
        targetId: mandate.targetId,
        amountUsd: input.amountUsd,
        description: input.description.trim(),
        status: "reserved",
        reservedAt: new Date().toISOString(),
      };
      await this.#store.append("compound_purchase_reserved", principal, reserved);
      return reserved;
    });

    try {
      const result = await executor.execute({
        idempotencyKey: purchase.id,
        targetId: purchase.targetId,
        amountUsd: purchase.amountUsd,
        description: purchase.description,
      });
      assertMoney(result.chargedUsd, "Executor charge");
      if (
        result.chargedUsd !== purchase.amountUsd ||
        !result.externalReference.trim() ||
        result.externalReference.length > 200 ||
        /[\u0000-\u001f\u007f]/u.test(result.externalReference)
      ) {
        await this.serializeMutation(async () => {
          const occurredAt = new Date().toISOString();
          if (result.chargedUsd > 0) {
            const breachEntry: LedgerEntry = {
              id: randomUUID(),
              kind: "reinvestment",
              source: "sara",
              amountUsd: result.chargedUsd,
              realized: true,
              recurringMonthly: false,
              description: `Executor contract violation for purchase ${purchase.id}`,
              occurredAt,
            };
            await this.#store.append("ledger_recorded", SARA_PRINCIPAL, breachEntry);
          }
          await this.#store.append("compound_purchase_failed", SARA_PRINCIPAL, {
            purchaseId: purchase.id,
            failureCode: "EXECUTOR_CONTRACT_VIOLATION",
          });
          await this.#store.append("emergency_stop_changed", SARA_PRINCIPAL, { active: true });
        });
        throw new Error("Compound executor violated its exact-charge contract; emergency stop engaged.");
      }
      return this.serializeMutation(async () => {
        const settledAt = new Date().toISOString();
        await this.#store.append("compound_purchase_settled", SARA_PRINCIPAL, {
          purchaseId: purchase.id,
          settledAt,
          externalReference: result.externalReference.trim(),
        });
        const entry: LedgerEntry = {
          id: randomUUID(),
          kind: "reinvestment",
          source: "sara",
          amountUsd: result.chargedUsd,
          realized: true,
          recurringMonthly: false,
          description: `Mandated ${purchase.providerId}/${purchase.operation}: ${purchase.description}`,
          occurredAt: settledAt,
        };
        await this.#store.append("ledger_recorded", SARA_PRINCIPAL, entry);
        return {
          ...purchase,
          status: "settled",
          settledAt,
          externalReference: result.externalReference.trim(),
        };
      });
    } catch (error) {
      if ((error as Error).message.includes("emergency stop engaged")) throw error;
      await this.serializeMutation(async () => {
        // A thrown connector call can be ambiguous: the provider may have
        // charged before the response was lost. Keep the reservation
        // fail-closed so a retry cannot spend the same Compound Reserve twice.
        await this.#store.append("compound_purchase_reconciliation_required", SARA_PRINCIPAL, {
          purchaseId: purchase.id,
          failureCode: "EXECUTOR_OUTCOME_UNKNOWN",
        });
      });
      throw error;
    }
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
      const reinvestmentRate = currentReinvestmentRate(
        state.compoundingDecisions,
        this.#constitution.ownerAuthority.defaultReinvestmentRate,
      );
      const compoundReserve = calculateProfitWaterfall(
        state.ledger,
        reinvestmentRate,
      ).reinvestmentUsd;
      const reservedBudget = reservedSelfDevelopmentBudget(state.jobs);
      const reservedPurchases = reservedCompoundPurchaseBudget(state.compoundPurchases);
      const spentReinvestment = compoundReinvestmentSpent(state.ledger);
      const availableBudget = Math.max(
        0,
        Math.round(
          (
            compoundReserve +
            this.#constitution.ownerAuthority.unearnedExpansionBudgetUsd -
            reservedBudget -
            reservedPurchases -
            spentReinvestment
          ) * 100,
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

  async getStatus(reinvestmentRate = this.#constitution.ownerAuthority.defaultReinvestmentRate): Promise<SaraStatus> {
    await this.mutationTail;
    const state = await this.state();
    const effectiveReinvestmentRate = state.compoundingDecisions.length > 0
      ? currentReinvestmentRate(state.compoundingDecisions, reinvestmentRate)
      : reinvestmentRate;
    const realizedProfit = calculateProfitWaterfall(state.ledger, effectiveReinvestmentRate);
    const compoundReinvestmentSpentUsd = compoundReinvestmentSpent(state.ledger);
    const reservedCompoundPurchaseBudgetUsd = reservedCompoundPurchaseBudget(state.compoundPurchases);
    const reservedSelfDevelopmentBudgetUsd = reservedSelfDevelopmentBudget(state.jobs);
    return {
      constitution: { version: this.#constitution.version, digest: this.constitutionDigest, verified: true },
      emergencyStopped: state.emergencyStopped,
      ownerFundedRecurringMonthlyUsd: ownerFundedRecurringMonthly(state.ledger),
      realizedProfit,
      compoundingDecision: state.compoundingDecisions.at(-1) ?? null,
      compoundReinvestmentSpentUsd,
      reservedCompoundPurchaseBudgetUsd,
      reservedSelfDevelopmentBudgetUsd,
      availableCompoundReserveUsd: Math.max(
        0,
        Math.round(
          (realizedProfit.reinvestmentUsd +
            this.#constitution.ownerAuthority.unearnedExpansionBudgetUsd -
            compoundReinvestmentSpentUsd -
            reservedCompoundPurchaseBudgetUsd -
            reservedSelfDevelopmentBudgetUsd) *
            100,
        ) / 100,
      ),
      compoundMandates: state.compoundMandates,
      compoundPurchases: state.compoundPurchases,
      memoryCount: state.memories.length,
      capabilities: state.capabilities,
      jobs: state.jobs,
      mutations: state.mutations,
      audit: { eventCount: state.events.length, headHash: state.events.at(-1)?.hash ?? null },
    };
  }
}
