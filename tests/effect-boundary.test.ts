import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadConstitution} from '../src/constitution.ts';
import {evaluatePolicy} from '../src/policy.ts';
import type {ActionType} from '../src/types.ts';

test('effectful policy fails closed for unknown actions, hidden external effects and unmandated writes', async()=>{
  const {constitution}=await loadConstitution();
  for(const action of ['arbitrary_web_instruction','internal_read','external_write']) {
    const decision=evaluatePolicy({constitution,principal:{id:'sara',kind:'sara',authenticated:true},
      request:{action:action as ActionType,targetId:'external:fixture',external:true},currentOwnerRecurringMonthlyUsd:0,emergencyStopped:false});
    assert.equal(decision.allowed,false,action);
  }
});
