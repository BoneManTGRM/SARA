import {arraySchema as a,objectSchema as o,idSchema as id,integerSchema as integer,textSchema as text,digestSchema,snapshotJson,validateSchema,CapabilityInputError,type Json} from './schema.ts';
import {canonicalJson} from '../canonical.ts';
import {deriveGoalTasks} from './self-management/definitions.ts';
import type {CapabilityContract} from './types.ts';
import {validatePlan,type CapabilityPlan} from './plan.ts';
const binding=o({inputKey:id,stepId:id,path:a(text(128),12,1)}),predicate=o({path:a(text(128),12,1),equals:{type:'json'}});
export const goalExecutionSchema=o({id,version:integer(1,1000000),goal:text(4096),steps:a(o({capabilityId:id,input:{type:'json'},evidenceReceiptIds:a(digestSchema,32),bindings:a(binding,32),completion:a(predicate,32,1)}),64),maximumSteps:integer(1,64)},['id','version','goal','steps']);
export async function compileGoalExecution(supplied:unknown,contract:(id:string)=>Promise<CapabilityContract|undefined>) {
 const request=snapshotJson(supplied) as Record<string,Json>;validateSchema(goalExecutionSchema,request);
 const templates=deriveGoalTasks(String(request.goal));const provided=request.steps as Record<string,Json>[];
 if(new Set(provided.map(s=>s.capabilityId)).size!==provided.length)throw new CapabilityInputError('DUPLICATE_GOAL_CAPABILITY_INPUT');
 if(provided.some(s=>!templates.some(t=>t.capabilityId===s.capabilityId)))throw new CapabilityInputError('INPUT_OUTSIDE_COMPILED_GOAL_SCOPE');
 const missing:string[]=[],tasks:Record<string,Json>[]=[],steps:CapabilityPlan['steps']=[];
 for(const template of templates){const capabilityId=String(template.capabilityId),c=await contract(capabilityId),input=provided.find(s=>s.capabilityId===capabilityId);
  const bounded=Boolean(c&&c.status==='ENABLED'&&['READ_ONLY','DRAFT_ONLY'].includes(c.authorityClass)&&['PURE','READ_ONLY','DRAFT_ONLY'].includes(c.effect));
  if(!c||!input||!bounded)missing.push(capabilityId);
  tasks.push({...template,authorityClass:c?.authorityClass??'PROHIBITED',input:input?.input??null,permission:bounded?'PERMITTED':'UNKNOWN',prerequisitesSatisfied:!!input&&bounded,evidenceSufficient:!!input,completionCriteria:input?(input.completion as Json[]).map(p=>canonicalJson(p)):template.completionCriteria!});
  if(c&&input&&bounded)steps.push({id:String(template.id),capabilityId,contractDigest:c.contractDigest,input:input.input!,dependsOn:template.dependencies as string[],evidenceReceiptIds:input.evidenceReceiptIds as string[],bindings:input.bindings as CapabilityPlan['steps'][number]['bindings'],completion:input.completion as CapabilityPlan['steps'][number]['completion']});
 }
 const ready=templates.length>0&&missing.length===0;
 return {request,goalInput:{goalId:request.id!,goal:request.goal!,tasks},missing,plan:ready?validatePlan({id:request.id,version:request.version,steps}):null,reason:templates.length?'CAPABILITY_INPUTS_OR_AUTHORITY_REQUIRED':'UNSUPPORTED_GOAL_FAMILY'};
}
