import {canonicalJson,sha256} from './canonical.ts';
import type {LedgerEntry} from './types.ts';
import type {RevenuePilotJob} from './revenue-pilot.ts';

export type JobExpenseInput={expectedScopeDigest:string;category:NonNullable<LedgerEntry['jobAccounting']>['category'];amountUsd:number;evidenceRef:string};
export const jobExpenseKinds={MODEL_API:'fulfillment_cost',DIRECT_EXTERNAL:'fulfillment_cost',ALLOCATION:'core_operation',REFUND:'required_liability'} as const;
export function roleCostDigest(job:RevenuePilotJob,index:number){return sha256(canonicalJson({jobId:job.id,index,receipt:job.receipts[index]}));}
export function jobAccountingScope(job:RevenuePilotJob,ledger:readonly LedgerEntry[]){
 return sha256(canonicalJson({job,entries:ledger.filter(e=>e.id===job.revenueEvidenceId||e.jobAccounting?.jobId===job.id)}));
}
/** Optional metadata on the existing ledger. No new financial store or policy. */
export function bindJobExpense(input:Omit<LedgerEntry,'id'>,job:RevenuePilotJob,ledger:readonly LedgerEntry[]){
 const a=input.jobAccounting!;
 if(!a||!Object.hasOwn(jobExpenseKinds,a.category)||input.kind!==jobExpenseKinds[a.category]||input.source!=='sara'||!input.realized||input.recurringMonthly)throw new Error('Invalid owner-attested job expense category.');
 if(typeof a.evidenceRef!=='string'||!a.evidenceRef.trim()||a.evidenceRef.length>128||/[\u0000-\u001f\u007f]/u.test(a.evidenceRef))throw new Error('A bounded financial evidence reference is required.');
 if(!/^[a-f0-9]{64}$/u.test(a.scopeDigest))throw new Error('Exact job accounting scope is required.');
 const prior=ledger.find(e=>e.jobAccounting?.jobId===job.id&&e.jobAccounting.evidenceRef===a.evidenceRef);
 if(prior){
  if(prior.amountUsd!==input.amountUsd||prior.jobAccounting!.category!==a.category)throw new Error('Conflicting duplicate job expense evidence.');
  return {existing:prior,attribution:prior.jobAccounting!};
 }
 if(a.scopeDigest!==jobAccountingScope(job,ledger))throw new Error('Job accounting scope changed; review current costs before recording.');
 if(a.category==='REFUND'){
  const revenue=ledger.find(e=>e.id===job.revenueEvidenceId&&e.kind==='revenue'&&e.source==='customer'&&e.realized);
  const refunded=ledger.filter(e=>e.jobAccounting?.jobId===job.id&&e.jobAccounting.category==='REFUND').reduce((n,e)=>n+e.amountUsd,0);
  if(!revenue||Math.round((refunded+input.amountUsd)*100)>Math.round(revenue.amountUsd*100))throw new Error('Recorded refund exceeds exact linked customer revenue.');
 }
 const covered=new Set(ledger.filter(e=>e.jobAccounting?.jobId===job.id&&e.jobAccounting.category==='MODEL_API').flatMap(e=>e.jobAccounting!.roleReceiptDigests??[]));
 const roleReceiptDigests=a.category==='MODEL_API'?job.receipts.flatMap((r,index)=>r.modelExecution||r.modelFailure?[roleCostDigest(job,index)]:[]).filter(d=>!covered.has(d)):[];
 if(a.category==='MODEL_API'&&(job.activeLease||!roleReceiptDigests.length))throw new Error('Model invoice reconciliation requires unaccounted role receipts and no active worker lease.');
 return {existing:null,attribution:{jobId:job.id,category:a.category,evidenceRef:a.evidenceRef,scopeDigest:a.scopeDigest,roleReceiptDigests}};
}
