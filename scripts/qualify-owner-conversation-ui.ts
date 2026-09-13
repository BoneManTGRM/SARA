import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {AddressInfo} from 'node:net';
import {nicosSeededMovementFixture} from '../tests/fixtures/nicos-seeded-movement.ts';
import {ProceduralKnowledgeStore} from '../src/procedural-intelligence.ts';
import {legacyLearningRetryFixture} from '../tests/fixtures/legacy-learning-retry.ts';
import {createSaraServer} from '../src/server.ts';
import {compileCommercialTerms} from '../src/commercial-terms.ts';
import {PILOT_REQUIRED_CAPABILITIES} from '../src/revenue-pilot.ts';
import {SaraKernel,SARA_PRINCIPAL} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {waitForSandboxBrowserEndpoint} from '../src/digital-capabilities/web/sandbox-browser.ts';
import {installOwnerDashboardThemeRuntime} from '../src/owner-dashboard-theme-runtime.ts';
import {collectSoftwareSource} from '../src/software-source-reader.ts';
import {runNicosMovementJourney} from '../src/software-journey-browser.ts';
import {assertNicosJourneyQualification} from './software-journey-qualification.ts';

// Isolated product E2E qualification. These credentials belong only to the
// disposable test kernel. This cannot authenticate a production owner.
const directory=await mkdtemp(join(tmpdir(),'sara-owner-ui-'));
const legacy=await legacyLearningRetryFixture();
const credential=legacy.token;
installOwnerDashboardThemeRuntime();
const runtimeDispatches={source:0,browser:0};
// Trusted boot wiring only: the owner request must cause these adapters to gather
// their own public inputs. No fixture repository packet or browser result enters
// the request, and the old synthetic service/learning state remains unchanged.
const kernel=await SaraKernel.boot({stateDirectory:legacy.directory,ownerTokenSha256:sha256(credential),softwareRuntime:{
 inspectSource:async(repository,journey)=>{runtimeDispatches.source++;return collectSoftwareSource(repository,journey);},
 testJourney:async()=>{runtimeDispatches.browser++;return runNicosMovementJourney();},
}});
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
 const until=async(expression:string,maximumMilliseconds=20000)=>{const deadline=performance.now()+maximumMilliseconds;while(performance.now()<deadline){if(await evaluate(expression))return;await delay(100);}throw new Error('Owner UI acceptance timed out');};
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
 await send('Page.reload');await until("document.body?.dataset.owner==='connected' && Boolean(document.querySelector('.commerce-expense-form'))");
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
 // Nico regression is supplied, synthetic execution fixture never counts as customer work.
 const defectMaterial="Expected: movement advances to Scanner test.\nObserved: No defect was reproduced in this bounded path. Forward, Right, Forward opened Scanner test.\nEnvironment: https://nicos-world.com/ revision ba0cab4a00664426848c34747f7377e59492f56a desktop.\nSteps: World Map, Robot Home, Robo Lab, movement, scanner.\nEvidence: lengthy source context remains below scope limits.\nUnknown: mobile and restart were not tested.";
 const fixtureFiles=[{path:'src/index.ts',content:"export {increment} from './counter.ts';"},{path:'src/counter.ts',content:'export function increment(n: number): number { return n+1; }'},{path:'tests/counter.test.ts',content:"import {increment} from '../src/index.ts';\nif(increment(1)!==2) throw new Error('counter assertion failed');"}];
 const fixtureMaterial='Expected: increment(1) returns 2.\nObserved: synthetic counter needs checking.\nEnvironment: synthetic isolated TypeScript.\nSteps: call increment(1).\nRevision: '+'a'.repeat(40)+'\n'+fixtureFiles.map(f=>'```ts '+f.path+'\n'+f.content+'\n```').join('\n');
 for(const width of [1280,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  for(const item of [{goal:'Review this software defect analysis for Nico’s World and give me a brief with findings and the next diagnostic step.',material:defectMaterial,visible:'No defect was reported'},{goal:'Run an isolated reproduction of this software defect.',material:fixtureMaterial,visible:'FIXTURE_PASSED'}]){
   await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(item.goal)};document.querySelector('#owner-work-material').value=${JSON.stringify(item.material)};document.querySelector('#owner-work-submit').click()`);
   await until("!document.querySelector('#owner-work-submit').disabled && document.querySelector('#owner-work-status').textContent==='COMPLETE · VERIFIED_ANALYSIS'");
   assert.equal(await evaluate(`document.querySelector('#owner-work-results article').innerText.includes(${JSON.stringify(item.visible)})`),true);
   if(item.material===defectMaterial)for(const fact of ['Scanner test','ba0cab4a','mobile and restart'])assert.equal(await evaluate(`document.querySelector('#owner-work-results article').innerText.includes(${JSON.stringify(fact)})`),true,`Sourced brief must retain ${fact}`);
   assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
   const receiptsBefore=(await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length;
   await evaluate("document.querySelector('#owner-work-submit').click()");await until("!document.querySelector('#owner-work-submit').disabled");
   assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length,receiptsBefore);
  }
 }
 const qualifiedCount=(await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length;
 assert.equal(qualifiedCount,finalCount+20);
 assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='owner_work_received').length,13,'Preserve the existing 13-request qualification baseline');
 assert.deepEqual(runtimeDispatches,{source:0,browser:0},'Historical supplied analysis must not dispatch the new source or browser adapters');

 // One genuine ordinary request in an isolated authenticated owner UI. The
 // public repository and application assets are self-gathered by SARA's runtime.
 // Mobile checks the owner UI and replays this same job; it does not claim a
 // second application/mobile journey test or create a duplicate external job.
 const softwareGoal='Test the movement-to-scanner journey on Nico’s World using https://nicos-world.com/ and BoneManTGRM/Nicos-Adventures. Inspect the current source and existing tests, gather the evidence yourself, and give me a defect report with what passed, what failed, what remains untested, and what still needs my decision.';
 const softwareReportPath=process.env.SARA_OWNER_SOFTWARE_UI_REPORT_PATH??join(process.cwd(),'artifacts','owner-software-runtime-qualification.json');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(softwareGoal)};document.querySelector('#owner-work-material').value='';document.querySelector('#owner-work-submit').click()`);
 // This is the only path with the extended bound: source collection (30s) and
 // the sandboxed browser (60s) still enforce their own smaller runtime limits.
 try{await until("!document.querySelector('#owner-work-submit').disabled && document.querySelector('#owner-work-results').textContent.includes('software-evidence-reviewer')",120000);}
 catch{
  const failedAudit=await kernel.inspectAudit();
  const failedReceipts=failedAudit.filter(e=>e.type==='digital_capability_executed').slice(qualifiedCount).map(e=>{const result=(e.data as {result:{capability:{id:string};resultDigest:string;status:string}}).result;return {capability:result.capability.id,resultDigest:result.resultDigest,status:result.status};});
  await mkdir(dirname(softwareReportPath),{recursive:true});
  await writeFile(softwareReportPath,JSON.stringify({status:'INCOMPLETE_EVIDENCE',provenance:'ISOLATED',syntheticOwner:true,goal:softwareGoal,runtimeDispatches,receipts:failedReceipts,boundary:'Actual owner software UI did not reach its required reviewer within the bounded wait.',productionAcceptance:false},null,2)+'\n',{mode:0o600});
  throw new Error(`Actual owner software UI qualification incomplete; evidence preserved at ${softwareReportPath}`);
 }
 const auditAfterSoftware=await kernel.inspectAudit();
 const softwareWork=auditAfterSoftware.filter(e=>e.type==='owner_work_received').at(-1)!;
 const workData=softwareWork.data as {request:{requestId:string;text:string;suppliedText?:string};plan?:{id:string;steps:{id:string;capabilityId:string}[]}};
 const newReceipts=auditAfterSoftware.filter(e=>e.type==='digital_capability_executed').slice(qualifiedCount).map(e=>(e.data as {result:{requestId:string;capability:{id:string;contractDigest:string};resultDigest:string;inputDigest:string;output:unknown;cost:{actualCashMicroUsd:number}}}).result);
 const sourceReceipt=newReceipts.find(r=>r.capability.id==='software-source-inspector');
 const journeyReceipt=newReceipts.find(r=>r.capability.id==='software-journey-tester');
 const reviewerReceipt=newReceipts.find(r=>r.capability.id==='software-evidence-reviewer');
 const sourceOutput=sourceReceipt?.output as {result?:string;evidence?:{repository:string;immutableCommitSha:string;treeSha:string;files:Array<{path:string;role:string;gitBlobSha:string;contentSha256:string;byteLength:number;sourceTruncated:boolean}>;limitations:string[]}}|undefined;
 const journeyOutput=journeyReceipt?.output as {result?:string;evidence?:unknown}|undefined;
 const reviewOutput=reviewerReceipt?.output as {qualified?:boolean;summary?:string;remaining?:string[];evidence?:unknown}|undefined;
 const softwareReport={status:reviewOutput?.qualified===true?'PENDING_INDEPENDENT_VERIFICATION':'INCOMPLETE_EVIDENCE',provenance:'ISOLATED',syntheticOwner:true,request:workData.request,
  implementationRevision:/^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA??'')?process.env.GITHUB_SHA:null,
  ownerInterface:'actual authenticated served dashboard',requestedOwnerViewports:[1280,390],applicationViewportScope:'isolated desktop only',sourceProvenance:'EXTERNAL_READ_ONLY',sourceCollectionActor:'SARA_RUNTIME',journeyActor:'SARA_RUNTIME',independentVerifierActor:'IMPLEMENTATION_AGENT',planId:workData.plan?.id,
  runtimeDispatches:{...runtimeDispatches},receiptChain:newReceipts.map(({requestId,capability,resultDigest,inputDigest,cost})=>({requestId,capability,resultDigest,inputDigest,cost})),
  source:Array.isArray(sourceOutput?.evidence?.files)?{...sourceOutput!.evidence!,files:sourceOutput!.evidence!.files.map(({path,role,gitBlobSha,contentSha256,byteLength,sourceTruncated})=>({path,role,gitBlobSha,contentSha256,byteLength,sourceTruncated}))}:null,
  journey:journeyOutput?.evidence??null,review:reviewOutput??null,ownerScreenshotDigests:[] as Array<{width:number;sha256:string}>,replayVerified:false,
  workflowCashMicroUsd:newReceipts.reduce((sum,r)=>sum+r.cost.actualCashMicroUsd,0),infrastructureAllocation:'UNKNOWN',productionAcceptance:false,commercialFulfillment:false,realRevenueVerified:false,authorityDelta:0};
 const saveSoftwareReport=async()=>{await mkdir(dirname(softwareReportPath),{recursive:true});await writeFile(softwareReportPath,JSON.stringify(softwareReport,null,2)+'\n',{mode:0o600});};
 await saveSoftwareReport(); // Preserve exact incomplete evidence if any assertion below fails.
 assert.equal(workData.request.text,softwareGoal);assert.equal(workData.request.suppliedText??'','');
 assert.deepEqual(runtimeDispatches,{source:1,browser:1});assert.equal(newReceipts.length,5);
 assert.equal(sourceOutput?.result,'SOURCE_COLLECTED',JSON.stringify({boundary:sourceReceipt?.output,report:softwareReportPath}));
 assertNicosJourneyQualification(journeyOutput?.evidence);
 assert.equal(reviewOutput?.qualified,true,JSON.stringify({boundary:reviewOutput,report:softwareReportPath}));
 assert.equal(await evaluate("document.querySelector('#owner-work-status').textContent"),'COMPLETE · VERIFIED_ANALYSIS');
 for(const width of [1280,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  if(width===390){
   await evaluate("document.querySelector('#owner-work-submit').click()");
   await until("!document.querySelector('#owner-work-submit').disabled && document.querySelector('#owner-work-status').textContent==='COMPLETE · VERIFIED_ANALYSIS'");
  }
  await evaluate("for(const detail of document.querySelectorAll('#owner-work-results details'))detail.open=true");
  for(const phrase of ['No defect was reproduced','isolated','software-source-inspector','software-journey-tester','software-evidence-reviewer','Recorded cost $0.000000'])assert.equal(await evaluate(`document.querySelector('#owner-work-results').innerText.includes(${JSON.stringify(phrase)})`),true,`Software owner result must show ${phrase}`);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,'Actual software results must fit each owner viewport');
  await evaluate("document.querySelector('#owner-work-results').scrollIntoView()");
  const screenshot=await send('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(screenshot.data,'base64');
  const screenshotPath=join(dirname(softwareReportPath),`owner-software-runtime-${width}.png`);
  await writeFile(screenshotPath,bytes,{mode:0o600});softwareReport.ownerScreenshotDigests.push({width,sha256:sha256(bytes)});
 }
 const finalAudit=await kernel.inspectAudit();
 assert.equal(finalAudit.filter(e=>e.type==='owner_work_received').length,14);
 assert.equal(finalAudit.filter(e=>e.type==='digital_capability_executed').length,qualifiedCount+5);
 assert.deepEqual(runtimeDispatches,{source:1,browser:1},'Identical desktop/mobile submission must reuse self-gathered source and journey receipts');
 assert.equal((await kernel.learningCampaignStatus()).campaign?.reserved,3);
 softwareReport.replayVerified=true;softwareReport.status='VERIFIED';await saveSoftwareReport();
 await evaluate("[...document.querySelectorAll('#owner-work-results button')].find(button=>button.textContent==='Resume this work').click()");
 await until("document.querySelector('#owner-work-status').textContent==='COMPLETE · VERIFIED_ANALYSIS'");
 assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='owner_work_received').length,14);
 assert.equal((await kernel.inspectAudit()).filter(e=>e.type==='digital_capability_executed').length,qualifiedCount+5);
 assert.deepEqual(runtimeDispatches,{source:1,browser:1});
 // Controlled seeded exercise is separate from the self-gathered request above.
 // Fixture preparation belongs to IMPLEMENTATION_AGENT; candidate work and all
 // verifications must be executed by the served SARA runtime capability.
 const knowledgeBeforeRepair=await ProceduralKnowledgeStore.inspectExisting(legacy.directory);
 const repairFixture=nicosSeededMovementFixture();
 const repairGoal='Prepare an isolated repair for this seeded movement defect.';
 const repairMaterial='Expected: Forward, Right, Forward reaches scanner readiness.\nObserved: a deliberately seeded comparator rejects the correct first command.\nEnvironment: SYNTHETIC isolated adapted TypeScript reducer.\nSteps: run the frozen movement regression.\nRevision: '+repairFixture.source.revision+'\n'+repairFixture.candidate.files.map(file=>'```ts '+file.path+'\n'+file.content+'```').join('\n');
 assert.ok(repairMaterial.length<=8192);
 await evaluate(`document.querySelector('#owner-work-text').value=${JSON.stringify(repairGoal)};document.querySelector('#owner-work-material').value=${JSON.stringify(repairMaterial)};document.querySelector('#owner-work-submit').click()`);
 await until("!document.querySelector('#owner-work-submit').disabled && document.querySelector('#owner-work-results').textContent.includes('isolated-defect-repairer')",120000);
 const repairAudit=await kernel.inspectAudit();
 const repairReceipts=repairAudit.filter(e=>e.type==='digital_capability_executed').slice(qualifiedCount+5).map(e=>(e.data as {result:{capability:{id:string};resultDigest:string;output:unknown;cost:{actualCashMicroUsd:number}}}).result);
 const repairReceipt=repairReceipts.find(r=>r.capability.id==='isolated-defect-repairer');
 const repairOutput=repairReceipt?.output as {qualified?:boolean;result?:string;summary?:string;evidence?:Record<string,any>}|undefined;
 const repairEvidence=repairOutput?.evidence??null;
 const repairReport={provenance:'ISOLATED',synthetic:true,fixturePreparationActor:'IMPLEMENTATION_AGENT',executionActor:'SARA_RUNTIME',independentEvidenceCheckActor:'IMPLEMENTATION_AGENT',request:repairGoal,procedureCandidate:null as {id:string;status:string;qualificationStatus:string}|null,receiptChain:repairReceipts,evidence:repairEvidence,replayVerified:false,productionChanged:false,commercialFulfillment:false,realRevenueVerified:false,infrastructureAllocation:'UNKNOWN'};
 const repairReportPath=join(dirname(softwareReportPath),'owner-isolated-repair-qualification.json');
 await writeFile(repairReportPath,JSON.stringify(repairReport,null,2)+'\n',{mode:0o600});
 assert.equal(repairOutput?.qualified,true,JSON.stringify(repairOutput));
 assert.equal(repairReceipts.length,4);
 const procedureReceipt=repairReceipts.find(r=>r.capability.id==='experience-to-procedure-compiler');
 assert.equal((procedureReceipt?.output as any)?.persisted,true);
 const knowledgeAfterRepair=await ProceduralKnowledgeStore.inspectExisting(legacy.directory);
 assert.ok(knowledgeAfterRepair);
 assert.equal(knowledgeAfterRepair.playbooks.length,(knowledgeBeforeRepair?.playbooks.length??0)+1);
 assert.deepEqual(knowledgeAfterRepair.outcomes,knowledgeBeforeRepair?.outcomes??[]);
 const repairProcedure=knowledgeAfterRepair.playbooks.find(p=>p.id===(procedureReceipt?.output as any)?.candidate?.id);
 assert.equal(repairProcedure?.status,'CANDIDATE');assert.equal(repairProcedure?.qualificationStatus,'pending_independent_qualification');assert.equal(repairProcedure?.verifiedAt,null);
 repairReport.procedureCandidate={id:repairProcedure!.id,status:repairProcedure!.status,qualificationStatus:repairProcedure!.qualificationStatus};
 assert.equal(repairEvidence?.status,'VERIFIED_ISOLATED_REPAIR');
 assert.equal(repairEvidence?.actor,'SARA_RUNTIME');assert.equal(repairEvidence?.synthetic,true);
 assert.equal(repairEvidence?.causalControlEstablished,true);
 assert.equal(repairEvidence?.regressionSha256,repairFixture.frozenRegression.sha256);
 assert.equal(repairEvidence?.verifiedSourceDigests?.find((file:{path:string})=>file.path==='src/route.ts')?.sha256,repairFixture.source.adaptedSha256);
 assert.equal(sha256(repairEvidence.patch),repairEvidence.patchSha256);
 assert.equal(repairEvidence?.authorityGranted,false);assert.equal(repairEvidence?.productionChanged,false);
 assert.ok(repairEvidence?.independentVerification);assert.ok(repairEvidence?.restoredBaselineVerification);
 assert.equal(await evaluate("document.querySelector('#owner-work-status').textContent"),'COMPLETE · VERIFIED_ANALYSIS');
 for(const phrase of ['SYNTHETIC / ISOLATED repair','live application was not changed','unresolved infrastructure allocation'])assert.equal(await evaluate(`document.querySelector('#owner-work-results').innerText.includes(${JSON.stringify(phrase)})`),true);
 await evaluate("document.querySelector('#owner-work-submit').click()");
 await until("!document.querySelector('#owner-work-submit').disabled && document.querySelector('#owner-work-status').textContent==='COMPLETE · VERIFIED_ANALYSIS'");
 const replayAudit=await kernel.inspectAudit();
 assert.equal(replayAudit.filter(e=>e.type==='owner_work_received').length,15);
 assert.equal(replayAudit.filter(e=>e.type==='digital_capability_executed').length,qualifiedCount+5+repairReceipts.length);
 assert.deepEqual(runtimeDispatches,{source:1,browser:1});
 assert.equal((await kernel.learningCampaignStatus()).campaign?.reserved,3);
 assert.deepEqual(await ProceduralKnowledgeStore.inspectExisting(legacy.directory),knowledgeAfterRepair);
 repairReport.replayVerified=true;await writeFile(repairReportPath,JSON.stringify(repairReport,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'VERIFIED',provenance:'ISOLATED',ownerInterface:'actual served dashboard with production theme and activity',viewports:[1280,390],ordinaryRequests:15,executedReceipts:qualifiedCount+5+repairReceipts.length,isolatedRepairQualification:repairReport,repairReportPath,preservedBaseline:{ordinaryRequests:13,executedReceipts:qualifiedCount},softwareRuntimeQualification:softwareReport,softwareReportPath,defectNoFailure:true,isolatedReproduction:true,defectReplay:true,ownerExpenseForm:true,expenseReplay:true,syntheticUnpaidJobExpenseUsd:0.25,durableCommunicationReuse:true,exactRetryBoundaryVisible:true,preservedLearningReservations:3,screenshotDigests:screenshots,actualCashMicroUsd:0,productionAcceptance:false}));
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Fixture closed'));}pending.clear();
}finally{
 socket?.close();chrome.kill('SIGKILL');
 if(chrome.exitCode===null&&chrome.signalCode===null)await Promise.race([new Promise<void>(resolve=>chrome.once('exit',()=>resolve())),delay(1000)]);
 await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});await legacy.cleanup();
}
