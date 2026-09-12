import type { Json, Schema } from "./schema.ts";
import type { ProcedureApplicabilityIdentity } from "../memory-fabric.ts";

export type AuthorityClass = "READ_ONLY" | "DRAFT_ONLY" | "REVERSIBLE_AUTHORIZED" | "CONSEQUENTIAL_REQUIRES_OWNER" | "PROHIBITED";
export type Provenance = "SUPPLIED" | "LOCAL" | "UNIT_TEST" | "CI" | "ISOLATED" | "STAGING" | "PRODUCTION" | "EXTERNAL_READ_ONLY" | "OWNER_OBSERVED";
export type EvidenceRecord = {
  id:string; sourceId:string; contentDigest:string; provenance:Provenance; claimedProvenance:string|null;
  authoritySource:false; subject:ProcedureApplicabilityIdentity; capturedAt:string|null;
  claims:string[]; integrity:"DIGESTED_INPUT"|"KERNEL_RECEIPT"; receiptId:string|null;
};
export type SuppliedEvidence = {sourceId:string;content:unknown;claimedProvenance?:string};
export type CapabilityInvocation = {requestId:string;capabilityId:string;input:unknown;evidence?:SuppliedEvidence[];evidenceReceiptIds?:string[]};
export type CapabilityContract = {
  id:string;version:string;description:string;maturity:"SHADOW"|"QUALIFIED";status:"ENABLED"|"SHADOW"|"QUARANTINED";
  inputSchema:Schema;outputSchema:Schema;computation:"DETERMINISTIC"|"MODEL_ASSISTED";
  effect:"PURE"|"READ_ONLY"|"DRAFT_ONLY"|"INTERNAL_STATE"|"EXTERNAL_EFFECT";authorityClass:AuthorityClass;
  requiredAuthorities:string[];allowedResources:string[];budget:{class:"ZERO_CASH";maximumCashMicroUsd:0};
  sensitivity:string;evidenceRequirements:string[];qualificationRequirements:string[];confidenceSemantics:string;
  invalidationRules:string[];procedureReuse:{eligible:boolean;conditions:string[]};retryPolicy:{maximumAttempts:number;retryableFailures:string[]};
  idempotency:string;failureClasses:string[];implementationDigest:string;contractDigest:string;
  qualification:{status:"PASSED"|"FAILED";passed:number;failed:number;scope:string;evidenceDigest:string};
};
export type ExecutionOutput = {output:Json;capturedEvidence?:readonly EvidenceRecord[];observed?:Json[];inferred?:Json[];unknowns?:string[];confidence?:{level:"HIGH"|"MEDIUM"|"LOW"|"UNASSESSED";basis:string};status?:"SUCCEEDED"|"BLOCKED"|"INCOMPLETE_EVIDENCE"};
export type ExecutionContext = {
  ownerAuthenticated:boolean;emergencyStopped:boolean;authorityContextDigest:string;constitutionDigest:string;
  mandateDigest:string|null;mandateId:string|null;evidence:readonly EvidenceRecord[];currentIdentity:ProcedureApplicabilityIdentity;
  nicoObserver?:import('./nico/observer.ts').NicoReadObserver;
  controls:Json[];policyDecision:{allowed:boolean;code:string;reason:string};
  benchmark:(ids:string[])=>Promise<Json>;
  serviceCapabilityEvidence?:readonly ServiceCapabilityEvidence[];
  priorCapabilityResults?:readonly CapabilityResult[];
  recoverySnapshot?:import('./troubleshooting/implementations.ts').RecoverySnapshot;
  proceduralKnowledge?:import('../procedural-intelligence.ts').ProceduralKnowledgeSnapshot|null;
  authoritativeJobAccounting?:import('./economic/accounting.ts').AuthoritativeJobAccounting;
  capabilityReadiness?:readonly {id:string;enabled:boolean;authorityClass:string;version?:string;contractDigest?:string;description?:string}[];
};
export type ServiceCapabilityEvidence = {
  id:string;contractDigest:string;qualifiedEnabled:boolean;procedureEvidenceDigests:string[];
};
export type FrozenCase = {name:string;input:Json;context?:Partial<ExecutionContext>;check:(result:ExecutionOutput)=>boolean};
export type CapabilityDefinition = {
  id:string;version:string;description:string;inputSchema:Schema;outputSchema:Schema;
  effect:CapabilityContract["effect"];authorityClass:AuthorityClass;ownerOnly?:boolean;resources?:string[];
  sourceFiles:string[];qualificationRequirements?:string[];
  execute:(input:Record<string,Json>,context:ExecutionContext)=>ExecutionOutput|Promise<ExecutionOutput>;
  cases:FrozenCase[];
};
export type CapabilityResult = {
  schemaVersion:1;requestId:string;status:"SUCCEEDED"|"INVALID_INPUT"|"BLOCKED"|"INCOMPLETE_EVIDENCE";
  capability:{id:string;version:string;implementationDigest:string;contractDigest:string};
  selectionReason:string;inputDigest:string;output:Json;observed:Json[];inferred:Json[];unknowns:string[];
  confidence:{level:"HIGH"|"MEDIUM"|"LOW"|"UNASSESSED";basis:string};evidence:EvidenceRecord[];
  authority:{required:AuthorityClass;available:boolean;contextDigest:string;mandateDigest:string|null;authorizationTokenIssued:false};
  cost:{actualCashMicroUsd:0;modelApiMicroUsd:0;allocatedCashMicroUsd:0;modeledLaborMicroUsd:null;costBasis:"DETERMINISTIC_LOCAL_COMPUTATION_NO_EXTERNAL_CALL"|"BOUNDED_EXTERNAL_READ_NO_PAID_MODEL"};
  persistentChanges:string[];subject:ProcedureApplicabilityIdentity;resultDigest:string;
  replayed?:boolean;receiptValidity?:{current:boolean;reason:string};
};
