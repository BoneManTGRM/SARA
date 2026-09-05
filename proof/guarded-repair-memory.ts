import {assertCodingRepairVerification,isEvidenceDigest} from '../src/experimental-v5/coding-repair-verification.ts';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {INITIAL_CODING_REPAIR_LIMITS as limits} from '../src/coding-repair-policy.ts';
import type {ProgramCandidateProposal} from '../src/types.ts';
import type {ProgramVerificationResult,CodingRepairProposal} from '../src/coding-repair-types.ts';
export type Scope={contract:string;dependencies:string;verifier:string;policy:string};
type Recipe={id:string;key:string;changes:CodingRepairProposal['changes'];changedLines:number;verifiedArtifactDigest:string;verificationEvidence:string[];quarantineDigest:string|null};
function artifact(candidate:ProgramCandidateProposal):string{
 const files=candidate.files.map(f=>({path:f.path,contentDigest:sha256(f.content)})).sort((a,b)=>a.path.localeCompare(b.path));
 return sha256(canonicalJson({schemaVersion:1,files}));
}
function key(candidate:ProgramCandidateProposal,scope:Scope):string{
 if(Object.keys(scope).length!==4||!['contract','dependencies','verifier','policy'].every(k=>Object.hasOwn(scope,k))||!Object.values(scope).every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v)))throw Error('INVALID_RECIPE_SCOPE');
 return sha256(canonicalJson({artifact:artifact(candidate),scope}));
}
function lines(a:string,b:string):number{
 const left=a.split('\n'),right=b.split('\n');let result=Math.abs(left.length-right.length);
 for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])result++;
 return result;
}
/** Experimental exact-source memory. It never substitutes for fresh controller verification. */
export class GuardedRepairMemory {
 readonly #recipes=new Map<string,Recipe>();
 learn(before:ProgramCandidateProposal,after:ProgramCandidateProposal,verification:ProgramVerificationResult,scope:Scope):string{
  try { assertCodingRepairVerification(verification); } catch { throw Error('UNVERIFIED_RECIPE'); }
  if(verification.passed!==true||verification.score!==1||verification.failures.length||verification.artifactDigest!==artifact(after)||
   !['source_policy','syntax','typecheck','behavior_tests','artifact_integrity'].every(x=>verification.completedChecks.includes(x as any))||
   !verification.evidenceDigests.length||!verification.evidenceDigests.every(isEvidenceDigest))throw Error('UNVERIFIED_RECIPE');
  if(new Set(before.files.map(f=>f.path)).size!==before.files.length||before.files.length!==after.files.length||new Set(after.files.map(f=>f.path)).size!==after.files.length)throw Error('RECIPE_FILE_SET_CHANGED');
  const changes:CodingRepairProposal['changes']=[];let changedLines=0;
  for(const old of before.files){
   const next=after.files.find(f=>f.path===old.path);if(!next)throw Error('RECIPE_FILE_SET_CHANGED');
   if(old.content===next.content)continue;
   if(!/^src\/[a-z0-9][a-z0-9._/-]*\.ts$/u.test(old.path)||old.path.includes('..')||limits.protectedPaths.some(p=>old.path===p||old.path.startsWith(p)))throw Error('RECIPE_PROTECTED_PATH');
   if(!next.content.trim()||Buffer.byteLength(next.content)>16384)throw Error('RECIPE_SIZE');
   changes.push({path:old.path,expectedContentDigest:sha256(old.content),replacementText:next.content});changedLines+=lines(old.content,next.content);
  }
  if(!changes.length||changes.length>limits.deepFiles||changedLines>limits.deepChangedLines)throw Error('RECIPE_MUTATION_LIMIT');
  const k=key(before,scope);
  const record={key:k,changes,changedLines,verifiedArtifactDigest:verification.artifactDigest,verificationEvidence:[...verification.evidenceDigests]};
  const id=sha256(canonicalJson(record));
  if(this.#recipes.size>=32&&!this.#recipes.has(k))throw Error('RECIPE_CAPACITY');
  // A quarantined identity may not be silently re-enabled by the same evidence.
  const previous=this.#recipes.get(k);
  this.#recipes.set(k,{...structuredClone(record),id,quarantineDigest:previous?.id===id?previous.quarantineDigest:null});
  return id;
 }
 lookup(candidate:ProgramCandidateProposal,verification:ProgramVerificationResult,scope:Scope,strategy:'surgical'|'deep'):CodingRepairProposal|null{
  if(strategy!=='surgical'&&strategy!=='deep')return null;
  try { assertCodingRepairVerification(verification); } catch { return null; }
  const recipe=this.#recipes.get(key(candidate,scope));
  if(!recipe||recipe.quarantineDigest||verification.passed||!verification.failures.length||verification.artifactDigest!==artifact(candidate))return null;
  const maxFiles=strategy==='surgical'?limits.surgicalFiles:limits.deepFiles;
  const maxLines=strategy==='surgical'?limits.surgicalChangedLines:limits.deepChangedLines;
  if(recipe.changes.length>maxFiles||recipe.changedLines>maxLines)return null;
  return {schemaVersion:1,baseArtifactDigest:verification.artifactDigest,failureFingerprint:verification.failures[0].fingerprint,strategy,changes:structuredClone(recipe.changes),limitations:['Exact-source verified recipe; fresh verification is still mandatory.']};
 }
 quarantine(id:string,failureDigest:string):void{
  if(!isEvidenceDigest(failureDigest))throw Error('INVALID_FAILURE_EVIDENCE');
  for(const recipe of this.#recipes.values())if(recipe.id===id)recipe.quarantineDigest=failureDigest;
 }
 get size():number{return this.#recipes.size;}
 snapshot():readonly Recipe[]{return structuredClone([...this.#recipes.values()]);}
}
