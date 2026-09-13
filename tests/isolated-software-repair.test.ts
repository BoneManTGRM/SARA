import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, sha256 } from '../src/canonical.ts';
import { runIsolatedSoftwareRepair, assertIsolatedRepairInput, FROZEN_MOVEMENT_REGRESSION, enumerateIsolatedComparatorProposals, buildOwnerIsolatedRepairInput } from '../src/isolated-software-repair.ts';
import { nicosSeededMovementFixture } from './fixtures/nicos-seeded-movement.ts';

test('runtime repairs seeded comparator with unchanged tests, independent holdouts and restored RED', { timeout: 90_000 }, async () => {
  const input = nicosSeededMovementFixture();
  const originalInput = canonicalJson(input);
  const steps: string[] = [];
  const result = await runIsolatedSoftwareRepair(input, { beforeStep: step => { steps.push(step); } });
  assert.equal(result.status, 'VERIFIED_ISOLATED_REPAIR');
  assert.equal(result.qualified, true); assert.equal(result.comparisonHypothesis.status, 'SUPPORTED_BY_CAUSAL_CONTROL');
  assert.equal(result.synthetic, true); assert.equal(result.provenance, 'ISOLATED');
  assert.equal(result.actor, 'SARA_RUNTIME');
  assert.equal(result.modelCalls, 0); assert.equal(result.providerCashUsd, 0);
  assert.equal(result.infrastructureAllocation, 'UNKNOWN');
  assert.equal(result.authorityGranted, false); assert.equal(result.productionChanged, false);
  assert.equal(result.baselineVerification?.passed, false);
  assert.equal(result.independentVerification?.passed, true);
  assert.equal(result.restoredBaselineVerification?.passed, false);
  assert.equal(result.restoredBaselineVerification?.artifactDigest, result.baselineVerification?.artifactDigest);
  assert.equal(result.causalControlEstablished, true);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts.filter(x => x.verification.passed).length, 1);
  assert.equal(result.regressionSha256, sha256(FROZEN_MOVEMENT_REGRESSION));
  assert.equal(result.candidate?.files.find(x => x.path === 'tests/route.test.ts')?.content, FROZEN_MOVEMENT_REGRESSION);
  assert.equal(result.candidate?.files.find(x => x.path === 'src/route.ts')?.content.includes('action.command !== expected'), true);
  assert.match(result.patch ?? '', /--- a\/src\/route.ts\n\+\+\+ b\/src\/route.ts/u);
  assert.equal(canonicalJson(input), originalInput);
  assert.deepEqual(steps, ['baseline', 'candidate-1', 'candidate-2', 'candidate-3', 'independent-verification', 'restored-baseline']);
});

test('passing original comparator produces no invented defect or repair', { timeout: 30_000 }, async () => {
  const input = nicosSeededMovementFixture();
  input.candidate.files.find(x => x.path === 'src/route.ts')!.content = input.candidate.files.find(x => x.path === 'src/route.ts')!.content.replace('action.command === expected', 'action.command !== expected');
  const result = await runIsolatedSoftwareRepair(input);
  assert.equal(result.status, 'NO_BEHAVIORAL_FAILURE');
  assert.equal(result.attempts.length, 0); assert.equal(result.candidate, null); assert.equal(result.patch, null);
  assert.equal(result.baselineVerification?.passed, true);
});

test('admission rejects non-isolated scope, test tampering, source injection and extra editable targets', () => {
  for (const change of [
    (x: ReturnType<typeof nicosSeededMovementFixture>) => { x.synthetic = false as true; },
    (x: ReturnType<typeof nicosSeededMovementFixture>) => { x.editablePaths.push('src/constants.ts'); },
    (x: ReturnType<typeof nicosSeededMovementFixture>) => { x.candidate.files.find(f => f.path.startsWith('tests/'))!.content += '\nexport const bypass = true;'; },
    (x: ReturnType<typeof nicosSeededMovementFixture>) => { x.candidate.files.find(f => f.path === 'src/route.ts')!.content += '\nconsole.log("forged verification");'; },
    (x: ReturnType<typeof nicosSeededMovementFixture>) => { x.source.sha256 = '0'.repeat(64); },
  ]) { const input = nicosSeededMovementFixture(); change(input); assert.throws(() => assertIsolatedRepairInput(input), /ISOLATED_REPAIR_/); }
});

test('enumerator emits exactly three unique one-token proposals and never changes protected files', () => {
  const input = nicosSeededMovementFixture();
  const proposals = enumerateIsolatedComparatorProposals(input);
  assert.equal(proposals.length, 3);
  assert.equal(new Set(proposals.map(x => x.replacementText)).size, 3);
  for (const proposal of proposals) { assert.equal(proposal.path, 'src/route.ts'); assert.equal(proposal.changedLines, 1); assert.equal(proposal.beforeToken, '==='); assert.equal(proposal.afterToken, '!=='); }
});

test('current authority callback can cancel before any child verification', async () => {
  const result = await runIsolatedSoftwareRepair(nicosSeededMovementFixture(), { beforeStep: () => { throw new Error('EXERCISE_REVOKED'); } });
  assert.equal(result.qualified, false); assert.equal(result.status, 'INCOMPLETE_EVIDENCE');
  assert.equal(result.eligibilityStopCode, 'EXERCISE_REVOKED'); assert.equal(result.interruptedAtStep, 'baseline');
  assert.equal(result.baselineVerification, null); assert.equal(result.attempts.length, 0);
});

test('revocation between candidates retains completed baseline and failed attempt evidence', { timeout: 30_000 }, async () => {
  const result = await runIsolatedSoftwareRepair(nicosSeededMovementFixture(), { beforeStep: step => { if (step === 'candidate-2') throw new Error('CAPABILITY_QUARANTINED'); } });
  assert.equal(result.status, 'INCOMPLETE_EVIDENCE'); assert.equal(result.qualified, false);
  assert.equal(result.baselineVerification?.passed, false); assert.equal(result.attempts.length, 1);
  assert.equal(result.eligibilityStopCode, 'CAPABILITY_QUARANTINED'); assert.equal(result.interruptedAtStep, 'candidate-2');
  assert.equal(result.candidate, null); assert.equal(result.independentVerification, null);
});

test('existing owner revision and fenced files admit only the fixed synthetic profile', () => {
  const fixture = nicosSeededMovementFixture();
  const result = buildOwnerIsolatedRepairInput({ revision: fixture.source.revision, files: fixture.candidate.files, constitutionDigest: fixture.constitutionDigest });
  assert.deepEqual(result.candidate.files, fixture.candidate.files);
  assert.equal(result.synthetic, true); assert.equal(result.source.provenance, 'SUPPLIED');
  assert.throws(() => buildOwnerIsolatedRepairInput({ revision: 'b'.repeat(40), files: fixture.candidate.files, constitutionDigest: fixture.constitutionDigest }), /REVIEWED_SOURCE_IDENTITY_REQUIRED/);
  assert.throws(() => assertIsolatedRepairInput({ ...fixture, approved: true }), /CLOSED_INPUT_REQUIRED/);
  assert.throws(() => assertIsolatedRepairInput({ ...fixture, source: null }), /REVIEWED_SOURCE_IDENTITY_REQUIRED/);
});
