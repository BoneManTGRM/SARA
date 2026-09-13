import { buildOwnerIsolatedRepairInput, runIsolatedSoftwareRepair } from '../../isolated-software-repair.ts';
import { arraySchema as a, objectSchema as o, textSchema as t, enumSchema as e, digestSchema, snapshotJson, type Json } from '../schema.ts';
import { shaSchema, bool } from './common.ts';
import type { CapabilityDefinition, ExecutionContext, ExecutionOutput } from '../types.ts';

const inputSchema = o({ revision: shaSchema, files: a(o({ path: t(256), content: t(8192) }), 8, 1) });
const outputSchema = o({ analysisComplete: bool, executionPerformed: bool, provenance: e('LOCAL', 'ISOLATED'), sourceProvenance: e('SUPPLIED'), synthetic: bool, revision: shaSchema, qualified: bool, result: e('BLOCKED', 'SOURCE_REJECTED', 'VERIFIED_ISOLATED_REPAIR', 'NO_BEHAVIORAL_FAILURE', 'INCOMPLETE_EVIDENCE', 'NO_VERIFIED_CANDIDATE'), summary: t(2048), evidence: { type: 'json' }, evidenceDigests: a(digestSchema, 64) });
const frozenInput = { revision: 'a'.repeat(40), files: [{ path: 'src/index.ts', content: 'export const value = 1;' }] };

async function repair(input: Record<string, Json>, context: ExecutionContext): Promise<ExecutionOutput> {
  const base = { analysisComplete: true, executionPerformed: false, provenance: 'LOCAL', sourceProvenance: 'SUPPLIED', synthetic: true, revision: input.revision!, qualified: false, evidence: null, evidenceDigests: [] };
  if (!context.isolatedRepairAuthorized || context.emergencyStopped || !context.isolatedRepairGuard) return {
    status: 'BLOCKED', output: { ...base, result: 'BLOCKED', summary: context.emergencyStopped ? 'EMERGENCY_STOP: isolated repair execution was not started.' : 'EXACT_OWNER_REPAIR_REQUEST_REQUIRED: this isolated repair needs authenticated admission and a current eligibility guard.' },
  };
  let admitted: ReturnType<typeof buildOwnerIsolatedRepairInput>;
  try { admitted = buildOwnerIsolatedRepairInput({ revision: String(input.revision), files: input.files as { path: string; content: string }[], constitutionDigest: context.constitutionDigest }); }
  catch (error) {
    const code = error instanceof Error && /^ISOLATED_REPAIR_[A-Z_]+$/u.test(error.message) ? error.message : 'ISOLATED_REPAIR_INVALID_INPUT';
    return { output: { ...base, result: 'SOURCE_REJECTED', summary: `The supplied files do not match the reviewed SYNTHETIC isolated movement-comparator profile (${code}). No repair ran. Supply the exact prepared fixture and revision; general application repair is not qualified.` } };
  }
  const result = await runIsolatedSoftwareRepair(admitted, { beforeStep: async () => { await context.isolatedRepairGuard!(); } });
  const evidence = snapshotJson(result);
  const executed = result.baselineVerification?.completedChecks.includes('behavior_tests') === true;
  const summary = result.qualified
    ? 'SARA prepared and verified a one-token repair for the SYNTHETIC isolated movement comparator. The unchanged regression and independent held-out tests pass; restoring the seeded source fails again. The exact patch and source hashes are available in the receipt. No live application was changed. Recorded provider/model cash is $0; infrastructure allocation is unknown.'
    : result.status === 'NO_BEHAVIORAL_FAILURE'
      ? 'The supplied isolated movement comparator passed the frozen regression. No defect was reproduced and no repair was prepared. This is not whole-application assurance. Recorded provider/model cash is $0; infrastructure allocation is unknown.'
      : result.eligibilityStopCode
        ? `The isolated repair stopped before ${result.interruptedAtStep} (${result.eligibilityStopCode}). Completed verification evidence is retained; no candidate is released. Recorded provider/model cash is $0; infrastructure allocation is unknown.`
        : 'The isolated comparator repair remains unqualified. Review baseline, candidate and independent verification evidence; a generic runner failure alone is not an established defect. No live application was changed. Recorded provider/model cash is $0; infrastructure allocation is unknown.';
  const evidenceDigests = [...new Set([result.baselineArtifactDigest, result.regressionSha256, result.heldOutRegressionSha256, ...result.attempts.map(attempt => attempt.proposalDigest), ...[result.baselineVerification, result.independentVerification, result.restoredBaselineVerification].flatMap(verification => verification?.evidenceDigests ?? []), ...(result.verifiedCandidateDigest ? [result.verifiedCandidateDigest] : []), ...(result.patchSha256 ? [result.patchSha256] : [])])];
  return {
    output: { ...base, executionPerformed: executed, provenance: executed ? 'ISOLATED' : 'LOCAL', qualified: result.qualified, result: result.status, summary, evidence, evidenceDigests },
    observed: [{ basis: 'SYNTHETIC_ISOLATED_REPAIR', sourceProvenance: 'SUPPLIED', artifactDigest: result.baselineArtifactDigest, candidateDigest: result.verifiedCandidateDigest, result: result.status, qualified: result.qualified }],
    unknowns: ['The source revision is supplied fixture provenance, not independently fetched production state.', 'Only the reviewed isolated comparator profile is qualified; live application behavior, integration, customer work and revenue are not established.', 'Recorded workflow/provider/model cash excludes unresolved infrastructure allocation.'],
  };
}

