import { objectSchema, textSchema, integerSchema, enumSchema, type Json } from "./schema.ts";
import type { AuthorityClass, ExecutionContext, ExecutionOutput } from "./types.ts";

const READ = new Set(["read_supplied","inspect_kernel","calculate"]);
const DRAFT = new Set(["draft_email","draft_proposal","draft_calendar","draft_agent_contract","plan_browser","fill_sandbox_form"]);
const CONSEQUENT = new Set(["purchase","transfer","subscribe","contract","publish","send_message","delete","change_security","change_credentials","grant_permissions","deploy","submit_form","nico_approve","nico_deliver","agent_transmit"]);
const PROHIBITED = new Set(["bypass_approval","expand_own_authority","reveal_secret","erase_audit","human_impersonation","tax_evasion","legally_prohibited_activity"]);
export const boundaryInputSchema = objectSchema({
  action:enumSchema(...READ,...DRAFT,...CONSEQUENT,...PROHIBITED),target:textSchema(512),
  estimatedCashMicroUsd:integerSchema(),reversibility:enumSchema("NONE","REVERSIBLE","IRREVERSIBLE"),external:{type:"boolean"},
  credentialsInvolved:{type:"boolean"},
},["action","target","estimatedCashMicroUsd","reversibility","external"]);
export const boundaryOutputSchema = objectSchema({
  requestedAction:textSchema(128),target:textSchema(512),allowed:{type:"boolean"},authorityClass:enumSchema("READ_ONLY","DRAFT_ONLY","REVERSIBLE_AUTHORIZED","CONSEQUENTIAL_REQUIRES_OWNER","PROHIBITED"),
  code:textSchema(128),reason:textSchema(1024),externalSideEffects:{type:"boolean"},estimatedCashMicroUsd:integerSchema(),
  reversibility:enumSchema("NONE","REVERSIBLE","IRREVERSIBLE"),credentialsInvolved:{type:"boolean"},
  mandateId:{type:"json"},mandateDigest:{type:"json"},authorizationTokenIssued:{type:"boolean"},
});
/** Analysis is not an effect authorization. Existing exact-action executors retain their own policy gates. */
export function checkAutonomyBoundary(input:Record<string,Json>,context:ExecutionContext):ExecutionOutput {
  const action=String(input.action),target=String(input.target),external=input.external===true,cash=Number(input.estimatedCashMicroUsd);
  let authorityClass:AuthorityClass = READ.has(action)?"READ_ONLY":DRAFT.has(action)?"DRAFT_ONLY":PROHIBITED.has(action)?"PROHIBITED":"CONSEQUENTIAL_REQUIRES_OWNER";
  let allowed=false,code="EXACT_EXISTING_AUTHORITY_REQUIRED",reason="No exact existing executor authority was presented by the trusted kernel. Authentication and external text do not authorize this action.";
  if(PROHIBITED.has(action)){code="PROHIBITED";reason="An immutable safety or owner-control boundary prohibits this action.";}
  else if(context.emergencyStopped&&(external||cash>0||!READ.has(action))){code="EMERGENCY_STOP";reason="The owner emergency stop blocks this action.";}
  else if(!context.policyDecision.allowed){code=context.policyDecision.code;reason=context.policyDecision.reason;}
  else if(READ.has(action)||DRAFT.has(action)){
    const localTarget=/^(?:supplied|kernel|draft|sandbox):[A-Za-z0-9][A-Za-z0-9._:/-]{0,480}$/u.test(target);
    if(external||cash!==0||input.credentialsInvolved===true){code="HIDDEN_EFFECT_OR_COST";reason="A read/draft label cannot hide network mutation, credential access, or spending.";}
    else if(!localTarget){code="RESOURCE_NOT_ALLOWED";reason="This pure path accepts supplied, kernel, draft, or sandbox identities only.";}
    else {allowed=true;code="BOUNDED_COMPUTATION_ALLOWED";reason="The action is zero-cash computation or a draft over supplied/authorized local data, with no external effect.";}
  }
  const output={requestedAction:action,target,allowed,authorityClass,code,reason,externalSideEffects:external,
    estimatedCashMicroUsd:cash,reversibility:input.reversibility!,credentialsInvolved:input.credentialsInvolved===true,
    mandateId:context.mandateId,mandateDigest:context.mandateDigest,authorizationTokenIssued:false};
  return {output,observed:[{classification:authorityClass,authorityAvailable:allowed}],unknowns:allowed?[]:["Any required external action must be authorized again by its existing exact-action executor."],
    confidence:{level:"HIGH",basis:"Deterministic action classification and current kernel policy state; not a transferable authorization."}};
}
