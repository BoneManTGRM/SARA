import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { PROCEDURAL_SEED_PLAYBOOKS, ProceduralKnowledgeStore, executeVerifiedProcedure } from "../src/procedural-intelligence.ts";
import type { Json } from "../src/digital-capabilities/schema.ts";
import { runSafeServiceRuntimeProof } from "../src/digital-capabilities/service-runtime-proof.ts";

function request(contractDigest:string) {
  return {requestId:"actual-service",capabilityId:"service-opportunity-generator",input:{
    capabilities:[{id:"ci-failure-triage",contractDigest,qualificationStatus:"PASSED",status:"ENABLED",estimatedDeliveryMinutes:1,estimatedCashMicroUsd:0}],
    demandSignals:["one","two"].map(host=>({sourceUrl:`https://${host}.example/offer`,observedAt:"2026-09-12",serviceName:"CI failure triage",targetCustomer:"Project maintainers",customerProblem:"Identify likely causes from supplied failed CI logs.",requiredCapabilityIds:["ci-failure-triage"],comparablePriceUsd:99})),
    maximumDeliveryMinutes:10,maximumCashMicroUsd:0,maximumCandidates:1,
  }};
}
const candidate=(value:Json)=>(value as unknown as {candidates:Array<{decision:string;procedureEvidenceDigests:string[]}>}).candidates[0]!;

test("safe runtime service proof rejects unsupported work and reuses its exact receipt",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"service-runtime-"));
  try {
    const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256("fixture-owner")});
    const input={kernel,sourceRevision:"a".repeat(40),deploymentId:"synthetic-deployment",environment:"ISOLATED" as const};
    const proof=await runSafeServiceRuntimeProof(input);
    assert.equal(proof.status,"VERIFIED");assert.ok(Object.values(proof.checks).every(Boolean));
    const count=(await kernel.inspectAudit()).length;
    assert.equal((await runSafeServiceRuntimeProof(input)).receiptDigest,proof.receiptDigest);
    assert.equal((await kernel.inspectAudit()).length,count);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("caller-invented qualified capabilities cannot create a service-ready card", async () => {
  const directory = await mkdtemp(join(tmpdir(), "service-trust-"));
  try {
    const kernel = await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256("fixture-owner")});
    const result = await kernel.invokeCapability(SARA_PRINCIPAL, {
      requestId:"forged-service-readiness", capabilityId:"service-opportunity-generator",
      input: {
        capabilities:[{id:"imaginary-qualified-service",contractDigest:"a".repeat(64),qualificationStatus:"PASSED",status:"ENABLED",estimatedDeliveryMinutes:1,estimatedCashMicroUsd:0}],
        demandSignals:["one", "two"].map(host => ({sourceUrl:`https://${host}.example/offer`,observedAt:"2026-09-12",serviceName:"Invented service",targetCustomer:"Project owners",customerProblem:"An unsupported service claim must remain unsupported.",requiredCapabilityIds:["imaginary-qualified-service"],comparablePriceUsd:99})),
        maximumDeliveryMinutes:10,maximumCashMicroUsd:0,maximumCandidates:1,
      },
    });
    const output = result.output as {candidates:Array<{decision:string;qualifiedCapabilityIds:string[]}>};
    assert.equal(output.candidates[0]?.decision,"EVIDENCE_REQUIRED");
    assert.deepEqual(output.candidates[0]?.qualifiedCapabilityIds,[]);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("real capability requires demonstrated current procedure; failure invalidates replay across restart and restore",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"service-procedure-")), backup=await mkdtemp(join(tmpdir(),"service-restore-"));
  const ownerTokenSha256=sha256("fixture-owner");
  try {
    const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256});
    const contract=(await kernel.inspectCapabilityContracts()).find(item=>item.id==="ci-failure-triage")!;
    const beforeFiles=await readdir(directory);
    assert.equal(candidate((await kernel.invokeCapability(SARA_PRINCIPAL,request(contract.contractDigest))).output).decision,"EVIDENCE_REQUIRED");
    assert.deepEqual(await readdir(directory),beforeFiles,"Readiness inspection must not create procedural state.");
    const identity={capabilityId:contract.id,contractDigest:contract.contractDigest,implementationDigest:contract.implementationDigest,policyDigest:(await kernel.getStatus()).constitution.digest};
    const playbook={...structuredClone(PROCEDURAL_SEED_PLAYBOOKS[0]!),procedureApplicabilityIdentity:identity,evidenceReuseIdentity:identity,authorityRequired:[]};
    const store=await ProceduralKnowledgeStore.open(directory,[playbook]);
    const execute=async(passed:boolean)=>executeVerifiedProcedure({store,
      task:{taskId:`service-evidence-${passed}`,description:"ci failure",taskFamily:playbook.taskFamily,identity,requestedActions:[]},
      grantedAuthorities:[],authorizedCostCeilingUsd:0,estimatedCostUsd:0,
      variableWork:()=>kernel.invokeCapability(SARA_PRINCIPAL,{requestId:`demonstrated-ci-${passed}`,capabilityId:contract.id,input:{revision:"a".repeat(40),changedFiles:[],steps:[{id:"install",status:"FAILED",logs:"ERESOLVE"}]}}),
      freshVerify:async result=>({passed:passed&&(result.output as Record<string,Json>).category==="DEPENDENCY",evidence:[result.resultDigest]}),
    });
    assert.equal((await execute(true)).outcome,"VERIFIED");
    const acceptedRequest={...request(contract.contractDigest),requestId:"qualified-service"};
    const accepted=await kernel.invokeCapability(SARA_PRINCIPAL,acceptedRequest);
    assert.equal(candidate(accepted.output).decision,"OWNER_REVIEW");
    assert.equal(candidate(accepted.output).procedureEvidenceDigests.length,1);
    const stale=await kernel.invokeCapability(SARA_PRINCIPAL,{...request("c".repeat(64)),requestId:"stale-contract"});
    assert.equal(candidate(stale.output).decision,"EVIDENCE_REQUIRED");
    await cp(directory,backup,{recursive:true});
    const restored=await SaraKernel.boot({stateDirectory:backup,ownerTokenSha256});
    const replay=await restored.invokeCapability(SARA_PRINCIPAL,acceptedRequest);
    assert.equal(replay.replayed,true);assert.equal(replay.resultDigest,accepted.resultDigest);assert.equal(replay.receiptValidity?.current,true);
    await assert.rejects(()=>execute(false),/FRESH_VERIFICATION_FAILED/);
    const historical=await kernel.invokeCapability(SARA_PRINCIPAL,acceptedRequest);
    assert.equal(historical.resultDigest,accepted.resultDigest);assert.equal(historical.receiptValidity?.current,false);
    assert.equal(candidate((await kernel.invokeCapability(SARA_PRINCIPAL,{...acceptedRequest,requestId:"after-failure"})).output).decision,"EVIDENCE_REQUIRED");
    const saved=await readFile(store.statePath,"utf8");
    await writeFile(store.statePath,saved.replace('"generation":', '"generation":999999,"discardedGeneration":'));
    await assert.rejects(()=>kernel.invokeCapability(SARA_PRINCIPAL,{...acceptedRequest,requestId:"corrupt-knowledge"}),/PROCEDURAL/);
  } finally {await rm(directory,{recursive:true,force:true});await rm(backup,{recursive:true,force:true});}
});
