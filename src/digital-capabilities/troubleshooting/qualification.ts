import type { FrozenCase } from '../types.ts';
import type { Json } from '../schema.ts';
const out=(r:{output:Json})=>r.output as Record<string,Json>;
export const failure={id:'event-1',sourceId:'ci-1',subsystem:'api',code:null,message:'HTTP 503 upstream unavailable',frames:[]};
export const retryInput={failure,attempts:0,maximumAttempts:3,remainingBudgetMicroUsd:100,estimatedAttemptMicroUsd:10,effect:'PURE',completion:'NOT_COMPLETED',idempotencyKey:null,retryAfterSeconds:null};
export const cases:Record<string,FrozenCase[]>={
 'failure-clusterer':[
  {name:'same-observation-not-double-counted',input:{failures:[failure,failure]},check:r=>(out(r).families as Record<string,Json>[])[0]?.occurrences===1&&(out(r).duplicateEventIds as Json[]).length===1},
  {name:'empty-is-no-invented-incident',input:{failures:[]},check:r=>(out(r).families as Json[]).length===0},
 ],
 'retry-worthiness-classifier':[
  {name:'upstream-can-retry-conditionally',input:retryInput,check:r=>out(r).decision==='CONDITIONAL_RETRY'&&out(r).executionAuthorized===false},
  {name:'denial-wins-over-timeout',input:{...retryInput,failure:{...failure,message:'403 forbidden; downstream timeout'}},check:r=>out(r).category==='AUTHORIZATION'&&out(r).decision==='DO_NOT_RETRY'},
  {name:'uncertain-external-completion-no-replay',input:{...retryInput,effect:'EXTERNAL_EFFECT',completion:'UNKNOWN',idempotencyKey:'key'},check:r=>out(r).decision==='DO_NOT_RETRY'},
 ],
 'diagnostic-experiment-designer':[
  {name:'safe-cheapest-discriminator',input:{hypotheses:[{id:'h1',evidenceRefs:[]},{id:'h2',evidenceRefs:[]}],experiments:[{id:'read',target:'READ_ONLY',costMicroUsd:0,durationSeconds:10,predictions:[{hypothesisId:'h1',outcome:'pass'},{hypothesisId:'h2',outcome:'fail'}],evidenceRefs:[]}],availableCashMicroUsd:0},check:r=>out(r).selectedId==='read'&&out(r).executionAuthorized===false},
  {name:'empty-is-insufficient',input:{hypotheses:[],experiments:[],availableCashMicroUsd:0},check:r=>out(r).status==='INCOMPLETE_EVIDENCE'},
 ],
 'recovery-state-reconstructor':[
  {name:'supplied-completed-journal-cannot-authorize-continuation',input:{jobId:'job',revision:'rev',journal:[{id:'step',status:'COMPLETED',dependencies:[],effect:'EXTERNAL_EFFECT',receiptDigest:'a'.repeat(64),idempotencyKey:'key'}]},check:r=>out(r).status==='EVIDENCE_REQUIRED'&&(out(r).resumeIds as Json[]).length===0},
  {name:'missing-journal-does-not-mean-complete',input:{jobId:'job',revision:'rev',journal:[]},check:r=>out(r).status==='EVIDENCE_REQUIRED'},
 ],
 'blocked-work-resolver':[
  {name:'missing-record-is-unknown',input:{taskId:'missing',tasks:[]},check:r=>out(r).status==='INCOMPLETE_EVIDENCE'},
  {name:'cyclic-prerequisites-block',input:{taskId:'a',tasks:[{id:'a',completed:false,dependencies:['b'],blockers:[]},{id:'b',completed:false,dependencies:['a'],blockers:[]}]},check:r=>out(r).status==='BLOCKED'&&(out(r).cycleTaskIds as Json[]).length===2},
 ],
 'escalation-quality-controller':[
  {name:'vague-failure-needs-diagnosis',input:{taskId:'job',reason:'UNKNOWN',evidenceRefs:[],alternatives:[],decision:null,choices:[]},check:r=>out(r).status==='MORE_DIAGNOSIS_REQUIRED'},
  {name:'precise-authority-boundary-can-be-presented',input:{taskId:'job',reason:'MISSING_AUTHORITY',evidenceRefs:['denial'],alternatives:[],decision:'Approve this bounded test target or keep the task blocked.',choices:[{id:'keep-blocked',effect:'No external work executes.'}]},check:r=>out(r).status==='OWNER_DECISION_READY'&&out(r).transmissionAuthorized===false},
 ],
};
