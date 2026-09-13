import { canonicalJson, sha256 } from './canonical.ts';
import type { WorkRecord } from './owner-work.ts';
import { validateSchema } from './digital-capabilities/schema.ts';
import type { CapabilityContract, CapabilityResult } from './digital-capabilities/types.ts';

const softwareResources = ['anonymous-public-GitHub-GET', 'credential-free-isolated-browser', 'existing-durable-receipts'];
const ceilings: Record<string, { effect: string; authority: string; resources: string[] }> = {
  'goal-to-work-queue-compiler': { effect: 'DRAFT_ONLY', authority: 'DRAFT_ONLY', resources: ['supplied-input', 'kernel-read-only-projection'] },
  'solution-reuse-ranker': { effect: 'READ_ONLY', authority: 'READ_ONLY', resources: ['existing-PR166-procedural-store', 'actor-visible-kernel-evidence-receipts'] },
  'software-source-inspector': { effect: 'READ_ONLY', authority: 'READ_ONLY', resources: softwareResources },
  'software-journey-tester': { effect: 'INTERNAL_STATE', authority: 'REVERSIBLE_AUTHORIZED', resources: softwareResources },
  'software-evidence-reviewer': { effect: 'PURE', authority: 'READ_ONLY', resources: softwareResources },
};
export type SoftwareWorkReauthorization = {
  record: WorkRecord; previousPlanDigest: string; currentPlanDigest: string; authorityContextDigest: string;
  proofDisposition: 'LEGACY_COARSE_IDENTITY_REEVALUATED';
  limitation: string;
  steps: { requestId: string; capabilityId: string; oldContractDigest: string; newContractDigest: string; priorResultDigest: string | null }[];
};

/** Fresh exact owner admission to the same reviewed read/isolated-test recipe.
 * This does not assert binary compatibility or upgrade any historical receipt. */
export function reauthorizeSoftwareWork(record: WorkRecord, contracts: CapabilityContract[], receipts: CapabilityResult[], authorityContextDigest: string): SoftwareWorkReauthorization {
  if (record.workflow !== 'software-inspection' || !record.plan || !record.softwareTarget) throw new Error('SOFTWARE_REAUTHORIZATION_SCOPE_REQUIRED');
  const expected = ['goal-to-work-queue-compiler', 'solution-reuse-ranker', 'software-source-inspector', ...(record.softwareTarget.scope === 'JOURNEY_TEST' ? ['software-journey-tester'] : []), 'software-evidence-reviewer'];
  if (canonicalJson(record.plan.steps.map(step => step.capabilityId)) !== canonicalJson(expected)) throw new Error('SOFTWARE_REAUTHORIZATION_RECIPE_CHANGED');
  const compilerInput = record.plan.steps[0]!.input as { tasks?: { capabilityId?: string; authorityClass?: string }[] };
  if (!Array.isArray(compilerInput.tasks) || record.plan.steps.slice(1).some(step => compilerInput.tasks!.find(task => task.capabilityId === step.capabilityId)?.authorityClass !== ceilings[step.capabilityId]!.authority)) throw new Error('SOFTWARE_REAUTHORIZATION_PLANNED_AUTHORITY_CHANGED');
  if (receipts.some(receipt => receipt.authority.contextDigest !== authorityContextDigest)) throw new Error('SOFTWARE_REAUTHORIZATION_AUTHORITY_CHANGED');
  const refreshed = structuredClone(record), steps: SoftwareWorkReauthorization['steps'] = [];
  for (const step of refreshed.plan!.steps) {
    const contract = contracts.find(item => item.id === step.capabilityId), ceiling = ceilings[step.capabilityId]!;
    if (!contract || contract.status !== 'ENABLED' || contract.qualification.status !== 'PASSED' || contract.effect !== ceiling.effect || contract.authorityClass !== ceiling.authority || contract.budget.class !== 'ZERO_CASH' || contract.budget.maximumCashMicroUsd !== 0 || contract.allowedResources.some(resource => !ceiling.resources.includes(resource)) || canonicalJson(contract.requiredAuthorities) !== canonicalJson(['authenticated-owner-or-trusted-internal-invocation'])) throw new Error('SOFTWARE_REAUTHORIZATION_CURRENT_BOUNDARY_REQUIRED');
    validateSchema(contract.inputSchema, step.input);
    const requestId = `plan-${sha256(canonicalJson({ planId: record.plan.id, version: record.plan.version, stepId: step.id }))}`;
    const previous = receipts.find(receipt => receipt.requestId === requestId);
    if (previous && previous.authority.required !== contract.authorityClass) throw new Error('SOFTWARE_REAUTHORIZATION_AUTHORITY_CHANGED');
    steps.push({ requestId, capabilityId: step.capabilityId, oldContractDigest: step.contractDigest, newContractDigest: contract.contractDigest, priorResultDigest: previous?.resultDigest ?? null });
    step.contractDigest = contract.contractDigest;
  }
  return { record: refreshed, previousPlanDigest: sha256(canonicalJson(record.plan)), currentPlanDigest: sha256(canonicalJson(refreshed.plan)), authorityContextDigest, steps, proofDisposition: 'LEGACY_COARSE_IDENTITY_REEVALUATED', limitation: 'Historical coarse implementation identities cannot establish unchanged source-policy compatibility. Affected steps are evaluated again; original source evidence and failures remain historical, never relabeled as current proof.' };
}
