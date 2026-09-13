import { snapshotJson,type Json } from './schema.ts';
import type { CapabilityResult } from './types.ts';
const dependencyKeys=['serviceReadinessDigest','proceduralKnowledgeDigest','capabilityReadinessDigest','recoverySnapshotDigest','jobAccountingDigest','workSubjectDigest','softwareRuntimeDigest'] as const;
export function hasReceiptDependencies(subject:CapabilityResult['subject']):boolean{return dependencyKeys.some(key=>subject[key]!==undefined);}
/** Persist only the identifiers needed to recompute minimum authoritative state.
 * Communication bodies, field values, customer prose and secrets are excluded. */
export function receiptDependencyInput(input:Record<string,Json>,subject:CapabilityResult['subject'],resolvedReadinessIds?:readonly string[]):Record<string,Json>|undefined {
 if(!hasReceiptDependencies(subject))return undefined;
 const retained:Record<string,Json>={};
 if(subject.softwareRuntimeDigest!==undefined)retained.softwareScope=input.scope??null;
 if(subject.workSubjectDigest!==undefined)retained.workId=input.workId!;
 if(subject.jobAccountingDigest!==undefined)retained.authoritativeJobIds=input.authoritativeJobIds??[];
 if(subject.serviceReadinessDigest!==undefined){retained.serviceCapabilityIds=Array.isArray(input.capabilities)?input.capabilities.map(x=>(x as Record<string,Json>).id!):input.requiredCapabilityIds??[];}
 if(subject.capabilityReadinessDigest!==undefined){const rows=[...(Array.isArray(input.tasks)?input.tasks:[]),...(Array.isArray(input.encounters)?input.encounters:[])];retained.capabilityReadinessIds=resolvedReadinessIds?[...resolvedReadinessIds].sort():[...new Set([...rows.map(x=>(x as Record<string,Json>).capabilityId!),...(Array.isArray(input.requestedCapabilityIds)?input.requestedCapabilityIds:[])])].sort();}
 if(subject.recoverySnapshotDigest!==undefined)retained.recoveryJobId=input.jobId!;
 if(subject.proceduralKnowledgeDigest!==undefined){const fields=['operation','playbookId','playbookVersion','taskFamily','claimKey','sourceKind','sourceRequestId'];const procedural:Record<string,Json>={};for(const key of fields)if(input[key]!==undefined)procedural[key]=input[key]!;if(Array.isArray(input.rules))procedural.rules=input.rules.map(x=>{const r=x as Record<string,Json>;return {kind:r.kind!,id:r.id!,version:r.version!};});if(Array.isArray(input.forecasts))procedural.forecasts=input.forecasts.map(x=>({taskReferenceDigest:(x as Record<string,Json>).taskReferenceDigest!}));retained.procedural=procedural;}
 return snapshotJson(retained,65536) as Record<string,Json>;
}
