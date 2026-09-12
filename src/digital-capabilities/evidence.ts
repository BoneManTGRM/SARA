import { canonicalJson, sha256 } from "../canonical.ts";
import { decidePriorEvidenceReuse, type ProcedureApplicabilityIdentity } from "../memory-fabric.ts";
import { CapabilityInputError, snapshotJson, type Json } from "./schema.ts";
import type { EvidenceRecord, SuppliedEvidence, Provenance } from "./types.ts";

export function normalizeSuppliedEvidence(records:readonly SuppliedEvidence[]=[]):EvidenceRecord[] {
  if(!Array.isArray(records)||records.length>64)throw new CapabilityInputError("EVIDENCE_LIMIT");
  const used=new Set<string>();
  return records.map(record=>{
    const clean=snapshotJson(record,65_536) as Record<string,Json>;
    if(!clean||Array.isArray(clean)||typeof clean!=="object"||Object.keys(clean).some(key=>!["sourceId","content","claimedProvenance"].includes(key))||
      typeof clean.sourceId!=="string"||! /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(clean.sourceId)||!Object.hasOwn(clean,"content")||
      (clean.claimedProvenance!==undefined&&(typeof clean.claimedProvenance!=="string"||clean.claimedProvenance.length>64)))throw new CapabilityInputError("INVALID_EVIDENCE");
    if(used.has(clean.sourceId))throw new CapabilityInputError("DUPLICATE_EVIDENCE_SOURCE");used.add(clean.sourceId);
    const contentDigest=sha256(canonicalJson(clean.content));
    return {id:sha256(canonicalJson({sourceId:clean.sourceId,contentDigest})),sourceId:clean.sourceId,contentDigest,provenance:"SUPPLIED",
      claimedProvenance:typeof clean.claimedProvenance==="string"?clean.claimedProvenance:null,authoritySource:false,subject:{},capturedAt:null,
      claims:[],integrity:"DIGESTED_INPUT",receiptId:null};
  });
}
/** Evidence classes are not a linear trust ladder: a test can never stand in for production. */
export function assessEvidence(input:{record:EvidenceRecord;requiredProvenance:Provenance[];currentIdentity:ProcedureApplicabilityIdentity;requiredClaims:string[]}):{
  status:"VALID"|"STALE"|"INCOMPLETE_EVIDENCE";reasons:string[];invalidations:Json[];
} {
  const reasons:string[]=[];
  if(!input.requiredProvenance.includes(input.record.provenance))reasons.push("PROVENANCE_MISMATCH");
  if(input.record.integrity!=="KERNEL_RECEIPT"&&input.record.provenance!=="SUPPLIED")reasons.push("UNVERIFIED_CAPTURE_AUTHORITY");
  if(input.requiredClaims.some(claim=>!input.record.claims.includes(claim)))reasons.push("CLAIM_NOT_PROVEN");
  const reuse=decidePriorEvidenceReuse({expectedIdentity:input.record.subject,currentIdentity:input.currentIdentity});
  if(!Object.keys(input.record.subject).length)reasons.push("SUBJECT_IDENTITY_MISSING");
  if(!reuse.reusable&&reuse.invalidations.length)reasons.push("SUBJECT_CHANGED");
  if(input.requiredProvenance.includes("PRODUCTION")&&input.record.provenance==="PRODUCTION"&&
    (typeof input.record.subject.deploymentSha!=="string"||! /^[a-f0-9]{40}$/u.test(input.record.subject.deploymentSha)||
      typeof input.record.subject.deploymentId!=="string"||! /^[A-Za-z0-9-]{8,128}$/u.test(input.record.subject.deploymentId)))reasons.push("DEPLOYMENT_IDENTITY_MISSING");
  return {status:reasons.some(reason=>reason!=="SUBJECT_CHANGED")?"INCOMPLETE_EVIDENCE":reasons.includes("SUBJECT_CHANGED")?"STALE":"VALID",reasons,
    invalidations:snapshotJson(reuse.invalidations.map(value=>({...value,current:value.current??null}))) as Json[]};
}
