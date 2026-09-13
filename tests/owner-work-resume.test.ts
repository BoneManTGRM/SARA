import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { SaraKernel, SARA_PRINCIPAL } from '../src/kernel.ts';
import { createSaraServer } from '../src/server.ts';
import { canonicalJson, sha256 } from '../src/canonical.ts';
import { compileOwnerWork } from '../src/owner-work.ts';
import { capabilityContracts } from '../src/digital-capabilities/registry.ts';
import { reauthorizeSoftwareWork } from '../src/owner-software-recovery.ts';

const token = 'synthetic-resume-owner';
const request = { requestId: 'synthetic-exact-resume', text: 'Inspect the source and tests in repository BoneManTGRM/Nicos-Adventures.', suppliedText: 'SYNTHETIC owner note retained exactly; not independent source evidence.' };

test('SYNTHETIC owner resume endpoint accepts only the existing durable request ID and preserves authentication/cancellation/stop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sara-resume-http-'));
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(token) });
  const server = createSaraServer(kernel, { stateDirectory: directory, ownerTokenSha256: sha256(token) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, credential = token) => fetch(`${base}/api/owner/work/resume`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const owner = kernel.authenticateOwnerToken(token), first = await kernel.executeOwnerMessage(owner, request);
    assert.equal((await post({ requestId: request.requestId }, 'wrong')).status, 401);
    assert.equal((await fetch(`${base}/api/owner/work/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.requestId }) })).status, 401);
    assert.equal((await post({ requestId: 'missing-work' })).status, 400);
    assert.equal((await post({ requestId: request.requestId, text: 'changed target' })).status, 400);
    await assert.rejects(kernel.resumeOwnerMessage(SARA_PRINCIPAL, request.requestId), /AUTHENTICATED_OWNER_REQUIRED/);
    const response = await post({ requestId: request.requestId }); assert.equal(response.status, 200);
    const resumed = await response.json() as any;
    assert.equal(resumed.planId, first.planId); assert.deepEqual(resumed.receipts, first.receipts);
    const records = (await kernel.inspectAudit()).filter(event => event.type === 'owner_work_received');
    assert.equal(records.length, 1); assert.deepEqual((records[0]!.data as any).request, request);
    await kernel.setEmergencyStop(owner, true);
    assert.equal((await (await post({ requestId: request.requestId })).json() as any).status, 'BLOCKED');
    await kernel.setEmergencyStop(owner, false);
    await kernel.cancelOwnerWork(owner, request.requestId);
    assert.equal((await (await post({ requestId: request.requestId })).json() as any).status, 'CANCELLED');
    assert.equal((await kernel.inspectAudit()).filter(event => event.type === 'owner_work_reauthorized').length, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('SYNTHETIC reauthorization freezes the recipe and rejects consequential effects, widened resources, cash, quarantine and changed authority', async () => {
  const contracts = await capabilityContracts();
  const record = await compileOwnerWork(request, [], contracts, '2026-09-13T00:00:00Z');
  assert.ok(record.plan);
  const original = canonicalJson(record);
  const accepted = reauthorizeSoftwareWork(record, contracts, [], sha256('authority'));
  assert.equal(canonicalJson(record), original); assert.equal(accepted.record.plan!.id, record.plan.id);
  assert.deepEqual(accepted.record.plan!.steps.map(({ contractDigest, ...step }) => step), record.plan.steps.map(({ contractDigest, ...step }) => step));
  assert.equal(accepted.proofDisposition, 'LEGACY_COARSE_IDENTITY_REEVALUATED');
  for (const change of [ { effect: 'EXTERNAL_EFFECT' }, { allowedResources: ['credentialed-write-api'] }, { authorityClass: 'CONSEQUENTIAL_REQUIRES_OWNER' }, { status: 'QUARANTINED' }, { budget: { class: 'ZERO_CASH', maximumCashMicroUsd: 1 } } ]) {
    const changed = structuredClone(contracts); Object.assign(changed.find(contract => contract.id === 'software-source-inspector')!, change);
    assert.throws(() => reauthorizeSoftwareWork(record, changed, [], sha256('authority')), /CURRENT_BOUNDARY_REQUIRED/);
  }
  const wrongRecipe = structuredClone(record); wrongRecipe.plan!.steps[2]!.capabilityId = 'nico-production-proof-runner';
  assert.throws(() => reauthorizeSoftwareWork(wrongRecipe, contracts, [], sha256('authority')), /RECIPE_CHANGED/);
  assert.throws(() => reauthorizeSoftwareWork(record, contracts, [{ authority: { contextDigest: sha256('old') } }] as any, sha256('current')), /AUTHORITY_CHANGED/);
});
