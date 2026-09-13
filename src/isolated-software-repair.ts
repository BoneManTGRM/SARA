/** Narrow deterministic repair algorithm, not a general repository executor.
 * Every accepted input/result is SYNTHETIC and ISOLATED. Kernel admission and
 * persistence remain the caller's responsibility; this module grants no authority. */
import * as ts from 'typescript';
import { canonicalJson, sha256 } from './canonical.ts';
import { snapshotJson } from './digital-capabilities/schema.ts';
import { assertBoundedProgramSource, validateProgramCandidateStructure } from './genome-lab.ts';
import { verifyGenomeLabProgramCandidate } from './genome-lab-verifier.ts';
import { validateCodingRepairProposal } from './coding-repair-prompt.ts';
import { digestCodingRepairProposal } from './coding-repair-artifacts.ts';
import type { CodingRepairLimits, CodingRepairProposal, ProgramVerificationResult } from './coding-repair-types.ts';
import type { ProgramCandidateProposal } from './types.ts';

export const ISOLATED_MOVEMENT_CONSTANTS = 'export type MovementCommand = "forward" | "left" | "right";\nexport const BOLT_BOT_MOVEMENT_SEQUENCE: readonly MovementCommand[] = ["forward", "right", "forward"];\n';
export const ISOLATED_MOVEMENT_ENTRY = "export { movementRouteReducer, newMovementRoute } from './route.ts';\n";
export const FROZEN_MOVEMENT_REGRESSION = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { movementRouteReducer, newMovementRoute } from '../src/route.ts';
import { BOLT_BOT_MOVEMENT_SEQUENCE } from '../src/constants.ts';
test('frozen exact movement route', () => {
  let state = newMovementRoute();
  for (const command of BOLT_BOT_MOVEMENT_SEQUENCE) state = movementRouteReducer(state, { type: 'move', command });
  assert.deepEqual(state.commands, ['forward', 'right', 'forward']);
  assert.equal(state.wrong, null);
});
test('frozen wrong-turn recovery retains progress', () => {
  let state = newMovementRoute();
  for (const command of ['forward', 'left', 'forward'] as const) state = movementRouteReducer(state, { type: 'move', command });
  assert.deepEqual(state.commands, ['forward']);
  assert.deepEqual(state.wrong, { received: 'forward', expected: 'right', step: 2 });
  for (const command of ['right', 'forward'] as const) state = movementRouteReducer(state, { type: 'move', command });
  assert.deepEqual(state.commands, ['forward', 'right', 'forward']);
});
test('frozen incorrect inputs at every step preserve the prefix', () => {
  let state = newMovementRoute();
  for (const command of BOLT_BOT_MOVEMENT_SEQUENCE) {
    const prior = state.commands;
    state = movementRouteReducer(state, { type: 'move', command: 'left' });
    assert.equal(state.commands, prior);
    assert.equal(state.wrong?.expected, command);
    state = movementRouteReducer(state, { type: 'move', command });
    assert.equal(state.wrong, null);
  }
});
test('frozen undo correction and reset', () => {
  let state = newMovementRoute();
  for (const command of BOLT_BOT_MOVEMENT_SEQUENCE) state = movementRouteReducer(state, { type: 'move', command });
  state = movementRouteReducer(state, { type: 'undo' });
  assert.deepEqual(state.commands, ['forward', 'right']);
  state = movementRouteReducer(state, { type: 'move', command: 'forward' });
  assert.deepEqual(state.commands, ['forward', 'right', 'forward']);
  state = movementRouteReducer(state, { type: 'reset' });
  assert.deepEqual(state, newMovementRoute());
  assert.deepEqual(movementRouteReducer(state, { type: 'undo' }), state);
});
test('frozen rapid input stops at completion', () => {
  let state = newMovementRoute();
  for (let i = 0; i < 100; i++) state = movementRouteReducer(state, { type: 'move', command: 'forward' });
  assert.deepEqual(state.commands, ['forward']);
  state = movementRouteReducer(state, { type: 'move', command: 'right' });
  for (let i = 0; i < 100; i++) state = movementRouteReducer(state, { type: 'move', command: 'forward' });
  assert.deepEqual(state.commands, ['forward', 'right', 'forward']);
  assert.equal(movementRouteReducer(state, { type: 'move', command: 'left' }), state);
});
`;

// This reference state model and its tests are not supplied to the proposal
// enumerator. Fresh verification adds them while preserving the frozen suite.
export const HELD_OUT_MOVEMENT_REGRESSION = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { movementRouteReducer, newMovementRoute } from '../src/route.ts';
import type { MovementCommand } from '../src/constants.ts';
test('independent bounded command sequence oracle', () => {
  const required: MovementCommand[] = ['forward', 'right', 'forward'];
  let frontier: MovementCommand[][] = [[]];
  for (let length = 0; length <= 4; length++) {
    for (const commands of frontier) {
      let state = newMovementRoute();
      let accepted = 0;
      for (const command of commands) {
        const prior = state;
        const expected = required.at(accepted);
        state = movementRouteReducer(state, { type: 'move', command });
        if (expected === undefined) assert.equal(state, prior);
        else if (command === expected) { accepted += 1; assert.equal(state.wrong, null); }
        else {
          assert.equal(state.commands, prior.commands);
          assert.deepEqual(state.wrong, { received: command, expected, step: accepted + 1 });
        }
        assert.deepEqual(state.commands, required.slice(0, accepted));
      }
      const undone = movementRouteReducer(state, { type: 'undo' });
      assert.deepEqual(undone.commands, required.slice(0, Math.max(0, accepted - 1)));
      assert.equal(undone.wrong, null);
      assert.deepEqual(movementRouteReducer(state, { type: 'reset' }), { commands: [], wrong: null });
    }
    const next: MovementCommand[][] = [];
    for (const prefix of frontier) for (const command of ['forward', 'left', 'right'] as const) next.push([...prefix, command]);
    frontier = next;
  }
});
`;

