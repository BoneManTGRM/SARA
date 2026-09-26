import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {projectView, acceptsEvidence} from '../src/second-brain.ts';
const token='synthetic-second-brain-token';
const note={project:'nico',text:'Compiler qualification remains blocked.',source:'https://github.com/example/synthetic/pull/12',observedAt:'2026-09-25T12:00:00.000Z',kind:'blocker'};
test('note survives restart, concurrent replay is idempotent, isolated and reported',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-brain-'));
 try{
 const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}); const owner=k.authenticateOwnerToken(token);
 const before=await k.getStatus();
 const records=await Promise.all(Array.from({length:8},()=>k.captureProjectNote(owner,note)));
 assert.equal(new Set(records.map(r=>r.id)).size,1);
 await assert.rejects(()=>k.captureProjectNote(SARA_PRINCIPAL,note),/owner/i);
 const restart=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)});
 const view=await restart.readProjectBrief(restart.authenticateOwnerToken(token),'nico','compiler');
 assert.equal(view.records.length,1);assert.equal(view.records[0]!.projectEvidence!.verification,'reported');
 assert.match(view.handoff,/Compiler qualification/);assert.match(view.handoff,/Unknown/);assert.match(view.handoff,/https:\/\/github.com/);
 assert.equal((await restart.readProjectBrief(restart.authenticateOwnerToken(token),'sara','compiler')).records.length,0);
 assert.equal((await restart.getStatus()).jobs.length,before.jobs.length);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('untrusted metadata cannot upgrade note truth or inject cross-project corrections',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-brain-'));
 try{const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)});const o=k.authenticateOwnerToken(token);
 await assert.rejects(()=>k.captureProjectNote(o,{...note,verification:'verified'}),/field/i);
 await assert.rejects(()=>k.captureProjectNote(o,{...note,source:'javascript:alert(1)'}),/source/i);
 await assert.rejects(()=>k.captureProjectNote(o,{...note,observedAt:'tomorrow'}),/timestamp/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('late old observations cannot replace new state; same-time contradictions are visible and exact identities are mandatory',()=>{
 const time='2026-09-26T12:00:00.000Z';
 const base:any={id:'new',category:'working',scope:'nico',statement:'compiler failed',source:'https://github.com/example/synthetic/actions/runs/1',observedAt:time,lastValidatedAt:'',confidence:0,verification:'measured',dependencies:[],projectEvidence:{schemaVersion:1,project:'nico',kind:'source',verification:'source_observed',dataClass:'public',contentDigest:'a'.repeat(64),ingestedAt:time,observedAt:time,lastVerifiedAt:time,expiresAt:'2026-09-27T12:00:00.000Z',stage:'tests_passed',outcome:'failure',repository:'example/synthetic',revision:'a'.repeat(40),pr:null,artifactId:null,runId:1,runAttempt:2,environment:null,deploymentId:null,claimKey:'run:1',conflictsWith:[]}};
 const old=structuredClone(base);old.id='old';old.projectEvidence.observedAt='2026-09-25T12:00:00.000Z';old.projectEvidence.ingestedAt='2026-09-26T13:00:00.000Z';old.projectEvidence.outcome='success';
 const view=projectView([old,base],'nico','',new Date(time));assert.deepEqual(view.records.map(r=>r.id),['new']);assert.equal(view.history[0]!.superseded,true);
 const conflicting=structuredClone(base);conflicting.id='contradiction';conflicting.projectEvidence.outcome='success';
 assert.equal(projectView([base,conflicting],'nico','',new Date(time)).conflicts.length,2);
 const target={stage:'tests_passed' as const,repository:'example/synthetic',revision:'a'.repeat(40),pr:null,artifactId:null,runId:1,runAttempt:2};
 assert.equal(acceptsEvidence(conflicting,target,new Date(time),[conflicting]),true);
 for(const wrong of [{revision:'b'.repeat(40)},{runAttempt:1},{stage:'merged' as const}])assert.equal(acceptsEvidence(conflicting,{...target,...wrong},new Date(time),[conflicting]),false);
 assert.equal(acceptsEvidence(conflicting,target,new Date('2026-09-28'),[conflicting]),false);
});
