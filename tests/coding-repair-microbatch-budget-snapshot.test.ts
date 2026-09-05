import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runVerifiedCodingMicroBatch,CodingMicroBatchExecutionError} from '../src/coding-repair-microbatch.ts';
const usage={accountedCostUsd:0.01,inputTokens:10,outputTokens:10,elapsedMilliseconds:1};
for(const replacement of [10,0,Number.NaN])test(`caller cannot replace the admitted budget with ${String(replacement)} after dispatch`,async()=>{
 const ceilings:Array<number|undefined>=[];
 const input:Parameters<typeof runVerifiedCodingMicroBatch>[0]={
  tasks:[{id:'a',objective:'return one',source:'broken'},{id:'b',objective:'return two',source:'broken'}],maximumSpendUsd:0.05,
  verify:async(_task,source)=>({passed:source==='fixed',score:source==='fixed'?1:0}),
  model:{async proposeBatch(tasks,ceiling){ceilings.push(ceiling);input.maximumSpendUsd=replacement;return {...usage,proposals:tasks.map(t=>({id:t.id,source:t.id==='a'?'fixed':'broken'}))};},
   async proposeSingle(task,ceiling){ceilings.push(ceiling);return {...usage,proposal:{id:task.id,source:'fixed'}};}}
 };
 const result=await runVerifiedCodingMicroBatch(input);
 assert.deepEqual(ceilings,[0.05,0.04]);assert.equal(result.verifiedComplete,2);assert.equal(result.accountedCostUsd,0.02);
});
test('invalid usage keeps the initial reservation even if the input budget is mutated',async()=>{
 const input:Parameters<typeof runVerifiedCodingMicroBatch>[0]={tasks:[{id:'a',objective:'return one',source:'broken'}],maximumSpendUsd:0.05,verify:async()=>({passed:true,score:1}),
 model:{async proposeBatch(tasks){input.maximumSpendUsd=10;return {...usage,inputTokens:0.5,proposals:tasks.map(t=>({id:t.id,source:'fixed'}))};},async proposeSingle(){throw Error('unused');}}};
 try{await runVerifiedCodingMicroBatch(input);assert.fail('must fail');}catch(error){assert(error instanceof CodingMicroBatchExecutionError);assert.equal(error.evidence.accountedCostUsd,null);assert.equal(error.evidence.unknownCostReservationUsd,0.05);}
});