const SHAPE_DIGEST = 'ebd23d1f74efeddcc85fe3929ba510355175c81cc3359eaafe04917389c9d912';
const ORIGINAL_SOURCE_DIGEST = '189ded1d872ad290f2d71cdb829c62244126760520646770f27a859b89c70bdc';
const ADAPTED_SOURCE_DIGEST = '0a7099a5e25397a94f43fcdff22acd86bc470a5b310077c26597666e571399e1';
const REQUIRED_CHECKS = ['source_policy', 'syntax', 'typecheck', 'behavior_tests', 'artifact_integrity'] as const;
const ZERO_CASH_LIMITS: CodingRepairLimits = { maximumCycles: 3, surgicalFiles: 1, surgicalChangedLines: 1, deepFiles: 1, deepChangedLines: 1, maximumModelSpendUsd: 0, protectedPaths: ['tests/', 'src/index.ts', 'src/constants.ts'] };

export type IsolatedSoftwareRepairInput = {
  schemaVersion: 1;
  profile: 'nicos-seeded-comparator-v1';
  provenance: 'ISOLATED';
  synthetic: true;
  source: { provenance: 'SUPPLIED'; repository: string; revision: string; path: string; sha256: string; adaptedSha256: string; preparationActor: 'IMPLEMENTATION_AGENT' };
  candidate: ProgramCandidateProposal;
  editablePaths: string[];
  frozenRegression: { path: string; sha256: string };
  constitutionDigest: string;
};

