import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GeminiInteractionsClient} from '../src/gemini-worker.ts';
function client(value: unknown, status=200) { let calls=0; return {get calls(){return calls;}, worker:new GeminiInteractionsClient({apiKey:'fake-fixture-only',billingMode:'paid',timeoutMs:100,fetchImpl:async()=>{calls++;return Response.json(value,{status});}})}; }
test('Gemini tokenizer uses exact model and structured Unicode input instead of bytes',async()=>{
  const prompt='const héllo = "你好 😀";'; let calls=0;
  const w=new GeminiInteractionsClient({apiKey:'fake-fixture-only',billingMode:'paid',fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens');
    assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');
    assert.deepEqual(JSON.parse(init!.body as string),{contents:[{role:'user',parts:[{text:prompt}]}]});
    assert.equal(new Headers(init!.headers).get('x-goog-api-key'),'fake-fixture-only');
    return Response.json({totalTokens:7});}});
  assert.equal(await w.countInputTokens(prompt),7);assert.notEqual(Buffer.byteLength(prompt),7);assert.equal(calls,1);
});
for(const value of [{},null,[],{totalTokens:-1},{totalTokens:1.5},{totalTokens:'4'},{totalTokens:Number.MAX_SAFE_INTEGER+1}]){
  test(`Gemini invalid tokenizer response rejects without byte fallback: ${JSON.stringify(value)}`,async()=>{
    const c=client(value);await assert.rejects(c.worker.countInputTokens('export const x=1'),/GEMINI_TOKEN_COUNT_UNAVAILABLE/);assert.equal(c.calls,1);
  });
}
test('Gemini tokenizer HTTP failure and empty prompt never dispatch generation',async()=>{
  const c=client({error:'sensitive message'},401);await assert.rejects(c.worker.countInputTokens('hello'),/GEMINI_TOKEN_COUNT_UNAVAILABLE/);
  await assert.rejects(c.worker.countInputTokens('  '));assert.equal(c.calls,1);
});
test('Gemini tokenizer deadline covers stalled body after headers',async()=>{
  let cancelled=false;
  const w=new GeminiInteractionsClient({apiKey:'fake',billingMode:'free',timeoutMs:100,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
  await assert.rejects(w.countInputTokens('hello'),/GEMINI_TOKEN_COUNT_UNAVAILABLE/);await new Promise(r=>setTimeout(r,10));assert(cancelled);
});
test('Gemini tokenizer invalid UTF8 and excessive body are rejected',async()=>{
  for(const bytes of [Uint8Array.of(0xff),new Uint8Array(65537)]){
    const w=new GeminiInteractionsClient({apiKey:'fake',billingMode:'free',fetchImpl:async()=>new Response(bytes)});
    await assert.rejects(w.countInputTokens('hello'),/GEMINI_TOKEN_COUNT_UNAVAILABLE/);
  }
});
