import { SaraKernel, SARA_PRINCIPAL } from "../kernel.ts";
import { canonicalJson, sha256 } from "../canonical.ts";
import type { Json } from "./schema.ts";

/** Synthetic unsupported-service denial only; no customer work or commercial claim. */
export async function runSafeServiceRuntimeProof(input:{kernel:SaraKernel;sourceRevision:string;deploymentId:string;environment:"ISOLATED"|"PRODUCTION"}) {
  if(!/^[a-f0-9]{40}$/.test(input.sourceRevision)||!/^[A-Za-z0-9-]{8,128}$/.test(input.deploymentId))throw new Error("INVALID_RUNTIME_IDENTITY");
  const before=await input.kernel.getStatus(),auditBefore=await input.kernel.inspectAudit();
  const identity=sha256(canonicalJson({source:input.sourceRevision,deployment:input.deploymentId,stop:before.emergencyStopped,mandate:before.standingMandate})).slice(0,24);
  const receipt=await input.kernel.invokeCapability(SARA_PRINCIPAL,{requestId:`service-proof:${identity}`,capabilityId:"service-opportunity-generator",input:{
    capabilities:[{id:"unqualified-runtime-fixture",contractDigest:"a".repeat(64),qualificationStatus:"PASSED",status:"ENABLED",estimatedDeliveryMinutes:1,estimatedCashMicroUsd:0}],
    demandSignals:["one","two"].map(host=>({sourceUrl:`https://${host}.example/synthetic`,observedAt:"2026-09-12",serviceName:"Synthetic service",targetCustomer:"Synthetic customer",customerProblem:"This fixture is not evidence of real customer demand.",requiredCapabilityIds:["unqualified-runtime-fixture"],comparablePriceUsd:99})),
    maximumDeliveryMinutes:10,maximumCashMicroUsd:0,maximumCandidates:1,
  }});
  const output=receipt.output as Record<string,Json>,candidate=(output.candidates as Array<Record<string,Json>>|undefined)?.[0];
  const after=await input.kernel.getStatus(),auditAfter=await input.kernel.inspectAudit();
  const equal=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
  const checks={
    unsupportedServiceRejected:candidate?.decision==="EVIDENCE_REQUIRED"&&(candidate.qualifiedCapabilityIds as Json[]|undefined)?.length===0,
    noCommercialAuthority:["mayContactCustomers","mayPublish","mayAcceptContracts","maySpend","mayExecuteWork"].every(key=>output[key]===false),
    noAuthorityToken:receipt.authority.authorizationTokenIssued===false,
    receiptCurrent:receipt.receiptValidity?.current!==false,
    zeroExternalCash:receipt.cost.actualCashMicroUsd===0&&receipt.cost.modelApiMicroUsd===0,
    auditPreserved:equal(auditBefore,auditAfter.slice(0,auditBefore.length))&&auditAfter.slice(auditBefore.length).every(event=>event.type==="digital_capability_executed"),
    controlsPreserved:equal(before.constitution,after.constitution)&&equal(before.standingMandate,after.standingMandate)&&before.emergencyStopped===after.emergencyStopped,
    statePreserved:equal(before.learning,after.learning)&&equal(before.mutations,after.mutations)&&before.memoryCount===after.memoryCount&&equal(before.realizedProfit,after.realizedProfit),
  };
  return {status:Object.values(checks).every(Boolean)?"VERIFIED":"NOT_VERIFIED",provenance:input.environment,sourceRevision:input.sourceRevision,deploymentId:input.deploymentId,
    scope:"Synthetic unsupported-capability denial; no real demand, customer delivery, or earned revenue claimed.",checks,receiptDigest:receipt.resultDigest,authorityDelta:0};
}
