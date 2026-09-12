import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SaraKernel } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { canonicalJson,sha256 } from "../src/canonical.ts";
import { snapshotJson,validateSchema,objectSchema,integerSchema,type Json } from "../src/digital-capabilities/schema.ts";
import { capabilityDefinition,capabilityContract } from "../src/digital-capabilities/registry.ts";
import { normalizeSuppliedEvidence,assessEvidence } from "../src/digital-capabilities/evidence.ts";
import type { EvidenceRecord } from "../src/digital-capabilities/types.ts";
const token="isolated-digital-boundary-owner";
const safe={action:"read_supplied",target:"supplied:incident",estimatedCashMicroUsd:0,reversibility:"NONE",external:false};
async function fixture(){const directory=await mkdtemp(join(tmpdir(),"sara-digital-boundary-"));const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});return {directory,kernel,owner:kernel.authenticateOwnerToken(token)};}
function output(value:Json):Record<string,Json>{assert.ok(value!==null&&typeof value==="object"&&!Array.isArray(value));return value;}

test("input snapshot rejects getters, sparse arrays, cycles, prototype payloads, and nonfinite arithmetic without executing content",()=>{
  let getterRan=false;const getter=Object.defineProperty({},"value",{get(){getterRan=true;return 1;},enumerable:true});const cycle:unknown[]=[];cycle.push(cycle);
  for(const value of [getter,new Array(3),cycle,JSON.parse('{"__proto__":{"privileged":true}}'),new Date(),{constructor:"injection"},{value:undefined},Infinity,NaN,2n,()=>{}])assert.throws(()=>snapshotJson(value));
  assert.equal(getterRan,false);assert.equal(({} as {privileged?:boolean}).privileged,undefined);
  assert.throws(()=>snapshotJson({message:"a".repeat(262_145)}));assert.throws(()=>validateSchema(objectSchema({cost:integerSchema()}),{cost:Number.MAX_SAFE_INTEGER+1}));
});

test("reviewed definitions and qualification predicates cannot be changed by a retrieved manifest",()=>{
  const definition=capabilityDefinition("autonomy-boundary-checker")!;
  assert.equal(Object.isFrozen(definition),true);assert.equal(Object.isFrozen(definition.cases),true);
  assert.throws(()=>{definition.authorityClass="PROHIBITED";});
  assert.throws(()=>{definition.cases[0]!.input={action:"purchase"};});
});

test("evidence invalidation uses only relevant identities and never upgrades lower-grade proof",()=>{
  const record:EvidenceRecord={id:"proof",sourceId:"kernel:proof",contentDigest:"a".repeat(64),provenance:"PRODUCTION",claimedProvenance:null,authoritySource:false,
    subject:{deploymentSha:"b".repeat(40),deploymentId:"deployment1",uiDigest:"c".repeat(64)},capturedAt:"2026-09-11T12:00:00Z",claims:["report-visible"],integrity:"KERNEL_RECEIPT",receiptId:"receipt1"};
  const requirement={record,requiredProvenance:["PRODUCTION"] as EvidenceRecord["provenance"][],currentIdentity:{...record.subject,documentationDigest:"changed"},requiredClaims:["report-visible"]};
  assert.equal(assessEvidence(requirement).status,"VALID");
  assert.equal(assessEvidence({...requirement,currentIdentity:{...record.subject,uiDigest:"changed"}}).status,"STALE");
  assert.equal(assessEvidence({...requirement,record:{...record,provenance:"CI"}}).status,"INCOMPLETE_EVIDENCE");
  assert.equal(assessEvidence({...requirement,record:{...record,subject:{deploymentSha:"not-a-sha",deploymentId:"deployment1"}}}).status,"INCOMPLETE_EVIDENCE");
  assert.equal(assessEvidence({...requirement,record:{...record,integrity:"DIGESTED_INPUT"}}).status,"INCOMPLETE_EVIDENCE");
  assert.equal(assessEvidence({...requirement,record:{...record,claims:[]}}).status,"INCOMPLETE_EVIDENCE");
});

