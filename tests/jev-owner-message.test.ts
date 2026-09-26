import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {jevOwnerMessage} from '../src/second-brain-ui.ts';

test('owner message distinguishes cached, simulated, uncertain and ambiguous results',()=>{
 const live={mode:'live_shadow',live:true,cached:false,reason:'uncertain_shadow'};
 assert.match(jevOwnerMessage(live),/could not choose/i);
 assert.match(jevOwnerMessage({...live,reason:'ambiguous_shadow'}),/too close/i);
 assert.match(jevOwnerMessage({...live,cached:true}),/earlier live result.*no new provider call/i);
 assert.match(jevOwnerMessage({...live,mode:'simulated_shadow',live:false}),/simulated test result/i);
 assert.match(jevOwnerMessage({...live,reason:'unqualified_shadow'}),/not yet qualified/i);
});

test('fallback explains setup and unknown outcomes without claiming no charge or exposing raw data',()=>{
 assert.match(jevOwnerMessage({mode:'local_search',reason:'missing_key'}),/secure.*key/i);
 assert.match(jevOwnerMessage({mode:'local_search',reason:'budget_denied'}),/allowance/i);
 for(const reason of ['timeout','unavailable','rate_limited','malformed','constructor','__proto__','<script>private-secret</script>']){
  const message=jevOwnerMessage({mode:'local_search',reason,secret:'private-secret'});
  assert.match(message,/local search/i);assert.doesNotMatch(message,/private-secret|<script>|no charge|no provider call/i);
 }
 assert.match(jevOwnerMessage(null),/unavailable/i);
});

test('the actual browser-embedded formatter runs without server-only dependencies',()=>{
 const input={mode:'live_shadow',live:true,cached:true,reason:'ambiguous_shadow'};
 const text=runInNewContext('('+jevOwnerMessage.toString()+')(input)',{input},{timeout:100});
 assert.match(text,/earlier live result/);assert.match(text,/too close/);
});
