import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { defaultConstitutionPath } from "../src/constitution.ts";
import { calculateProfitWaterfall } from "../src/economics.ts";
import { authenticateOwnerPrincipal, SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { PolicyDeniedError } from "../src/policy.ts";
import { EventStoreIntegrityError } from "../src/store.ts";
import type { OwnerApproval, Principal } from "../src/types.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "bootstrap-test-owner-token";
process.env.SARA_OWNER_TOKEN_SHA256 = sha256(OWNER_TOKEN);
const owner: Principal = authenticateOwnerPrincipal(OWNER_TOKEN);

async function tempState(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sara-test-"));
  cleanup.push(directory);
  return directory;
}

function approval(targetId: string): OwnerApproval {
  return {
    approvalId: `approval-${targetId}`,
    action: "production_promotion",
    targetId,
    approvedAt: "2026-09-01T00:00:00.000Z",
    ownerId: owner.id,
  };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SARA constitutional and economic kernel", () => {
  it("fails closed when the canonical Constitution changes", async () => {
    const directory = await tempState();
    const changed = join(directory, "constitution.json");
    await copyFile(defaultConstitutionPath(), changed);
    await writeFile(changed, `${await readFile(changed, "utf8")}\n`);
    await assert.rejects(() => SaraKernel.boot({ stateDirectory: join(directory, "state"), constitutionPath: changed }), {
      name: "ConstitutionIntegrityError",
    });
  });

  it("deep-freezes the verified Constitution and preserves the original authority", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    assert.equal(Object.isFrozen(kernel.constitution), true);
    assert.equal(Object.isFrozen(kernel.constitution.ownerAuthority), true);
    const mutableView = kernel.constitution as unknown as {
      ownerAuthority: { ownerIdentity: string; ownerFundedRecurringMonthlyUsdMaximum: number };
    };
    assert.throws(() => {
      mutableView.ownerAuthority.ownerIdentity = "sara";
    }, TypeError);
    assert.throws(() => {
      mutableView.ownerAuthority.ownerFundedRecurringMonthlyUsdMaximum = 999_999;
    }, TypeError);
    await assert.rejects(
      () =>
        kernel.recordLedgerEntry(
          { id: "sara", kind: "owner", authenticated: true },
          {
            kind: "core_operation",
            source: "owner",
            amountUsd: 301,
            realized: true,
            recurringMonthly: true,
            description: "Forged authority after mutation attempt",
            occurredAt: "2026-09-01T00:00:00.000Z",
          },
        ),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
    );
    assert.equal((await kernel.getStatus()).ownerFundedRecurringMonthlyUsd, 0);
  });

  it("requires runtime boot authority and a kernel-bound owner capability", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    assert.throws(
      () =>
        Reflect.construct(SaraKernel as unknown as Function, [
          Symbol("forged-construction"),
          {},
          kernel.constitution,
          kernel.constitutionDigest,
          process.env.SARA_OWNER_TOKEN_SHA256,
        ]),
      /only be constructed through verified boot/,
    );
    await kernel.setEmergencyStop(owner, true);
    await assert.rejects(
      () => kernel.setEmergencyStop({ id: "OWNER", kind: "owner", authenticated: true }, false),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
    );
    assert.equal((await kernel.getStatus()).emergencyStopped, true);
    await kernel.setEmergencyStop(owner, false);

    const alternateDigest = sha256("different-owner-token");
    await assert.rejects(
      () => SaraKernel.boot({ stateDirectory, ownerTokenSha256: alternateDigest }),
      /does not match the authority bound to this state/,
    );
  });

  it("does not export or expose a policy-bypassing event writer", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    assert.equal("store" in kernel, false);
    assert.equal((kernel as unknown as { store?: unknown }).store, undefined);
    const storeModule = await import("../src/store.ts");
    assert.equal("EventStore" in storeModule, false);
    const audit = await kernel.inspectAudit();
    assert.ok(audit.length > 0);
    audit[0].type = "ledger_recorded";
    assert.notEqual((await kernel.inspectAudit())[0].type, "ledger_recorded");
  });

  it("enforces the $300 owner-funded recurring ceiling", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    const initial = await kernel.getStatus();
    assert.equal(kernel.constitution.ownerAuthority.bootstrapOwnerFundedRecurringMonthlyTargetUsd, 0);
    assert.equal(kernel.constitution.ownerAuthority.unearnedExpansionBudgetUsd, 0);
    assert.equal(initial.ownerFundedRecurringMonthlyUsd, 0);
    await assert.rejects(
      () =>
        kernel.recordLedgerEntry(SARA_PRINCIPAL, {
          kind: "core_operation",
          source: "owner",
          amountUsd: 1,
          realized: false,
          recurringMonthly: true,
          description: "Unapproved bootstrap cost",
          occurredAt: "2026-09-01T00:00:00.000Z",
        }),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
    );
    await kernel.recordLedgerEntry(owner, {
      kind: "core_operation",
      source: "owner",
      amountUsd: 200,
      realized: false,
      recurringMonthly: true,
      description: "Core runtime commitment",
      occurredAt: "2026-09-01T00:00:00.000Z",
    });
    await assert.rejects(
      () =>
        kernel.recordLedgerEntry(owner, {
          kind: "core_operation",
          source: "owner",
          amountUsd: 101,
          realized: false,
          recurringMonthly: true,
          description: "Budget-breaking add-on",
          occurredAt: "2026-09-01T00:00:00.000Z",
        }),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_BUDGET_EXCEEDED",
    );
    assert.equal((await kernel.getStatus()).ownerFundedRecurringMonthlyUsd, 200);
  });

  it("serializes concurrent owner recurring commitments against one current budget", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    const commitment = (description: string) =>
      kernel.recordLedgerEntry(owner, {
        kind: "core_operation",
        source: "owner",
        amountUsd: 200,
        realized: false,
        recurringMonthly: true,
        description,
        occurredAt: "2026-09-01T00:00:00.000Z",
      });

    const pending = Promise.allSettled([commitment("Concurrent runtime A"), commitment("Concurrent runtime B")]);
    const statusDuringConcurrentWrites = kernel.getStatus();
    const results = await pending;
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]?.status === "rejected" &&
        rejected[0].reason instanceof PolicyDeniedError &&
        rejected[0].reason.decision.code === "OWNER_BUDGET_EXCEEDED",
    );
    assert.equal((await statusDuringConcurrentWrites).ownerFundedRecurringMonthlyUsd, 200);
    assert.equal((await kernel.getStatus()).ownerFundedRecurringMonthlyUsd, 200);
  });

  it("serializes competing kernels that share one durable state directory", async () => {
    const stateDirectory = await tempState();
    const first = await SaraKernel.boot({ stateDirectory });
    const second = await SaraKernel.boot({ stateDirectory });
    const commitment = (kernel: SaraKernel, description: string) =>
      kernel.recordLedgerEntry(owner, {
        kind: "core_operation",
        source: "owner",
        amountUsd: 200,
        realized: false,
        recurringMonthly: true,
        description,
        occurredAt: "2026-09-01T00:00:00.000Z",
      });
    const results = await Promise.allSettled([
      commitment(first, "Shared runtime A"),
      commitment(second, "Shared runtime B"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.ok(
      rejection?.status === "rejected" &&
        rejection.reason instanceof PolicyDeniedError &&
        rejection.reason.decision.code === "OWNER_BUDGET_EXCEEDED",
    );
    assert.equal((await first.getStatus()).ownerFundedRecurringMonthlyUsd, 200);
    assert.equal((await second.getStatus()).ownerFundedRecurringMonthlyUsd, 200);
    assert.ok((await first.inspectAudit()).length > 0);
  });

  it("applies the owner-funded ceiling even when a recurring charge is realized", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    await assert.rejects(
      () =>
        kernel.recordLedgerEntry(owner, {
          kind: "core_operation",
          source: "owner",
          amountUsd: 301,
          realized: true,
          recurringMonthly: true,
          description: "Realized charge above the ceiling",
          occurredAt: "2026-09-01T00:00:00.000Z",
        }),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_BUDGET_EXCEEDED",
    );
    assert.equal((await kernel.getStatus()).ownerFundedRecurringMonthlyUsd, 0);
  });

  it("uses only collected realized revenue and preserves the protected split", () => {
    const base = {
      id: "entry",
      source: "customer" as const,
      recurringMonthly: false,
      description: "test",
      occurredAt: "2026-09-01T00:00:00.000Z",
    };
    const projectedOnly = calculateProfitWaterfall(
      [{ ...base, kind: "revenue", amountUsd: 10_000, realized: false }],
      0.25,
    );
    assert.equal(projectedOnly.realizedDistributableProfitUsd, 0);

    const realized = calculateProfitWaterfall(
      [
        { ...base, kind: "revenue", amountUsd: 500, realized: true },
        { ...base, id: "cost", kind: "fulfillment_cost", amountUsd: 50, realized: true },
      ],
      0.25,
    );
    assert.deepEqual(realized, {
      collectedRevenueUsd: 500,
      trueCostsAndReservesUsd: 50,
      realizedDistributableProfitUsd: 450,
      reinvestmentUsd: 112.5,
      ownerDistributionUsd: 337.5,
      allocationRoundingCarryUsd: 0,
      reinvestmentRate: 0.25,
    });
    const maximumCompound = calculateProfitWaterfall(
      [
        { ...base, kind: "revenue", amountUsd: 500, realized: true },
        { ...base, id: "cost", kind: "fulfillment_cost", amountUsd: 50, realized: true },
      ],
      0.5,
    );
    assert.equal(maximumCompound.reinvestmentUsd, 225);
    assert.equal(maximumCompound.ownerDistributionUsd, 225);
    const unevenCent = calculateProfitWaterfall(
      [{ ...base, kind: "revenue", amountUsd: 1.01, realized: true }],
      0.5,
    );
    assert.equal(unevenCent.reinvestmentUsd, 0.5);
    assert.equal(unevenCent.ownerDistributionUsd, 0.51);
    assert.ok(unevenCent.reinvestmentUsd <= unevenCent.realizedDistributableProfitUsd * 0.5);
    assert.ok(unevenCent.ownerDistributionUsd >= unevenCent.realizedDistributableProfitUsd * 0.5);
    const minimumCompound = calculateProfitWaterfall(
      [{ ...base, kind: "revenue", amountUsd: 1.01, realized: true }],
      0.25,
    );
    assert.equal(minimumCompound.reinvestmentUsd, 0.26);
    assert.equal(minimumCompound.ownerDistributionUsd, 0.75);
    assert.ok(minimumCompound.reinvestmentUsd >= minimumCompound.realizedDistributableProfitUsd * 0.25);
    assert.ok(minimumCompound.ownerDistributionUsd <= minimumCompound.realizedDistributableProfitUsd * 0.75);
    const indivisibleCent = calculateProfitWaterfall(
      [{ ...base, kind: "revenue", amountUsd: 0.01, realized: true }],
      0.25,
    );
    assert.equal(indivisibleCent.reinvestmentUsd, 0);
    assert.equal(indivisibleCent.ownerDistributionUsd, 0);
    assert.equal(indivisibleCent.allocationRoundingCarryUsd, 0.01);
    assert.throws(() => calculateProfitWaterfall([], 0.51), /25–50%/);
    assert.throws(() => calculateProfitWaterfall([], 0.24), /25–50%/);
    assert.throws(() => calculateProfitWaterfall([], Number.NaN), /25–50%/);
    assert.throws(
      () => calculateProfitWaterfall([{ ...base, kind: "revenue", amountUsd: Number.NaN, realized: true }], 0.25),
      /finite non-negative/,
    );
    assert.throws(
      () => calculateProfitWaterfall([{ ...base, kind: "revenue", amountUsd: 0.001, realized: true }], 0.25),
      /whole cents/,
    );
  });

  it("does not let SARA self-attest projected revenue as realized", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    await assert.rejects(
      () =>
        kernel.recordLedgerEntry(SARA_PRINCIPAL, {
          kind: "revenue",
          source: "customer",
          amountUsd: 500,
          realized: true,
          recurringMonthly: false,
          description: "Unverified customer payment",
          occurredAt: "2026-09-01T00:00:00.000Z",
        }),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
    );
    assert.equal((await kernel.getStatus()).realizedProfit.collectedRevenueUsd, 0);
  });

  it("reserves self-development budgets only from realized Compound Reserve funds", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    const work = (maximumBudgetUsd: number, objective: string) =>
      kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
        objective,
        expectedOwnerValue: 100,
        requiredCapabilities: [],
        acceptanceCriteria: ["The bounded experiment reports verifiable evidence."],
        maximumBudgetUsd,
      });
    await assert.rejects(() => work(0.01, "Spend before earning"), /unreserved SARA Compound Reserve/);
    await kernel.recordLedgerEntry(owner, {
      kind: "revenue",
      source: "customer",
      amountUsd: 100,
      realized: true,
      recurringMonthly: false,
      description: "Collected customer payment",
      occurredAt: "2026-09-01T00:00:00.000Z",
    });
    await work(20, "First earned experiment");
    await assert.rejects(() => work(5.01, "Over-reserve earned funds"), /\$5.00 unreserved/);
    const status = await kernel.getStatus();
    assert.equal(status.realizedProfit.reinvestmentUsd, 25);
    assert.equal(status.reservedSelfDevelopmentBudgetUsd, 20);
    assert.equal(status.availableCompoundReserveUsd, 5);
  });
});

