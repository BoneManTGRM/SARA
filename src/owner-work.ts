import {canonicalJson,sha256} from './canonical.ts';
import {suppliedReview} from './owner-work-inputs.ts';
import type {Job,Capability} from './types.ts';
import type {RevenuePilotJob} from './revenue-pilot.ts';
import {objectSchema,textSchema,idSchema,snapshotJson,validateSchema,type Json} from './digital-capabilities/schema.ts';
import type {CapabilityContract,CapabilityResult} from './digital-capabilities/types.ts';
import type {CapabilityPlan} from './digital-capabilities/plan.ts';

const messageSchema=objectSchema({requestId:idSchema,text:textSchema(4096),suppliedText:textSchema(12000,0)},['requestId','text']);
export type StoredWorkMaterial={body:string;sourceId:string;receivedAt:string;workflow?:string|null};
export type WorkContext={jobCapabilities?:Capability[];materials?:StoredWorkMaterial[]};
export type WorkMessage={requestId:string;text:string;suppliedText?:string};
export type WorkBlocker={subjectId:string;reason:string;missing:string[]};
export type WorkRecord={request:WorkMessage;requestDigest:string;workflow:string|null;plan:CapabilityPlan|null;selection:{capabilityId:string;reason:string;inputs:string[];unmet:string[]}[];alternatives:{capabilityId:string;reason:string}[];blockers:WorkBlocker[];sourceDigest:string;receivedAt:string;fieldProvenance:{field:string;kind:'OBSERVED'|'DERIVED'|'UNKNOWN';source:string}[]};
export function parseWorkMessage(value:unknown):WorkMessage{const input=snapshotJson(value);validateSchema(messageSchema,input);return input as unknown as WorkMessage;}
const controlIds=new Set(['learned-capability-disable-and-quarantine','self-benchmark-runner','decision-register','experience-to-procedure-compiler','memory-conflict-resolver']);
const workflowCapabilities=new Set(['bug-reproduction-planner','root-cause-analyzer','quote-margin-guard','proposal-compiler','profitability-accountant','goal-to-work-queue-compiler','solution-reuse-ranker','unfinished-work-reconciler','priority-rebalancer','daily-owner-brief','inbox-priority-classifier','email-thread-action-extractor','commitment-tracker','follow-up-detector','calendar-intent-parser','support-intake-triage']);
export function reachability(contracts:CapabilityContract[]){return contracts.map(c=>({id:c.id,contractDigest:c.contractDigest,qualification:c.qualification.status,effectiveStatus:c.status,
 disposition:c.status!=='ENABLED'?'INTENTIONALLY_UNAVAILABLE':controlIds.has(c.id)?'EXPLICIT_OWNER_OPERATION':c.id==='failure-clusterer'?'SUPPORTED_WORK_EVENT':workflowCapabilities.has(c.id)?'ORDINARY_GOAL_EXECUTION':'EXPLICIT_OWNER_OPERATION',
 reason:c.status!=='ENABLED'?'Current qualification or control prevents execution.':controlIds.has(c.id)?'Trusted explicit operation only; never selected from quoted or model text.':c.id==='failure-clusterer'?'One deduplicated failed-learning diagnosis under the existing active mandate, daily action allowance and serialized worker.':workflowCapabilities.has(c.id)?'Bounded work-review, communication, defect-report or quote recipe; schema and authority rechecked before execution.':'Existing authenticated capability API; ordinary-language input gathering not yet qualified for this contract.',
 ordinaryQualification:workflowCapabilities.has(c.id)?'REQUIRES_CONVERSATION_ACCEPTANCE':'NOT_QUALIFIED',externalAuthorityGranted:false}));}