type ComparatorProposal = { path: string; replacementText: string; changedLines: 1; beforeToken: string; afterToken: string; line: number; beforeLine: string; afterLine: string };
export type IsolatedSoftwareRepairResult = {
  schemaVersion: 1; actor: 'SARA_RUNTIME'; provenance: 'ISOLATED'; synthetic: true;
  profile: 'nicos-seeded-comparator-v1';
  status: 'VERIFIED_ISOLATED_REPAIR' | 'NO_BEHAVIORAL_FAILURE' | 'INCOMPLETE_EVIDENCE' | 'NO_VERIFIED_CANDIDATE';
  qualified: boolean;
  comparisonHypothesis: { status: 'UNCONFIRMED' | 'SUPPORTED_BY_CAUSAL_CONTROL'; statement: string };
  interruptedAtStep: string | null; eligibilityStopCode: string | null;
  inputDigest: string; source: IsolatedSoftwareRepairInput['source'];
  baselineArtifactDigest: string; baselineSourceSha256: string; regressionSha256: string;
  heldOutRegressionSha256: string;
  baselineVerification: ProgramVerificationResult | null;
  attempts: Array<{ index: number; proposalDigest: string; candidateArtifactDigest: string; changedPath: string; changedLines: 1; verification: ProgramVerificationResult }>;
  independentVerification: ProgramVerificationResult | null;
  restoredBaselineVerification: ProgramVerificationResult | null;
  causalControlEstablished: boolean;
  verifiedCandidateDigest: string | null; verifiedSourceDigests: Array<{ path: string; sha256: string }>;
  candidate: ProgramCandidateProposal | null; patch: string | null; patchSha256: string | null;
  authorityGranted: false; productionChanged: false; modelCalls: 0; providerCashUsd: 0; infrastructureAllocation: 'UNKNOWN';
  elapsedMilliseconds: number; limitations: string[];
};