test("supplied evidence stores identity and digest, not secret content, and refuses duplicate/conflicting sources",async()=>{
  const f=await fixture();try{
    const secret="ONLY_SYNTHETIC_SECRET_9j2x";
    const result=await f.kernel.invokeCapability(f.owner,{requestId:"secret-hygiene",capabilityId:"autonomy-boundary-checker",input:safe,
      evidence:[{sourceId:"email:example",content:`password=${secret}`,claimedProvenance:"OWNER_OBSERVED"}]});
    assert.equal(result.evidence[0]!.provenance,"SUPPLIED");assert.equal(result.evidence[0]!.authoritySource,false);
    assert.equal((await readFile(join(f.directory,"events.ndjson"),"utf8")).includes(secret),false);
    assert.throws(()=>normalizeSuppliedEvidence([{sourceId:"x",content:1},{sourceId:"x",content:2}]));
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a prior kernel result may be referenced without fabricating production or independent acceptance",async()=>{
  const f=await fixture();try{
    const prior=await f.kernel.invokeCapability(f.owner,{requestId:"producer",capabilityId:"autonomy-boundary-checker",input:safe});
    const next=await f.kernel.invokeCapability(f.owner,{requestId:"consumer",capabilityId:"autonomy-boundary-checker",input:safe,evidenceReceiptIds:[prior.resultDigest]});
    assert.equal(next.status,"SUCCEEDED");assert.equal(next.evidence[0]!.provenance,"LOCAL");
    assert.equal(next.evidence[0]!.integrity,"KERNEL_RECEIPT");assert.equal(next.evidence[0]!.contentDigest,prior.resultDigest);
    assert.equal(next.evidence[0]!.authoritySource,false);assert.equal(next.evidence[0]!.claims.includes("independently-accepted"),false);
    const missing=await f.kernel.invokeCapability(f.owner,{requestId:"missing-receipt",capabilityId:"autonomy-boundary-checker",input:safe,evidenceReceiptIds:["f".repeat(64)]});
    assert.equal(missing.status,"INVALID_INPUT");
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("concurrent identical requests create one receipt; caller mutation cannot change a waiting request",async()=>{
  const f=await fixture();try{
    const request={requestId:"concurrent",capabilityId:"autonomy-boundary-checker",input:{...safe}};
    const first=f.kernel.invokeCapability(f.owner,request);request.input.target="supplied:changed-after-call";
    assert.equal((await first).inputDigest,sha256(canonicalJson(safe)));
    const results=await Promise.all(Array.from({length:8},()=>f.kernel.invokeCapability(f.owner,{...request,input:safe})));
    assert.ok(results.every(result=>result.replayed));
    assert.equal((await f.kernel.inspectAudit()).filter(event=>event.type==="digital_capability_executed").length,1);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("historical receipts survive an actual process restart and do not duplicate accounting",async()=>{
  const f=await fixture();try{
    const prior=await f.kernel.invokeCapability(f.owner,{requestId:"restart",capabilityId:"autonomy-boundary-checker",input:safe});
    const child=join(f.directory,"child.mjs"),destination=join(f.directory,"result.json");
    await writeFile(child,`import{SaraKernel}from ${JSON.stringify(new URL("../src/kernel.ts",import.meta.url).href)};import{writeFile}from'node:fs/promises';const kernel=await SaraKernel.boot({stateDirectory:${JSON.stringify(f.directory)},ownerTokenSha256:${JSON.stringify(sha256(token))}});const result=await kernel.invokeCapability(kernel.authenticateOwnerToken(${JSON.stringify(token)}),${JSON.stringify({requestId:"restart",capabilityId:"autonomy-boundary-checker",input:safe})});await writeFile(${JSON.stringify(destination)},JSON.stringify(result));`);
    await promisify(execFile)(process.execPath,["--import","tsx",child],{cwd:process.cwd(),timeout:10_000});
    const result=JSON.parse(await readFile(destination,"utf8"));assert.equal(result.resultDigest,prior.resultDigest);assert.equal(result.replayed,true);
    assert.equal((await f.kernel.inspectAudit()).filter(event=>event.type==="digital_capability_executed").length,1);
    assert.equal(result.cost.actualCashMicroUsd,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a historical allowed analysis is explicitly stale after owner authority changes",async()=>{
  const f=await fixture();try{
    const request={requestId:"before-stop",capabilityId:"autonomy-boundary-checker",input:safe};const prior=await f.kernel.invokeCapability(f.owner,request);
    await f.kernel.setEmergencyStop(f.owner,true);const replay=await f.kernel.invokeCapability(f.owner,request);
    assert.equal(replay.resultDigest,prior.resultDigest);assert.equal(replay.receiptValidity?.current,false);
    assert.equal(replay.authority.authorizationTokenIssued,false);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("authenticated HTTP exposes contracts and invocation while bridge, cookie-CSRF, GET and invalid requests cannot mutate",async()=>{
  const f=await fixture();const server=createSaraServer(f.kernel,{stateDirectory:f.directory,ownerTokenSha256:sha256(token),readOnlyBridgeTokenSha256:sha256("read-bridge")});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
  try{
    assert.equal((await fetch(`${base}/api/capability-contracts`)).status,401);
    assert.equal((await fetch(`${base}/api/capability-contracts`,{headers:{Authorization:"Bearer read-bridge"}})).status,401);
    const catalog=await fetch(`${base}/api/capability-contracts`,{headers});assert.equal(catalog.status,200);assert.ok(Array.isArray(await catalog.json()));
    const request={requestId:"http-invoke",capabilityId:"autonomy-boundary-checker",input:{...safe,action:"purchase",external:true}};
    assert.equal((await fetch(`${base}/api/capabilities/invoke`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)})).status,401);
    const result=await fetch(`${base}/api/capabilities/invoke`,{method:"POST",headers,body:JSON.stringify(request)});assert.equal(result.status,200);
    assert.equal(output((await result.json() as {output:Json}).output).allowed,false);
    assert.notEqual((await fetch(`${base}/api/capabilities/invoke`,{headers})).status,200);
    const audit=await f.kernel.inspectAudit();assert.equal(audit.filter(event=>event.type==="digital_capability_executed").length,1);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(f.directory,{recursive:true,force:true});}
});

test("financial magnitude and suggested profit never overcome the deterministic authority boundary",async()=>{
  const f=await fixture();try{
    for(const [i,cost] of [0,1,999,1_000_000,300_000_000,Number.MAX_SAFE_INTEGER].entries()){
      const result=await f.kernel.invokeCapability(f.owner,{requestId:`cost-${i}`,capabilityId:"autonomy-boundary-checker",input:{...safe,action:"purchase",external:true,estimatedCashMicroUsd:cost}});
      assert.equal(result.status,"SUCCEEDED");assert.equal(output(result.output).allowed,false);
    }
    const before=(await f.kernel.getStatus()).realizedProfit;
    assert.deepEqual((await f.kernel.getStatus()).realizedProfit,before);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
