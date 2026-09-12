import {arraySchema as a,objectSchema as o,textSchema as t,idSchema,digestSchema,type Json,validateSchema,CapabilityInputError} from './schema.ts';
import {identitySchema,identityFromInput,requireUnique,rows} from './engineering/common.ts';
import {canonicalJson,sha256} from '../canonical.ts';
import type {EvidenceRecord} from './types.ts';
export const ownerEvidenceSchema=o({requestId:idSchema,sourceId:idSchema,contentDigest:digestSchema,subject:identitySchema,claims:a(t(256),128,1)});
/** Owner attestation is its own grade; it can never mint CI or production capture. */
export function compileOwnerEvidence(input:Record<string,Json>,capturedAt:string):EvidenceRecord {
 validateSchema(ownerEvidenceSchema,input);requireUnique(rows(input.subject!),'key');const subject=identityFromInput(input.subject!);
 if(!Object.keys(subject).length)throw new CapabilityInputError('SUBJECT_IDENTITY_REQUIRED');
 const unsigned={sourceId:String(input.sourceId),contentDigest:String(input.contentDigest),provenance:'OWNER_OBSERVED' as const,claimedProvenance:null,
  authoritySource:false as const,subject,capturedAt,claims:[...new Set(input.claims as string[])].sort(),integrity:'KERNEL_RECEIPT' as const,receiptId:null};
 return {id:sha256(canonicalJson(unsigned)),...unsigned};
}
