import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
const token='synthetic-evidence-owner';
test('owner observation retains its grade, subject and audit identity across replay/restore',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-owner-evidence-')),copy=await mkdtemp(join(tmpdir(),'sara-owner-evidence-copy-'));
 try{const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),owner=k.authenticateOwnerToken(token);
 const input={requestId:'proof',sourceId:'owner:observation',contentDigest:sha256('observed'),subject:[{key:'revision',value:'a'.repeat(40)}],claims:['observed:test']};
 assert.equal(typeof k.recordOwnerObservedEvidence,'function');
 assert.throws(()=>k.recordOwnerObservedEvidence(SARA_PRINCIPAL,input),/AUTHENTICATED_OWNER/);
 assert.throws(()=>k.recordOwnerObservedEvidence({id:'OWNER',kind:'owner',authenticated:true},input),/AUTHENTICATED_OWNER/);
 const record=await k.recordOwnerObservedEvidence(owner,input);assert.equal(record.provenance,'OWNER_OBSERVED');assert.equal(record.authoritySource,false);
 assert.throws(()=>k.recordOwnerObservedEvidence(owner,{...input,provenance:'PRODUCTION'}),/UNEXPECTED/);
 const n=(await k.inspectAudit()).length;assert.deepEqual(await k.recordOwnerObservedEvidence(owner,input),record);assert.equal((await k.inspectAudit()).length,n);
 await assert.rejects(()=>k.recordOwnerObservedEvidence(owner,{...input,claims:['other']}),/REPLAY_CONFLICT/);
 await cp(dir,copy,{recursive:true});const restored=await SaraKernel.boot({stateDirectory:copy,ownerTokenSha256:sha256(token)});
 assert.deepEqual(await restored.recordOwnerObservedEvidence(restored.authenticateOwnerToken(token),input),record);
 const proof=await restored.invokeCapability(restored.authenticateOwnerToken(token),{requestId:'grade',capabilityId:'production-proof-validator',input:{deploymentSha:'a'.repeat(40),deploymentId:'deployment-fixture',behavior:'observed:test',proofIds:[record.id]},evidenceReceiptIds:[record.id]});
 assert.equal((proof.output as any).productionBehaviorProven,false);assert.equal(proof.evidence[0]!.provenance,'OWNER_OBSERVED');
 }finally{await rm(dir,{recursive:true,force:true});await rm(copy,{recursive:true,force:true});}
});

test('owner evidence preserves typed scalar subject fields without allowing structured authority payloads',async()=>{
 const {compileOwnerEvidence}=await import('../src/digital-capabilities/observed-evidence.ts');
 const input={requestId:'typed-owner-evidence',sourceId:'owner-record',contentDigest:'a'.repeat(64),subject:[{key:'reportRevision',value:2},{key:'protected',value:true},{key:'actorId',value:'specialist'},{key:'supersededBy',value:null}],claims:['observed']};
 const e=compileOwnerEvidence(input,'2026-09-12T00:00:00.000Z');assert.deepEqual(e.subject,{reportRevision:2,protected:true,actorId:'specialist',supersededBy:null});assert.equal(e.provenance,'OWNER_OBSERVED');assert.equal(e.authoritySource,false);
 assert.throws(()=>compileOwnerEvidence({...input,subject:[{key:'authority',value:{owner:true}}]},'2026-09-12T00:00:00.000Z'),/SAFE_SCALAR_SUBJECT_REQUIRED/);
});
