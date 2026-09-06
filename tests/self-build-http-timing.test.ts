import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { observeSelfBuildHttp, type SelfBuildHttpTiming } from "../src/self-build-http-timing.ts";
async function listen(server: Server) { await new Promise<void>(r=>server.listen(0,"127.0.0.1",r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
async function close(server: Server) { await new Promise<void>(r=>server.close(()=>r())); }
const path="/api/jobs/timing-fixture/self-build";
test("HTTP timer includes handler awaits and emits exactly once without private inputs",async()=>{
  const events:SelfBuildHttpTiming[]=[];
  const server=createServer(async(_q,r)=>{await delay(35);r.writeHead(201);r.end('{"done":true}');});
  observeSelfBuildHttp(server,{sourceRevision:"a".repeat(40),emit:e=>events.push(e)});
  const base=await listen(server);
  try { const r=await fetch(base+path,{method:"POST",headers:{authorization:"Bearer do-not-log"},body:"private-source"});await r.text();await delay(5);
    assert.equal(events.length,1);assert(events[0].elapsedMilliseconds>=30);assert.equal(events[0].outcome,"response_finished");
    assert(events[0].kernelAcceptanceInferredFrom201);assert(events[0].telemetryOnly);assert.equal(events[0].sourceRevision,"a".repeat(40));
    assert.doesNotMatch(JSON.stringify(events),/do-not-log|private-source|timing-fixture/);
  }finally{await close(server);}
});
test("timing failure does not change the response or cause another emission",async()=>{
  let failures=0,calls=0;const server=createServer((_q,r)=>{r.writeHead(401);r.end("unauthorized");});
  observeSelfBuildHttp(server,{emit:()=>{calls++;throw Error("optional");},onTelemetryFailure:()=>{failures++;}});
  const base=await listen(server);try{assert.equal((await fetch(base+path,{method:"POST"})).status,401);await delay(5);assert.equal(calls,1);assert.equal(failures,1);}
  finally{await close(server);}
});
test("health, unrelated routes and GET requests are excluded",async()=>{
  const events:SelfBuildHttpTiming[]=[];const server=createServer((_q,r)=>r.end("ok"));observeSelfBuildHttp(server,{emit:e=>events.push(e)});
  const base=await listen(server);try{for(const p of ["/health","/api/jobs/x/report",path])await (await fetch(base+p)).text();await delay(5);assert.equal(events.length,0);}finally{await close(server);}
});
test("duplicate observers and invalid revision are rejected",()=>{
  const server=createServer();assert.throws(()=>observeSelfBuildHttp(server,{sourceRevision:"wrong",emit:()=>{}}),/INVALID_SOURCE/);
  observeSelfBuildHttp(server,{emit:()=>{}});assert.throws(()=>observeSelfBuildHttp(server,{emit:()=>{}}),/ALREADY_ATTACHED/);
});
test("premature connection close is not recorded as successful completion",async()=>{
  const events:SelfBuildHttpTiming[]=[];const server=createServer((_q,r)=>{r.writeHead(201);r.destroy();});observeSelfBuildHttp(server,{emit:e=>events.push(e)});
  const base=await listen(server);try{await assert.rejects(fetch(base+path,{method:"POST"}));await delay(5);assert.equal(events.length,1);assert.equal(events[0].outcome,"connection_closed_before_finish");assert.equal(events[0].kernelAcceptanceInferredFrom201,false);}finally{await close(server);}
});