function failure(code: string): never { throw new Error(`ISOLATED_REPAIR_${code}`); }
function hasExactKeys(value: unknown, keys: string[]): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()));
}
function fileDigests(candidate: ProgramCandidateProposal): Array<{ path: string; contentDigest: string }> {
  return candidate.files.map(file => ({ path: file.path, contentDigest: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path));
}
function artifactDigest(candidate: ProgramCandidateProposal): string { return sha256(canonicalJson({ schemaVersion: 1, files: fileDigests(candidate) })); }
function comparisonTokens(source: string): Array<{ start: number; end: number; line: number; text: string }> {
  const file = ts.createSourceFile('src/route.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const tokens: Array<{ start: number; end: number; line: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) tokens.push({ start: node.operatorToken.getStart(file), end: node.operatorToken.end, line: file.getLineAndCharacterOfPosition(node.operatorToken.getStart(file)).line + 1, text: node.operatorToken.getText(file) });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return tokens;
}

export function assertIsolatedRepairInput(input: unknown): IsolatedSoftwareRepairInput {
  let checked: IsolatedSoftwareRepairInput;
  try { checked = snapshotJson(input, 64 * 1024) as unknown as IsolatedSoftwareRepairInput; } catch { failure('PLAIN_BOUNDED_INPUT_REQUIRED'); }
  if (!hasExactKeys(checked, ['schemaVersion', 'profile', 'provenance', 'synthetic', 'source', 'candidate', 'editablePaths', 'frozenRegression', 'constitutionDigest'])) failure('CLOSED_INPUT_REQUIRED');
  if (!checked || checked.schemaVersion !== 1 || checked.profile !== 'nicos-seeded-comparator-v1' || checked.provenance !== 'ISOLATED' || checked.synthetic !== true || !/^[a-f0-9]{64}$/u.test(checked.constitutionDigest ?? '')) failure('EXACT_SYNTHETIC_SCOPE_REQUIRED');
  const source = checked.source;
  if (!hasExactKeys(source, ['provenance', 'repository', 'revision', 'path', 'sha256', 'adaptedSha256', 'preparationActor']) || source.provenance !== 'SUPPLIED' || source.repository !== 'BoneManTGRM/Nicos-Adventures' || source.revision !== 'ba0cab4a00664426848c34747f7377e59492f56a' || source.path !== 'web/src/game/boltBotRoute.ts' || source.sha256 !== ORIGINAL_SOURCE_DIGEST || source.adaptedSha256 !== ADAPTED_SOURCE_DIGEST || source.preparationActor !== 'IMPLEMENTATION_AGENT') failure('REVIEWED_SOURCE_IDENTITY_REQUIRED');
  if (!Array.isArray(checked.editablePaths) || canonicalJson(checked.editablePaths) !== canonicalJson(['src/route.ts'])) failure('EXACT_EDITABLE_PATH_REQUIRED');
  try { validateProgramCandidateStructure(checked.candidate); } catch { failure('INVALID_CANDIDATE'); }
  const candidate = checked.candidate;
  if (!hasExactKeys(candidate, ['schemaVersion', 'candidateKind', 'programName', 'summary', 'files', 'limitations']) || candidate.files.some(file => !hasExactKeys(file, ['path', 'content']))) failure('CLOSED_CANDIDATE_REQUIRED');
  if (candidate.candidateKind !== 'typescript_program' || candidate.files.length !== 4 || candidate.files.some(file => !['src/index.ts', 'src/constants.ts', 'src/route.ts', 'tests/route.test.ts'].includes(file.path))) failure('EXACT_FIXTURE_FILES_REQUIRED');
  if (candidate.files.find(file => file.path === 'src/index.ts')?.content !== ISOLATED_MOVEMENT_ENTRY || candidate.files.find(file => file.path === 'src/constants.ts')?.content !== ISOLATED_MOVEMENT_CONSTANTS || candidate.files.find(file => file.path === 'tests/route.test.ts')?.content !== FROZEN_MOVEMENT_REGRESSION) failure('PROTECTED_SOURCE_OR_TEST_CHANGED');
  if (!hasExactKeys(checked.frozenRegression, ['path', 'sha256']) || checked.frozenRegression.path !== 'tests/route.test.ts' || checked.frozenRegression.sha256 !== sha256(FROZEN_MOVEMENT_REGRESSION)) failure('FROZEN_REGRESSION_IDENTITY_REQUIRED');
  const route = candidate.files.find(file => file.path === 'src/route.ts')!.content;
  const tokens = comparisonTokens(route);
  if (tokens.length !== 3) failure('REVIEWED_COMPARATOR_SHAPE_REQUIRED');
  let normalized = route;
  for (const token of [...tokens].reverse()) normalized = normalized.slice(0, token.start) + '<EQ>' + normalized.slice(token.end);
  if (sha256(normalized) !== SHAPE_DIGEST) failure('REVIEWED_COMPARATOR_SHAPE_REQUIRED');
  const paths = new Set(candidate.files.map(file => file.path));
  try { for (const file of candidate.files) assertBoundedProgramSource(file.path, file.content, paths); } catch { failure('EXISTING_SOURCE_POLICY_REJECTED'); }
  return checked;
}

/** Existing fenced-source intake may supply revision and files. This adapter
 * admits only the already reviewed synthetic subset; it never supplies a
 * corrected source file or turns a supplied revision into a fetched fact. */
export function buildOwnerIsolatedRepairInput(input: { revision: string; files: ProgramCandidateProposal['files']; constitutionDigest: string }): IsolatedSoftwareRepairInput {
  return assertIsolatedRepairInput({
    schemaVersion: 1, profile: 'nicos-seeded-comparator-v1', provenance: 'ISOLATED', synthetic: true,
    source: { provenance: 'SUPPLIED', repository: 'BoneManTGRM/Nicos-Adventures', revision: input.revision, path: 'web/src/game/boltBotRoute.ts', sha256: ORIGINAL_SOURCE_DIGEST, adaptedSha256: ADAPTED_SOURCE_DIGEST, preparationActor: 'IMPLEMENTATION_AGENT' },
    candidate: { schemaVersion: 1, candidateKind: 'typescript_program', programName: 'Owner isolated comparator repair', summary: 'Owner-supplied copy of the reviewed synthetic movement comparator exercise.', limitations: ['SYNTHETIC isolated source subset; not a live defect or deployment.'], files: input.files },
    editablePaths: ['src/route.ts'], frozenRegression: { path: 'tests/route.test.ts', sha256: sha256(FROZEN_MOVEMENT_REGRESSION) }, constitutionDigest: input.constitutionDigest,
  });
}

export function enumerateIsolatedComparatorProposals(input: unknown): ComparatorProposal[] {
  const checked = assertIsolatedRepairInput(input);
  const source = checked.candidate.files.find(file => file.path === 'src/route.ts')!.content;
  return comparisonTokens(source).map(token => {
    const afterToken = token.text === '===' ? '!==' : '===';
    const replacementText = source.slice(0, token.start) + afterToken + source.slice(token.end);
    return { path: 'src/route.ts', replacementText, changedLines: 1, beforeToken: token.text, afterToken, line: token.line, beforeLine: source.split('\n').at(token.line - 1)!, afterLine: replacementText.split('\n').at(token.line - 1)! };
  });
}

function behavioralFailure(verification: ProgramVerificationResult): boolean {
  return !verification.passed && REQUIRED_CHECKS.every(check => verification.completedChecks.includes(check)) && verification.failures.length === 1 && verification.failures[0]!.kind === 'behavior' && verification.failures[0]!.code === 'GENOME_LAB_RUNTIME_FAILURE';
}
function verified(verification: ProgramVerificationResult, candidate: ProgramCandidateProposal): boolean {
  return verification.passed && verification.failures.length === 0 && verification.artifactDigest === artifactDigest(candidate) && REQUIRED_CHECKS.every(check => verification.completedChecks.includes(check));
}
class IsolatedRepairStepStopped extends Error {
  constructor(readonly step: string, readonly code: string) { super(code); }
}

/** There is no model interface, external fetch, owner-controlled command, or
 * paid dispatch. This bounded algorithm reuses existing verification machinery. */
export async function runIsolatedSoftwareRepair(rawInput: unknown, control: { beforeStep?: (step: string) => void | Promise<void> } = {}): Promise<IsolatedSoftwareRepairResult> {
  const started = performance.now();
  const input = assertIsolatedRepairInput(rawInput);
  const baseline = structuredClone(input.candidate);
  const result: IsolatedSoftwareRepairResult = {
    schemaVersion: 1, actor: 'SARA_RUNTIME', provenance: 'ISOLATED', synthetic: true, profile: 'nicos-seeded-comparator-v1', status: 'INCOMPLETE_EVIDENCE', qualified: false, comparisonHypothesis: { status: 'UNCONFIRMED', statement: 'One reviewed strict-equality branch may explain the seeded regression; behavioral failure alone is insufficient evidence.' }, interruptedAtStep: null, eligibilityStopCode: null, inputDigest: sha256(canonicalJson(input)), source: input.source,
    baselineArtifactDigest: artifactDigest(baseline), baselineSourceSha256: sha256(baseline.files.find(file => file.path === 'src/route.ts')!.content), regressionSha256: input.frozenRegression.sha256, heldOutRegressionSha256: sha256(HELD_OUT_MOVEMENT_REGRESSION), baselineVerification: null, attempts: [], independentVerification: null, restoredBaselineVerification: null, causalControlEstablished: false, verifiedCandidateDigest: null, verifiedSourceDigests: [], candidate: null, patch: null, patchSha256: null,
    authorityGranted: false, productionChanged: false, modelCalls: 0, providerCashUsd: 0, infrastructureAllocation: 'UNKNOWN', elapsedMilliseconds: 0,
    limitations: ['SYNTHETIC / ISOLATED qualification of a reviewed comparator-repair profile; no production defect or full-application repair is established.', 'Source was supplied by the implementation agent. Isolation remaps the constants import, uses .at for a nonnegative array-length lookup, and ports existing Vitest behavior to frozen Node tests.', 'The solver only enumerates three one-token strict-equality inversions. It is not a general software diagnosis or repair model.', 'The existing verifier reports generic behavioral failure, not individual failing assertion text. Causal attribution requires independent candidate PASS followed by restored-baseline failure.', 'Provider/model cash is zero; infrastructure allocation is unknown. This result is not customer fulfillment, revenue, or integration authority.'],
  };
  const verify = async (candidate: ProgramCandidateProposal, step: string): Promise<ProgramVerificationResult> => {
    if (performance.now() - started > 75_000) throw new IsolatedRepairStepStopped(step, 'ISOLATED_REPAIR_DURATION_LIMIT');
    try { await control.beforeStep?.(step); }
    catch (error) { throw new IsolatedRepairStepStopped(step, error instanceof Error && /^[A-Z][A-Z0-9_]{0,95}$/u.test(error.message) ? error.message : 'CURRENT_ELIGIBILITY_REJECTED'); }
    return verifyGenomeLabProgramCandidate({ candidate, objective: 'Qualify a SYNTHETIC isolated movement-reducer comparator repair.', acceptanceCriteria: ['Preserve immutable regression, protected dependencies and source identity.', 'Accept only the exact forward/right/forward movement progression and preserve correction, undo, reset and completion behavior.'], constitutionDigest: input.constitutionDigest, maximumBudgetUsd: 0 });
  };
  try {
    result.baselineVerification = await verify(baseline, 'baseline');
    if (verified(result.baselineVerification, baseline)) { result.status = 'NO_BEHAVIORAL_FAILURE'; return result; }
    if (!behavioralFailure(result.baselineVerification) || result.baselineVerification.artifactDigest !== result.baselineArtifactDigest) return result;
    const failures = new Set(result.baselineVerification.failures.map(failure => failure.fingerprint));
    const accepted: Array<{ candidate: ProgramCandidateProposal; change: ComparatorProposal }> = [];
    for (const [index, change] of enumerateIsolatedComparatorProposals(input).entries()) {
      const proposal: CodingRepairProposal = { schemaVersion: 1, baseArtifactDigest: result.baselineArtifactDigest, failureFingerprint: result.baselineVerification.failures[0]!.fingerprint, strategy: 'surgical', changes: [{ path: change.path, expectedContentDigest: result.baselineSourceSha256, replacementText: change.replacementText }], limitations: ['Deterministically enumerated isolated comparator inversion; no correctness claim before verification.'] };
      validateCodingRepairProposal({ proposal, candidate: baseline, artifactDigest: result.baselineArtifactDigest, failureFingerprints: failures, limits: ZERO_CASH_LIMITS, expectedStrategy: 'surgical' });
      const candidate = { ...structuredClone(baseline), files: baseline.files.map(file => file.path === change.path ? { path: file.path, content: change.replacementText } : { ...file }) };
      assertIsolatedRepairInput({ ...input, candidate });
      const verification = await verify(candidate, `candidate-${index + 1}`);
      result.attempts.push({ index: index + 1, proposalDigest: digestCodingRepairProposal(proposal), candidateArtifactDigest: artifactDigest(candidate), changedPath: change.path, changedLines: 1, verification });
      if (verified(verification, candidate)) accepted.push({ candidate, change });
    }
    if (accepted.length !== 1) { result.status = 'NO_VERIFIED_CANDIDATE'; result.limitations.push(accepted.length ? 'More than one candidate passed; the diagnosis remains ambiguous.' : 'No candidate passed the unchanged regression.'); return result; }
    const selected = accepted[0]!;
    const independent = structuredClone(selected.candidate);
    independent.files.push({ path: 'tests/independent.test.ts', content: HELD_OUT_MOVEMENT_REGRESSION });
    result.independentVerification = await verify(independent, 'independent-verification');
    if (!verified(result.independentVerification, independent)) return result;
    result.restoredBaselineVerification = await verify(baseline, 'restored-baseline');
    if (!behavioralFailure(result.restoredBaselineVerification) || result.restoredBaselineVerification.artifactDigest !== result.baselineArtifactDigest || canonicalJson(result.restoredBaselineVerification.failures) !== canonicalJson(result.baselineVerification.failures)) return result;
    result.causalControlEstablished = true;
    result.qualified = true;
    result.comparisonHypothesis = { status: 'SUPPORTED_BY_CAUSAL_CONTROL', statement: 'In this seeded subset, the command equality branch rejects the expected next move. Its one-token inversion passes unchanged and held-out regressions; restoring the seeded source fails again.' };
    result.status = 'VERIFIED_ISOLATED_REPAIR';
    result.candidate = selected.candidate;
    result.verifiedCandidateDigest = artifactDigest(selected.candidate);
    result.verifiedSourceDigests = fileDigests(selected.candidate).filter(file => file.path.startsWith('src/')).map(file => ({ path: file.path, sha256: file.contentDigest }));
    result.patch = `--- a/src/route.ts\n+++ b/src/route.ts\n@@ -${selected.change.line} +${selected.change.line} @@\n-${selected.change.beforeLine}\n+${selected.change.afterLine}\n`;
    result.patchSha256 = sha256(result.patch);
    return result;
  } catch (error) {
    if (!(error instanceof IsolatedRepairStepStopped)) throw error;
    result.interruptedAtStep = error.step; result.eligibilityStopCode = error.code;
    result.limitations.push('Current eligibility prevented the next verification. Completed evidence is retained; no candidate is qualified or released after this stop.');
    return result;
  } finally { result.elapsedMilliseconds = Math.round(performance.now() - started); }
}
