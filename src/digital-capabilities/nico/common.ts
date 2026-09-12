import { assessEvidence } from '../evidence.ts';
import type { ExecutionContext,EvidenceRecord } from '../types.ts';
import type { Data } from '../engineering/common.ts';
export function subject(identity:Data):Record<string,string|number>{return {runId:String(identity.runId),repository:String(identity.repository),commitSha:String(identity.commitSha),reportRevision:Number(identity.revision),reportDigest:String(identity.reportDigest)};}
export function proof(context:ExecutionContext,ids:string[],identity:Data,claim:string,extra:Record<string,string|number|boolean>={}):EvidenceRecord|undefined {
 const expected={...subject(identity),...extra};return ids.flatMap(id=>context.evidence.filter(e=>e.id===id||e.receiptId===id||e.contentDigest===id)).find(e=>e.provenance!=='SUPPLIED'&&e.integrity==='KERNEL_RECEIPT'&&Object.entries(expected).every(([k,v])=>e.subject[k]===v)&&assessEvidence({record:e,requiredProvenance:[e.provenance],requiredClaims:[claim],currentIdentity:{...e.subject,...context.currentIdentity,...expected}}).status==='VALID');
}
export function independentActor(id:unknown,producer:unknown):id is string{return typeof id==='string'&&id!==producer&&!/^(?:sara|sara[-_:].*|system|model)$/i.test(id);}
export function humanProof(ctx:ExecutionContext,ids:string[],identity:Data,claim:string,actor:unknown,producer:unknown,extra:Record<string,string|number|boolean>={}):boolean{return independentActor(actor,producer)&&Boolean(proof(ctx,ids,identity,claim,{...extra,actorId:actor,actorKind:'HUMAN',producerId:String(producer)}));}
