import { boundaryInputSchema, boundaryOutputSchema, checkAutonomyBoundary } from "./boundary.ts";
import { arraySchema, enumSchema, idSchema, integerSchema, objectSchema, textSchema, type Json } from "./schema.ts";
import { serviceOpportunityDefinition } from "./service-opportunity.ts";
import type { CapabilityDefinition, ExecutionContext } from "./types.ts";

export const BASE_QUALIFICATION_CONTEXT:ExecutionContext=Object.freeze({
  ownerAuthenticated:false,emergencyStopped:false,authorityContextDigest:"0".repeat(64),constitutionDigest:"0".repeat(64),
  mandateDigest:null,mandateId:null,evidence:[],currentIdentity:{},controls:[],policyDecision:{allowed:true,code:"ALLOWED",reason:"Isolated frozen-case computation."},
  benchmark:async()=>({passed:0,failed:1,results:[],reenabledCapabilities:0}),
});
const read={action:"read_supplied",target:"supplied:case",estimatedCashMicroUsd:0,reversibility:"NONE",external:false};
export const foundationDefinitions:readonly CapabilityDefinition[]=[
  {
    id:"autonomy-boundary-checker",version:"1.0.0",description:"Classify a proposed action against current kernel policy without issuing transferable authority or executing the action.",
    inputSchema:boundaryInputSchema,outputSchema:boundaryOutputSchema,effect:"PURE",authorityClass:"READ_ONLY",
    sourceFiles:["boundary.ts"],execute:checkAutonomyBoundary,
    cases:[
      {name:"bounded-read",input:read,check:r=>(r.output as Record<string,Json>).allowed===true},
      {name:"purchase-is-not-authorized-by-authentication",input:{...read,action:"purchase",external:true,estimatedCashMicroUsd:50_000_000},context:{ownerAuthenticated:true},check:r=>(r.output as Record<string,Json>).allowed===false},
      {name:"emergency-stop",input:{...read,action:"publish",external:true},context:{emergencyStopped:true},check:r=>(r.output as Record<string,Json>).code==="EMERGENCY_STOP"},
      {name:"hidden-effect",input:{...read,external:true},check:r=>(r.output as Record<string,Json>).allowed===false},
      {name:"immutable-restriction",input:{...read,action:"reveal_secret"},context:{ownerAuthenticated:true},check:r=>(r.output as Record<string,Json>).authorityClass==="PROHIBITED"},
      {name:"draft-does-not-send",input:{...read,action:"draft_email",target:"draft:email"},check:r=>{const out=r.output as Record<string,Json>;return out.allowed===true&&out.authorityClass==="DRAFT_ONLY"&&out.authorizationTokenIssued===false;}},
    ],
  },
  {
    id:"learned-capability-disable-and-quarantine",version:"1.0.0",description:"Expose the existing append-only learned-capability controls. Changes use the exact owner-reviewed control API, never caller-supplied authority.",
    inputSchema:objectSchema({operation:enumSchema("inspect")}),
    outputSchema:objectSchema({controls:arraySchema({type:"json"},1000),mutationEndpoint:textSchema(128),restorationRequires:arraySchema(textSchema(256)),historyPreserved:{type:"boolean"}}),
    effect:"READ_ONLY",authorityClass:"CONSEQUENTIAL_REQUIRES_OWNER",ownerOnly:true,sourceFiles:["foundation.ts","../capability-control.ts"],
    qualificationRequirements:["frozen-contract","owner-authentication","exact-control-approval","restart","audit-chain","backup-restore","independent-fresh-qualification","concurrent-control-epoch"],
    execute:(_input,context)=>({output:{controls:[...context.controls],mutationEndpoint:"/api/learning/controls/review",
      restorationRequires:["genuine owner authentication","fresh independent frozen-contract qualification","exact current target approval"],historyPreserved:true}}),
    cases:[{name:"retains-restrictions",input:{operation:"inspect"},context:{controls:[{mutationId:"fixture",state:"DISABLED"}]},check:r=>((r.output as Record<string,Json>).controls as Json[]).length===1},
      {name:"empty-history-is-not-promoted",input:{operation:"inspect"},check:r=>((r.output as Record<string,Json>).controls as Json[]).length===0}],
  },
  {
    id:"self-benchmark-runner",version:"1.0.0",description:"Run frozen, bounded capability qualification cases; preserve measured results without enabling learned capabilities or changing authority.",
    inputSchema:objectSchema({capabilityIds:arraySchema(idSchema,128,1)}),
    outputSchema:objectSchema({passed:integerSchema(),failed:integerSchema(),results:arraySchema({type:"json"},128),reenabledCapabilities:integerSchema(0,0)}),
    effect:"INTERNAL_STATE",authorityClass:"READ_ONLY",ownerOnly:true,sourceFiles:["foundation.ts","registry.ts"],
    execute:async(input,context)=>({output:await context.benchmark(input.capabilityIds as string[])}),
    cases:[{name:"reports-actual-runner-counts-without-restoration",input:{capabilityIds:["autonomy-boundary-checker"]},
      context:{benchmark:async()=>({passed:6,failed:0,results:[{capabilityId:"autonomy-boundary-checker",passed:6,failed:0}],reenabledCapabilities:0})},
      check:r=>{const output=r.output as Record<string,Json>;return output.passed===6&&output.failed===0&&output.reenabledCapabilities===0;}},
      {name:"keeps-failed-qualification-visible",input:{capabilityIds:["unknown"]},context:{benchmark:async()=>({passed:0,failed:1,results:[{capabilityId:"unknown",passed:0,failed:1}],reenabledCapabilities:0})},
      check:r=>(r.output as Record<string,Json>).failed===1}],
  },
  serviceOpportunityDefinition,
];
