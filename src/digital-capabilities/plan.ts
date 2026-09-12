import {arraySchema as a,objectSchema as o,integerSchema as i,textSchema as t,idSchema as id,digestSchema,snapshotJson,validateSchema,CapabilityInputError,type Json} from './schema.ts';
import {canonicalJson,sha256} from '../canonical.ts';
import type {CapabilityContract,CapabilityInvocation,CapabilityResult} from './types.ts';
export const planSchema=o({id,version:i(1,1000000),steps:a(o({id,capabilityId:id,contractDigest:digestSchema,input:{type:'json'},dependsOn:a(id,64),evidenceReceiptIds:a(digestSchema,32),bindings:a(o({inputKey:id,stepId:id,path:a(t(128),12,1)}),32),completion:a(o({path:a(t(128),12,1),equals:{type:'json'}}),32,1)}),64,1)});
type Step={id:string;capabilityId:string;contractDigest:string;input:Json;dependsOn:string[];evidenceReceiptIds:string[];bindings:{inputKey:string;stepId:string;path:string[]}[];completion:{path:string[];equals:Json}[]};
export type CapabilityPlan={id:string;version:number;steps:Step[]};
export function validatePlan(supplied:unknown):CapabilityPlan {
 const input=snapshotJson(supplied);validateSchema(planSchema,input);const plan=input as unknown as CapabilityPlan;
 const seen=new Set<string>();for(const step of plan.steps){if(seen.has(step.id))throw new CapabilityInputError('DUPLICATE_STEP');seen.add(step.id);}
 const completed=new Set<string>();for(const step of plan.steps){if(step.dependsOn.some(id=>!completed.has(id)))throw new CapabilityInputError('DEPENDENCY_ORDER_OR_CYCLE');if(step.bindings.some(b=>!step.dependsOn.includes(b.stepId)))throw new CapabilityInputError('UNDECLARED_BINDING_DEPENDENCY');completed.add(step.id);}
 return plan;
}
function at(value:Json,path:string[]):Json|undefined {let current:Json|undefined=value;for(const key of path){if(['__proto__','constructor','prototype'].includes(key)||!current||typeof current!=='object'||!Object.hasOwn(current,key))return undefined;current=(current as Record<string,Json>)[key];}return current;}
export async function executeBoundedPlan(plan:CapabilityPlan,adapter:{contract:(id:string)=>Promise<CapabilityContract|undefined>;invoke:(request:CapabilityInvocation)=>Promise<CapabilityResult>;stopped:()=>Promise<boolean>},maximumSteps:number) {
 if(!Number.isSafeInteger(maximumSteps)||maximumSteps<1||maximumSteps>64)throw new CapabilityInputError('STEP_BUDGET');
 const results=new Map<string,CapabilityResult>(),completed:{stepId:string;resultDigest:string}[]=[];
 const finish=(status:string,blockedStep:string|null,reason:string)=>({planId:plan.id,version:plan.version,planDigest:sha256(canonicalJson(plan)),status,completed,blockedStep,reason,externalActions:0,actualCashMicroUsd:0});
 let fresh=0;
 for(const step of plan.steps){
  if(await adapter.stopped())return finish('BLOCKED',step.id,'EMERGENCY_STOP');
  const contract=await adapter.contract(step.capabilityId);
  if(!contract||contract.contractDigest!==step.contractDigest||contract.status!=='ENABLED'||!['PURE','READ_ONLY','DRAFT_ONLY'].includes(contract.effect)||!['READ_ONLY','DRAFT_ONLY'].includes(contract.authorityClass))return finish('BLOCKED',step.id,'CURRENT_QUALIFIED_BOUNDED_CONTRACT_REQUIRED');
  let input=snapshotJson(step.input);
  if(step.bindings.length){if(!input||typeof input!=='object'||Array.isArray(input))throw new CapabilityInputError('BINDING_OBJECT_REQUIRED');for(const binding of step.bindings){const prior=results.get(binding.stepId);const value=prior?at(prior.output,binding.path):undefined;if(value===undefined)return finish('BLOCKED',step.id,'BINDING_EVIDENCE_MISSING');if(['__proto__','constructor','prototype'].includes(binding.inputKey))throw new CapabilityInputError('UNSAFE_BINDING');input[binding.inputKey]=snapshotJson(value);}}
  const request={requestId:`plan-${sha256(canonicalJson({planId:plan.id,version:plan.version,stepId:step.id}))}`,capabilityId:step.capabilityId,input,evidenceReceiptIds:[...new Set([...step.evidenceReceiptIds,...step.dependsOn.map(id=>results.get(id)!.resultDigest)])]};
  const result=await adapter.invoke(request);
  if(result.status!=='SUCCEEDED'||result.receiptValidity?.current===false)return finish('BLOCKED',step.id,result.receiptValidity?.current===false?'STALE_STEP_RECEIPT':result.status);
  if(step.completion.some(p=>{const value=at(result.output,p.path);return value===undefined||canonicalJson(value)!==canonicalJson(p.equals);} ))return finish('BLOCKED',step.id,'COMPLETION_PREDICATE_FAILED');
  results.set(step.id,result);completed.push({stepId:step.id,resultDigest:result.resultDigest});
  if(!result.replayed)fresh++;
  if(fresh>=maximumSteps&&completed.length<plan.steps.length)return finish('PAUSED',null,'PER_CALL_STEP_BUDGET');
 }
 return finish('COMPLETE',null,'ALL_EXPLICIT_COMPLETION_PREDICATES_PASSED');
}