export const isolatedRepairDefinition: CapabilityDefinition = {
  id: 'isolated-defect-repairer', version: '1.0.0',
  description: 'Prepare a bounded deterministic repair for an exactly owner-admitted synthetic movement fixture, preserving regression and independent causal verification.',
  inputSchema, outputSchema, effect: 'INTERNAL_STATE', authorityClass: 'REVERSIBLE_AUTHORIZED',
  resources: ['supplied-reviewed-synthetic-typescript-fixture', 'existing-permission-restricted-genome-lab-runtime', 'existing-durable-capability-receipt'],
  sourceFiles: ['engineering/repair.ts', '../isolated-software-repair.ts', '../owner-defect-work.ts', '../genome-lab.ts', '../genome-lab-verifier.ts', '../coding-repair-prompt.ts', '../coding-repair-artifacts.ts', '../coding-repair-types.ts', '../types.ts', '../experimental-compiler-cache.ts'],
  qualificationRequirements: ['exact-authenticated-owner-repair-admission', 'closed-reviewed-synthetic-profile', 'unchanged-regression-and-protected-dependencies', 'zero-model-dispatch', 'actual-isolated-causal-control', 'fresh-independent-held-out-verification', 'current-eligibility-before-each-child', 'durable-replay-restart', 'authenticated-owner-runtime-acceptance'],
  execute: repair,
  cases: [
    { name: 'no-owner-no-repair', input: frozenInput, check: result => result.status === 'BLOCKED' && (result.output as Record<string, Json>).executionPerformed === false },
    { name: 'stop-no-repair', input: frozenInput, context: { isolatedRepairAuthorized: true, emergencyStopped: true, isolatedRepairGuard: async () => undefined }, check: result => result.status === 'BLOCKED' && (result.output as Record<string, Json>).qualified === false },
    { name: 'missing-current-guard-no-repair', input: frozenInput, context: { isolatedRepairAuthorized: true }, check: result => result.status === 'BLOCKED' },
    { name: 'unreviewed-profile-rejected', input: frozenInput, context: { isolatedRepairAuthorized: true, isolatedRepairGuard: async () => undefined }, check: result => (result.output as Record<string, Json>).result === 'SOURCE_REJECTED' && (result.output as Record<string, Json>).executionPerformed === false },
  ],
};
