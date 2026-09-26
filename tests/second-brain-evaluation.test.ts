import assert from 'node:assert/strict';
import {test} from 'node:test';
import {performance} from 'node:perf_hooks';
import {noteInput,evidenceId,projectView} from '../src/second-brain.ts';
import {recallMemories} from '../src/memory-fabric.ts';
// Frozen before evaluation. Small lexical retrieval diagnostic; not a live model benchmark.
const asOf='2026-09-26T12:00:00.000Z';
const fixture=[
 ['compiler','Compiler timeout blocks native qualification.','blocker'],
 ['merge','A summary says merged, but this is only an unverified claim.','note'],
 ['approval','Deployment approval remains pending.','approval'],
 ['goal','Preserve source-linked continuity across sessions.','goal'],
 ['negative','Do not infer deployment from green tests.','constraint'],
 ['conflict','One summary says sanitizer passed; another says sanitizer failed. Unresolved.','note'],
] as const;
const cases=[{query:'compiler timeout',expected:'compiler'},{query:'native qualification',expected:'compiler'},{query:'merged summary',expected:'merge'},{query:'approval pending',expected:'approval'},{query:'source-linked continuity',expected:'goal'},{query:'green tests',expected:'negative'},{query:'sanitizer',expected:'conflict'},{query:'quantum banana',expected:null}];
const records=fixture.map(([label,text,kind])=>{const m=noteInput({project:'nico',text,kind,observedAt:asOf},asOf);return {...m,id:evidenceId(m),label};});
test('frozen lexical retrieval: expected first match or abstention; compare ordinary search',()=>{
 const threshold=1;let correct=0,ordinaryCorrect=0,abstentions=0;const timings:number[]=[];
 for(const c of cases){const start=performance.now();const view=projectView(records,'nico',c.query,new Date(asOf));timings.push(performance.now()-start);const expected=records.find(r=>r.label===c.expected)?.id??null;const actual=view.records[0]?.id??null;correct+=Number(expected===actual);abstentions+=Number(actual===null);
 const ordinary=recallMemories(records,{scope:'nico',query:c.query,now:new Date(asOf)});ordinaryCorrect+=Number((ordinary.relevant[0]?.id??null)===expected);
 assert.ok(view.records.every(m=>m.projectEvidence.verification==='reported'));assert.match(view.handoff,/Unknown/);
 }
 console.log(JSON.stringify({evaluation:'frozen-lexical-v1',cases:cases.length,correct,ordinaryCorrect,abstentions,threshold,latencyMs:timings,providerCalls:0,providerUsage:null,liveJevEvaluated:false}));assert.ok(correct/cases.length>=threshold);assert.ok(correct>=ordinaryCorrect);
});
test('handoff remains compact for maximum-size notes without deleting durable records',()=>{
 const big=Array.from({length:35},(_,i)=>{const m=noteInput({project:'nico',kind:'blocker',text:String(i)+' x'.repeat(3995),observedAt:asOf},asOf);return {...m,id:evidenceId(m)};});
 const view=projectView(big,'nico','',new Date(asOf));assert.ok(view.handoff.length<=16000);assert.equal(view.totalRecords,35);assert.match(view.handoff,/excerpt/);assert.match(view.handoff,/Open Sources/);
});
