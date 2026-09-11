import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { createSaraServer } from "../src/server.ts";

const token="budget-test-owner";
// Deliberately artificial test prices: one call reserves exactly one cent.
const config={monthlyLimitUsd:.01,openingChargeUsd:0,inputUsdPerMillionTokens:100,outputUsdPerMillionTokens:100};
const request={prompt:"fixture",reasoningLevel:"low" as const,maximumOutputTokens:50};
async function setup(directory:string){return SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});}
async function configure(kernel:SaraKernel,input=config){
 const owner=kernel.authenticateOwnerToken(token);
 await kernel.configureModelBudget(owner,input,{approvalId:"budget-test",ownerId:owner.id,action:"owner_funded_ceiling_change",targetId:`model-budget:${sha256(canonicalJson(input))}`,approvedAt:new Date().toISOString()});
}
function client(execute:()=>Promise<{outputText:string;inputTokens:number;billableOutputTokens:number}>){return {routeKey:"openai:gpt-5.6-luna:paid",maximumWallTimeMs:1000,async countInputTokens(){return 50;},execute};}

test("shared allocation defaults to zero and cannot be raised by SARA or a forged owner",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"sara-budget-auth-"));
 try{
  const kernel=await setup(directory);let calls=0;
  const guarded=kernel.guardPaidModelClient(client(async()=>{calls++;return {outputText:"ok",inputTokens:50,billableOutputTokens:1};}));
  await assert.rejects(()=>guarded.execute(request),/not configured/);assert.equal(calls,0);
  for(const principal of [SARA_PRINCIPAL,{id:"OWNER",kind:"owner" as const,authenticated:true}]) await assert.rejects(()=>kernel.configureModelBudget(principal,config));
  await configure(kernel);
  await guarded.execute(request);assert.equal(calls,1);
  assert.equal((await kernel.modelBudgetStatus()).remainingUsd,0);
  await assert.rejects(()=>guarded.execute(request),/exhausted/);assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test("parallel kernel clients and restart share an irrevocable pre-dispatch hold",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"sara-budget-race-"));
 try{
  const first=await setup(directory);await configure(first);const second=await setup(directory);
  let calls=0;
  const failing=client(async()=>{calls++;throw new Error("Connection lost; billing uncertain");});
  const results=await Promise.allSettled([first.guardPaidModelClient(failing).execute(request),second.guardPaidModelClient(failing).execute(request)]);
  assert.equal(results.filter(r=>r.status==="rejected").length,2);assert.equal(calls,1);
  const rebooted=await setup(directory);assert.equal((await rebooted.modelBudgetStatus()).reservedUsd,.01);
  await configure(rebooted); // Saving the same allocation cannot reset consumption.
  await assert.rejects(()=>rebooted.guardPaidModelClient(failing).execute(request),/exhausted/);assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test("opening usage, emergency stop, and lowering a limit never restore spent allowance",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"sara-budget-opening-"));
 try{
  const kernel=await setup(directory);await configure(kernel,{...config,monthlyLimitUsd:.02,openingChargeUsd:.01});
  let calls=0;const guarded=kernel.guardPaidModelClient(client(async()=>{calls++;return {outputText:"ok",inputTokens:50,billableOutputTokens:1};}));
  const owner=kernel.authenticateOwnerToken(token);await kernel.setEmergencyStop(owner,true);
  await assert.rejects(()=>guarded.execute(request),/Emergency stop/);assert.equal(calls,0);
  await kernel.setEmergencyStop(owner,false);await guarded.execute(request);
  assert.equal((await kernel.modelBudgetStatus()).reservedUsd,.02);
  await assert.rejects(()=>configure(kernel),/cannot be reduced/);
  await configure(kernel,{...config,openingChargeUsd:.01});
  assert.equal((await kernel.modelBudgetStatus()).remainingUsd,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test("unexpected provider usage freezes subsequent paid dispatch",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"sara-budget-bound-"));
 try{
  const kernel=await setup(directory);await configure(kernel,{...config,monthlyLimitUsd:1});let calls=0;
  const guarded=kernel.guardPaidModelClient(client(async()=>{calls++;return {outputText:"bad accounting",inputTokens:51,billableOutputTokens:1};}));
  await assert.rejects(()=>guarded.execute(request),/outside the reserved/);
  const rebooted=await setup(directory);
  await assert.rejects(()=>rebooted.guardPaidModelClient(client(async()=>{calls++;return {outputText:"ok",inputTokens:50,billableOutputTokens:1};})).execute(request),/reconciliation/);
  assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test("allocation HTTP controls require owner authentication",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"sara-budget-http-"));
 const kernel=await setup(directory);
 const server=createSaraServer(kernel,{stateDirectory:directory,ownerTokenSha256:sha256(token),readOnlyBridgeTokenSha256:sha256("read-only-fixture")});
 try{
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/model-budget`;
  const post=(key?:string)=>fetch(url,{method:"POST",headers:{"content-type":"application/json",...(key?{"authorization":`Bearer ${key}`}:{})},body:JSON.stringify(config)});
  assert.equal((await post()).status,401);assert.notEqual((await post("read-only-fixture")).status,200);
  const response=await post(token);assert.equal(response.status,200,await response.clone().text());
  assert.equal(((await response.json()) as {monthlyLimitUsd:number}).monthlyLimitUsd,.01);
  const learningUrl=url.replace("/api/model-budget","/api/autonomy/learning-mandate");
  assert.equal((await fetch(learningUrl,{method:"POST"})).status,401);
  const activation=await fetch(learningUrl,{method:"POST",headers:{authorization:`Bearer ${token}`}});
  assert.equal(activation.status,201,await activation.clone().text());
  const mandate=await activation.json() as {allowedChannels:string[];allowedServiceIds:string[];maximumCostPerActionUsd:number;maximumDailyActions:number};
  assert.deepEqual(mandate.allowedChannels,["internal"]);assert.deepEqual(mandate.allowedServiceIds,["skill-learning"]);
  assert.equal(mandate.maximumCostPerActionUsd,0);assert.equal(mandate.maximumDailyActions,20);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
});