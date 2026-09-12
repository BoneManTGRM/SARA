import {canonicalJson,sha256} from '../../canonical.ts';
import type {LedgerEntry} from '../../types.ts';
import type {RevenuePilotJob} from '../../revenue-pilot.ts';
import type {ExecutionContext} from '../types.ts';
import {CapabilityInputError,type Json} from '../schema.ts';
import {roleCostDigest} from '../../revenue-job-accounting.ts';

type Data=Record<string,Json>;
export type AuthoritativeJobAccounting={jobIds:string[];entries:Data[];unknowns:string[];basisDigest:string|null;missingJobIds:string[];unattributedEntries:Data[];unattributedEntryCount:number;jobStatuses:{jobId:string;status:string}[]};
function micro(value:number):number {const result=Math.round(value*1_000_000);if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(result))throw new CapabilityInputError('INVALID_ACCOUNTED_AMOUNT');return result;}
/** Read the existing authoritative ledger and durable job receipts; never infer
 * financial attribution from prose, customer claims, predicted prices or names. */
export function buildAuthoritativeJobAccounting(jobIds:string[],ledger:readonly LedgerEntry[],jobs:readonly RevenuePilotJob[]):AuthoritativeJobAccounting {
 const ids=[...new Set(jobIds)].sort();if(ids.length>32)throw new CapabilityInputError('ACCOUNTING_JOB_LIMIT');
 const selected=ids.flatMap(id=>jobs.filter(j=>j.id===id)),missingJobIds=ids.filter(id=>!selected.some(j=>j.id===id));
 const entries:Data[]=[],unknowns=['Refunds, hosting/tooling allocations and other expenses remain unknown unless explicitly job-attributed; absence of records does not prove zero expense.','Unreconciled model expense uses conservatively accounted durable role costs, including failures. Owner-attested invoice records cover exact role receipts without creating independent provider invoice attestations.'];
 const boundRevenueIds=new Set(jobs.flatMap(j=>j.revenueEvidenceId?[j.revenueEvidenceId]:[]));
 for(const job of selected){
  const expenses=ledger.filter(e=>e.realized&&e.jobAccounting?.jobId===job.id);
  const reconciled=new Set(expenses.filter(e=>e.jobAccounting!.category==='MODEL_API').flatMap(e=>e.jobAccounting!.roleReceiptDigests??[]));
  for(const expense of expenses)entries.push({id:`expense-${expense.id}`,jobId:job.id,sourceId:`ledger:${expense.id}`,kind:expense.jobAccounting!.category,amountMicroUsd:micro(expense.amountUsd),realized:true});
  if(expenses.length)unknowns.push(`Job ${job.id}: attributed expenses are authenticated owner attestations with retained source references; this analysis does not independently verify those external sources.`);
  const revenue=ledger.find(e=>e.id===job.revenueEvidenceId);
  if(revenue?.kind==='revenue'&&revenue.source==='customer'&&revenue.realized){entries.push({id:`revenue-${revenue.id}`,jobId:job.id,sourceId:`ledger:${revenue.id}`,kind:'REVENUE',amountMicroUsd:micro(revenue.amountUsd),realized:true});}
  else unknowns.push(`Job ${job.id}: no exact linked realized customer revenue entry; quoted price is not received revenue.`);
  let receiptCost=0;
  for(const [index,receipt] of job.receipts.entries()){
   const cost=micro(receipt.costUsd);receiptCost+=cost;
   if(reconciled.has(roleCostDigest(job,index)))continue;
   if(cost===0)continue;
   const model=Boolean(receipt.modelExecution||receipt.modelFailure);
   entries.push({id:`role-${sha256(canonicalJson({jobId:job.id,index,receipt}))}`,jobId:job.id,sourceId:`job:${job.id}:receipt:${index}`,kind:model?'MODEL_API':'DIRECT_EXTERNAL',amountMicroUsd:cost,realized:true});
   if(!model)unknowns.push(`Job ${job.id} receipt ${index}: accounted execution cost has no model evidence; classified as direct execution cost, without provider billing attribution.`);
  }
  if(receiptCost!==micro(job.actualExecutionCostUsd))unknowns.push(`Job ${job.id}: aggregate execution cost and role receipts disagree; full contribution is unverified.`);
  // Preserve zero-cost/failed/unpaid jobs in the accountant grouping too.
  if(!entries.some(e=>e.jobId===job.id))entries.push({id:`job-${job.id}`,jobId:job.id,sourceId:`job:${job.id}:record`,kind:'DIRECT_EXTERNAL',amountMicroUsd:0,realized:true});
 }
 const unattributed=ledger.filter(e=>!boundRevenueIds.has(e.id)&&!jobs.some(j=>j.id===e.jobAccounting?.jobId)).map(e=>({id:e.id,kind:e.kind,source:e.source,amountMicroUsd:micro(e.amountUsd),realized:e.realized,recurringMonthly:e.recurringMonthly}));
 if(unattributed.length)unknowns.push(`${unattributed.length} ledger entries lack exact job attribution; their amounts are exposed separately and are not silently allocated or counted as predicted cash.`);
 if(unattributed.length>128)unknowns.push('Unattributed entry details are bounded to 128; the source digest binds the entire unattributed set. Full profitability is not established.');
 if(missingJobIds.length)unknowns.push(`Requested job records missing: ${missingJobIds.join(', ')}.`);
 const jobStatuses=selected.map(j=>({jobId:j.id,status:j.status}));
 const basisDigest=sha256(canonicalJson({jobIds:ids,entries,missingJobIds,unattributed,jobStatuses,attributions:ledger.filter(e=>ids.includes(e.jobAccounting?.jobId??'')),aggregates:selected.map(j=>({id:j.id,actualExecutionCostMicroUsd:micro(j.actualExecutionCostUsd)}))}));
 return {jobIds:ids,entries,unknowns,basisDigest,missingJobIds,unattributedEntries:unattributed.slice(0,128),unattributedEntryCount:unattributed.length,jobStatuses};
}
export function projectAuthoritativeJobAccounting(jobIds:string[],context:ExecutionContext):AuthoritativeJobAccounting {
 const expected=[...new Set(jobIds)].sort(),projection=context.authoritativeJobAccounting;
 if(!projection||canonicalJson(expected)!==canonicalJson(projection.jobIds))return {jobIds:expected,entries:[],unknowns:['Current kernel-owned accounting projection for the exact requested jobs is required.'],basisDigest:null,missingJobIds:expected,unattributedEntries:[],unattributedEntryCount:0,jobStatuses:[]};
 return structuredClone(projection);
}
