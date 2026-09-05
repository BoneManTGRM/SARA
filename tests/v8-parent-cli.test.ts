import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gunzipSync} from 'node:zlib';
import {canonicalJson,sha256} from '../src/canonical.ts';
// Only external HTTPS is replaced. This is SCRIPTED engineering evidence, never a live benchmark.
test('real parent CLI preserves worker digest, actual verifier evidence, and HTTP accounting through mocked HTTPS',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v8-cli-test-'));
 const loader=join(dir,'fake-https.mjs');
 const fixture=pathToFileURL(resolve('proof/v8-live-fixture.ts')).href;
 await writeFile(loader,`
import {good,mutations} from ${JSON.stringify(fixture)};
let identity;let generations=0;const original=console.log;
console.log=(...args)=>{try{const e=JSON.parse(args[0]);if(e.type==='V8_AWAITING_OWNER_GRANT')identity=e.payload;}catch{}original(...args);};
globalThis.fetch=async(url,init)=>{
 const target=String(url);
 if(target.startsWith('https://raw.githubusercontent.com/BoneManTGRM/SARA/experiment/v8-owner-run-grant/.github/sara/v8-live-owner-grant.json?')){
  if(!identity)throw Error('identity absent');const {contractDigest,implementationCommit,deploymentId,serviceId,nonce}=identity;const now=Date.now();
  return Response.json({schemaVersion:1,caseId:'bounded-inventory-basket-v8-live-01',mode:'live',contractDigest,implementationCommit,deploymentId,serviceId,nonce,maximumPhysicalSpendUsd:0.15,issuedAt:now,expiresAt:now+60000});
 }
 if(target==='https://api.openai.com/v1/responses/input_tokens')return Response.json({input_tokens:100});
 if(target!=='https://api.openai.com/v1/responses')throw Error('test forbids all other network');
 const body=JSON.parse(init.body);const compact=body.input.startsWith('OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1');
 const facts=JSON.parse(body.input.split('\\n').slice(2).join('\\n'));const current=facts.files.find(f=>f.path==='src/inventory.ts');
 const proposal={schemaVersion:1,baseArtifactDigest:facts.currentArtifactDigest,failureFingerprint:facts.failures[0].fingerprint,strategy:facts.requiredStrategy,changes:[{path:current.path,expectedContentDigest:current.contentDigest,...(compact?{edits:mutations.map(m=>({find:m.replace,replace:m.find}))}:{replacementText:good})}],limitations:[]};
 return Response.json({id:'SCRIPTED_RESPONSE_'+(++generations),model:'gpt-5.6-luna',status:'completed',usage:{input_tokens:100,output_tokens:100,output_tokens_details:{reasoning_tokens:0},input_tokens_details:{cached_tokens:0}},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]});
};
`);
 try{
 const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','--import',loader,'proof/v8-railway-supervisor.ts','--await-grant'],{env:{PATH:process.env.PATH,OPENAI_API_KEY:'TEST_ONLY_NOT_A_REAL_KEY',RAILWAY_GIT_COMMIT_SHA:'b'.repeat(40),RAILWAY_DEPLOYMENT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',RAILWAY_SERVICE_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},timeout:60000,maxBuffer:4*1024*1024});
 const events=stdout.trim().split('\n').map(s=>JSON.parse(s));
 const meta=events.find(e=>e.type==='V8_EVIDENCE_META').payload;
 const chunks=events.filter(e=>e.type==='V8_EVIDENCE_CHUNK').sort((a,b)=>a.payload.index-b.payload.index);
 assert.equal(chunks.length,meta.chunks);
 const text=gunzipSync(Buffer.from(chunks.map(e=>e.payload.data).join(''),'base64')).toString();assert.equal(sha256(text),meta.sha256);
 const {evidenceDigest,...record}=JSON.parse(text);assert.equal(evidenceDigest,sha256(canonicalJson(record)));
 const {pairDigest,...worker}=record.supervisor.result;assert.equal(pairDigest,sha256(canonicalJson(worker)));
 assert.equal(record.supervisor.generations,2);assert(record.comparison.arms.every((a:any)=>a.verifiedComplete&&a.finalVerification.passed));
 assert.equal(record.contract.hiddenAssertionCount,50);assert.equal(record.providerCostEstimateUsd,0.00028);
 assert(record.http.filter((r:any)=>r.kind==='generation').every((r:any)=>r.responseId.startsWith('SCRIPTED_')));
 assert(!stdout.includes('TEST_ONLY_NOT_A_REAL_KEY'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
