import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {canonicalJson,sha256} from '../src/canonical.ts';
test('recovery reads the actual persisted job after restore without replacing it or inventing accounting',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'recovery-job-')),copy=await mkdtemp(join(tmpdir(),'recovery-copy-'));
 try{const kernel=await SaraKernel.boot({stateDirectory:dir});const job=await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{objective:'Analyze supplied text',expectedOwnerValue:0,requiredCapabilities:['read'],acceptanceCriteria:['Preserve input'],maximumBudgetUsd:0});
 const input={jobId:job.id,revision:job.learningContractDigest??sha256(canonicalJson(job.workCard)),journal:[]};
 const first=await kernel.invokeCapability(SARA_PRINCIPAL,{requestId:'recovery-before',capabilityId:'recovery-state-reconstructor',input});
 assert.equal((first.output as any).basis,'TRUSTED_DURABLE_STATE');assert.deepEqual((first.output as any).accounting,{spentMicroUsd:null,reservedMicroUsd:null});
 const before=await kernel.inspectAudit();await cp(dir,copy,{recursive:true});const restored=await SaraKernel.boot({stateDirectory:copy});
 const again=await restored.invokeCapability(SARA_PRINCIPAL,{requestId:'recovery-before',capabilityId:'recovery-state-reconstructor',input});
 assert.equal(again.replayed,true);assert.equal(again.receiptValidity?.current,true);assert.equal(again.resultDigest,first.resultDigest);const after=await restored.inspectAudit();assert.deepEqual(after.slice(0,before.length),before);assert.ok(after.slice(before.length).every(e=>e.type==='system_booted'));assert.equal(after.filter(e=>e.type==='job_created').length,1);
 const forged=await restored.invokeCapability(SARA_PRINCIPAL,{requestId:'recovery-forged',capabilityId:'recovery-state-reconstructor',input:{...input,revision:'unrelated'}});assert.equal((forged.output as any).basis,'SUPPLIED_JOURNAL_ONLY');
 }finally{await rm(dir,{recursive:true,force:true});await rm(copy,{recursive:true,force:true});}
});
