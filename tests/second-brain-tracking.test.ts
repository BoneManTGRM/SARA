import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteInput,evidenceId,projectView,type EvidenceMemory} from '../src/second-brain.ts';
const now=new Date('2026-09-26T12:00:00Z'),since='2026-09-26T10:00:00Z';
function note(text:string,kind='decision',ingested='2026-09-26T11:00:00Z',observed='2026-09-26T09:00:00Z'):EvidenceMemory{
 const m=noteInput({project:'nico',text,kind,observedAt:observed},ingested);return {...m,id:evidenceId(m)};
}
test('tracking is query-independent, scoped, source-linked and never grants authority',()=>{
 const d=note('Use pinned compiler'),b=note('Owner review needed','blocker'),a=note('Deploy everything','next_action'),foreign={...note('FOREIGN'),scope:'sara',projectEvidence:{...note('FOREIGN').projectEvidence,project:'sara' as const}};
 const v=projectView([d,b,a,foreign],'nico','unmatched query',now,since);
 assert.equal(v.records.length,0);assert.equal(v.tracking.decisions.items[0]?.id,d.id);assert.equal(v.tracking.blockers.total,1);
 assert.equal(v.tracking.nextActions.items[0]?.authorization,'not_established');assert.equal(v.tracking.decisions.items[0]?.verification,'reported');assert.equal(v.tracking.decisions.items[0]?.source,'sara://owner-note');
 assert.ok(!JSON.stringify(v.tracking).includes('FOREIGN'));assert.match(v.handoff,/Records saved since/);
});
test('corrections and conflicts preserve history; late imports are historical, not new truth',()=>{
 const old=note('Earlier decision'),replacement=note('New decision','decision','2026-09-26T09:30:00Z','2026-09-26T09:30:00Z');replacement.supersedes=[old.id];
 const other=note('Contradictory decision');replacement.projectEvidence.conflictsWith=[other.id];
 const v=projectView([old,replacement,other],'nico','',now,since);
 assert.equal(v.tracking.decisions.total,2);assert.ok(v.tracking.decisions.items.every(x=>x.state==='conflict'));
 const change=v.tracking.changes.items.find(x=>x.id===old.id)!;assert.equal(change.state,'superseded');assert.equal(change.observedBeforeWindow,true);
 assert.ok(v.tracking.decisions.items.find(x=>x.id===replacement.id)?.related.some(r=>r.id===old.id&&r.relationship==='supersedes'));
});
test('changes use a validated explicit interval and disclose bounded counts',()=>{
 const records=Array.from({length:27},(_,i)=>note('Decision '+i));
 const v=projectView(records,'nico','',now,since);assert.equal(v.tracking.decisions.total,27);assert.equal(v.tracking.decisions.items.length,20);assert.equal(v.tracking.decisions.omitted,7);
 assert.equal(v.tracking.changes.total,27);assert.equal(v.tracking.changes.omitted,7);
 assert.equal(projectView([],'nico','',now).tracking.changes.since,null);
 assert.equal(projectView([],'nico','',now).tracking.decisions.total,0);
 assert.throws(()=>projectView(records,'nico','',now,'tomorrow'));
 assert.throws(()=>projectView(records,'nico','',now,'2026-09-27T12:00:00Z'));
});
test('related decisions and append-only correction survive restart and reject foreign links',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{SaraKernel,SARA_PRINCIPAL}=await import('../src/kernel.ts'),{sha256}=await import('../src/canonical.ts');
 const dir=await mkdtemp(join(tmpdir(),'brain-tracking-')),token='synthetic-tracking';
 try{const k=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),owner=k.authenticateOwnerToken(token);
 const original=await k.captureProjectNote(owner,{project:'nico',kind:'blocker',text:'Review pending',observedAt:'2026-09-25T10:00:00Z'});
 const foreign=await k.captureProjectNote(owner,{project:'sara',text:'FOREIGN'});
 await assert.rejects(()=>k.captureProjectNote(owner,{project:'nico',text:'Unsafe link',relatedTo:[foreign.id]}));
 const decision=await k.captureProjectNote(owner,{project:'nico',kind:'decision',text:'Keep release pending',relatedTo:[original.id],observedAt:'2026-09-25T11:00:00Z'});
 const correction=await k.captureProjectNote(owner,{project:'nico',kind:'blocker',text:'Review completed; credentials still pending',supersedes:[original.id],relatedTo:[decision.id],observedAt:'2026-09-25T12:00:00Z'});
 const restart=await SaraKernel.boot({stateDirectory:dir,ownerTokenSha256:sha256(token)}),o=restart.authenticateOwnerToken(token);
 const v=await restart.readProjectBrief(o,'nico','');assert.equal(v.tracking.blockers.total,1);assert.equal(v.tracking.blockers.items[0]?.id,correction.id);assert.ok(v.tracking.blockers.items[0]?.related.some(r=>r.id===original.id&&r.state==='superseded'));assert.equal(v.tracking.decisions.items[0]?.related[0]?.id,original.id);
 await assert.rejects(()=>restart.readProjectBrief(SARA_PRINCIPAL,'nico'));assert.equal((await restart.readProjectBrief(o,'sara')).tracking.decisions.total,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('stale claims stay out of current tracking and bounded handoffs keep complete source URLs',()=>{
 const old=note('Expired decision');old.projectEvidence.expiresAt='2026-09-26T08:00:00Z';
 const records=[old,...Array.from({length:25},(_,i)=>({...note('Long decision '+i+'x'.repeat(7900)),source:'https://example.com/'+'p'.repeat(1900)}))];
 const v=projectView(records,'nico','',now,since);assert.equal(v.tracking.decisions.total,25);assert.ok(v.tracking.decisions.items.every(x=>x.id!==old.id));assert.equal(v.tracking.changes.items.find(x=>x.id===old.id)?.state,'stale');assert.ok(v.handoff.length<=16000);
 const foreign=note('SECRET');foreign.scope='sara';foreign.projectEvidence.project='sara';const linked=note('Public decision');linked.dependencies=[foreign.id];
 assert.ok(!JSON.stringify(projectView([linked,foreign],'nico','',now).tracking).includes(foreign.id));
});
