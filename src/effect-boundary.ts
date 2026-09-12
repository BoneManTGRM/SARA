import {canonicalJson,sha256} from './canonical.ts';
import type {PolicyDecision} from './types.ts';

/** Finalize an existing executor's decision. This function can only narrow it. */
export function enforceEffectBoundary(input:{
  action:string;target:string;external:boolean;emergencyStopped:boolean;
  effect:'READ'|'DRAFT'|'INTERNAL'|'EXTERNAL'|'PROHIBITED'|'UNKNOWN';
  decision:PolicyDecision;authority:'INTERNAL_POLICY'|'AUTHENTICATED_OWNER'|'EXACT_MANDATE'|'EXACT_FUNDED_JOB'|null;
  authorityIdentity:string|null;cost:number|null;credentials:boolean;
}):PolicyDecision & {boundary:{action:string;target:string;effect:string;external:boolean;authority:string|null;authorityDigest:string|null;cost:number|null;credentials:boolean;authorizationTokenIssued:false}} {
  let decision=input.decision;
  if(decision.allowed){
    if(input.effect==='UNKNOWN'||input.effect==='PROHIBITED')decision={allowed:false,code:'UNSUPPORTED_EFFECT',reason:'Unknown or prohibited action cannot inherit an allow decision.'};
    else if(input.emergencyStopped&&input.external)decision={allowed:false,code:'EMERGENCY_STOP',reason:'External execution is frozen.'};
    else if(input.external&&input.effect==='INTERNAL')decision={allowed:false,code:'HIDDEN_EXTERNAL_EFFECT',reason:'An internal action cannot conceal an external effect.'};
    else if(input.effect==='EXTERNAL'&&(!input.authorityIdentity||!['AUTHENTICATED_OWNER','EXACT_MANDATE','EXACT_FUNDED_JOB'].includes(input.authority??'')))decision={allowed:false,code:'EXACT_AUTHORITY_REQUIRED',reason:'An external effect requires the existing exact owner, mandate or funded-job executor authority.'};
    else if(input.cost!==null&&(!Number.isFinite(input.cost)||input.cost<0))decision={allowed:false,code:'INVALID_COST',reason:'Effect cost metadata is invalid.'};
  }
  return {...decision,boundary:{action:input.action,target:input.target,effect:input.effect,external:input.external,
    authority:input.authority,authorityDigest:input.authorityIdentity?sha256(canonicalJson(input.authorityIdentity)):null,
    cost:input.cost,credentials:input.credentials,authorizationTokenIssued:false}};
}
