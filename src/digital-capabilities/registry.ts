import { engineeringDefinitions } from "./engineering/definitions.ts";
import {troubleshootingDefinitions} from './troubleshooting/definitions.ts';
import {proceduralDefinitions} from './procedural/definitions.ts';
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256 } from "../canonical.ts";
import { BASE_QUALIFICATION_CONTEXT, foundationDefinitions } from "./foundation.ts";
import { snapshotJson, validateSchema, type Json } from "./schema.ts";
import type { CapabilityContract, CapabilityDefinition, ExecutionContext } from "./types.ts";

// Only reviewed, statically imported implementations enter this registry. Customer manifests and learned artifacts cannot register code here.
const DEFINITIONS:readonly CapabilityDefinition[]=[...foundationDefinitions,...engineeringDefinitions,...troubleshootingDefinitions,...proceduralDefinitions];
const COMMON_FILES=["receipt-dependencies.ts","types.ts","schema.ts","registry.ts","evidence.ts","observed-evidence.ts","plan.ts","boundary.ts","receipt.ts","foundation.ts","../kernel.ts","../policy.ts","../effect-boundary.ts","../canonical.ts","../memory-fabric.ts","../server.ts","production-proof.ts"];
function freezeReviewed(value:unknown):void {
  if(!value||typeof value!=="object"||Object.isFrozen(value))return;
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))if("value" in descriptor)freezeReviewed(descriptor.value);
  Object.freeze(value);
}
for(const definition of DEFINITIONS)freezeReviewed(definition);
const definitions=new Map(DEFINITIONS.map(definition=>[definition.id,definition]));
if(definitions.size!==DEFINITIONS.length)throw new Error("DUPLICATE_CAPABILITY_ID");
export function capabilityDefinition(id:string):CapabilityDefinition|undefined{return definitions.get(id);}

type QualificationEvidence={capabilityId:string;passed:number;failed:number;caseDigest:string;implementationDigest:string;failures:string[]};
const qualificationCache=new Map<string,Promise<QualificationEvidence>>();
async function sourceIdentity(definition:CapabilityDefinition, startupReads?:Map<string,Promise<Buffer>>):Promise<string>{
  // Share reads only within the one loaded-code snapshot. Runtime checks always
  // reread current bytes, so startup deduplication cannot hide later changes.
  const read = (key:string, url:URL):Promise<Buffer> => {
    if (!startupReads) return readFile(url);
    let pending = startupReads.get(key);
    if (!pending) { pending = readFile(url); startupReads.set(key,pending); }
    return pending;
  };
  const files=[...new Set([...COMMON_FILES,...definition.sourceFiles])].sort(),source=[];
  for(const file of files)source.push({path:file,digest:sha256(await read(file,new URL(file,import.meta.url)))});
  source.push({path:"package-lock.json",digest:sha256(await read("package-lock.json",new URL("../../package-lock.json",import.meta.url)))});
  return sha256(canonicalJson(source));
}
// Loaded code and on-disk evidence must describe the same process revision.
// A changed source file requires restart; passing old loaded code cannot attest new bytes.
const startupReads=new Map<string,Promise<Buffer>>();
const loadedIdentities=new Map(await Promise.all(DEFINITIONS.map(async definition=>[definition.id,await sourceIdentity(definition,startupReads)] as const)));
startupReads.clear();
freezeReviewed(BASE_QUALIFICATION_CONTEXT);
export async function runFrozenCapabilityCases(id:string):Promise<QualificationEvidence&{evidenceDisposition:"FRESH"|"REUSED"|"INVALIDATED"}> {
  const definition=definitions.get(id);
  if(!definition)return {capabilityId:id,passed:0,failed:1,caseDigest:sha256(id),implementationDigest:"0".repeat(64),failures:["UNREGISTERED_CAPABILITY"],evidenceDisposition:"INVALIDATED"};
  const implementationDigest=await sourceIdentity(definition);
  const caseDigest=sha256(canonicalJson(definition.cases.map(item=>({name:item.name,input:item.input,checkDigest:sha256(item.check.toString())}))));
  if(implementationDigest!==loadedIdentities.get(id))return {capabilityId:id,passed:0,failed:1,caseDigest,implementationDigest,failures:["LOADED_SOURCE_CHANGED_RESTART_REQUIRED"],evidenceDisposition:"INVALIDATED"};
  const key=`${id}:${implementationDigest}:${caseDigest}`,previous=qualificationCache.get(key);
  if(previous)return {...structuredClone(await previous),evidenceDisposition:"REUSED"};
  const promise=(async()=>{
    let passed=0;const failures:string[]=[];
    for(const item of definition.cases){
      try{
        const input=snapshotJson(item.input);validateSchema(definition.inputSchema,input);
        const context={...BASE_QUALIFICATION_CONTEXT,...item.context} as ExecutionContext;
        const result=await definition.execute(input as Record<string,Json>,context);
        validateSchema(definition.outputSchema,snapshotJson(result.output));
        if(!item.check(result))throw new Error("frozen predicate failed");
        passed++;
      }catch{failures.push(item.name);}
    }
    return {capabilityId:id,passed,failed:failures.length,caseDigest,implementationDigest,failures};
  })();
  qualificationCache.set(key,promise);
  try{return {...structuredClone(await promise),evidenceDisposition:"FRESH"};}
  catch(error){qualificationCache.delete(key);throw error;}
}
export async function benchmarkCapabilities(ids:string[]):Promise<Json>{
  const selected=[...new Set(ids)];
  if(!selected.length||selected.length>128)throw new Error("BENCHMARK_LIMIT");
  const results=[];
  for(const id of selected)results.push(await runFrozenCapabilityCases(id));
  return {passed:results.reduce((sum,result)=>sum+result.passed,0),failed:results.reduce((sum,result)=>sum+result.failed,0),results,reenabledCapabilities:0};
}

