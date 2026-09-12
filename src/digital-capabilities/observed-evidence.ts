import {arraySchema as a,objectSchema as o,textSchema as t,idSchema,digestSchema,type Json,validateSchema,CapabilityInputError} from './schema.ts';
import {requireUnique,rows} from './engineering/common.ts';
import {canonicalJson,sha256} from '../canonical.ts';
import type {EvidenceRecord} from './types.ts';
export const ownerEvidenceSchema=o({requestId:idSchema,sourceId:idSchema,contentDigest:digestSchema,subject:a(o({key:idSchema,value:{type:'json'}}),64,1),claims:a(t(256),128,1)});
/** Owner attestation is its own grade; it can never mint CI or production capture. */
export function compileOwnerEvidence(input:Record<string,Json>,capturedAt:string):EvidenceRecord {
 validateSchema(ownerEvidenceSchema,input);requireUnique(rows(input.subject!),'key');const entries=rows(input.subject!);for(const entry of entries){const v=entry.value;if(['__proto__','constructor','prototype'].includes(String(entry.key))||v!==null&&typeof v!=='string'&&typeof v!=='boolean'&&!(typeof v==='number'&&Number.isSafeInteger(v))||typeof v==='string'&&v.length>2048)throw new CapabilityInputError('SAFE_SCALAR_SUBJECT_REQUIRED');}const subject=Object.fromEntries(entries.map(e=>[String(e.key),e.value])) as EvidenceRecord['subject'];
 if(!Object.keys(subject).length)throw new CapabilityInputError('SUBJECT_IDENTITY_REQUIRED');
 const unsigned={sourceId:String(input.sourceId),contentDigest:String(input.contentDigest),provenance:'OWNER_OBSERVED' as const,claimedProvenance:null,
  authoritySource:false as const,subject,capturedAt,claims:[...new Set(input.claims as string[])].sort(),integrity:'KERNEL_RECEIPT' as const,receiptId:null};
 return {id:sha256(canonicalJson(unsigned)),...unsigned};
}