describe("SARA durable memory and Genome Lab", () => {
  it("survives restart with provenance and detects audit corruption", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    const memory = await kernel.recordMemory(SARA_PRINCIPAL, {
      category: "strategic",
      statement: "Build only the self-development bootstrap before revenue-gated expansion.",
      source: "owner-directive:2026-09-01",
      observedAt: "2026-09-01T00:00:00.000Z",
      confidence: 1,
      verification: "measured",
      scope: "sara-bootstrap",
      dependencies: ["constitution-v1"],
      lastValidatedAt: "2026-09-01T00:00:00.000Z",
    });
    const restarted = await SaraKernel.boot({ stateDirectory });
    const status = await restarted.getStatus();
    assert.equal(status.memoryCount, 37);
    const events = await restarted.inspectAudit();
    assert.deepEqual(events.find((event) => event.type === "memory_recorded")?.data, memory);

    const eventPath = join(stateDirectory, "events.ndjson");
    await writeFile(eventPath, `${await readFile(eventPath, "utf8")}not-json\n`);
    await assert.rejects(() => restarted.getStatus(), EventStoreIntegrityError);
  });

  it("rejects blank records inserted into the append-only audit log", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    const eventPath = join(stateDirectory, "events.ndjson");
    const raw = await readFile(eventPath, "utf8");
    await writeFile(eventPath, raw.replaceAll("\n", "\n\n"));
    await assert.rejects(() => kernel.getStatus(), EventStoreIntegrityError);
  });

  it("compiles a gap and requires staged, evidenced, owner-approved promotion", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    await kernel.registerCapability(SARA_PRINCIPAL, {
      id: "tgrm",
      name: "TGRM verification",
      status: "available",
      evidence: ["tests/tgrm.test.ts"],
      limitations: [],
    });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Add a narrow GitHub App executor",
      expectedOwnerValue: 100,
      requiredCapabilities: ["tgrm", "github-app-executor"],
      acceptanceCriteria: ["A candidate PR is created without protected-branch bypass."],
      maximumBudgetUsd: 0,
    });
    assert.deepEqual(job.workCard.missingCapabilities, ["github-app-executor"]);
    const candidateDigest = sha256("candidate-patch-v1");
    const mutation = await kernel.createMutation(SARA_PRINCIPAL, {
      jobId: job.id,
      summary: "Candidate GitHub executor",
      candidateDigest,
    });
    assert.equal(mutation.stage, "SANDBOX");
    await assert.rejects(() => kernel.promoteMutation(SARA_PRINCIPAL, mutation.id, "SHADOW"), /passing verification/);
    await kernel.recordMutationEvidence(SARA_PRINCIPAL, mutation.id, {
      command: "npm run verify",
      exitCode: 0,
      outputDigest: sha256("tests passed"),
      candidateDigest,
      observedAt: "2026-09-01T00:00:00.000Z",
    });
    await assert.rejects(() => kernel.promoteMutation(SARA_PRINCIPAL, mutation.id, "CANARY"), /exactly one stage/);
    assert.equal((await kernel.promoteMutation(SARA_PRINCIPAL, mutation.id, "SHADOW")).stage, "SHADOW");
    await assert.rejects(
      () => kernel.promoteMutation(owner, mutation.id, "CANARY", approval(`${mutation.id}:CANARY`)),
      /owner-attested verification evidence/,
    );
    await kernel.recordMutationEvidence(owner, mutation.id, {
      command: "npm run verify",
      exitCode: 0,
      outputDigest: sha256("owner reviewed tests"),
      candidateDigest,
      observedAt: "2026-09-01T00:00:00.000Z",
    });
    await assert.rejects(
      () => kernel.promoteMutation(owner, mutation.id, "CANARY", approval(`${mutation.id}:CANARY`)),
      /locally re-verifiable Genome Lab artifact/,
    );
  });

  it("writes and compiler-checks a real zero-cost skill candidate in Genome Lab", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Create the next bounded capability scaffold",
      expectedOwnerValue: 1,
      requiredCapabilities: ["next-capability"],
      acceptanceCriteria: ["Generated TypeScript compiles without syntax errors."],
      maximumBudgetUsd: 0,
    });
    const execution = await kernel.executeDeterministicSkillScaffold(SARA_PRINCIPAL, job.id);
    assert.equal(execution.mutation.stage, "SANDBOX");
    assert.equal(execution.evidence.attestation, "kernel_executed");
    assert.equal(execution.evidence.exitCode, 0);
    const generated = await readFile(join(stateDirectory, execution.artifactRelativePath, "skill.ts"), "utf8");
    assert.match(generated, /export function runSkillScaffold/);
    assert.match(generated, /Create the next bounded capability scaffold/);
    assert.equal((await kernel.promoteMutation(SARA_PRINCIPAL, execution.mutation.id, "SHADOW")).stage, "SHADOW");
    await assert.rejects(
      () => kernel.promoteMutation(SARA_PRINCIPAL, execution.mutation.id, "CANARY"),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "OWNER_REQUIRED",
    );
    assert.equal(
      (
        await kernel.promoteMutation(
          owner,
          execution.mutation.id,
          "CANARY",
          approval(`${execution.mutation.id}:CANARY`),
        )
      ).stage,
      "CANARY",
    );
  });

  it("does not treat false or unauthenticated owner evidence as owner-attested", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Reject forged evidence authority",
      expectedOwnerValue: 1,
      requiredCapabilities: [],
      acceptanceCriteria: ["Only the constitutional owner can attest evidence."],
      maximumBudgetUsd: 0,
    });
    const candidateDigest = sha256("forged-evidence-candidate");
    const mutation = await kernel.createMutation(SARA_PRINCIPAL, {
      jobId: job.id,
      summary: "Authority classification probe",
      candidateDigest,
    });
    for (const impostor of [
      { id: "not-the-owner", kind: "owner", authenticated: true },
      { id: "OWNER", kind: "owner", authenticated: false },
    ] as Principal[]) {
      const evidence = await kernel.recordMutationEvidence(impostor, mutation.id, {
        command: "false-owner-claim",
        exitCode: 0,
        outputDigest: sha256(impostor.id + String(impostor.authenticated)),
        candidateDigest,
        observedAt: "2026-09-01T00:00:00.000Z",
      });
      assert.equal(evidence.attestation, "candidate_self_attested");
    }
  });

  it("rejects promotion after a verified Genome Lab artifact is changed", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Produce a candidate whose exact bytes remain bound to evidence",
      expectedOwnerValue: 1,
      requiredCapabilities: [],
      acceptanceCriteria: ["Changed candidate bytes cannot be promoted."],
      maximumBudgetUsd: 0,
    });
    const execution = await kernel.executeDeterministicSkillScaffold(SARA_PRINCIPAL, job.id);
    const skillPath = join(stateDirectory, execution.artifactRelativePath, "skill.ts");
    await writeFile(skillPath, `${await readFile(skillPath, "utf8")}\n// changed after verification\n`);
    await assert.rejects(
      () => kernel.promoteMutation(SARA_PRINCIPAL, execution.mutation.id, "SHADOW"),
      /no longer matches its verified candidate digest/,
    );
  });

  it("binds every file in the Genome Lab artifact tree before production", async () => {
    const stateDirectory = await tempState();
    const kernel = await SaraKernel.boot({ stateDirectory });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Reject unverified files added to an otherwise verified candidate",
      expectedOwnerValue: 1,
      requiredCapabilities: [],
      acceptanceCriteria: ["Every artifact path and byte is digest-bound."],
      maximumBudgetUsd: 0,
    });
    const execution = await kernel.executeDeterministicSkillScaffold(SARA_PRINCIPAL, job.id);
    await kernel.promoteMutation(SARA_PRINCIPAL, execution.mutation.id, "SHADOW");
    await writeFile(
      join(stateDirectory, execution.artifactRelativePath, "unbound-production-file.ts"),
      "export const bypass = true;\n",
    );
    await assert.rejects(
      () =>
        kernel.promoteMutation(
          owner,
          execution.mutation.id,
          "CANARY",
          approval(`${execution.mutation.id}:CANARY`),
        ),
      /no longer matches its verified candidate digest/,
    );
  });

  it("freezes internal mutations and new spending during emergency stop", async () => {
    const kernel = await SaraKernel.boot({ stateDirectory: await tempState() });
    await kernel.setEmergencyStop(owner, true);
    await kernel.recordMemory(SARA_PRINCIPAL, {
      category: "failure",
      statement: "Emergency stop engaged; preserve recovery evidence.",
      source: "kernel-emergency-stop",
      observedAt: "2026-09-01T00:00:00.000Z",
      confidence: 1,
      verification: "measured",
      scope: "recovery",
      dependencies: [],
      lastValidatedAt: "2026-09-01T00:00:00.000Z",
    });
    await assert.rejects(
      () =>
        kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
          objective: "Must remain frozen",
          expectedOwnerValue: 1,
          requiredCapabilities: [],
          acceptanceCriteria: ["No job is created."],
          maximumBudgetUsd: 0,
        }),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "EMERGENCY_STOP",
    );
    await assert.rejects(
      () =>
        kernel.recordLedgerEntry(owner, {
          kind: "core_operation",
          source: "owner",
          amountUsd: 1,
          realized: false,
          recurringMonthly: true,
          description: "Must remain frozen",
          occurredAt: "2026-09-01T00:00:00.000Z",
        }),
      (error: unknown) => error instanceof PolicyDeniedError && error.decision.code === "EMERGENCY_STOP",
    );
    assert.equal((await kernel.getStatus()).jobs.length, 0);
    assert.equal((await kernel.getStatus()).ownerFundedRecurringMonthlyUsd, 0);
    assert.equal((await kernel.getStatus()).memoryCount, 37);
    await kernel.setEmergencyStop(owner, false);
    assert.equal((await kernel.getStatus()).emergencyStopped, false);
  });
});