export async function capabilityContract(id:string):Promise<CapabilityContract|undefined>{
  const definition=definitions.get(id);if(!definition)return undefined;
  const {evidenceDisposition:_disposition,...qualification}=await runFrozenCapabilityCases(id);
  const implementationDigest=qualification.implementationDigest;
  const specification={id:definition.id,version:definition.version,description:definition.description,
    maturity:qualification.failed===0?"QUALIFIED" as const:"SHADOW" as const,status:qualification.failed===0?"ENABLED" as const:"QUARANTINED" as const,
    inputSchema:definition.inputSchema,outputSchema:definition.outputSchema,computation:"DETERMINISTIC" as const,
    effect:definition.effect,authorityClass:definition.authorityClass,
    requiredAuthorities:definition.ownerOnly?["authenticated-owner-invocation"]:["authenticated-owner-or-trusted-internal-invocation"],
    allowedResources:definition.resources??["supplied-input","kernel-read-only-projection"],budget:{class:"ZERO_CASH" as const,maximumCashMicroUsd:0 as const},
    sensitivity:"OWNER_PRIVATE_NO_SECRET_STORAGE",evidenceRequirements:["digest-bound-input","observed-inferred-unknown-separation","no-provenance-upgrade","minimum-subject-identity"],
    qualificationRequirements:definition.qualificationRequirements??["frozen-contract","malformed-input","adversarial-boundary","deterministic-output"],
    confidenceSemantics:"Confidence describes the evidence supporting an observation or inference, never execution authority or guaranteed real-world success.",
    invalidationRules:["implementation-or-contract-change","relevant-source-identity-change","policy-or-authority-change","integrity-failure"],
    procedureReuse:{eligible:definition.id!=="self-benchmark-runner",conditions:["existing-PR166-applicability-check","current-evidence","qualified-enabled-implementation"]},
    retryPolicy:{maximumAttempts:1,retryableFailures:[] as string[]},idempotency:"actor-and-request-bound-durable-receipt; conflicting replay rejected; old receipt never authorizes an effect",
    failureClasses:["INVALID_INPUT","UNREGISTERED_CAPABILITY","AUTHORITY_REQUIRED","EMERGENCY_STOP","INCOMPLETE_EVIDENCE","REPLAY_CONFLICT","QUALIFICATION_FAILED","INTEGRITY_FAILURE"],
    implementationDigest,qualification:{status:qualification.failed===0?"PASSED" as const:"FAILED" as const,passed:qualification.passed,failed:qualification.failed,
      scope:"frozen-pure-contract-cases; stateful/HTTP/recovery qualification is separately required in CI",evidenceDigest:sha256(canonicalJson(qualification))},
  };
  return {...specification,contractDigest:sha256(canonicalJson(specification))};
}
export async function capabilityContracts():Promise<CapabilityContract[]>{
  const result:CapabilityContract[]=[];for(const id of [...definitions.keys()].sort())result.push((await capabilityContract(id))!);return result;
}
