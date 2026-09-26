import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createJevSecondBrain,type JevBudget} from '../src/jev-second-brain.ts';
const request={project:'nico',principalId:'owner',query:'compiler',queryApprovedForExternal:true,canRead:()=>true,candidates:[{id:'public',project:'nico',digest:'a'.repeat(64),text:'Compiler evidence',dataClass:'public' as const,freshUntil:'2030-01-01T00:00:00Z'}]};
const raw=()=>({id:'gen-dec-synthetic',provider:'TypeSafe',model:'typesafe/jev-1.13-20260917',answers:{r0:{type:'noul',noul:.9}},usage:{input_tokens:476,output_tokens:70,cost:.000019992}});
function facade(receipts:unknown[]=[],holds:unknown[]=[]):JevBudget{return {reserve:async i=>{holds.push(i);return {id:'hold'};},stillAuthorized:async()=>true,record:async r=>{receipts.push(r);}};}
test('OpenRouter official route pins identity, records billed cost and remains synthetic shadow',async()=>{
 const receipts:any[]=[],holds:any[]=[];let calls=0;
 const adapter=createJevSecondBrain({provider:'openrouter',enabled:true,apiKey:'synthetic-openrouter',budget:facade(receipts,holds),transport:async(url,init)=>{
  calls++;assert.equal(url,'https://openrouter.ai/api/alpha/decisions');assert.equal(init?.redirect,'error');
  const body=JSON.parse(String(init?.body));assert.equal(body.model,'typesafe/jev-1.13');assert.deepEqual(body.provider,{only:['typesafe'],allow_fallbacks:false,data_collection:'deny',max_price:{prompt:.042,completion:0}});
  return new Response(JSON.stringify(raw()));
 }});
 const result=await adapter.rerank(request);assert.equal(result.mode,'simulated_shadow');assert.equal(result.live,false);assert.equal(result.promoted,false);
 assert.equal(adapter.status().provider,'openrouter');assert.equal(result.model,'typesafe/jev-1.13');assert.equal(receipts[0].costMicrousd,20);
 assert.equal(holds[0].questionVersion,'sara-relevance-v3-openrouter-20260917');assert.equal(holds[0].maximumInputTokens,32000);
 assert.equal((await adapter.rerank(request)).cached,true);assert.equal(calls,1);assert.equal((await adapter.rerank({...request,canRead:()=>false})).ids.length,0);
 assert.ok(!JSON.stringify([adapter.status(),result,receipts,holds]).includes('synthetic-openrouter'));
});
test('OpenRouter malformed identity or unknown/over-bound cost retains holds and never claims live qualification',async()=>{
 for(const change of [{model:'~typesafe/jev-latest'},{model:'typesafe/jev-1.14'},{provider:'Other'},{usage:{input_tokens:476,output_tokens:70}},{usage:{input_tokens:476,output_tokens:70,cost:-1}},{usage:{input_tokens:476,output_tokens:70,cost:'0.000019992'}}]){
  const receipts:any[]=[];const a=createJevSecondBrain({provider:'openrouter',enabled:true,apiKey:'synthetic',budget:facade(receipts),transport:async()=>new Response(JSON.stringify({...raw(),...change}))});
  assert.equal((await a.rerank(request)).reason,'malformed');assert.equal(receipts[0].costMicrousd,null);
 }
});
test('OpenRouter never dispatches denied funding; rate limits use one attempt and no invented zero receipt',async()=>{
 let calls=0;const receipts:any[]=[];const transport:typeof fetch=async()=>{calls++;return new Response('',{status:429});};
 const denied=createJevSecondBrain({provider:'openrouter',enabled:true,apiKey:'synthetic',budget:{...facade(),reserve:async()=>null},transport});
 assert.equal((await denied.rerank(request)).reason,'budget_denied');assert.equal(calls,0);
 const a=createJevSecondBrain({provider:'openrouter',enabled:true,apiKey:'synthetic',budget:facade(receipts),transport});assert.equal((await a.rerank(request)).reason,'rate_limited');assert.equal(calls,1);assert.equal(receipts[0].costMicrousd,null);
});

test('environment requires explicit route and never substitutes another provider credential',async()=>{
 const {jevEnvironment}=await import('../src/jev-contract.ts');
 const keys={TYPESAFE_API_KEY:'synthetic-direct',OPENROUTER_API_KEY:'synthetic-router'};
 assert.equal(jevEnvironment({...keys,SARA_JEV_PROVIDER:'openrouter'}).jevApiKey,keys.OPENROUTER_API_KEY);
 assert.equal(jevEnvironment(keys).jevApiKey,keys.TYPESAFE_API_KEY);
 assert.equal(jevEnvironment({SARA_JEV_PROVIDER:'openrouter',TYPESAFE_API_KEY:'synthetic-direct'}).jevApiKey,undefined);
 assert.equal(jevEnvironment({...keys,SARA_JEV_PROVIDER:'arbitrary'}).jevDisabled,true);
 assert.equal(jevEnvironment({...keys,SARA_JEV_PROVIDER:'arbitrary'}).jevApiKey,undefined);
});

test('OpenRouter observed over-bound cost is retained for durable freeze rather than unknown zero',async()=>{
 const receipts:any[]=[];const adapter=createJevSecondBrain({provider:'openrouter',enabled:true,apiKey:'synthetic',budget:facade(receipts),transport:async()=>new Response(JSON.stringify({...raw(),usage:{input_tokens:476,output_tokens:70,cost:1}}))});
 assert.equal((await adapter.rerank(request)).reason,'budget_denied');assert.equal(receipts[0].outcome,'bound_exceeded');assert.equal(receipts[0].costMicrousd,1e6);assert.equal(receipts[0].billedCostUsd,1);
});
test('billing violation survives malformed decisions and invalid or excess token counts',async()=>{
 for(const changed of [{answers:{}},{answers:null},{usage:{cost:1,input_tokens:40000,output_tokens:70}},{usage:{cost:1,input_tokens:'unknown',output_tokens:null}}]){
 const receipts:any[]=[];const adapter=createJevSecondBrain({provider:'openrouter',enabled:true,apiKey:'synthetic',budget:facade(receipts),transport:async()=>new Response(JSON.stringify({...raw(),usage:{cost:1,input_tokens:476,output_tokens:70},...changed}))});
 assert.equal((await adapter.rerank(request)).reason,'budget_denied');assert.equal(receipts[0].outcome,'bound_exceeded');assert.equal(receipts[0].costMicrousd,1e6);
 }
});
