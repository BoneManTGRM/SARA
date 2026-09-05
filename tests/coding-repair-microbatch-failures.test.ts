import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runVerifiedCodingMicroBatch} from '../src/coding-repair-microbatch.ts';
const tasks=[{id:'a',objective:'a',source:'a'},{id:'b',objective:'b',source:'b'},{id:'c',objective:'c',source:'c'}];
const usage={accountedCostUsd:.03,inputTokens:10,outputTokens:10,elapsedMilliseconds:2};
test('supplies the physical ceiling before the initial batch can spend',async()=>{
 let ceiling:unknown;
 await runVerifiedCodingMicroBatch({tasks,maximumSpendUsd:.1,model:{async proposeBatch(t,c){ceiling=c;return {...usage,proposals:t.map(x=>({id:x.id,source:'fixed'}))};},async proposeSingle(){throw Error('unused');}},verify:async()=>({passed:true,score:1})});
 assert.equal(ceiling,.1);
});
test('failed concurrent fallback retains verified members, settled usage and an unknown-cost reservation',async()=>{
 let err:any;
 try{await runVerifiedCodingMicroBatch({tasks,maximumSpendUsd:.15,model:{async proposeBatch(t){return {...usage,proposals:t.map(x=>({id:x.id,source:x.id==='a'?'fixed':'bad'}))};},async proposeSingle(t){if(t.id==='b')throw Error('PRIVATE_PROVIDER_MESSAGE');return {...usage,accountedCostUsd:.01,proposal:{id:t.id,source:'fixed'}};}},verify:async(_t,s)=>({passed:s==='fixed',score:s==='fixed'?1:0})});}catch(e){err=e;}
 assert(err?.evidence,'failure must expose bounded partial evidence');
 assert.equal(err.evidence.modelCalls,3);assert.equal(err.evidence.accountedCostUsd,null);assert(Math.abs(err.evidence.knownCostUsd-.04)<1e-12);assert(Math.abs(err.evidence.unknownCostReservationUsd-.06)<1e-12);
 assert.deepEqual(err.evidence.results.filter((r:any)=>r.passed).map((r:any)=>r.id),['a','c']);
 assert(!JSON.stringify(err).includes('PRIVATE_PROVIDER_MESSAGE'));
});
test('truthy malformed verifier results cannot become accepted repairs',async()=>{
 await assert.rejects(()=>runVerifiedCodingMicroBatch({tasks,maximumSpendUsd:.15,model:{async proposeBatch(t){return {...usage,proposals:t.map(x=>({id:x.id,source:'bad'}))};},async proposeSingle(){throw Error('unused');}},verify:async()=>({passed:'yes',score:1} as any)}));
});
test('fractional token counters are rejected with reservation preserved',async()=>{
 let err:any;try{await runVerifiedCodingMicroBatch({tasks,maximumSpendUsd:.15,model:{async proposeBatch(t){return {...usage,inputTokens:1.5,proposals:t.map(x=>({id:x.id,source:'fixed'}))};},async proposeSingle(){throw Error('unused');}},verify:async()=>({passed:true,score:1})});}catch(e){err=e;}
 assert(err?.evidence);assert.equal(err.evidence.accountedCostUsd,null);assert.equal(err.evidence.unknownCostReservationUsd,.15);
});
test('initial provider exception is not recorded as zero spending',async()=>{
 let err:any;try{await runVerifiedCodingMicroBatch({tasks,maximumSpendUsd:.15,model:{async proposeBatch(){throw Error('SECRET');},async proposeSingle(){throw Error('unused');}},verify:async()=>({passed:true,score:1})});}catch(e){err=e;}
 assert(err?.evidence);assert.equal(err.evidence.modelCalls,1);assert.equal(err.evidence.unknownCostReservationUsd,.15);assert.equal(err.evidence.accountedCostUsd,null);
});
test('a synchronous fallback exception still allows all reserved sibling outcomes to settle',async()=>{
 let err:any;
 try{await runVerifiedCodingMicroBatch({tasks,maximumSpendUsd:.15,model:{async proposeBatch(t){return {...usage,proposals:t.map(x=>({id:x.id,source:x.id==='a'?'fixed':'bad'}))};},proposeSingle(t){if(t.id==='b')throw Error('sync');return Promise.resolve({...usage,accountedCostUsd:.01,proposal:{id:t.id,source:'fixed'}});}},verify:async(_t,s)=>({passed:s==='fixed',score:s==='fixed'?1:0})});}catch(e){err=e;}
 assert.deepEqual(err.evidence.results.filter((r:any)=>r.passed).map((r:any)=>r.id),['a','c']);
});
