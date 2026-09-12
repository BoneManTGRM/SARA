import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { createSaraServer } from "../src/server.ts";

type RuntimeProof={status:string;provenance:string;sourceRevision:string;productionBehaviorClaimed:boolean;checks:Record<string,boolean>;cost:{externalCashMicroUsd:number};receiptDigests:string[]};
type Runner=(input:{kernel:SaraKernel;port:number;sourceRevision:string;deploymentId:string;environment:"ISOLATED"|"PRODUCTION"})=>Promise<RuntimeProof>;
async function runner():Promise<Runner>{const module=await import("../src/digital-capabilities/production-proof.ts").catch(()=>null);assert.equal(typeof module?.runSafeCapabilityRuntimeProof,"function","The shared capability substrate requires a real safe-runtime verification path, not deployment status alone.");return module!.runSafeCapabilityRuntimeProof as Runner;}
for(const stopped of [false,true])test(`safe runtime proof executes actual kernel denials and protected HTTP checks with emergency stop ${stopped}`,async()=>{
  const run=await runner(),directory=await mkdtemp(join(tmpdir(),"sara-digital-runtime-")),token="isolated-runtime-proof-owner";
  const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  if(stopped)await kernel.setEmergencyStop(kernel.authenticateOwnerToken(token),true);
  const server=createSaraServer(kernel,{stateDirectory:directory,ownerTokenSha256:sha256(token)});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const input={kernel,port:(server.address() as {port:number}).port,sourceRevision:"d".repeat(40),deploymentId:"isolated-deployment",environment:"ISOLATED" as const};
    const before=(await kernel.getStatus()).realizedProfit;
    const proof=await run(input);assert.equal(proof.status,"VERIFIED");assert.equal(proof.provenance,"ISOLATED");assert.equal(proof.productionBehaviorClaimed,false);
    assert.ok(Object.values(proof.checks).every(Boolean));assert.equal(proof.cost.externalCashMicroUsd,0);assert.equal(proof.receiptDigests.length,3);
    const audit=(await kernel.inspectAudit()).length;assert.deepEqual((await run(input)).receiptDigests,proof.receiptDigests);
    assert.equal((await kernel.inspectAudit()).length,audit,"A restart proof must reuse unchanged idempotent receipts rather than duplicate work.");
    assert.deepEqual((await kernel.getStatus()).realizedProfit,before);assert.equal((await kernel.getStatus()).emergencyStopped,stopped);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
