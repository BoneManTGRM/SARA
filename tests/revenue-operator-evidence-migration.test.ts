import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {verifiedRevenueCapabilities} from '../src/revenue-capability-bootstrap.ts';

// Exact legacy registration derived from accepted a6d66920585f0214991cec9a53f0e9772d52534d.
// Keep version 5 frozen: deriving it as currentVersion - 1 hides forgotten migrations.
test('economic operator upgrade preserves copied version-5 production evidence and restarts idempotently',async()=>{
 const original=await mkdtemp(join(tmpdir(),'revenue-v5-original-')),restored=await mkdtemp(join(tmpdir(),'revenue-v5-restored-'));
 try{
  const options={stateDirectory:original,ownerTokenSha256:sha256('synthetic-migration-owner')};
  const old=await SaraKernel.boot(options),candidate=(await verifiedRevenueCapabilities()).find(c=>c.id==='independent-report-verification')!;
  const legacy={...candidate,evidence:['behavioral-test:tests/revenue-pilot.test.ts','behavioral-test:tests/revenue-pilot-operator.test.ts','implementation-sha256:d2e1b64a5f6c60ff754155919df5db6d2e42c40620d59542df12780d5e3e94c4','integrated-gate:npm run verify'],registration:{...candidate.registration!,evidenceVersion:5,implementationDigest:'d2e1b64a5f6c60ff754155919df5db6d2e42c40620d59542df12780d5e3e94c4',evidenceDigest:'0a9bbd49fc7ff0ca51555b74ff706fea562217a9f8001c8ce252b0c5699d1796',verifiedAt:'2026-09-12T14:10:36.000Z'}};
  await old.registerCapability(SARA_PRINCIPAL,legacy);const before=await old.inspectAudit();
  await cp(original,restored,{recursive:true});
  const migrated=await SaraKernel.boot({...options,stateDirectory:restored,bootstrapRevenueCapabilities:true});
  const events=await migrated.inspectAudit();assert.deepEqual(events.slice(0,before.length),before);assert.ok(events.slice(before.length).every(e=>['system_booted','capability_registered'].includes(e.type)));
  const current=(await migrated.getStatus()).capabilities.find(c=>c.id===legacy.id)!;assert.ok(current.registration!.evidenceVersion>5);assert.equal(current.registration!.implementationDigest,candidate.registration!.implementationDigest);
  assert.ok(events.some(e=>e.type==='capability_registered'&&JSON.stringify(e.data).includes(legacy.registration.implementationDigest)),'Original evidence remains auditable');
  const restarted=await SaraKernel.boot({...options,stateDirectory:restored,bootstrapRevenueCapabilities:true});assert.deepEqual((await restarted.inspectAudit()).filter(e=>e.type==='capability_registered'),events.filter(e=>e.type==='capability_registered'));
  assert.deepEqual(await old.inspectAudit(),before,'Copied migration does not modify its source');
 }finally{await rm(original,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});

// Frozen registration derived from serving57955eae9f721a6e2501e03ba2352021f2a1e71f; SYNTHETIC copied state.
test('paid-step operator upgrade preserves copied version-6 production evidence and restarts idempotently',async()=>{
 const original=await mkdtemp(join(tmpdir(),'revenue-v6-original-')),restored=await mkdtemp(join(tmpdir(),'revenue-v6-restored-'));
 try{
  const options={stateDirectory:original,ownerTokenSha256:sha256('synthetic-migration-owner')};
  const old=await SaraKernel.boot(options),candidate=(await verifiedRevenueCapabilities()).find(c=>c.id==='independent-report-verification')!;
  const legacy={...candidate,evidence:['behavioral-test:tests/revenue-pilot.test.ts','behavioral-test:tests/revenue-pilot-operator.test.ts','implementation-sha256:bccc60afe0e5acbde3a321614962120e304944de4a7c7428943fef53d6422a6b','integrated-gate:npm run verify'],registration:{...candidate.registration!,evidenceVersion:6,implementationDigest:'bccc60afe0e5acbde3a321614962120e304944de4a7c7428943fef53d6422a6b',evidenceDigest:'c85eaa72c321f9f832bf0bdd9e04a01f5f475552de3cf460d0de2c0b0fa2c18a',verifiedAt:'2026-09-13T04:12:03.715Z'}};
  await old.registerCapability(SARA_PRINCIPAL,legacy);const before=await old.inspectAudit();
  await cp(original,restored,{recursive:true});
  const migrated=await SaraKernel.boot({...options,stateDirectory:restored,bootstrapRevenueCapabilities:true});
  const events=await migrated.inspectAudit();assert.deepEqual(events.slice(0,before.length),before);assert.ok(events.slice(before.length).every(e=>['system_booted','capability_registered'].includes(e.type)));
  const current=(await migrated.getStatus()).capabilities.find(c=>c.id===legacy.id)!;assert.ok(current.registration!.evidenceVersion>6);assert.equal(current.registration!.implementationDigest,candidate.registration!.implementationDigest);
  assert.ok(events.some(e=>e.type==='capability_registered'&&JSON.stringify(e.data).includes(legacy.registration.implementationDigest)),'Original evidence remains auditable');
  const restarted=await SaraKernel.boot({...options,stateDirectory:restored,bootstrapRevenueCapabilities:true});assert.deepEqual((await restarted.inspectAudit()).filter(e=>e.type==='capability_registered'),events.filter(e=>e.type==='capability_registered'));
  assert.deepEqual(await old.inspectAudit(),before,'Copied migration does not modify its source');
 }finally{await rm(original,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});
