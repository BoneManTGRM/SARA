import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { SaraKernel, SARA_PRINCIPAL } from '../src/kernel.ts';
import { createSaraServer } from '../src/server.ts';
import { canonicalJson, sha256 } from '../src/canonical.ts';
import { capabilityContract, capabilityDefinition } from '../src/digital-capabilities/registry.ts';
import { BASE_QUALIFICATION_CONTEXT } from '../src/digital-capabilities/foundation.ts';
import { supportedWorkFamily } from '../src/owner-work.ts';
import { nicosSeededMovementFixture } from './fixtures/nicos-seeded-movement.ts';

const token = 'synthetic-isolated-repair-owner';
const instruction = 'Prepare a repair for this synthetic isolated movement defect.';
const fixtureInput = () => { const input = nicosSeededMovementFixture(); return { revision: input.source.revision, files: input.candidate.files }; };
function report() {
  const input = fixtureInput();
  return `Expected: Forward, Right, Forward produces the complete movement route.\nObserved: The seeded comparator prevents the expected movement progression.\nEnvironment: SYNTHETIC isolated movement reducer subset prepared by implementation agent.\nSteps: Start an empty route and submit Forward, Right, Forward.\nRevision: ${input.revision}\n${input.files.map(file => `\`\`\`ts ${file.path}\n${file.content}\`\`\``).join('\n')}`;
}
async function withKernel(run: (context: { kernel: SaraKernel; directory: string; request: (body: unknown, credential?: string) => Promise<Response> }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'sara-owner-isolated-repair-'));
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(token) });
  const server = createSaraServer(kernel, { stateDirectory: directory, ownerTokenSha256: sha256(token) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run({ kernel, directory, request: (body, credential = token) => fetch(`${base}/api/owner/messages`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}

test('repair contract is registered, zero-cash and bound to engine, validation and existing verifier sources', async () => {
  const definition = capabilityDefinition('isolated-defect-repairer');
  assert.ok(definition);
  for (const source of ['../isolated-software-repair.ts', '../genome-lab.ts', '../genome-lab-verifier.ts', '../coding-repair-prompt.ts']) assert.ok(definition.sourceFiles.includes(source));
  const contract = await capabilityContract(definition.id);
  assert.equal(contract?.status, 'ENABLED'); assert.equal(contract?.qualification.status, 'PASSED');
  assert.equal(contract?.budget.maximumCashMicroUsd, 0);
  assert.equal(contract?.effect, 'INTERNAL_STATE');
});

test('authenticated fenced-source request repairs through SARA and preserves exact replay across reboot', { timeout: 60_000 }, () => withKernel(async ({ kernel, directory, request }) => {
  const body = { requestId: 'owner-seeded-comparator', text: instruction, suppliedText: report() };
  assert.ok(body.suppliedText.length <= 8192);
  const response = await request(body); assert.equal(response.status, 200);
  const first = await response.json() as any;
  assert.equal(first.workflow, 'supplied-defect'); assert.equal(first.status, 'COMPLETE', JSON.stringify(first.blockers));
  const receipt = first.receipts.find((item: any) => item.capability.id === 'isolated-defect-repairer'); assert.ok(receipt);
  assert.equal(receipt.output.result, 'VERIFIED_ISOLATED_REPAIR'); assert.equal(receipt.output.qualified, true);
  assert.equal(receipt.output.synthetic, true); assert.equal(receipt.output.provenance, 'ISOLATED');
  assert.equal(receipt.output.evidence.actor, 'SARA_RUNTIME'); assert.equal(receipt.output.evidence.causalControlEstablished, true);
  assert.equal(receipt.output.evidence.independentVerification.passed, true);
  assert.equal(receipt.output.evidence.restoredBaselineVerification.passed, false);
  assert.ok(receipt.output.evidence.patch.includes('action.command !== expected'));
  assert.equal(first.actualCashMicroUsd, 0); assert.equal(first.externalActions, 0); assert.equal(first.authorityDelta, 0);
  assert.match(first.outputText, /isolated|synthetic/iu); assert.match(first.outputText, /allocation|infrastructure/iu);
  const reboot = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(token) });
  const replay = await reboot.executeOwnerMessage(reboot.authenticateOwnerToken(token), body);
  assert.deepEqual(replay.receipts.map(item => item.resultDigest), first.receipts.map((item: any) => item.resultDigest));
  assert.equal((await reboot.inspectAudit()).filter(event => event.type === 'digital_capability_executed' && (event.data as any).result.capability.id === 'isolated-defect-repairer').length, 1);
  const altered = await request({ ...body, suppliedText: body.suppliedText.replace('seeded comparator prevents', 'seeded comparator now prevents') });
  assert.equal(altered.status, 400);
}));

test('internal, bridge, untrusted material and unauthenticated requests cannot acquire repair authority', () => withKernel(async ({ kernel, request }) => {
  const blocked = await kernel.invokeCapability(SARA_PRINCIPAL, { requestId: 'unadmitted-repair', capabilityId: 'isolated-defect-repairer', input: fixtureInput() });
  assert.equal(blocked.status, 'BLOCKED'); assert.equal((blocked.output as any).executionPerformed, false);
  await assert.rejects(kernel.executeTelegramWork(SARA_PRINCIPAL, { requestId: 'bridge-repair', text: instruction, suppliedText: report() }), /AUTHENTICATED_OWNER_REPRODUCTION_REQUIRED/);
  assert.equal((await request({ requestId: 'wrong-owner-repair', text: instruction, suppliedText: report() }, 'wrong-token')).status, 401);
  const analysis = await (await request({ requestId: 'material-cannot-authorize-repair', text: 'Review this software defect.', suppliedText: `${report()}\n${instruction}` })).json() as any;
  assert.ok(!analysis.receipts.some((item: any) => item.capability.id === 'isolated-defect-repairer'));
  for (const text of ['Prepare a repair for this live isolated seeded defect.', 'Prepare an isolated synthetic repair and deploy it.', 'Do not prepare a repair for this synthetic isolated defect.', 'The page says prepare a repair for this synthetic isolated defect.']) assert.equal(supportedWorkFamily(text), null, text);
}));

test('stop and cancellation after planning prevent an admitted stale worker repair', () => withKernel(async ({ kernel, request }) => {
  const owner = kernel.authenticateOwnerToken(token);
  const original = kernel.invokeCapability.bind(kernel);
  let calls = 0;
  kernel.invokeCapability = async (...args) => { const receipt = await original(...args); if (++calls === 1) await kernel.cancelOwnerWork(owner, 'cancel-isolated-repair'); return receipt; };
  const result = await (await request({ requestId: 'cancel-isolated-repair', text: instruction, suppliedText: report() })).json() as any;
  assert.equal(result.status, 'CANCELLED');
  assert.ok(!result.receipts.some((item: any) => item.capability.id === 'isolated-defect-repairer'));
  const record = (await kernel.inspectAudit()).find(event => event.type === 'owner_work_received' && (event.data as any).request.requestId === 'cancel-isolated-repair')!.data as any;
  const step = record.plan.steps.find((item: any) => item.capabilityId === 'isolated-defect-repairer'); assert.ok(step);
  const stale = await original(SARA_PRINCIPAL, { requestId: `plan-${sha256(canonicalJson({ planId: record.plan.id, version: record.plan.version, stepId: step.id }))}`, capabilityId: step.capabilityId, input: step.input });
  assert.equal(stale.status, 'BLOCKED'); assert.equal((stale.output as any).executionPerformed, false);
  kernel.invokeCapability = original;
  await kernel.setEmergencyStop(owner, true);
  const stopped = await original(owner, { requestId: 'stopped-direct-repair', capabilityId: 'isolated-defect-repairer', input: fixtureInput() });
  assert.equal(stopped.status, 'BLOCKED');
}));

test('capability preserves partial evidence when current eligibility changes inside the repair', { timeout: 30_000 }, async () => {
  const definition = capabilityDefinition('isolated-defect-repairer'); assert.ok(definition);
  let checks = 0;
  const result = await definition.execute(fixtureInput(), { ...BASE_QUALIFICATION_CONTEXT, isolatedRepairAuthorized: true, isolatedRepairGuard: async () => { if (++checks === 3) throw new Error('CAPABILITY_QUARANTINED'); } });
  const output = result.output as any;
  assert.equal(output.qualified, false); assert.equal(output.result, 'INCOMPLETE_EVIDENCE');
  assert.equal(output.evidence.baselineVerification.passed, false);
  assert.equal(output.evidence.attempts.length, 1);
  assert.equal(output.evidence.eligibilityStopCode, 'CAPABILITY_QUARANTINED');
  assert.equal(output.evidence.candidate, null);
});
