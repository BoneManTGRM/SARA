import {arraySchema as a,objectSchema as o,integerSchema as i,textSchema as t,idSchema as id,digestSchema,snapshotJson,validateSchema,CapabilityInputError,type Json} from './schema.ts';
import {canonicalJson,sha256} from '../canonical.ts';
import type {CapabilityContract,CapabilityInvocation,CapabilityResult} from './types.ts';
export const planSchema=o({id,version:i(1,1000000),steps:a(o({id,capabilityId:id,contractDigest:digestSchema,input:{type:'json'},dependsOn:a(id,64),evidenceReceiptIds:a(digestSchema,32),bindings:a(o({inputKey:id,stepId:id,path:a(t(128),12,1)}),32),completion:a(o({path:a(t(128),12,1),equals:{type:'json'}}),32,1),obligation:{type:'boolean'},economicEvidenceId:digestSchema},['id','capabilityId','contractDigest','input','dependsOn','evidenceReceiptIds','bindings','completion']),64,1)});
type Step={obligation?:boolean;economicEvidenceId?:string;id:string;capabilityId:string;contractDigest:string;input:Json;dependsOn:string[];evidenceReceiptIds:string[];bindings:{inputKey:string;stepId:string;path:string[]}[];completion:{path:string[];equals:Json}[]};
export type CapabilityPlan={id:string;version:number;steps:Step[]};
// This capability persists only its sourced snapshot in the normal invocation
// receipt; it cannot alter policy, send messages or write a competing store.
function boundedEffect(c:CapabilityContract):boolean{return (c.id==='isolated-defect-reproducer'&&c.effect==='INTERNAL_STATE'&&c.authorityClass==='REVERSIBLE_AUTHORIZED')||['PURE','READ_ONLY','DRAFT_ONLY'].includes(c.effect)||(c.id==='commitment-tracker'&&c.effect==='INTERNAL_STATE'&&c.authorityClass==='READ_ONLY');}
function boundedAuthority(c:CapabilityContract):boolean{return ['READ_ONLY','DRAFT_ONLY'].includes(c.authorityClass)||(c.id==='isolated-defect-reproducer'&&c.authorityClass==='REVERSIBLE_AUTHORIZED');}
export function validatePlan(supplied:unknown):CapabilityPlan {
 const input=snapshotJson(supplied);validateSchema(planSchema,input);const plan=input as unknown as CapabilityPlan;
 const seen=new Set<string>();for(const step of plan.steps){if(seen.has(step.id))throw new CapabilityInputError('DUPLICATE_STEP');seen.add(step.id);}
 const completed=new Set<string>();for(const step of plan.steps){if(step.dependsOn.some(id=>!completed.has(id)))throw new CapabilityInputError('DEPENDENCY_ORDER_OR_CYCLE');if(step.bindings.some(b=>!step.dependsOn.includes(b.stepId)))throw new CapabilityInputError('UNDECLARED_BINDING_DEPENDENCY');completed.add(step.id);}
 return plan;
}
function at(value:Json,path:string[]):Json|undefined {let current:Json|undefined=value;for(const key of path){if(['__proto__','constructor','prototype'].includes(key)||!current||typeof current!=='object'||!Object.hasOwn(current,key))return undefined;current=(current as Record<string,Json>)[key];}return current;}
export async function executeBoundedPlan(plan:CapabilityPlan,adapter:{contract:(id:string)=>Promise<CapabilityContract|undefined>;invoke:(request:CapabilityInvocation)=>Promise<CapabilityResult>;stopped:()=>Promise<boolean>;valuation?:(digest:string)=>Promise<number|null|undefined>},maximumSteps:number) {
 if(!Number.isSafeInteger(maximumSteps)||maximumSteps<1||maximumSteps>64)throw new CapabilityInputError('STEP_BUDGET');
 const results=new Map<string,CapabilityResult>(),completed:{stepId:string;resultDigest:string}[]=[],blocked:{stepId:string;reason:string}[]=[],pending=[...plan.steps];
 const finish=(status:string,blockedStep:string|null,reason:string)=>({planId:plan.id,version:plan.version,planDigest:sha256(canonicalJson(plan)),status,completed,blocked,blockedStep,reason,externalActions:0,actualCashMicroUsd:0});
 let fresh=0;
 while(pending.length){
  const ready=pending.filter(s=>s.dependsOn.every(d=>results.has(d)||blocked.some(b=>b.stepId===d)));
  if(!ready.length)return finish('BLOCKED',pending[0]!.id,'DEPENDENCY_UNRESOLVED');
  const eligible:{step:Step;score:number|null;contract:CapabilityContract}[]=[];
  for(const candidate of ready){const c=await adapter.contract(candidate.capabilityId);
   let reason=candidate.dependsOn.some(d=>blocked.some(b=>b.stepId===d))?'FAILED_PREREQUISITE':!c||c.contractDigest!==candidate.contractDigest||c.status!=='ENABLED'||c.qualification.status!=='PASSED'||!boundedEffect(c)||!boundedAuthority(c)?'CURRENT_QUALIFIED_BOUNDED_CONTRACT_REQUIRED':null;
   const score=candidate.economicEvidenceId?await adapter.valuation?.(candidate.economicEvidenceId):null;
   if(candidate.economicEvidenceId&&score===undefined)reason='CURRENT_ECONOMIC_RECEIPT_REQUIRED';
   if(reason){blocked.push({stepId:candidate.id,reason});pending.splice(pending.indexOf(candidate),1);}else eligible.push({step:candidate,score:score??null,contract:c!});
  }
  eligible.sort((a,b)=>Number(b.step.obligation===true)-Number(a.step.obligation===true)||Number(b.score!==null)-Number(a.score!==null)||(b.score??0)-(a.score??0)||plan.steps.indexOf(a.step)-plan.steps.indexOf(b.step));
  if(!eligible.length)continue;
  const {step}=eligible[0]!;pending.splice(pending.indexOf(step),1);
  if(await adapter.stopped())return finish('BLOCKED',step.id,'EMERGENCY_STOP');
  const contract=await adapter.contract(step.capabilityId);
  if(!contract||contract.contractDigest!==step.contractDigest||contract.status!=='ENABLED'||contract.qualification.status!=='PASSED'||!boundedEffect(contract)||!boundedAuthority(contract))return finish('BLOCKED',step.id,'CURRENT_QUALIFIED_BOUNDED_CONTRACT_REQUIRED');
  let input=snapshotJson(step.input);
  if(step.bindings.length){if(!input||typeof input!=='object'||Array.isArray(input))throw new CapabilityInputError('BINDING_OBJECT_REQUIRED');for(const binding of step.bindings){const prior=results.get(binding.stepId);const value=prior?at(prior.output,binding.path):undefined;if(value===undefined)return finish('BLOCKED',step.id,'BINDING_EVIDENCE_MISSING');if(['__proto__','constructor','prototype'].includes(binding.inputKey))throw new CapabilityInputError('UNSAFE_BINDING');input[binding.inputKey]=snapshotJson(value);}}
  const request={requestId:`plan-${sha256(canonicalJson({planId:plan.id,version:plan.version,stepId:step.id}))}`,capabilityId:step.capabilityId,input,evidenceReceiptIds:[...new Set([...step.evidenceReceiptIds,...step.dependsOn.map(id=>results.get(id)!.resultDigest)])]};
  const result=await adapter.invoke(request);
  if(result.status!=='SUCCEEDED'||result.receiptValidity?.current===false)return finish('BLOCKED',step.id,result.receiptValidity?.current===false?'STALE_STEP_RECEIPT':result.status);
  if(step.completion.some(p=>{const value=at(result.output,p.path);return value===undefined||canonicalJson(value)!==canonicalJson(p.equals);} ))return finish('BLOCKED',step.id,'COMPLETION_PREDICATE_FAILED');
  results.set(step.id,result);completed.push({stepId:step.id,resultDigest:result.resultDigest});
  if(!result.replayed)fresh++;
  if(fresh>=maximumSteps&&pending.length>0)return finish('PAUSED',null,'PER_CALL_STEP_BUDGET');
 }
 return blocked.length?finish('BLOCKED',blocked[0]!.stepId,blocked[0]!.reason):finish('COMPLETE',null,'ALL_EXPLICIT_COMPLETION_PREDICATES_PASSED');
}
