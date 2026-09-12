import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {createSaraServer} from '../src/server.ts';

test('owner-attested job expenses bind exact scope, contribute to accounting and replay after reboot',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-synthetic-job-expense-')),token='synthetic-expense-owner';
 const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)}),owner=kernel.authenticateOwnerToken(token);
 const job=await kernel.createRevenuePilotJob(owner,{opportunityId:'synthetic-expense-job',sourceUrl:'https://github.com/example/project/issues/1',sourceAllowsAutomatedDiscovery:true,discoveredFromPublicSource:true,repoUrl:'https://github.com/example/project',repositoryIsPublic:true,repositoryOwnerPermissionConfirmed:true,requiresPrivateAccess:false,containsRegulatedOrPrivateData:false,requestsProductionChanges:false,requestsExploitValidation:false,primaryGoal:'release_readiness',customerBudgetUsd:149,desiredTurnaroundDays:3,recentCommitDays:5});
 const server=createSaraServer(kernel,{stateDirectory:directory,ownerTokenSha256:sha256(token)});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/revenue-pilot/jobs/${job.id}/accounting`;
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
 try{
  assert.equal((await fetch(url)).status,401);
  const scopeResponse=await fetch(url,{headers});assert.equal(scopeResponse.status,200);
  const scope=await scopeResponse.json() as any;assert.match(scope.scopeDigest,/^[a-f0-9]{64}$/);
  const input={expectedScopeDigest:scope.scopeDigest,category:'DIRECT_EXTERNAL',amountUsd:2,evidenceRef:'synthetic-invoice-01'};
  const posted=await Promise.all([0,1].map(()=>fetch(url,{method:'POST',headers,body:JSON.stringify(input)})));assert.ok(posted.every(r=>r.status===200));
  const [entry,concurrent]=await Promise.all(posted.map(r=>r.json())) as any[];assert.deepEqual(concurrent,entry);
  assert.equal(entry.jobAccounting.jobId,job.id);assert.equal(entry.amountUsd,2);
  const audit=await kernel.inspectAudit();
  const repeat=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.deepEqual(await repeat.json(),entry);
  const replayAudit=await kernel.inspectAudit();assert.deepEqual(replayAudit.slice(0,audit.length),audit);assert.ok(replayAudit.slice(audit.length).every(e=>e.type==='policy_decision'),'Rechecking owner authority may append policy evidence, never another financial event');
  const conflict=await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,amountUsd:3})});assert.notEqual(conflict.status,200);
  const stale=await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,evidenceRef:'synthetic-invoice-02'})});assert.notEqual(stale.status,200);
  const invalid=await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,category:'INVENTED'})});assert.notEqual(invalid.status,200);
  const other=await kernel.createRevenuePilotJob(owner,{...job.input,opportunityId:'synthetic-other-expense-job'});
  const wrongJob=await fetch(url.replace(job.id,other.id),{method:'POST',headers,body:JSON.stringify({...input,evidenceRef:'synthetic-wrong-job'})});assert.notEqual(wrongJob.status,200);
  const projection=await kernel.invokeCapability(owner,{requestId:'synthetic-expense-accountant',capabilityId:'profitability-accountant',input:{authoritativeJobIds:[job.id],includeModeledLabor:false}});
  const output=projection.output as any;assert.equal(output.jobs[0].directExternalMicroUsd,2_000_000);assert.equal(output.jobs[0].recordedNetContributionMicroUsd,-2_000_000);assert.equal(output.fullProfitabilityProven,false);
  const reboot=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  assert.deepEqual(await reboot.recordRevenueJobExpense(reboot.authenticateOwnerToken(token),job.id,input as any),entry);
  await assert.rejects(reboot.recordRevenueJobExpense(SARA_PRINCIPAL,job.id,{...input,evidenceRef:'synthetic-forged'} as any),/owner|OWNER/i);
  assert.equal((await reboot.inspectAudit()).filter(e=>e.type==='ledger_recorded'&&(e.data as any).id===entry.id).length,1);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
