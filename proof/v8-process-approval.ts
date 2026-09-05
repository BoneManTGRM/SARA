export type Identity={contractDigest:string;implementationCommit:string;deploymentId:string;serviceId:string;nonce:string};
export type V8Approval=Identity & {schemaVersion:1;caseId:'bounded-inventory-basket-v8-live-01';mode:'live';maximumPhysicalSpendUsd:0.15;issuedAt:number;expiresAt:number};
const fields=['schemaVersion','caseId','mode','contractDigest','implementationCommit','deploymentId','serviceId','nonce','maximumPhysicalSpendUsd','issuedAt','expiresAt'].sort();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
/** GitHub-owned HTTPS approval is bound to a random process challenge, not just a deployment. */
export function validateV8Approval(value:unknown,identity:Identity,now:number):asserts value is V8Approval {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_APPROVAL');
 const g=value as Record<string,unknown>;
 if(JSON.stringify(Object.keys(g).sort())!==JSON.stringify(fields))throw Error('INVALID_APPROVAL');
 if(g.schemaVersion!==1||g.caseId!=='bounded-inventory-basket-v8-live-01'||g.mode!=='live'||g.maximumPhysicalSpendUsd!==0.15)throw Error('INVALID_APPROVAL');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(g.issuedAt)||!Number.isSafeInteger(g.expiresAt)||
   (g.issuedAt as number)>now||(g.issuedAt as number)<0||now>=(g.expiresAt as number)||
   (g.expiresAt as number)-(g.issuedAt as number)>900_000)throw Error('APPROVAL_EXPIRED_OR_INVALID');
 for(const key of ['contractDigest','implementationCommit','deploymentId','serviceId','nonce'] as const){
  if(typeof identity[key]!=='string'||g[key]!==identity[key])throw Error('APPROVAL_IDENTITY_MISMATCH');
  if(key==='deploymentId'||key==='serviceId'){if(!uuid.test(identity[key]))throw Error('INVALID_IDENTITY');}
  else if(!(key==='implementationCommit'?/^[a-f0-9]{40}$/u:/^[a-f0-9]{64}$/u).test(identity[key]))throw Error('INVALID_IDENTITY');
 }
}
