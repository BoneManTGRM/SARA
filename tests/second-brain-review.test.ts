import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {noteInput,evidenceId,projectView,acceptsEvidence,type EvidenceMemory} from '../src/second-brain.ts';
import type {MemoryRecord} from '../src/types.ts';
const token='synthetic-review-token';
const revision='a'.repeat(40);
const now='2026-09-26T12:00:00.000Z';
function sourceRecord(id='memory-'+ '1'.repeat(64)):EvidenceMemory {
 const base=noteInput({project:'nico',text:'Synthetic committed source'},now);
 return {...base,id,projectEvidence:{...base.projectEvidence,verification:'source_observed',kind:'source',stage:'committed',outcome:'success',repository:'example/repo',revision,observedAt:now,lastVerifiedAt:now,expiresAt:'2026-09-30T12:00:00.000Z'}};
}
test('review: generic memory methods reject forged source verification for both owner and SARA',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-review-'));
 try{const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)});const owner=k.authenticateOwnerToken(token);
 const {id:_id,...input}=sourceRecord();
 for(const principal of [owner,SARA_PRINCIPAL])for(const method of ['recordMemory','recordMemoryOnce'] as const)await assert.rejects(()=>k[method](principal,input),/owner project evidence/i);
 assert.equal((await k.readProjectBrief(owner,'nico')).records.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('review: identical GitHub refresh renews freshness append-only and survives restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sara-review-refresh-'));
 const originalFetch=globalThis.fetch;
 t.mock.timers.enable({apis:['Date'],now:new Date(now)});
 globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).endsWith('/'+revision)?{sha:revision,committer:{date:'2026-09-20T00:00:00Z'}}:{private:false,full_name:'BoneManTGRM/NICO'}));
 try{const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)});const owner=k.authenticateOwnerToken(token);
 const first=await k.importProjectGitHub(owner,'nico',{kind:'commit',sha:revision});assert.equal(first.status,'complete');
 const initial=(await k.readProjectBrief(owner,'nico')).records[0]!;
 t.mock.timers.setTime(new Date('2026-09-28T12:00:00.000Z').getTime());
 assert.equal((await k.readProjectBrief(owner,'nico')).records.length,0);
 const second=await k.importProjectGitHub(owner,'nico',{kind:'commit',sha:revision});assert.deepEqual(second.recordIds,first.recordIds);
 const restarted=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)});
 const view=await restarted.readProjectBrief(restarted.authenticateOwnerToken(token),'nico');
 assert.equal(view.totalRecords,1);assert.equal(view.records.length,1);
 assert.equal(view.records[0]!.projectEvidence.observedAt,initial.projectEvidence.observedAt);
 assert.equal(view.records[0]!.projectEvidence.ingestedAt,initial.projectEvidence.ingestedAt);
 assert.equal(view.records[0]!.projectEvidence.lastVerifiedAt,'2026-09-28T12:00:00.000Z');
 }finally{globalThis.fetch=originalFetch;t.mock.timers.reset();await rm(dir,{recursive:true,force:true});}
});
test('review: exported brief includes mandatory source-linked anchors even when query has no matches',()=>{
 const {projectEvidence:_metadata,...base}=sourceRecord();
 const anchor:MemoryRecord={...base,id:'synthetic-anchor',category:'constitutional',scope:'global',statement:'Synthetic mandatory rule: only the owner authorizes promotion.',source:'constitution/constitution.v1.json',tags:['anchor'],status:'active'};
 const view=projectView([anchor],'nico','unmatched query',new Date(now));
 assert.match(view.handoff,/Preserve the Constitution/);assert.match(view.handoff,/sara:\/\/core-memory\/v1/);assert.doesNotMatch(view.handoff,/Synthetic mandatory rule/);assert.equal(view.records.length,0);
});
test('review: exact SHA cannot satisfy acceptance without canonical current, conflict-free membership',()=>{
 const memory=sourceRecord();const target={stage:'committed' as const,repository:'example/repo',revision};
 // Runtime omission must fail closed as well as the typed API requiring context.
 const check=acceptsEvidence as (...args:unknown[])=>boolean;
 assert.equal(check(memory,target,new Date(now)),false);
 assert.equal(check(memory,target,new Date(now),[memory]),true);
 const correction:EvidenceMemory={...sourceRecord('memory-'+ '2'.repeat(64)),statement:'Synthetic correction',supersedes:[memory.id],projectEvidence:{...memory.projectEvidence,observedAt:'2026-09-27T12:00:00.000Z'}};
 assert.equal(check(memory,target,new Date('2026-09-28T12:00:00Z'),[memory,correction]),false);
 const conflict:EvidenceMemory={...sourceRecord('memory-'+ '3'.repeat(64)),projectEvidence:{...memory.projectEvidence,outcome:'failure',conflictsWith:[memory.id]}};
 assert.equal(check(memory,target,new Date(now),[memory,conflict]),false);
 const superseded:EvidenceMemory={...memory,status:'superseded'};
 assert.equal(check(superseded,target,new Date(now),[superseded]),false);
 const fabricated={...memory,projectEvidence:{...memory.projectEvidence,revision:'b'.repeat(40)}};
 assert.equal(check(fabricated,{...target,revision:'b'.repeat(40)},new Date(now),[memory]),false);
});

test('review: a handoff includes both sides of a conflict even when only one matches the query',()=>{
 const at='2026-09-26T12:00:00.000Z';
 const first=noteInput({project:'nico',text:'Compiler qualification passed, according to a summary.',observedAt:at},at);
 const a={...first,id:evidenceId(first)};
 const second=noteInput({project:'nico',text:'The same qualification failed with a timeout.',observedAt:at,conflictsWith:[a.id]},at);
 const b={...second,id:evidenceId(second)};
 const view=projectView([a,b],'nico','Compiler',new Date(at));
 assert.equal(view.conflicts.length,2);
 assert.ok(view.handoff.includes(a.id));assert.ok(view.handoff.includes(b.id));
 assert.match(view.handoff,/CONFLICT/);
});
