import assert from 'node:assert/strict';
import {test} from 'node:test';
import {discoverProjectUpdates} from '../src/project-updates.ts';
import {prepareProjectQuestion} from '../src/project-question.ts';
import {projectView,noteInput,evidenceId} from '../src/second-brain.ts';
const repo={full_name:'BoneManTGRM/SARA',private:false};
test('discovery pins bounded exact public objects and states partial coverage',async()=>{
 const paths:string[]=[];
 const payloads=[repo,[{sha:'a'.repeat(40)}],[{number:200}],{workflow_runs:[{id:123,run_attempt:2}]}];
 const result=await discoverProjectUpdates('sara',{fetch:async(url,init)=>{paths.push(String(url));assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(payloads.shift());}});
 assert.equal(result.status,'complete');assert.deepEqual(result.targets,[{kind:'commit',sha:'a'.repeat(40)},{kind:'pr',number:200},{kind:'workflow',runId:123,attempt:2}]);assert.equal(paths.length,4);assert.match(result.coverage,/partial/i);
});
test('discovery refuses private/wrong repo, oversized payloads and bounded timeout',async()=>{
 for(const metadata of [{...repo,private:true},{...repo,full_name:'other/repo'}]) {let calls=0;const r=await discoverProjectUpdates('sara',{fetch:async()=>{calls++;return Response.json(metadata);}});assert.equal(r.status,'failed');assert.equal(calls,1);assert.deepEqual(r.targets,[]);}
 for(const f of [async()=>new Response('x'.repeat(270000)),async()=>new Response('limit',{status:429}),async()=>new Promise<Response>(()=>{})])assert.equal((await discoverProjectUpdates('sara',{fetch:f,timeoutMs:10})).status,'failed');
});
test('question preview excludes private evidence unless explicitly selected and binds scope/content',()=>{
 const now=new Date();const a=noteInput({project:'sara',text:'Private compiler blocker',kind:'blocker'},now.toISOString());const record={...a,id:evidenceId(a)};const view=projectView([record],'sara','compiler',now);
 const publicOnly=prepareProjectQuestion(view,'compiler',false);assert.equal(publicOnly.sources.length,0);assert.ok(!publicOnly.text.includes('Private'));
 const privatePreview=prepareProjectQuestion(view,'compiler',true);assert.equal(privatePreview.sources[0]?.id,record.id);assert.ok(privatePreview.text.includes('Private compiler blocker'));assert.ok(privatePreview.text.length<=1200);assert.notEqual(publicOnly.digest,privatePreview.digest);
 assert.notEqual(privatePreview.digest,prepareProjectQuestion({...view,project:'nico'},'compiler',true).digest);
 assert.throws(()=>prepareProjectQuestion(view,'x'.repeat(301),true));
});
test('question preview never sends conflict/stale records and discloses bounded excerpts',()=>{
 const now=new Date();const a=noteInput({project:'sara',text:'compiler '+ 'long text '.repeat(500)},now.toISOString());const record={...a,id:evidenceId(a)};const view=projectView([record],'sara','compiler',now);
 const preview=prepareProjectQuestion(view,'compiler',true);assert.equal(preview.sources[0]?.truncated,true);assert.ok(preview.text.length<=1200);
 assert.equal(prepareProjectQuestion({...view,conflicts:[record]},'compiler',true).sources.length,0);
});

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {createSaraServer} from '../src/server.ts';
import type {AddressInfo} from 'node:net';
import {OwnerAssistant} from '../src/owner-assistant.ts';
test('refresh admission is authenticated, durable, scoped and cross-instance serialized',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-refresh-')),token='synthetic-owner';const originalFetch=globalThis.fetch;
 let calls=0;globalThis.fetch=async()=>{calls++;return new Response('unavailable',{status:503});};
 try {
  const k=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),o=k.authenticateOwnerToken(token);
  await assert.rejects(k.refreshProjectGitHub(SARA_PRINCIPAL,'sara'),/owner/i);assert.equal(calls,0);
  const other=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  const results=await Promise.all([k.refreshProjectGitHub(o,'sara'),other.refreshProjectGitHub(other.authenticateOwnerToken(token),'sara')]);
  assert.deepEqual(results.map(r=>r.status).sort(),['cooldown','failed']);assert.equal(calls,1);
  const restarted=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  assert.equal((await restarted.refreshProjectGitHub(restarted.authenticateOwnerToken(token),'sara')).status,'cooldown');assert.equal(calls,1);
 }finally{globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});}
});
test('HTTP question requires exact preview/disclosure, excludes other projects and emits no calls while disabled',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-question-')),token='synthetic-owner';
 const k=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),o=k.authenticateOwnerToken(token);
 await k.captureProjectNote(o,{project:'sara',text:'Compiler blocker',kind:'blocker'});
 await k.captureProjectNote(o,{project:'nico',text:'Compiler PRIVATE OTHER PROJECT',kind:'blocker'});
 const s=createSaraServer(k,{ownerTokenSha256:sha256(token),productMode:'second_brain'});
 await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(s.address() as AddressInfo).port;
 const query={project:'sara',query:'compiler',includePrivate:true};
 const post=(path:string,body:unknown,auth=true)=>fetch(base+'/api/second-brain/'+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 try {
  assert.equal((await post('question/preview',query,false)).status,401);assert.equal((await post('refresh',{project:'sara'},false)).status,401);
  const p=await post('question/preview',query);assert.equal(p.headers.get('cache-control'),'no-store');const preview=await p.json() as ReturnType<typeof prepareProjectQuestion> & {configured:boolean};assert.equal(preview.configured,false);assert.equal(preview.sources.length,1);assert.ok(!JSON.stringify(preview).includes('OTHER PROJECT'));
  assert.equal((await post('question/ask',{...query,digest:preview.digest})).status,400);
  assert.equal((await post('question/ask',{...query,digest:'wrong',approveDisclosure:true})).status,400);
  assert.equal(((await (await post('question/ask',{...query,digest:preview.digest,approveDisclosure:true})).json()) as {mode:string}).mode,'unavailable');
  assert.equal((await post('question/preview',{...query,includePrivate:'yes'})).status,400);
 }finally{await new Promise<void>(r=>s.close(()=>r()));await rm(directory,{recursive:true,force:true});}
});
test('AI dispatch rechecks current authorization and never sends after refusal',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-ai-gate-'));let calls=0;
 const assistant=new OwnerAssistant({stateDirectory:directory,monthlyBudgetUsd:1,modelClient:{routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,countInputTokens:async()=>100,execute:async()=>{calls++;return {outputText:'A proposal only',inputTokens:100,billableOutputTokens:20};}}});
 try{await assert.rejects(assistant.analyze({requestId:'project:synthetic-authority-gate',text:'Synthetic compiler query',beforeDispatch:async()=>false}));assert.equal(calls,0);}finally{await rm(directory,{recursive:true,force:true});}

});
test('configured question path sends only approved context, preserves provenance and suppresses replay dispatch',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-question-ai-')),token='synthetic-owner';let calls=0;let prompt='';
 const k=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),o=k.authenticateOwnerToken(token);
 await k.captureProjectNote(o,{project:'sara',text:'Compiler blocker',kind:'blocker'});
 const assistant=new OwnerAssistant({stateDirectory:directory,monthlyBudgetUsd:1,modelClient:{routeKey:'openai:gpt-5.6-luna:paid',maximumWallTimeMs:1000,countInputTokens:async()=>100,execute:async input=>{calls++;prompt=input.prompt;return {outputText:'Review the reported compiler blocker [S1].',inputTokens:100,billableOutputTokens:20};}}});
 const s=createSaraServer(k,{ownerTokenSha256:sha256(token),projectAssistant:assistant});await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+(s.address() as AddressInfo).port;const query={project:'sara',query:'compiler',includePrivate:true};
 const post=(path:string,body:unknown)=>fetch(base+'/api/second-brain/question/'+path,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 try {
  const preview=await (await post('preview',query)).json() as ReturnType<typeof prepareProjectQuestion> & {configured:boolean};assert.equal(preview.configured,true);
  const body={...query,digest:preview.digest,approveDisclosure:true};
  const first=await post('ask',body);assert.equal(first.status,200);const result=await first.json() as {mode:string;notice:string;sources:{id:string}[]};assert.equal(result.mode,'ai_analysis');assert.match(result.notice,/unverified/);assert.equal(result.sources[0]!.id,preview.sources[0]!.id);assert.ok(prompt.includes(preview.text));assert.equal(calls,1);
  assert.equal(((await (await post('ask',body)).json()) as {outcome:string}).outcome,'already_processed');assert.equal(calls,1);
  await k.captureProjectNote(o,{project:'sara',text:'compiler changed context',kind:'blocker'});
  assert.equal((await post('ask',body)).status,400);assert.equal(calls,1);
 }finally{await new Promise<void>(r=>s.close(()=>r()));await rm(directory,{recursive:true,force:true});}
});
test('a refresh imports exact discovered observations without claiming test or deployment success',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-refresh-success-')),token='synthetic-owner',originalFetch=globalThis.fetch;
 const sha='a'.repeat(40),date='2026-09-20T10:00:00Z';let calls=0;
 globalThis.fetch=async(url)=>{calls++;const path=String(url).replace('https://api.github.com/repos/BoneManTGRM/SARA','');
 const data=path===''?repo:path==='/commits?per_page=1'?[{sha}]:path.startsWith('/pulls?')?[{number:200}]:path==='/actions/runs?per_page=1'?{workflow_runs:[{id:123,run_attempt:2}]}:path==='/commits/'+sha?{sha,commit:{message:'Compiler repair',committer:{date}}}:path==='/pulls/200'?{number:200,state:'open',merged:false,head:{sha},base:{repo},updated_at:date,title:'Compiler repair',body:'Reported compiler change'}:{id:123,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success',updated_at:date,repository:repo};return Response.json(data);};
 try{const k=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),o=k.authenticateOwnerToken(token);const before=await k.getStatus();const result=await k.refreshProjectGitHub(o,'sara');assert.equal(result.status,'complete');assert.equal(result.receipts.length,3);assert.equal(calls,10);const view=await k.readProjectBrief(o,'sara');assert.equal(view.totalRecords,3);assert.ok(!view.records.some(r=>['tests_passed','deployed','production_verified'].includes(r.projectEvidence.stage??'')));assert.deepEqual((await k.getStatus()).jobs,before.jobs);}finally{globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});}
});
