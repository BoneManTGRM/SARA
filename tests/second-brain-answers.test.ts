import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {noteInput,evidenceId,projectView,type EvidenceMemory} from '../src/second-brain.ts';
import {recallMemories} from '../src/memory-fabric.ts';
import {sha256} from '../src/canonical.ts';
const bytes=readFileSync(new URL('./fixtures/guided-project-questions.v1.json',import.meta.url),'utf8');
const fixture=JSON.parse(bytes) as {version:string;asOf:string;threshold:number;cases:[string,string|null][]};
const now=new Date(fixture.asOf);
function note(text:string,kind='decision',project='nico'):EvidenceMemory{const m=noteInput({project,text,kind,source:'https://example.com/source',observedAt:'2026-09-25T10:00:00Z'},fixture.asOf);return {...m,id:evidenceId(m)};}
const records=[note('Use the blue layout.'),note('Compiler cannot finish.','blocker'),note('Inspect the public build log.','next_action'),note('Owner sign-off is still needed.','approval'),note('Misleading summary: everything shipped.','note')];
test('frozen guided questions route by saved category; ordinary search is only a comparison',()=>{
 let correct=0,abstentions=0,ordinaryHits=0;const times:number[]=[];
 for(const [query,expected] of fixture.cases){const start=performance.now();const v=projectView(records,'nico',query,now);times.push(performance.now()-start);
  const ordinary=query.trim()?recallMemories(records,{scope:'nico',query,now}):null;ordinaryHits+=Number(expected!==null&&ordinary?.relevant[0]?.projectEvidence?.kind===expected);
  if(expected===null){assert.equal(v.answer,null);abstentions++;correct++;continue;}
  assert.equal(v.answer?.kind,expected);assert.equal(v.answer?.status,'reported');assert.equal(v.answer?.authorization,'not_established');assert.equal(v.answer?.total,1);
  assert.equal(v.records[0]?.projectEvidence.kind,expected);assert.equal(v.answer?.sources[0]?.id,v.records[0]?.id);assert.equal(v.answer?.sources[0]?.source,'https://example.com/source');assert.match(v.handoff,/Question answer/);correct++;
 }
 console.log(JSON.stringify({version:fixture.version,digest:sha256(bytes),correct,cases:fixture.cases.length,abstentions,ordinaryCategoryTop1:ordinaryHits,latencyMs:times,providerCalls:0,providerUsage:null,liveJevEvaluated:false}));assert.equal(correct/fixture.cases.length,fixture.threshold);
});
test('unknown answers do not infer no blockers, approval, or an authorized action',()=>{
 for(const query of ['What is blocked?','What is the next authorized step?','What needs approval?']){const v=projectView([],'nico',query,now);assert.equal(v.answer?.status,'unknown');assert.equal(v.answer?.authorization,'not_established');assert.match(v.answer?.notice??'',/Unknown/);assert.deepEqual(v.answer?.sources,[]);}
});
test('answers exclude stale, superseded and foreign evidence; late ingestion never makes an old observation current',()=>{
 const old=note('Old choice.'),replacement=note('New choice.');replacement.projectEvidence.observedAt='2026-09-26T10:00:00Z';replacement.supersedes=[old.id];old.projectEvidence.ingestedAt=fixture.asOf;
 const stale=note('Expired choice.');stale.projectEvidence.expiresAt='2026-09-25T11:00:00Z';const foreign=note('FOREIGN PRIVATE','decision','sara');
 const v=projectView([old,replacement,stale,{...foreign,projectEvidence:{...foreign.projectEvidence,kind:'decision'}}],'nico','What was decided?',now);
 assert.deepEqual(v.answer?.sources.map(x=>x.id),[replacement.id]);assert.ok(!JSON.stringify(v.answer).includes('FOREIGN'));assert.equal(v.history.length,2);
});
test('contradictions cannot become a settled answer and both sources stay visible',()=>{
 const a=note('Use blue.'),b=note('Use red.');b.projectEvidence.conflictsWith=[a.id];const v=projectView([a,b],'nico','What was decided?',now);
 assert.equal(v.answer?.status,'conflict');assert.equal(v.answer?.sources.length,2);assert.equal(v.answer?.conflictCount,2);assert.ok(v.conflicts.some(x=>x.id===a.id)&&v.conflicts.some(x=>x.id===b.id));assert.match(v.handoff,/CONFLICT/);
});
test('bounded answers and handoffs disclose omitted sources',()=>{
 const v=projectView(Array.from({length:40},(_,i)=>note(`${i} ${'x'.repeat(7900)}`)),'nico','What was decided?',now);
 assert.equal(v.answer?.total,40);assert.equal(v.answer?.sources.length,10);assert.equal(v.answer?.omitted,30);assert.ok(v.handoff.length<=16000);assert.ok(v.answer?.sources.every(x=>x.excerpt.length<=500));
});