function route(text:string):string|null{
 // These are explicitly bounded English request families, not general semantic routing.
 // Quoted/forwarded bodies belong in suppliedText and never choose a workflow.
 if(/["“”`]|^\s*>|\b(?:forwarded|email says|page says|quoted)\b/iu.test(text))return null;
 if(/\b(?:send|publish|buy|purchase|transfer|approve|increase.*budget|delete|deploy|merge)\b/iu.test(text))return null;
 if(/\b(?:NICO|repository|deployment|API|agent collaboration|database)\b/iu.test(text))return null;
 const defect=/\b(?:diagnose|analyze|analyse|triage|review|inspect)\b/iu.test(text)&&/\b(?:(?:software )?(?:defect|bug)(?: report)?|failure report)\b/iu.test(text);
 const quote=/\b(?:review|analyze|analyse|check|calculate|draft|prepare)\b/iu.test(text)&&/\b(?:quote|proposal)\b/iu.test(text);
 if((defect||quote)&&/\b(?:inbox|email|communications|messages|unfinished work|pending jobs|work queue|obligations)\b/iu.test(text))return null;
 if(defect&&quote)return null;
 if(defect)return 'supplied-defect';
 if(/\bsoftware\b/iu.test(text))return null;
 if(quote)return 'supplied-quote';
 const action=/\b(?:review|inspect|check|summarize|summarise|triage|prioritize|prioritise|organize|organise|give|prepare|identify|show|tell|audit|reconcile|complete|finish)\b/iu.test(text);
 if(action&&/\b(?:(?:unfinished|outstanding|pending|open)\s+(?:work|jobs|tasks|obligations)|work queue|backlog|obligations|stuck jobs)\b/iu.test(text))return 'unfinished-work';
 if(action&&/\b(?:inbox|email|communications|messages|secretary|commitments|follow.up|meeting)\b/iu.test(text))return 'supplied-communications';
 return null;
}
export function supportedWorkFamily(text:string){return route(text);}
function shortlist(text:string,contracts:CapabilityContract[]){const tokens=new Set(text.toLowerCase().match(/[a-z]{4,}/gu)??[]);return contracts.map(c=>({c,score:[...tokens].filter(t=>(c.id+' '+c.description).toLowerCase().includes(t)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id)).slice(0,5).map(x=>({capabilityId:x.c.id,reason:controlIds.has(x.c.id)?'Requires an explicit trusted owner operation.':'Description match only; no qualified ordinary-language input adapter for this request.'}));}
export function workSourceDigest(jobs:Job[],revenueJobs:RevenuePilotJob[]=[],ledgerDigest='',jobCapabilities:Capability[]=[]){const required=new Set([...jobs.flatMap(j=>j.workCard.requiredCapabilities),...revenueJobs.flatMap(j=>j.plan.requiredCapabilities)]);return sha256(canonicalJson({jobs,revenueJobs,ledgerDigest,capabilities:jobCapabilities.filter(c=>required.has(c.id)).sort((a,b)=>a.id.localeCompare(b.id))}));}
export async function compileOwnerWork(request:WorkMessage,jobs:Job[],contracts:CapabilityContract[],now:string,revenueJobs:RevenuePilotJob[]=[],ledgerDigest='',context:WorkContext={}):Promise<WorkRecord>{
 const workflow=route(request.text),requestDigest=sha256(canonicalJson(request));
 const record:WorkRecord={request,requestDigest,workflow,plan:null,selection:[],alternatives:shortlist(request.text,contracts),blockers:[],sourceDigest:workflow==='unfinished-work'?workSourceDigest(jobs,revenueJobs,ledgerDigest,context.jobCapabilities):requestDigest,receivedAt:now,fieldProvenance:[{field:'ownerGoal',kind:'OBSERVED',source:'authenticated request'},{field:'jobs',kind:'OBSERVED',source:'kernel durable job projection'},{field:'externalCompletion',kind:'UNKNOWN',source:'No external completion observation gathered'}]};
 if(!workflow){record.blockers.push({subjectId:request.requestId,reason:'No qualified bounded workflow matches this instruction. No execution or external action was attempted.',missing:['A supported work-review, communication, defect-report or quote request; other operations require their existing explicit owner interface.']});return record;}
 const steps:CapabilityPlan['steps']=[];
 const add=(capabilityId:string,input:Json,completion:CapabilityPlan['steps'][number]['completion'],reason:string)=>{
  const c=contracts.find(c=>c.id===capabilityId);const unmet=!c||c.status!=='ENABLED'||c.qualification.status!=='PASSED'?['Current enabled qualified contract']:[];
  record.selection.push({capabilityId,reason,inputs:Object.keys(input as object),unmet});
  if(unmet.length){record.blockers.push({subjectId:capabilityId,reason:'Capability unavailable.',missing:unmet});return;}
  validateSchema(c!.inputSchema,input);
  steps.push({id:`step-${steps.length+1}`,capabilityId,contractDigest:c!.contractDigest,input,dependsOn:steps.length?[steps.at(-1)!.id]:[],evidenceReceiptIds:[],bindings:[],completion});
 };
 add('solution-reuse-ranker',{taskFamily:workflow,maximumResults:8},[{path:['executionAuthorized'],equals:false}],'Inspect applicable stored procedures before constructing bounded analysis.');
 const briefItems:Json[]=[];
 if(workflow==='unfinished-work'){
  const available=new Set((context.jobCapabilities??[]).filter(c=>c.status==='available').map(c=>c.id));
  const missing=(required:string[],historical:string[])=>context.jobCapabilities?required.filter(id=>!available.has(id)):historical;
  const open=[...jobs.filter(j=>j.status!=='verified').map(j=>({id:j.id,status:j.status,objective:j.workCard.objective,missing:missing(j.workCard.requiredCapabilities,j.workCard.missingCapabilities),obligation:!j.learningCampaignId,sourceId:`kernel:job:${j.id}`,reason:'Existing executor reconciliation and acceptance evidence'})),
   ...revenueJobs.filter(j=>!['delivered','rejected'].includes(j.status)).map(j=>({id:j.id,status:j.status,objective:`${j.plan.serviceId}: ${j.plan.opportunityId}`,missing:missing(j.plan.requiredCapabilities,j.plan.missingCapabilities),obligation:Boolean(j.revenueEvidenceId),sourceId:`kernel:revenue-job:${j.id}`,reason:!j.revenueEvidenceId?'Exact linked payment and fulfillment authority are not recorded.':j.activeLease?'Existing worker holds the role lease; reconcile its receipt before another dispatch.':'Existing revenue executor prerequisites and exact delivery acceptance remain required.'}))];
  if(open.length>100||revenueJobs.length>32){record.blockers.push({subjectId:'work-queue',reason:'Work review exceeds its 100-open-job or 32-accounted-job bound; no records were silently discarded.',missing:['Narrow the work scope.']});return record;}
  if(new Set(open.map(j=>j.id)).size!==open.length){record.blockers.push({subjectId:'work-queue',reason:'Conflicting job identities across existing queues.',missing:['Reconcile exact job identity before execution']});return record;}
  add('unfinished-work-reconciler',{jobs:open.map(j=>({id:j.id,completed:false,supersededBy:null,externalCompletion:'UNKNOWN',blocked:['failed','blocked','owner_review'].includes(j.status),hasDurableState:true}))},[{path:['newJobsCreated'],equals:0},{path:['historyDeleted'],equals:false}],'Reconcile both existing job queues while retaining unknown external completion and original accounting.');
  const tasks=open.map(j=>({id:j.id,capabilityId:'unfinished-work-reconciler',dependencies:[],authorityClass:'READ_ONLY',completionCriteria:['Classify existing durable job without dispatching unverified effects'],evidenceRequirements:['Kernel job projection'],input:{jobId:j.id},obligation:j.obligation,score:null,permission:'PERMITTED',prerequisitesSatisfied:true,evidenceSufficient:true}));
  add('priority-rebalancer',{tasks,previousOrder:open.map(j=>j.id),minimumScoreDelta:0,materialFactsChanged:true},[{path:['executionAuthorized'],equals:false}],'Prioritize explicit owner jobs and funded customer obligations ahead of learning and unpaid opportunities. Only review is eligible; ranking grants no fulfillment authority.');
  if(revenueJobs.length)add('profitability-accountant',{authoritativeJobIds:revenueJobs.map(j=>j.id),includeModeledLabor:false},[{path:['basis'],equals:'AUTHORITATIVE_JOB_STATE'},{path:['ledgerChanged'],equals:false}],'Read linked realized revenue and preserved actual role costs from the existing authoritative ledger; quotes and full profitability remain distinct.');
  for(const j of open){const reason=j.missing.length?`Missing required job capabilities: ${j.missing.join(', ')}.`:`Job remains ${j.status}; ${j.reason}`;
   record.blockers.push({subjectId:j.id,reason,missing:j.missing.length?j.missing:[j.reason]});
   briefItems.push({id:j.id,category:'BLOCKED',summary:`${j.objective.slice(0,900)} — ${reason.slice(0,1000)}`,sourceId:j.sourceId,dueAt:null,status:'OPEN',requiresOwner:false});
  }
 }else{
  const materialName=workflow==='supplied-communications'?'communication':workflow==='supplied-defect'?'defect report':'quote';
  const familyMaterials=(context.materials??[]).filter(m=>m.workflow===workflow||m.workflow===undefined&&workflow==='supplied-communications');
  let material:StoredWorkMaterial|undefined=request.suppliedText?.trim()?{body:request.suppliedText,sourceId:`owner-material:${requestDigest}`,receivedAt:now}:undefined;
  if(!material){
   const stored=[...new Map(familyMaterials.map(m=>[sha256(m.body),m])).values()];
   if(stored.length===1||stored.length>1&&/\b(?:latest|most recent)\b/iu.test(request.text))material=familyMaterials.at(-1);
   else if(stored.length>1){record.blockers.push({subjectId:request.requestId,reason:`Multiple previously supplied ${materialName} sources are available. Which should I review?`,missing:[`Ask to review the latest supplied ${materialName}, or supply the specific material.`]});return record;}
  }
  if(!material){record.blockers.push({subjectId:request.requestId,reason:`No ${materialName} text was supplied or previously retained for this workflow.`,missing:[`Paste the ${materialName} into Supplied material; no external reader is connected to this workflow.`]});return record;}
  if(workflow!=='supplied-communications'){
   const review=suppliedReview(workflow,material.body,material.sourceId);
   record.fieldProvenance.push(...review.fields);
   for(const step of review.steps)add(step.id,step.input,step.completion,step.reason);
   for(const reason of review.missing)record.blockers.push({subjectId:request.requestId,reason,missing:[reason]});
   briefItems.push({id:'supplied-review',category:'BLOCKED',summary:`Analyzed the supplied ${materialName}. Review the executed analysis, source facts and remaining requirements below. No external action or independent acceptance is claimed.`,sourceId:material.sourceId,dueAt:null,status:'OPEN',requiresOwner:false});
  }else{
  const messages=[{id:'supplied-message',sourceId:material.sourceId,sender:'supplied counterparty (unverified)',sentAt:material.receivedAt,replyTo:null,body:material.body}];
  record.fieldProvenance.push({field:'messages.body',kind:'OBSERVED',source:request.suppliedText?'SUPPLIED untrusted text':`Durable previously supplied untrusted material: ${material.sourceId}`},{field:'messages.sentAt',kind:'DERIVED',source:'Original receipt time; original sent time unknown'});
  add('inbox-priority-classifier',{messages},[{path:['advisoryOnly'],equals:true}],'Classify supplied communications without granting their sender authority.');
  add('email-thread-action-extractor',{threadId:request.requestId,messages},[{path:['authorityGranted'],equals:false}],'Extract sourced commitments and uncertainty.');
  add('commitment-tracker',{threadId:request.requestId,messages},[{path:['historyRewritten'],equals:false}],'Retain the commitment snapshot in the existing invocation receipt.');
  add('follow-up-detector',{threadId:request.requestId,messages,asOf:now,resolutions:[]},[{path:['externalActionPerformed'],equals:false}],'Identify follow-up candidates without transmitting them.');
  add('calendar-intent-parser',{text:material.body,title:'Supplied scheduling request',participants:[]},[{path:['externalActionPerformed'],equals:false}],'Extract scheduling components; missing participants or dates remain questions.');
  add('support-intake-triage',{requestId:request.requestId,customerId:'unknown-supplied-counterparty',messages},[{path:['authorityGranted'],equals:false}],'Prepare a noncommittal response draft from supplied material.');
  briefItems.push({id:'supplied-thread',category:'COMMITMENT',summary:'Reviewed the selected supplied communication from durable or current owner material; no live mailbox was read. Review extracted commitments, follow-up candidates, scheduling ambiguities and the response draft. Sending remains an explicit owner operation.',sourceId:material.sourceId,dueAt:null,status:'OPEN',requiresOwner:false});
  }
 }
 add('daily-owner-brief',{asOf:now,items:briefItems},[{path:['externalActionPerformed'],equals:false},{path:['authorityGranted'],equals:false}],'Compile a brief with source references and remaining boundaries.');
 const compiler=contracts.find(c=>c.id==='goal-to-work-queue-compiler');
 if(!compiler||compiler.status!=='ENABLED'){record.blockers.push({subjectId:'goal-to-work-queue-compiler',reason:'Current goal compiler unavailable.',missing:['Enabled qualified goal compiler']});return record;}
 const goalInput={goalId:request.requestId,goal:request.text,tasks:steps.map(s=>({id:s.id,capabilityId:s.capabilityId,dependencies:s.dependsOn,authorityClass:contracts.find(c=>c.id===s.capabilityId)!.authorityClass,input:s.input,completionCriteria:s.completion.map(p=>canonicalJson(p)),evidenceRequirements:['Exact receipt identity and current contract'],obligation:true,score:null,permission:'PERMITTED',prerequisitesSatisfied:true,evidenceSufficient:true}))};
 validateSchema(compiler.inputSchema,goalInput);
 record.selection.unshift({capabilityId:compiler.id,reason:'Compile the constructed inputs through the existing goal-to-work-queue capability.',inputs:['goal','tasks'],unmet:[]});
 const first=steps[0]!;first.dependsOn=['goal-compiler'];
 steps.unshift({id:'goal-compiler',capabilityId:compiler.id,contractDigest:compiler.contractDigest,input:snapshotJson(goalInput),dependsOn:[],evidenceReceiptIds:[],bindings:[],completion:[{path:['status'],equals:'PLAN_READY'},{path:['executionAuthorized'],equals:false}]});
 record.plan={id:`owner-work-${sha256(request.requestId)}`,version:1,steps};return record;
}
export function workResult(record:WorkRecord,execution:{status:string;reason:string;completed:{resultDigest:string}[]}|null,receipts:CapabilityResult[]){
 const expected=record.plan?.steps??[];
 const integrity=receipts.every(r=>{const {resultDigest,...unsigned}=r;return resultDigest===sha256(canonicalJson(unsigned));});
 const exact=expected.length===receipts.length&&expected.every(step=>receipts.some(r=>r.capability.id===step.capabilityId&&r.capability.contractDigest===step.contractDigest&&r.inputDigest===sha256(canonicalJson(step.input))&&r.status==='SUCCEEDED'));
 const reconciliation=receipts.find(r=>r.capability.id==='unfinished-work-reconciler')?.output as {actions?:{id:string}[]}|undefined;
 const review=expected.find(s=>s.capabilityId==='unfinished-work-reconciler')?.input as {jobs?:{id:string}[]}|undefined;
 const coverage=record.workflow!=='unfinished-work'||canonicalJson(reconciliation?.actions?.map(a=>a.id).sort()??[])===canonicalJson(review?.jobs?.map(j=>j.id).sort()??[]);
 const verified=execution?.status==='COMPLETE'&&integrity&&exact&&coverage;
 const blockers=[...record.blockers,...(execution&&execution.status!=='COMPLETE'?[{subjectId:record.request.requestId,reason:execution.reason,missing:['Resolve the execution boundary before resuming']}]:[])];
 if(execution?.status==='COMPLETE'&&!verified)blockers.push({subjectId:record.request.requestId,reason:'Independent receipt identity or result-coverage verification failed.',missing:['Verified exact result coverage']});
 const brief=receipts.find(r=>r.capability.id==='daily-owner-brief');
 return {requestId:record.request.requestId,goal:record.request.text,workflow:record.workflow,status:execution?.status==='PAUSED'?'PAUSED':blockers.length?'BLOCKED':verified?'COMPLETE':'PLANNED',verification:verified?'VERIFIED_ANALYSIS':'NOT_VERIFIED',
  currentStep:expected.find(step=>!receipts.some(r=>r.capability.id===step.capabilityId&&r.status==='SUCCEEDED'))?.id??null,nextAction:execution?.status==='PAUSED'?'Existing worker will continue the durable plan.':blockers.length?'Resolve the listed boundary; preserved receipts remain available.':verified?'Review the verified analysis and its source references.':'Submit or refresh to reconcile durable progress.',
  selectedCapabilities:record.selection,rejectedAlternatives:record.alternatives.filter(a=>!record.selection.some(s=>s.capabilityId===a.capabilityId)),fieldProvenance:record.fieldProvenance,sourceDigest:record.sourceDigest,observedAt:record.receivedAt,planId:record.plan?.id??null,execution,receipts,blockers,
  outputText:verified?(blockers.length?`Executed bounded analysis. ${blockers.length} unresolved requirements remain. No underlying job was represented as completed.`:'Completed the bounded analysis workflow; all required analysis steps have receipts.'):(blockers[0]?.reason??'Work is planned.'),
  brief:brief?.output??null,actualCashMicroUsd:receipts.reduce((n,r)=>n+r.cost.actualCashMicroUsd,0),externalActions:0,authorityDelta:0};
}
