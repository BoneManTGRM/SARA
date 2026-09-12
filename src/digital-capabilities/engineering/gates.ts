import { assessEvidence } from "../evidence.ts";
import type { ExecutionContext, ExecutionOutput, Provenance } from "../types.ts";
import { data, evidenceById, identityFromInput, requireUnique, rows, strings, suppliedAnalysis, unique, verifyEvidence, type Data } from "./common.ts";

export function selectMinimalFix(input: Data): ExecutionOutput {
  const candidates = rows(input.candidates!); requireUnique(candidates, "id");
  const required = unique(strings(input.requiredCriteria!)), levels: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const evaluated = candidates.map(candidate => ({ id: candidate.id!, missingCriteria: required.filter(criterion => !strings(candidate.criteria!).includes(criterion)),
    rootCauseAddressedReported: candidate.addressesRootCause!, risk: candidate.risk!, pathCount: unique(strings(candidate.paths!)).length,
    estimatedCashMicroUsd: candidate.estimatedCashMicroUsd! }));
  const eligible = evaluated.filter(candidate => candidate.rootCauseAddressedReported === true && !candidate.missingCriteria.length && required.length)
    .sort((a, b) => levels[String(a.risk)]! - levels[String(b.risk)]! || a.pathCount - b.pathCount || Number(a.estimatedCashMicroUsd) - Number(b.estimatedCashMicroUsd) || String(a.id).localeCompare(String(b.id)));
  return suppliedAnalysis({ status: eligible.length ? "READY" : "INCOMPLETE_EVIDENCE", selectedId: eligible[0]?.id ?? null,
    candidates: evaluated, verifiedFix: false, selectionBasis: "First require declared root-cause coverage and all criteria; then compare risk, affected paths and supplied cash cost. Actual verification is still required." });
}
const releaseCategories = ["CI", "SECURITY", "QUALIFICATION", "CONFIGURATION", "MIGRATION", "DEPLOYMENT", "ARTIFACT", "ROLLBACK"];
export function gateRelease(input: Data, context: ExecutionContext): ExecutionOutput {
  const requirements = rows(input.requirements!), artifacts = rows(input.artifacts!); requireUnique(requirements, "id"); requireUnique(artifacts, "id");
  const missingCategories = releaseCategories.filter(category => !requirements.some(item => item.category === category));
  const checks = requirements.map(requirement => {
    const provenance = String(requirement.provenance) as Provenance;
    const disallowedGrade = provenance === "SUPPLIED" || provenance === "OWNER_OBSERVED" || provenance === "EXTERNAL_READ_ONLY" || requirement.category === "CI" && provenance !== "CI";
    const verification = verifyEvidence(context, strings(input.proofIds!), { provenance, claim: String(requirement.claim), identity: { sourceRevision: String(input.revision) } });
    return { id: requirement.id!, category: requirement.category!, passed: !disallowedGrade && verification.passed,
      reason: disallowedGrade ? "UNACCEPTABLE_PROVENANCE_FOR_RELEASE_CRITERION" : verification.passed ? "EXACT_SUBJECT_AND_CLAIM" : "MATCHING_TRUSTED_EVIDENCE_MISSING", evidence: verification.inspected };
  });
  const badArtifacts = artifacts.filter(item => item.expectedDigest !== item.observedDigest).map(item => item.id!);
  const blocked = strings(input.blockers!).length > 0 || badArtifacts.length > 0;
  const status = blocked ? "BLOCKED" : missingCategories.length || !requirements.length || checks.some(check => !check.passed) || !artifacts.length ? "INCOMPLETE_EVIDENCE" : "READY";
  const result = suppliedAnalysis({ status, revision: input.revision!, blockers: input.blockers!, missingCategories, checks,
    mismatchedArtifactIds: badArtifacts, artifactComparisonBasis: "SUPPLIED_DIGESTS_REQUIRE_TRUSTED_ARTIFACT_CRITERION", deploymentAuthorized: false });
  return { ...result, status: status === "READY" ? "SUCCEEDED" : status };
}
export function validateProductionProof(input: Data, context: ExecutionContext): ExecutionOutput {
  const result = verifyEvidence(context, strings(input.proofIds!), { provenance: "PRODUCTION", claim: String(input.behavior),
    identity: { deploymentSha: String(input.deploymentSha), deploymentId: String(input.deploymentId) } });
  const status = result.passed ? "READY" : "INCOMPLETE_EVIDENCE";
  return { ...suppliedAnalysis({ status, deploymentSha: input.deploymentSha!, deploymentId: input.deploymentId!, behavior: input.behavior!,
    productionBehaviorProven: result.passed, evidence: result.inspected, deploymentSuccessAloneSufficient: false }),
    status: result.passed ? "SUCCEEDED" : "INCOMPLETE_EVIDENCE" };
}
export function detectStaleEvidence(input: Data, context: ExecutionContext): ExecutionOutput {
  const currentIdentity = { ...context.currentIdentity, ...identityFromInput(input.currentIdentity!) };
  const evidence = unique(strings(input.proofIds!)).map(id => {
    const record = evidenceById(context, id);
    if (!record) return { id, status: "MISSING", reasons: ["EVIDENCE_NOT_IN_TRUSTED_CONTEXT"], invalidations: [] };
    const result = assessEvidence({ record, requiredProvenance: [record.provenance], requiredClaims: [], currentIdentity });
    return { id, ...result };
  });
  const status = evidence.some(item => item.status === "STALE") ? "STALE" : !evidence.length || evidence.some(item => item.status !== "VALID") ? "INCOMPLETE_EVIDENCE" : "CURRENT";
  return suppliedAnalysis({ status, evidence, reusableIds: evidence.filter(item => item.status === "VALID").map(item => item.id),
    rule: "Only dependencies bound to the original proof invalidate it. Unrelated changed fields do not invalidate historical evidence." });
}
export function planRollback(input: Data, context: ExecutionContext): ExecutionOutput {
  const prerequisites = ["retained-immutable-previous-revision", "authorized-rollback-target", "post-rollback-health-check"];
  if (input.dataChanged) prerequisites.push("verified-pre-migration-backup", "reader-writer-compatibility", "recovery-point-review");
  const verification = verifyEvidence(context, strings(input.proofIds!), { provenance: "ISOLATED", claim: `rollback:${input.previousRevision}`, identity: { sourceRevision: String(input.revision) } });
  const missing = input.dataChanged && input.backupId === null;
  const steps = [
    { order: 1, action: "Freeze the release identity and retain current diagnostics; avoid duplicate deploys.", targetRevision: input.revision! },
    { order: 2, action: input.dataChanged ? "Prove backup recovery and compatible readers/writers on an isolated copy before touching live data." : "Verify that the retained previous build is available and configuration-compatible.", targetRevision: input.previousRevision! },
    { order: 3, action: "Use the existing exact-authority deployment path to restore the retained immutable revision only after authorization.", targetRevision: input.previousRevision! },
    { order: 4, action: "Independently check serving identity, representative behavior, state integrity, accounting and protected routes.", targetRevision: input.previousRevision! },
  ];
  return suppliedAnalysis({ status: verification.passed && !missing ? "READY" : "INCOMPLETE_EVIDENCE", revision: input.revision!, previousRevision: input.previousRevision!,
    target: input.target!, prerequisites, steps, rollbackVerified: verification.passed && !missing, executionAuthorized: false,
    backupIdentityAvailable: input.backupId !== null }, ["A recovery plan is not verified rollback until a matching isolated execution proof is present."]);
}
