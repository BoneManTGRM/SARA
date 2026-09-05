import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluatePair} from '../proof/v7-live-evaluation.ts';
const clean={verifiedComplete:true,timeMs:40,costUsd:0.01,error:null};
test('300 percent means four times speed and cost may not rise',()=>{
 assert.equal(evaluatePair(clean,{...clean,timeMs:10}).target300PercentMet,true);
 assert.equal(evaluatePair(clean,{...clean,timeMs:11}).target300PercentMet,false);
 assert.equal(evaluatePair(clean,{...clean,timeMs:10,costUsd:0.02}).target300PercentMet,false);
});
test('no speed claim for failure or unknown cost',()=>{
 assert.equal(evaluatePair(clean,{...clean,verifiedComplete:false}).speedRatio,null);
 assert.equal(evaluatePair(clean,{...clean,timeMs:9,costUsd:null}).target300PercentMet,false);
 assert.equal(evaluatePair(clean,{...clean,error:'OutputRejected'}).valid,false);
});
test('a slower valid result is not turned into improvement',()=>{
 const result=evaluatePair(clean,{...clean,timeMs:80});assert.equal(result.speedIncreasePercent,-50);assert.equal(result.verdict,'REJECT_REGRESSION');
});
test('failure cannot be compared as a fast completion',()=>{
 const result=evaluatePair({...clean,verifiedComplete:false},{...clean,timeMs:1});
 assert.equal(result.timeComparable,false);assert.equal(result.speedRatio,null);assert.equal(result.target300PercentMet,false);
});
