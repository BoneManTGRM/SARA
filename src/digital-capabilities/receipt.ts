import { canonicalJson, sha256 } from "../canonical.ts";
import type { CapabilityContract, CapabilityResult, ExecutionContext, ExecutionOutput } from "./types.ts";
import type { Json } from "./schema.ts";

export function capabilityResult(input:{requestId:string;capabilityId:string;inputDigest:string;contract?:CapabilityContract;context:ExecutionContext;
  result:ExecutionOutput;status?:CapabilityResult["status"];persisted?:boolean}):CapabilityResult{
  const {contract,context,result}=input;
  const unsigned={schemaVersion:1 as const,requestId:input.requestId,status:input.status??result.status??"SUCCEEDED",
    capability:{id:input.capabilityId,version:contract?.version??"unregistered",implementationDigest:contract?.implementationDigest??"0".repeat(64),contractDigest:contract?.contractDigest??"0".repeat(64)},
    selectionReason:"Explicit capability invocation; no autonomous expansion of job scope.",inputDigest:input.inputDigest,
    output:result.output,observed:result.observed??[] as Json[],inferred:result.inferred??[] as Json[],unknowns:result.unknowns??[],
    confidence:result.confidence??{level:"UNASSESSED" as const,basis:"No calibrated confidence estimate is available."},evidence:[...context.evidence],
    authority:{required:contract?.authorityClass??"PROHIBITED" as const,available:input.status!=="BLOCKED"&&context.policyDecision.allowed,
      contextDigest:context.authorityContextDigest,mandateDigest:context.mandateDigest,authorizationTokenIssued:false as const},
    cost:{actualCashMicroUsd:0 as const,modelApiMicroUsd:0 as const,allocatedCashMicroUsd:0 as const,modeledLaborMicroUsd:null,
      costBasis:"DETERMINISTIC_LOCAL_COMPUTATION_NO_EXTERNAL_CALL" as const},
    persistentChanges:input.persisted===false?[]:["append-only capability execution receipt; no external state changed"],subject:context.currentIdentity,
  };
  return {...unsigned,resultDigest:sha256(canonicalJson(unsigned))};
}
