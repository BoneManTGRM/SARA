import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {AddressInfo} from 'node:net';
import {legacyLearningRetryFixture} from '../tests/fixtures/legacy-learning-retry.ts';
import {createSaraServer} from '../src/server.ts';
import {compileCommercialTerms} from '../src/commercial-terms.ts';
import {PILOT_REQUIRED_CAPABILITIES} from '../src/revenue-pilot.ts';
import {SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {waitForSandboxBrowserEndpoint} from '../src/digital-capabilities/web/sandbox-browser.ts';
import {installOwnerDashboardThemeRuntime} from '../src/owner-dashboard-theme-runtime.ts';

// Isolated product E2E qualification. These credentials belong only to the
// disposable test kernel. This cannot authenticate a production owner.
const directory=await mkdtemp(join(tmpdir(),'sara-owner-ui-'));
const legacy=await legacyLearningRetryFixture();
const credential=legacy.token;
installOwnerDashboardThemeRuntime();
const kernel=legacy.kernel;
const terms=compileCommercialTerms({businessName:'Synthetic owner UI fixture',contactEmail:'owner@example.com',governingLaw:'Synthetic test terms'});
const recipientAddress=`0x${'2'.repeat(40)}`;
const server=createSaraServer(kernel,{stateDirectory:legacy.directory,ownerTokenSha256:sha256(credential),commerce:{terms,recipientAddress,rpcUrl:'https://mainnet.base.org',publicOrigin:'https://saraseed.app',fetchImpl:async()=>{throw new Error('SYNTHETIC_NETWORK_NOT_EXPECTED');}}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const chrome=spawn('google-chrome',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'chrome')}`,'about:blank'],{stdio:'ignore',env:{PATH:process.env.PATH,LANG:'en_US.UTF-8'}});
let launchError:Error|undefined;chrome.on('error',e=>{launchError=e;});
let socket:WebSocket|undefined;
try{
 const endpoint=await waitForSandboxBrowserEndpoint({read:()=>readFile(join(directory,'chrome','DevToolsActivePort'),'utf8'),alive:()=>!launchError&&chrome.exitCode===null&&chrome.signalCode===null,now:()=>performance.now(),pause:delay});
 socket=new WebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.path}`);
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Chrome connection timed out')),5000);socket!.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket!.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Chrome connection failed'));},{once:true});});
 let next=0;const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let sessionId:string|undefined;
 const send=(method:string,params:Record<string,unknown>={},session=sessionId):Promise<any>=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser command timed out: ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket!.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Page.javascriptDialogOpening'){
   assert.equal(m.params.type,'confirm');assert.match(m.params.message,/Record already-incurred USD 0.25 for job/);
   void send('Page.handleJavaScriptDialog',{accept:true},m.sessionId).catch(()=>{});
 }else if(m.method==='Fetch.requestPaused'){
   const url=String(m.params.request.url);void send(url.startsWith(origin+'/')?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(url.startsWith(origin+'/')?{}:{errorReason:'BlockedByClient'})},m.sessionId).catch(()=>{});
 }});
 const target=await send('Target.createTarget',{url:'about:blank'});
 sessionId=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async(expression:string)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('Owner UI script exception');return r.result.value;};
 const until=async(expression:string)=>{const deadline=performance.now()+20000;while(performance.now()<deadline){if(await evaluate(expression))return;await delay(100);}throw new Error('Owner UI acceptance timed out');};
 await send('Page.navigate',{url:origin});await until("Boolean(document.querySelector('#owner-work-text'))");
 assert.equal(await evaluate("document.querySelector('#owner-work-fields').disabled"),true);
 assert.equal(await evaluate("Boolean(document.querySelector('#owner-work-results').closest('.owner-job-activity'))"),true,'Qualify the actual production activity transform');
 assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='owner_work_received').length,0);
 await evaluate("document.querySelector('#connect').click()");
 await until("document.querySelector('#owner-dialog').open");
 await evaluate(`document.querySelector('#token').value=${JSON.stringify(credential)};document.querySelector('#owner-form button[type=submit]').click()`);
 await until("document.body.dataset.owner==='connected' && !document.querySelector('#owner-work-fields').disabled");
 const screenshots:string[]=[];
 for(const width of [1280,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  const goal=width===1280?'Review unfinished work, identify blockers, prioritize obligations, complete the authorized steps, and give me a brief.':'Inspect outstanding tasks and summarize what is stuck';
  await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(goal)};document.querySelector('#owner-work-submit').click()`);
  await until("document.querySelector('#owner-work-status').textContent==='BLOCKED · VERIFIED_ANALYSIS'");
  assert.equal(await evaluate("document.querySelector('#owner-work-results').innerText.includes('LEARNING_FRESH_ROOT_RETRY_BUDGET_EXHAUSTED')"),true,'The actual worker boundary must be visible in ordinary activity');
  assert.equal(await evaluate("document.querySelector('#owner-work-results').textContent.includes('Recorded cost $0.000000')"),true);
  assert.equal(await evaluate("document.querySelector('#owner-work-results').textContent.includes('unfinished-work-reconciler')"),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,'Owner workflow must fit the viewport');
  await evaluate("document.querySelector('#owner-work-results').scrollIntoView()");
  const shot=await send('Page.captureScreenshot',{format:'png'});screenshots.push(sha256(Buffer.from(shot.data,'base64')));
 }
 for(const supplied of [true,false]){
  const goal=supplied?'Review this supplied communication and tell me what needs my attention.':'Review the latest supplied messages and prepare a brief.';
  const material=supplied?'I will provide the draft by 2026-10-01. Can we meet on 2026-10-02 at 14:00 UTC for 30 minutes?':'';
  await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(goal)};document.querySelector('#owner-work-material').value=${JSON.stringify(material)};document.querySelector('#owner-work-submit').click()`);
  await until("document.querySelector('#owner-work-status').textContent==='COMPLETE · VERIFIED_ANALYSIS'");
  assert.equal(await evaluate("document.querySelector('#owner-work-results').textContent.includes('commitment-tracker')"),true);
  assert.equal(await evaluate("document.querySelector('#owner-work-results').textContent.includes('2026-10-01')"),true);
  assert.equal(await evaluate("document.querySelector('#owner-work-results').innerText.includes('Proposed meeting: 2026-10-02 14:00 UTC')"),true);
  assert.equal(await evaluate("document.querySelector('#owner-work-results').innerText.includes('meeting is not confirmed')"),true);
 }
 for(const item of [
  {goal:'Diagnose this software defect and give me a brief.',material:'Expected: the counter returns 2.\nObserved: the counter returns 3.\nEnvironment: isolated Node fixture.\nSteps: call increment(1).',visible:'Root cause remains unconfirmed.'},
  {goal:'Review this business quote and draft a proposal.',material:'Problem: review the supplied release report.\nDeliverables: a written readiness brief.\nAcceptance criteria: identify every supplied blocker.\nPrice: USD 200.\nDirect cash cost: USD 25.\nModel API cost: USD 5.\nInfrastructure cost: USD 0.\nTooling cost: USD 0.\nRisk reserve: USD 10.\nMinimum margin: 20%.',visible:'cash margin: 80.00%'}
 ]){
  await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(item.goal)};document.querySelector('#owner-work-material').value=${JSON.stringify(item.material)};document.querySelector('#owner-work-submit').click()`);
  await until("document.querySelector('#owner-work-status').textContent==='BLOCKED · VERIFIED_ANALYSIS'");
  assert.equal(await evaluate(`document.querySelector('#owner-work-results').innerText.includes(${JSON.stringify(item.visible)})`),true,'The real activity view must show useful analysis without opening API responses');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
 }
 for(const width of [1280,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  const goal=width===1280?'Review my authorized opportunities and unfinished work. Complete eligible paid work first, prepare the best supported offer, and tell me exactly what still needs my decision.':'Review my earning path and prepare the best supported offer.';
  await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(goal)};document.querySelector('#owner-work-material').value='';document.querySelector('#owner-work-submit').click()`);
  await until("document.querySelector('#owner-work-status').textContent==='BLOCKED · VERIFIED_ANALYSIS'");
  await evaluate("document.querySelector('#owner-work-results details').open=true");
  for(const phrase of ['Public Repository Readiness Snapshot','No recorded customer','WAITING FOR AUTHORITY','Excluded:','149.00','profitability-accountant','Preserve the supplied value','Missing current capabilities: legacy-retry-skill'])assert.equal(await evaluate(`document.querySelector('#owner-work-results').innerText.includes(${JSON.stringify(phrase)})`),true,phrase);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
  assert.equal((await kernel.getStatus()).revenuePilotJobs.length,0);
 }
 const received=(await kernel.inspectAudit()).filter(e=>e.type==='owner_work_received');assert.equal(received.length,8);
 const count=(await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length;assert.equal(count,48);
 await evaluate("document.querySelector('#owner-work-submit').click()");await until("!document.querySelector('#owner-work-submit').disabled");
 assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length,count,'Repeated submission must reuse receipts');
 assert.equal((await kernel.learningCampaignStatus()).campaign?.reserved,3,'Read-only review must preserve consumed learning reservations');
 // This unpaid synthetic job exercises the actual owner expense form, not a payment provider.
 for(const id of PILOT_REQUIRED_CAPABILITIES)await kernel.registerCapability(SARA_PRINCIPAL,{id,name:id,status:'available',evidence:[`SYNTHETIC:UI:${id}`],limitations:['Isolated public snapshot fixture only.']});
 const owner=kernel.authenticateOwnerToken(credential);
 const expenseJob=await kernel.createRevenuePilotJob(owner,{opportunityId:'synthetic-ui-expense-job',sourceUrl:'https://github.com/example/project/issues/1',sourceAllowsAutomatedDiscovery:true,discoveredFromPublicSource:true,repoUrl:'https://github.com/example/project',repositoryIsPublic:true,repositoryOwnerPermissionConfirmed:true,requiresPrivateAccess:false,containsRegulatedOrPrivateData:false,requestsProductionChanges:false,requestsExploitValidation:false,primaryGoal:'release_readiness',customerBudgetUsd:149,desiredTurnaroundDays:3,recentCommitDays:2});
 await kernel.createRevenuePaymentIntent(owner,{id:'synthetic-ui-expense-intent',jobId:expenseJob.id,recipientAddress,clientSecretDigest:sha256('synthetic-ui-unused-secret'),customerReferenceDigest:sha256('synthetic-ui-customer'),terms});
 await send('Page.reload');await until("document.body.dataset.owner==='connected' && Boolean(document.querySelector('.commerce-expense-form'))");
 for(const width of [390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  await evaluate("document.querySelector('.commerce-expense-form').closest('details').open=true");
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,'Actual expense form must fit the viewport');
  await evaluate("document.querySelector('[aria-label=\"Actual cash amount in USD\"]').value='0.25';document.querySelector('[aria-label=\"Invoice or receipt reference\"]').value='synthetic-ui-invoice-01';document.querySelector('.commerce-expense-form button').click()");
  await until("Boolean(document.querySelector('.commerce-expense-form')) && document.querySelector('[aria-label=\"Invoice or receipt reference\"]').value===''");
  const expenses=(await kernel.inspectAudit()).filter(e=>e.type==='ledger_recorded'&&(e.data as any).jobAccounting?.jobId===expenseJob.id);
  assert.equal(expenses.length,1,'Identical owner expense submission must reuse the financial entry');assert.equal((expenses[0]!.data as any).amountUsd,0.25);
 }
 await evaluate("document.querySelector('#owner-work-text').value='Review my earning path and prepare a supported offer with recorded costs.';document.querySelector('#owner-work-submit').click()");
 await until("document.querySelector('#owner-work-status').textContent==='BLOCKED · VERIFIED_ANALYSIS'");
 assert.equal(await evaluate("document.querySelector('#owner-work-results').innerText.includes('recorded net contribution $-0.250000')"),true);
 assert.equal(await evaluate("document.querySelector('#owner-work-results').innerText.includes('full profit remains unverified')"),true);
 assert.equal((await kernel.getStatus()).revenuePaymentIntents[0]!.status,'awaiting_payment');
 const finalCount=(await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length;assert.equal(finalCount,53);
 console.log(JSON.stringify({status:'VERIFIED',provenance:'ISOLATED',ownerInterface:'actual served dashboard with production theme and activity',viewports:[1280,390],ordinaryRequests:9,executedReceipts:finalCount,ownerExpenseForm:true,expenseReplay:true,syntheticUnpaidJobExpenseUsd:0.25,durableCommunicationReuse:true,exactRetryBoundaryVisible:true,preservedLearningReservations:3,screenshotDigests:screenshots,actualCashMicroUsd:0,productionAcceptance:false}));
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Fixture closed'));}pending.clear();
}finally{
 socket?.close();chrome.kill('SIGKILL');
 if(chrome.exitCode===null&&chrome.signalCode===null)await Promise.race([new Promise<void>(resolve=>chrome.once('exit',()=>resolve())),delay(1000)]);
 await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});await legacy.cleanup();
}
