import { canonicalJson, sha256 } from "../../canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../../kernel.ts";
import { engineeringCases } from "./qualification.ts";
import type { Json } from "../schema.ts";
import type { CapabilityResult } from "../types.ts";

/** Startup-only harmless computation probes. Neither environment labels nor results grant an execution capability. */
export async function runSafeEngineeringRuntimeProof(input: {
  kernel: SaraKernel; sourceRevision: string; deploymentId: string; environment: "ISOLATED" | "PRODUCTION";
}) {
  if (!/^[a-f0-9]{40}$/u.test(input.sourceRevision) || !/^[A-Za-z0-9-]{8,128}$/u.test(input.deploymentId) || !["ISOLATED", "PRODUCTION"].includes(input.environment)) throw new Error("INVALID_TRUSTED_RUNTIME_IDENTITY");
  const { kernel } = input, before = await kernel.getStatus(), beforeAudit = await kernel.inspectAudit();
  const contracts = await kernel.inspectCapabilityContracts();
  const ids = Object.keys(engineeringCases).sort();
  const identity = sha256(canonicalJson({ sourceRevision: input.sourceRevision, deploymentId: input.deploymentId,
    contracts: contracts.filter(contract => ids.includes(contract.id)).map(contract => ({ id: contract.id, digest: contract.contractDigest })),
    constitution: before.constitution.digest, mandate: before.standingMandate, stop: before.emergencyStopped,
    stopEpoch: beforeAudit.filter(event => event.type === "emergency_stop_changed").at(-1)?.hash ?? null,
  })).slice(0, 24);
  const receipts: CapabilityResult[] = [];
  for (const id of ids) receipts.push(await kernel.invokeCapability(SARA_PRINCIPAL, {
    requestId: `engineering-runtime:${identity}:${id}`,
    capabilityId: id, input: engineeringCases[id]![0]!.input,
  }));
  const outputs = new Map(receipts.map(receipt => [receipt.capability.id, receipt.output as Record<string, Json>]));
  // Contract-level expectations are explicit here rather than trusting a producer's success flag.
  const behaviorChecks: Record<string, boolean> = {
    ciRoot: outputs.get("ci-failure-triage")?.category === "DEPENDENCY",
    incidentUncertainty: outputs.get("incident-log-triage")?.causalOrderEstablished === false,
    reproductionIsolated: outputs.get("bug-reproduction-planner")?.reproductionTarget === "ISOLATED_COPY",
    rootCauseNotInvented: outputs.get("root-cause-analyzer")?.rootCauseEstablished === false,
    impactUnknownRetained: (outputs.get("repository-change-impact-analyzer")?.unknownPaths as Json[] | undefined)?.includes("unknown.ts") === true,
    regressionNotInvented: outputs.get("regression-surface-mapper")?.regressionProven === false,
    missingDenialTestFound: (outputs.get("test-gap-mapper")?.gaps as Json[] | undefined)?.length === 1,
    authorizationRiskFound: (outputs.get("pull-request-risk-review")?.requiredVerification as Json[] | undefined)?.includes("authorization-denial") === true,
    dependencyRuntimeBlocked: outputs.get("dependency-change-risk-triage")?.status === "BLOCKED",
    configMissingDetected: outputs.get("configuration-drift-detector")?.status === "DRIFT_DETECTED",
    destructiveMigrationBlocked: outputs.get("database-migration-risk-review")?.status === "BLOCKED",
    cyclicRolloutBlocked: outputs.get("cross-repository-change-coordinator")?.status === "BLOCKED",
    wrongMinimalFixRejected: outputs.get("minimal-fix-selector")?.selectedId === null,
    absentReleaseProofRejected: outputs.get("release-readiness-gate")?.status === "INCOMPLETE_EVIDENCE",
    absentProductionProofRejected: outputs.get("production-proof-validator")?.productionBehaviorProven === false,
    absentEvidenceNotReused: outputs.get("stale-evidence-detector")?.status === "INCOMPLETE_EVIDENCE",
    unprovenRollbackNotVerified: outputs.get("rollback-plan-generator")?.rollbackVerified === false,
  };
  const after = await kernel.getStatus(), afterAudit = await kernel.inspectAudit();
  const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  const checks = {
    ...behaviorChecks,
    allRegistered: ids.length === 17 && ids.every(id => contracts.some(contract => contract.id === id && contract.qualification.status === "PASSED")),
    allCurrent: receipts.every(receipt => receipt.status !== "INVALID_INPUT" && receipt.receiptValidity?.current !== false),
    noExternalAuthority: receipts.every(receipt => !receipt.authority.authorizationTokenIssued),
    zeroModelAndExternalCash: receipts.every(receipt => receipt.cost.modelApiMicroUsd === 0 && receipt.cost.actualCashMicroUsd === 0),
    auditPrefixPreserved: equal(beforeAudit, afterAudit.slice(0, beforeAudit.length)),
    onlyAnalysisReceiptsAppended: afterAudit.slice(beforeAudit.length).every(event => event.type === "digital_capability_executed"),
    constitutionPreserved: equal(before.constitution, after.constitution),
    emergencyStopPreserved: before.emergencyStopped === after.emergencyStopped,
    mandatePreserved: equal(before.standingMandate, after.standingMandate),
    financialStatePreserved: equal(before.realizedProfit, after.realizedProfit) && before.ownerFundedRecurringMonthlyUsd === after.ownerFundedRecurringMonthlyUsd && before.reservedSelfDevelopmentBudgetUsd === after.reservedSelfDevelopmentBudgetUsd,
    learningAndMemoryPreserved: equal(before.learning, after.learning) && equal(before.mutations, after.mutations) && before.memoryCount === after.memoryCount,
  };
  const verified = Object.values(checks).every(Boolean);
  return { schemaVersion: 1, status: verified ? "VERIFIED" : "NOT_VERIFIED", provenance: input.environment,
    sourceRevision: input.sourceRevision, deploymentId: input.deploymentId, productionBehaviorClaimed: verified && input.environment === "PRODUCTION",
    scope: "Seventeen actual-runtime deterministic synthetic analysis and denial probes only; no real customer work, deployment, SQL, outbound call, NICO approval or external executor success is claimed.",
    capabilityCount: ids.length, checks, receiptDigests: receipts.map(receipt => receipt.resultDigest), authorityDelta: 0,
    cost: { modelApiMicroUsd: 0, externalCashMicroUsd: 0 }, audit: { beforeCount: beforeAudit.length, afterCount: afterAudit.length, headHash: afterAudit.at(-1)?.hash ?? null } };
}
