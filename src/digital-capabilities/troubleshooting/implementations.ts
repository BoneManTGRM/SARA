import { CapabilityInputError, type Json } from '../schema.ts';
import type { ExecutionContext, ExecutionOutput } from '../types.ts';
import { data, rows, strings, digest, unique, requireUnique, suppliedAnalysis, type Data } from '../engineering/common.ts';

export function classifyFailure(f:Data):string {
 const text=`${f.code ?? ''} ${f.message}`;
 // Denials and deterministic defects take precedence over downstream timeout/retry text.
 if(/policy.{0,30}(reject|denied|prohibit)|permanent.policy/i.test(text))return 'POLICY_REJECTION';
 if(/budget|quota.exhaust|insufficient.funds/i.test(text))return 'BUDGET';
 if(/\b(401|403)\b|unauthori[sz]ed|forbidden|permission.denied|eacces/i.test(text))return 'AUTHORIZATION';
 if(/malformed|invalid.input|bad.request|\b400\b/i.test(text))return 'MALFORMED_INPUT';
 if(/assertion|syntaxerror|typeerror|referenceerror|test.failed|eresolve|deterministic/i.test(text))return 'DETERMINISTIC_CODE';
 if(/\b429\b|rate.limit/i.test(text))return 'RATE_LIMIT';
 if(/\b(500|502|503|504)\b|upstream.unavailable|service.unavailable/i.test(text))return 'UPSTREAM_OUTAGE';
 if(/timeout|timed.out|etimedout/i.test(text))return 'TIMEOUT';
 if(/econnreset|econnrefused|eai_again|temporar/i.test(text))return 'LIKELY_TRANSIENT';
 return 'UNKNOWN';
}
export function cluster(input:Data):ExecutionOutput {
 const failures=rows(input.failures!); const seen=new Map<string,string>(); const duplicate:string[]=[];
 const families=new Map<string,Data>();
 for(const f of failures){const eventDigest=digest(f),id=String(f.id);if(seen.has(id)){if(seen.get(id)!==eventDigest)throw new CapabilityInputError('CONFLICTING_EVENT_ID');duplicate.push(id);continue;}seen.set(id,eventDigest);
  const category=classifyFailure(f);
  const frames=strings(f.frames!).map(frame=>frame.replace(/:\d+(?::\d+)?\b/g,':N'));
  // Error text differences without structured frame/code evidence remain separate signatures.
  const signature=digest({category,subsystem:f.subsystem,code:f.code,frames,messageFallback:frames.length===0?digest(f.message):null});
  const existing=families.get(signature);if(existing){(existing.eventIds as string[]).push(id);(existing.sourceIds as string[]).push(String(f.sourceId));existing.occurrences=Number(existing.occurrences)+1;}
  else families.set(signature,{signature,category,subsystem:f.subsystem!,eventIds:[id],sourceIds:[String(f.sourceId)],occurrences:1,rootCauseProven:false});
 }
 const result=[...families.values()].map((f):Data=>({...f,eventIds:unique(strings(f.eventIds!)),sourceIds:unique(strings(f.sourceIds!))})).sort((a,b)=>String(a.signature).localeCompare(String(b.signature)));
 return suppliedAnalysis({families:result,duplicateEventIds:unique(duplicate),sourceDigest:digest(input)},['Repeated signatures suggest a failure family; shared root cause requires current causal evidence.']);
}
export function retry(input:Data):ExecutionOutput {
 const category=classifyFailure(data(input.failure!));const reasons:string[]=[];
 const remainingAttempts=Math.max(0,Number(input.maximumAttempts)-Number(input.attempts));
 let decision='CONDITIONAL_RETRY';
 if(['POLICY_REJECTION','BUDGET','AUTHORIZATION','MALFORMED_INPUT','DETERMINISTIC_CODE'].includes(category)){decision='DO_NOT_RETRY';reasons.push('Repair the classified deterministic blocker before another attempt.');}
 if(category==='UNKNOWN'){decision='DIAGNOSE';reasons.push('No objective transient signature identified.');}
 if(!remainingAttempts){decision='DO_NOT_RETRY';reasons.push('Attempt limit reached.');}
 if(Number(input.estimatedAttemptMicroUsd)>Number(input.remainingBudgetMicroUsd)){decision='DO_NOT_RETRY';reasons.push('Supplied remaining budget does not cover the attempt.');}
 if(input.completion==='COMPLETED'){decision='DO_NOT_RETRY';reasons.push('Completion is already recorded; do not duplicate completed work.');}
 if(input.effect==='EXTERNAL_EFFECT'&&(input.completion==='UNKNOWN'||input.idempotencyKey===null)){decision='DO_NOT_RETRY';reasons.push('Reconcile external completion and establish idempotency before any replay.');}
 if(decision==='CONDITIONAL_RETRY')reasons.push('Retry is only a proposal, subject to current authority, remaining budget, and fresh completion reconciliation.');
 return suppliedAnalysis({category,decision,reasons,delaySeconds:decision==='CONDITIONAL_RETRY'?(input.retryAfterSeconds??Math.min(300,2**Math.min(Number(input.attempts),8))):null,remainingAttempts,executionAuthorized:false,evidenceDigest:digest(input.failure)},['Caller estimates do not change the authoritative budget or retry ceiling.']);
}
export function designExperiment(input:Data):ExecutionOutput {
 const hypotheses=rows(input.hypotheses!),experiments=rows(input.experiments!);requireUnique(hypotheses,'id');requireUnique(experiments,'id');
 const hypothesisIds=hypotheses.map(h=>String(h.id));const ranking:Data[]=[],rejected:Data[]=[];
 for(const e of experiments){const predictions=rows(e.predictions!);requireUnique(predictions,'hypothesisId');if(predictions.some(p=>!hypothesisIds.includes(String(p.hypothesisId))))throw new CapabilityInputError('UNKNOWN_HYPOTHESIS');
 const reasons:string[]=[];if(e.target==='PRODUCTION_MUTATION')reasons.push('Diagnostic reproduction may not mutate production.');if(Number(e.costMicroUsd)>Number(input.availableCashMicroUsd))reasons.push('Experiment exceeds supplied available cash.');
 const missingPredictionIds=hypothesisIds.filter(id=>!predictions.some(p=>p.hypothesisId===id));let pairs=0;
 for(let i=0;i<predictions.length;i++)for(let j=i+1;j<predictions.length;j++)if(predictions[i]!.outcome!==predictions[j]!.outcome)pairs++;
 if(missingPredictionIds.length)reasons.push('All competing hypotheses need a prediction before comparison.');if(!pairs)reasons.push('No competing hypotheses are distinguished.');
 if(reasons.length)rejected.push({id:e.id!,reasons});else ranking.push({id:e.id!,distinguishedPairs:pairs,costMicroUsd:e.costMicroUsd!,durationSeconds:e.durationSeconds!,missingPredictionIds});
 }
 // Preserve raw units: Pareto-style priority by information, then cost, then duration; no fictitious dollars for time.
 ranking.sort((a,b)=>Number(b.distinguishedPairs)-Number(a.distinguishedPairs)||Number(a.costMicroUsd)-Number(b.costMicroUsd)||Number(a.durationSeconds)-Number(b.durationSeconds)||String(a.id).localeCompare(String(b.id)));
 return suppliedAnalysis({selectedId:ranking[0]?.id??null,ranking,rejected,status:ranking.length?'DRAFT_READY':'INCOMPLETE_EVIDENCE',executionAuthorized:false,sourceDigest:digest(input)},['Predicted outcomes are supplied hypotheses, not measured experiment results.']);
}
export type RecoverySnapshot={sourceDigest:string;jobId:string;revision:string;steps:{id:string;status:'PENDING'|'COMPLETED'|'IN_FLIGHT'|'FAILED';dependencies:string[];effect:'PURE'|'EXTERNAL_EFFECT';receiptDigest:string|null;idempotencyKey:string|null}[];accounting:{spentMicroUsd:number|null;reservedMicroUsd:number|null};auditHead:string};
export function reconstruct(input:Data,context:ExecutionContext):ExecutionOutput {
 const trusted=(context as ExecutionContext&{recoverySnapshot?:RecoverySnapshot}).recoverySnapshot;
 const matching=trusted?.jobId===input.jobId&&trusted.revision===input.revision;
 const steps=matching?trusted.steps as unknown as Data[]:rows(input.journal!);requireUnique(steps,'id');
 const completedIds:string[]=[],resumeIds:string[]=[],reconcileIds:string[]=[],blockedIds:string[]=[];
 const completed=new Set(steps.filter(s=>s.status==='COMPLETED'&&s.receiptDigest!==null).map(s=>String(s.id)));
 for(const s of steps){const id=String(s.id);if(s.status==='COMPLETED'&&s.receiptDigest!==null){completedIds.push(id);continue;}
 if((s.status==='IN_FLIGHT'&&s.effect==='EXTERNAL_EFFECT')||s.status==='COMPLETED'){reconcileIds.push(id);continue;}
 if(strings(s.dependencies!).some(d=>!completed.has(d))||s.status==='FAILED'){blockedIds.push(id);continue;}
 if(s.effect==='EXTERNAL_EFFECT'&&s.idempotencyKey===null){reconcileIds.push(id);continue;}
 if(matching)resumeIds.push(id);else blockedIds.push(id);
 }
 const status=!matching?'EVIDENCE_REQUIRED':reconcileIds.length?'RECONCILE_EXTERNAL_COMPLETION':blockedIds.length?'BLOCKED':resumeIds.length?'CONTINUATION_IDENTIFIED':steps.length?'COMPLETE':'EVIDENCE_REQUIRED';
 const output={status,basis:matching?'TRUSTED_DURABLE_STATE':'SUPPLIED_JOURNAL_ONLY',completedIds:unique(completedIds),resumeIds:unique(resumeIds),reconcileIds:unique(reconcileIds),blockedIds:unique(blockedIds),accounting:matching?trusted.accounting:null,auditHead:matching?trusted.auditHead:null,sourceDigest:matching?trusted.sourceDigest:digest(input),executionAuthorized:false};
 if(!matching)return suppliedAnalysis(output,['A trusted matching durable snapshot is required to reconstruct an executable continuation.']);
 return {output,observed:[{basis:'TRUSTED_DURABLE_STATE',sourceDigest:trusted.sourceDigest}],unknowns:['Continuation still requires normal scheduler authority and live external completion checks; this analysis changes no job or reservation. Null job-level accounting means attribution is unknown; existing shared reservations remain authoritative.'],confidence:{level:'HIGH',basis:'Deterministic reconstruction from the matching kernel durable snapshot; no external completion is inferred.'}};
}
export function resolveBlockers(input:Data):ExecutionOutput {
 const tasks=rows(input.tasks!);requireUnique(tasks,'id');for(const t of tasks)requireUnique(rows(t.blockers!),'id');
 const map=new Map(tasks.map(t=>[String(t.id),t]));const missing:string[]=[],cycles:string[]=[],roots:Data[]=[];const done=new Set<string>();
 function visit(id:string,path:string[]):void{if(path.includes(id)){cycles.push(...path.slice(path.indexOf(id)),id);return;}if(done.has(id))return;const t=map.get(id);if(!t){missing.push(id);return;}if(t.completed===true){done.add(id);return;}
 for(const b of rows(t.blockers!))roots.push({taskId:id,blockerId:b.id!,kind:b.kind!,evidenceRefs:b.evidenceRefs!,detailDigest:digest(b.detail)});
 for(const d of strings(t.dependencies!))visit(d,[...path,id]);
 if(id!==input.taskId&&rows(t.blockers!).length===0&&strings(t.dependencies!).every(d=>map.get(d)?.completed===true))roots.push({taskId:id,blockerId:null,kind:'FAILED_PREREQUISITE',evidenceRefs:[],detailDigest:digest({id,status:'PENDING_PREREQUISITE'})});
 done.add(id);}
 visit(String(input.taskId),[]);const status=missing.length?'INCOMPLETE_EVIDENCE':roots.length||cycles.length?'BLOCKED':'UNBLOCKED';
 const order=['POLICY_PROHIBITION','MISSING_AUTHORITY','HUMAN_ONLY','ECONOMIC_STOP','FAILED_PREREQUISITE','EXTERNAL_OUTAGE','MISSING_CAPABILITY','MISSING_EVIDENCE','UNKNOWN'];
 roots.sort((a,b)=>order.indexOf(String(a.kind))-order.indexOf(String(b.kind))||String(a.taskId).localeCompare(String(b.taskId))||String(a.blockerId).localeCompare(String(b.blockerId)));
 return suppliedAnalysis({status,roots,missingTaskIds:unique(missing),cycleTaskIds:unique(cycles),nextAction:missing.length?'Read the missing authoritative task records.':cycles.length?'Resolve the dependency cycle without duplicating jobs.':roots.length?`Resolve ${String(roots[0]!.kind)} for task ${String(roots[0]!.taskId)} using its evidence.`:'No supplied dependency blocker remains; normal authority checks still apply.',executionAuthorized:false});
}
export function escalation(input:Data):ExecutionOutput {
 const alternatives=rows(input.alternatives!),choices=rows(input.choices!);requireUnique(alternatives,'id');requireUnique(choices,'id');
 const missingFacts:string[]=[];const evidenceRefs=strings(input.evidenceRefs!);const ownerReason=['MISSING_AUTHORITY','HUMAN_ONLY'].includes(String(input.reason));
 if(!evidenceRefs.length)missingFacts.push('Exact supporting evidence references.');if(!input.decision)missingFacts.push('Exact decision or action required.');if(!choices.length)missingFacts.push('Consequences of the available choice or action.');
 const attempted=alternatives.filter(a=>a.outcome==='FAILED'||a.outcome==='UNAVAILABLE');if(attempted.some(a=>strings(a.evidenceRefs!).length===0))missingFacts.push('Evidence for attempted or unavailable alternatives.');
 const untried=alternatives.filter(a=>a.outcome==='UNTRIED');if(!ownerReason&&untried.length)missingFacts.push('Try available safe diagnostic alternatives first.');
 const success=alternatives.some(a=>a.outcome==='SUCCEEDED');const status=success||input.reason==='POLICY_PROHIBITION'?'NO_ESCALATION_REQUIRED':missingFacts.length||!ownerReason?'MORE_DIAGNOSIS_REQUIRED':'OWNER_DECISION_READY';
 return suppliedAnalysis({status,taskId:input.taskId!,reason:input.reason!,evidenceRefs,attemptedAlternativeIds:attempted.map(a=>String(a.id)),untriedAlternativeIds:untried.map(a=>String(a.id)),decision:input.decision!,choices,missingFacts,transmissionAuthorized:false},['No owner notification is transmitted. Supplied alternatives and decisions retain their untrusted provenance.']);
}
