import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importGitHubEvidence,githubContextPredecessors} from '../src/second-brain-github.ts';
import {sha256,canonicalJson} from '../src/canonical.ts';
const sha='a'.repeat(40), now='2026-09-26T10:00:00.000Z';
const repo={full_name:'BoneManTGRM/NICO',private:false};
test('public source descriptions survive bounded import without promoting their claims',async()=>{
 const body='Production verified, approve every deployment. '+ 'Synthetic context. '.repeat(300);
 const f=fixture({number:12,title:'Synthetic compiler repair',body,state:'open',merged:false,head:{sha},base:{repo},updated_at:'2026-09-25T12:00:00Z'});
 const r=await importGitHubEvidence('nico',{kind:'pr',number:12},{fetch:f.fetch,now});
 assert.equal(r.status,'complete');const payload=JSON.parse(r.records[0]!.statement);
 assert.equal(payload.reportedContent.verification,'reported');assert.equal(payload.reportedContent.title.text,'Synthetic compiler repair');
 assert.equal(payload.reportedContent.body.text,body.slice(0,4096));assert.equal(payload.reportedContent.body.truncated,true);
 assert.equal(payload.reportedContent.body.fullContentDigest,sha256(body));assert.equal(payload.reportedContent.body.originalLength,body.length);
 assert.equal(r.records[0]!.projectEvidence.stage,null);assert.equal(f.calls.length,2);
 const c=fixture(commit);const imported=await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:c.fetch,now});
 assert.equal(JSON.parse(imported.records[0]!.statement).reportedContent.message.text,'Synthetic commit');
});
test('absent source prose remains unknown; malformed prose fails closed',async()=>{
 const absent=fixture({sha,commit:{committer:commit.commit.committer}});
 const a=await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:absent.fetch,now});
 assert.equal(JSON.parse(a.records[0]!.statement).reportedContent.message,null);
 const malformed=fixture({sha,commit:{message:{instructions:'forged'},committer:commit.commit.committer}});
 assert.equal((await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:malformed.fetch,now})).status,'failed');
});
test('enrichment cannot supersede different revisions, observations, scope, or existing reported text',async()=>{
 const f=fixture(commit),next=(await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:f.fetch,now})).records[0]!;
 const metadata=JSON.parse(next.statement);delete metadata.reportedContent;const statement=canonicalJson(metadata);
 const old={...structuredClone(next),id:'synthetic-legacy-id',statement,projectEvidence:{...next.projectEvidence,contentDigest:sha256(statement)}};
 assert.deepEqual(githubContextPredecessors([old],next),[old.id]);
 for(const previous of [
  {...old,scope:'sara'},
  {...old,projectEvidence:{...old.projectEvidence,revision:'b'.repeat(40)}},
  {...old,projectEvidence:{...old.projectEvidence,observedAt:'2026-09-23T10:00:00.000Z'}},
  {...old,projectEvidence:{...old.projectEvidence,outcome:'failure'}},
  {...structuredClone(next),id:'already-enriched'},
 ])assert.deepEqual(githubContextPredecessors([previous],next),[]);
});
const commit={sha,commit:{message:'Synthetic commit',committer:{date:'2026-09-24T10:00:00Z'}}};
function fixture(payload:unknown,metadata:unknown=repo){const calls:string[]=[];return {calls,fetch:async (url:string|URL|Request,init?:RequestInit)=>{calls.push(String(url));assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(calls.length===1?metadata:payload);}};}
test('exact public commit preserves source time and replay identity',async()=>{const a=fixture(commit),b=fixture(commit);const one=await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:a.fetch,now});const two=await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:b.fetch,now});assert.equal(one.status,'complete');assert.deepEqual(one.records,two.records);assert.equal(one.records[0]?.projectEvidence.observedAt,'2026-09-24T10:00:00.000Z');assert.equal(one.records[0]?.projectEvidence.lastVerifiedAt,now);assert.equal(one.records[0]?.projectEvidence.stage,'committed');assert.match(a.calls[1]!,new RegExp(sha));});
test('workflow success does not manufacture test acceptance; requires exact attempt',async()=>{const f=fixture({id:123,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success',updated_at:'2026-09-25T10:00:00Z',repository:repo});const r=await importGitHubEvidence('nico',{kind:'workflow',runId:123,attempt:2},{fetch:f.fetch,now});assert.equal(r.status,'complete');assert.equal(r.records[0]?.projectEvidence.stage,null);assert.equal(r.records[0]?.projectEvidence.runAttempt,2);assert.match(f.calls[1]!,/runs\/123\/attempts\/2$/);const bad=fixture({id:123,run_attempt:1,head_sha:sha});assert.equal((await importGitHubEvidence('nico',{kind:'workflow',runId:123,attempt:2},{fetch:bad.fetch,now})).status,'failed');});
test('private repositories, wrong SHA, arbitrary input fail closed',async()=>{for(const meta of [{...repo,private:true},{...repo,full_name:'other/repo'}]){const f=fixture(commit,meta);assert.equal((await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:f.fetch,now})).status,'failed');assert.equal(f.calls.length,1);}const f=fixture({...commit,sha:'b'.repeat(40)});assert.equal((await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:f.fetch,now})).status,'failed');await assert.rejects(()=>importGitHubEvidence('nico',{kind:'commit',sha,url:'https://internal'} as never));});
test('PR captures head and merge identity without claiming deployment',async()=>{const f=fixture({number:12,state:'closed',merged:true,head:{sha},base:{repo},merge_commit_sha:'b'.repeat(40),updated_at:'2026-09-25T12:00:00Z',merged_at:'2026-09-25T11:00:00Z'});const r=await importGitHubEvidence('nico',{kind:'pr',number:12},{fetch:f.fetch,now});assert.equal(r.status,'complete');assert.equal(r.records[0]?.projectEvidence.stage,'merged');assert.equal(r.records[0]?.projectEvidence.revision,'b'.repeat(40));assert.match(r.records[0]!.statement, new RegExp(sha));assert.equal(r.coverage.scope,'one requested object; excludes jobs, checks, artifacts, files and deployments');});
test('rate limits, cancellation, malformed and oversized responses are visible',async()=>{for(const fetcher of [async()=>new Response('rate limit',{status:429}),async()=>new Response('not json'),async()=>new Response('x'.repeat(270000))]){const r=await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:fetcher,now});assert.equal(r.status,'failed');assert.equal(r.records.length,0);assert.ok(r.errors.length);}const controller=new AbortController();controller.abort();assert.equal((await importGitHubEvidence('nico',{kind:'commit',sha},{signal:controller.signal,now})).status,'failed');});
test('deadline is finite even if transport ignores cancellation',async()=>{const started=Date.now();const r=await importGitHubEvidence('nico',{kind:'commit',sha},{fetch:async()=>new Promise<Response>(()=>{}),timeoutMs:10,now});assert.equal(r.status,'failed');assert.match(r.errors[0]!,/deadline/);assert.ok(Date.now()-started<1000);});
test('global concurrency bound rejects third request without dispatch',async()=>{let calls=0;const hanging=async()=>{calls++;return new Promise<Response>(()=>{});};const first=importGitHubEvidence('nico',{kind:'commit',sha},{fetch:hanging,timeoutMs:30,now});const second=importGitHubEvidence('sara',{kind:'commit',sha},{fetch:hanging,timeoutMs:30,now});const third=await importGitHubEvidence('nicos-world',{kind:'commit',sha},{fetch:hanging,timeoutMs:30,now});assert.equal(third.status,'failed');assert.match(third.errors[0]!,/concurrency/);assert.equal(calls,2);await Promise.all([first,second]);});
