import {canonicalJson,sha256} from '../../canonical.ts';
import type {Job} from '../../types.ts';
import type {StoredEvent} from '../../store.ts';
import type {RecoverySnapshot} from './implementations.ts';
/** Existing kernel jobs are the durable unit; no synthetic replacement jobs. */
export function durableRecoverySnapshot(jobs:readonly Job[],events:readonly StoredEvent[],jobId:string):RecoverySnapshot|undefined {
 const job=jobs.find(j=>j.id===jobId);if(!job)return undefined;
 const relevant=events.filter(event=>{
  const d=event.data as {id?:string;jobId?:string;job?:{id?:string}};
  return (event.type==='job_created'&&d?.id===job.id)||d?.jobId===job.id||d?.job?.id===job.id||event.type.startsWith('model_budget_');
 });
 const last=relevant.at(-1);if(!last)return undefined;
 const done=job.status==='verified';
 return {jobId:job.id,revision:job.learningContractDigest??sha256(canonicalJson(job.workCard)),sourceDigest:sha256(canonicalJson({job,eventHashes:relevant.map(e=>e.hash)})),
  auditHead:last.hash,accounting:{spentMicroUsd:null,reservedMicroUsd:null},
  steps:[{id:job.id,status:done?'COMPLETED':job.status==='running'?'IN_FLIGHT':job.status==='authorized'?'PENDING':'FAILED',
    effect:'EXTERNAL_EFFECT',dependencies:[],receiptDigest:done?last.hash:null,idempotencyKey:job.id}]};
}
