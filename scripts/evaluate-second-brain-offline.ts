import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {noteInput,evidenceId,projectView} from '../src/second-brain.ts';
import {recallMemories} from '../src/memory-fabric.ts';
import {sha256} from '../src/canonical.ts';

// Offline diagnostic only: no credential, provider transport or spending surface.
const bytes=await readFile(new URL('../tests/fixtures/second-brain-jev-evaluation.v1.json',import.meta.url),'utf8');
const fixture=JSON.parse(bytes) as {version:string;asOf:string;records:{id:string;text:string;kind:string;contentDigest:string;conflictsWith?:string[]}[];cases:{id:string;group:string;query:string;relevantIds:string[];answerMustBeUnknownOrDeclined:boolean}[]};
const ids=new Map<string,string>();
const memories=fixture.records.map(r=>{
 if(sha256(r.text)!==r.contentDigest)throw new Error('Frozen fixture content digest mismatch');
 const memory=noteInput({project:'nico',text:r.text,kind:r.kind,observedAt:fixture.asOf,conflictsWith:r.conflictsWith?.map(id=>{const bound=ids.get(id);if(!bound)throw Error('Fixture relationship order');return bound;})},fixture.asOf);
 const id=evidenceId(memory);ids.set(r.id,id);return {...memory,id};
});
const label=(id:string|undefined)=>id?[...ids].find(([,value])=>value===id)?.[0]??null:null;
const outcomes=fixture.cases.map(c=>{
 const start=performance.now();const view=projectView(memories,'nico',c.query,new Date(fixture.asOf));const elapsedMs=performance.now()-start;
 const ordinary=recallMemories(memories,{scope:'nico',query:c.query,now:new Date(fixture.asOf)});
 const first=label(view.records[0]?.id),ordinaryFirst=label(ordinary.relevant[0]?.id);
 return {...c,first,ordinaryFirst,correct:c.relevantIds.length?c.relevantIds.includes(first??''):first===null,ordinaryCorrect:c.relevantIds.length?c.relevantIds.includes(ordinaryFirst??''):ordinaryFirst===null,elapsedMs,verifiedStageRemainsUnknown:!view.handoff.includes('\n- tests_passed:')&&!view.handoff.includes('\n- deployed:'),conflictIds:view.conflicts.map(m=>label(m.id))};
});
const answerable=outcomes.filter(c=>c.relevantIds.length),times=outcomes.map(c=>c.elapsedMs).sort((a,b)=>a-b);
console.log(JSON.stringify({version:fixture.version,fixtureDigest:sha256(bytes),mode:'offline_deterministic_only',cases:outcomes.length,answerable:answerable.length,top1Correct:answerable.filter(c=>c.correct).length,ordinaryTop1Correct:answerable.filter(c=>c.ordinaryCorrect).length,emptyRetrievals:outcomes.filter(c=>c.first===null).length,unsupportedQueries:outcomes.filter(c=>c.answerMustBeUnknownOrDeclined).length,unsupportedWithLexicalMatches:outcomes.filter(c=>c.answerMustBeUnknownOrDeclined&&c.first!==null).length,p95LatencyMs:times[Math.ceil(times.length*.95)-1],providerCalls:0,providerUsage:null,liveJevQuality:'unknown',promoted:false,outcomes},null,2));
