import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile, cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Both processes use a disposable source copy. This is a deployment identity
// regression, never mutation of loaded production/working code or audit data.
const program = `
import { SaraKernel, SARA_PRINCIPAL } from './src/kernel.ts';
import { sha256 } from './src/canonical.ts';
import { writeFile } from 'node:fs/promises';
const token='synthetic-code-recovery-owner', body={requestId:'synthetic-code-recovery',text:'Inspect the source and tests in repository BoneManTGRM/Nicos-Adventures.'};
let calls=0;
const runtime={configurationIdentity:{sourceDigest:sha256('same-source-adapter'),journeyDigest:sha256('same-browser-configuration')},inspectSource:async repository=>{calls++;return {schemaVersion:1,actor:'SARA_RUNTIME',evidenceLabel:'EXTERNAL_READ_ONLY',collectionMode:'anonymous_read_only',repository:'https://github.com/'+repository,immutableCommitSha:'a'.repeat(40),treeSha:'b'.repeat(40),defaultBranch:'main',collectedAt:'2026-09-13T00:00:00Z',inventoryTruncated:false,files:[{path:'package.json',role:'manifest',gitBlobSha:'d'.repeat(40),contentSha256:sha256('{}'),byteLength:2,permalink:'https://github.com/'+repository+'/blob/'+ 'a'.repeat(40)+'/package.json',sourceText:'{}',sourceTruncated:false,trust:'UNTRUSTED_SOURCE'}],requestsUsed:1,limitations:['SYNTHETIC fixture; no real application/customer evidence.']};},testJourney:async()=>{throw new Error('Unexpected browser');}};
const kernel=await SaraKernel.boot({stateDirectory:process.argv[2],ownerTokenSha256:sha256(token),softwareRuntime:runtime}),owner=kernel.authenticateOwnerToken(token);
const before=await kernel.inspectAudit(), displayed=await kernel.inspectOwnerWork(owner);
if(process.argv[3]==='crash'){
 kernel.runCapabilityPlan=async()=>{throw new Error('SYNTHETIC_CRASH_AFTER_OWNER_REFRESH');};
 let failure=null;try{await kernel.resumeOwnerMessage(owner,body.requestId);}catch(error){failure=error.message;}
 await writeFile(process.argv[4],JSON.stringify({calls,failure,before,after:await kernel.inspectAudit()}));process.exit(0);
}
let worker=null,bridgeError=null;
if(process.argv[3]==='recover')worker=await kernel.resumeOwnerWorkTick();
if(process.argv[3]==='refresh'){
 worker=await kernel.resumeOwnerWorkTick();
 try{await kernel.executeTelegramWork(SARA_PRINCIPAL,body);}catch(error){bridgeError=error.message;}
}
const result=await kernel.executeOwnerMessage(owner,body),replay=await kernel.executeOwnerMessage(owner,body),after=await kernel.inspectAudit();
await writeFile(process.argv[4],JSON.stringify({calls,displayed,worker,bridgeError,result,replay,before,after}));
`;

test('SYNTHETIC exact owner replay refreshes changed-code software contracts on the same durable work, with preserved history', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sara-contract-recovery-'));
  try {
    const source = join(directory, 'source');
    await cp(root, source, { recursive: true, filter: path => {
      const relative = path.slice(root.length).split('/').filter(Boolean);
      return !relative.length || ['src', 'tgrm', 'constitution', 'scripts', 'package.json', 'package-lock.json', 'railpack.json', 'tsconfig.json'].includes(relative[0]!);
    } });
    await symlink(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
    await writeFile(join(source, 'synthetic-recovery.ts'), program);
    const state = join(directory, 'state'), firstPath = join(directory, 'first.json'), nextPath = join(directory, 'next.json');
    await run(process.execPath, ['--import', 'tsx', 'synthetic-recovery.ts', state, 'initial', firstPath], { cwd: source, timeout: 40_000, maxBuffer: 1024 * 1024 });
    const first = JSON.parse(await readFile(firstPath, 'utf8'));
    assert.equal(first.result.status, 'COMPLETE');
    await appendFile(join(source, 'src/software-journey-browser.ts'), '\n// SYNTHETIC diagnostic-only deployment identity change.\n');
    await run(process.execPath, ['--import', 'tsx', 'synthetic-recovery.ts', state, 'refresh', nextPath], { cwd: source, timeout: 40_000, maxBuffer: 1024 * 1024 });
    const next = JSON.parse(await readFile(nextPath, 'utf8'));
    assert.equal(next.displayed[0].verification, 'HISTORICAL_ANALYSIS', 'changed code must invalidate displayed dependent proof before owner renewal');
    assert.equal(next.worker.status, 'IDLE', 'worker cannot mint an owner contract refresh');
    assert.match(next.bridgeError, /AUTHENTICATED_OWNER/);
    assert.equal(next.result.status, 'COMPLETE', JSON.stringify(next.result.blockers));
    assert.equal(next.result.planId, first.result.planId);
    assert.equal(next.result.requestId, first.result.requestId);
    assert.equal(next.result.authorityDelta, 0);
    assert.equal(next.result.externalActions, 0);
    assert.deepEqual(next.replay.receipts, next.result.receipts);
    assert.deepEqual(next.before.slice(0, first.after.length), first.after);
    assert.deepEqual(next.after.slice(0, first.after.length), first.after);
    assert.equal(next.after.filter((event: any) => event.type === 'owner_work_received' && event.data.request.requestId === first.result.requestId).length, 1);
    const renewed = next.after.filter((event: any) => event.type === 'owner_work_reauthorized');
    assert.equal(renewed.length, 1);
    assert.equal(renewed[0].actor.kind, 'owner');
    assert.equal(renewed[0].data.record.requestDigest, first.after.find((event: any) => event.type === 'owner_work_received').data.requestDigest);
    assert.equal(next.calls, 1, 'opaque old implementation identity needs fresh source evaluation; exact replay then reuses it');
    await appendFile(join(source, 'src/software-journey-browser.ts'), '\n// SYNTHETIC second diagnostic deployment, crash recovery qualification.\n');
    const crashPath = join(directory, 'crash.json'), recoveryPath = join(directory, 'recovered.json');
    await run(process.execPath, ['--import', 'tsx', 'synthetic-recovery.ts', state, 'crash', crashPath], { cwd: source, timeout: 40_000, maxBuffer: 1024 * 1024 });
    const crash = JSON.parse(await readFile(crashPath, 'utf8'));
    assert.equal(crash.failure, 'SYNTHETIC_CRASH_AFTER_OWNER_REFRESH'); assert.equal(crash.calls, 0);
    await run(process.execPath, ['--import', 'tsx', 'synthetic-recovery.ts', state, 'recover', recoveryPath], { cwd: source, timeout: 40_000, maxBuffer: 1024 * 1024 });
    const recovered = JSON.parse(await readFile(recoveryPath, 'utf8'));
    assert.equal(recovered.displayed[0].verification, 'HISTORICAL_ANALYSIS', 'owner refresh alone cannot verify old receipts');
    assert.equal(recovered.worker.status, 'COMPLETE'); assert.equal(recovered.calls, 1);
    assert.equal(recovered.result.planId, first.result.planId); assert.equal(recovered.result.status, 'COMPLETE');
    assert.deepEqual(recovered.after.slice(0, crash.after.length), crash.after);
    assert.equal(recovered.after.filter((event: any) => event.type === 'owner_work_reauthorized').length, 2);
    assert.equal(recovered.after.filter((event: any) => event.type === 'owner_work_received').length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
