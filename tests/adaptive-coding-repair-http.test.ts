import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { sha256 } from "../src/canonical.ts";
import { largeCandidate, needle, replacement, fixtureContext } from "./helpers/adaptive-repair-fixture.ts";
import type { WorkerModelClient } from "../src/model-router.ts";

test("owner canary requests a compact cold repair, re-verifies it in the kernel, and reuses it after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "sara-adaptive-http-"));
  const token = "local-adaptive-fixture-only", hash = sha256(token);
  let modelCalls = 0, countCalls = 0;
  const client: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
    async countInputTokens(prompt) {
      countCalls++;
      assert.match(prompt,/SARA_CODING_REPAIR_EDITS_V1/);
      assert.doesNotMatch(prompt,/PRIVATE_ADAPTIVE_ORACLE/);
      const runs = await readdir(join(root,"coding-repair-receipts"));
      const intent = JSON.parse(await readFile(join(root,"coding-repair-receipts",runs[0],"format-1.json"),"utf8"));
      assert.equal(intent.phase,"before_dispatch");assert.equal(intent.decision.format,"compact_edits");
      return 100;
    },
    async execute(input) {
      modelCalls++;const payload=JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
      const source=payload.files.find((file:{path:string})=>file.path==="src/value.ts");
      return {outputText:JSON.stringify({schemaVersion:1,baseArtifactDigest:payload.currentArtifactDigest,
        failureFingerprint:payload.failures[0].fingerprint,strategy:"surgical",changes:[{path:source.path,
          expectedContentDigest:source.contentDigest,edits:[{find:needle,replace:replacement}]}],limitations:[]}),inputTokens:100,billableOutputTokens:50};
    }};
  try {
    let digest="";
    for(let turn=0;turn<2;turn++){
      const kernel=await SaraKernel.boot({stateDirectory:root,ownerTokenSha256:hash});
      if(!turn) await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(token),{kind:"revenue",source:"customer",amountUsd:100,
        realized:true,recurringMonthly:false,description:"Synthetic test funding",occurredAt:"2026-09-06T00:00:00.000Z"});
      const job=await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL,{objective:fixtureContext.objective,
        acceptanceCriteria:fixtureContext.acceptanceCriteria,requiredCapabilities:[],expectedOwnerValue:1,maximumBudgetUsd:0.15});
      const server=createSaraServer(kernel,{ownerTokenSha256:hash,stateDirectory:root,reparodynamicCoding:{mode:"canary",modelClient:client,stateDirectory:root}});
      await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
      try{
        const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs/${job.id}/self-build`;
        const body=JSON.stringify({proposal:largeCandidate()});
        assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body})).status,401);
        const response=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body});
        const text=await response.text();assert.equal(response.status,201,text);
        const result=JSON.parse(text);assert.equal(result.mutation.stage,"SHADOW");assert.equal(result.evidence.attestation,"kernel_executed");
        if(!turn)digest=result.mutation.candidateDigest;else assert.equal(result.mutation.candidateDigest,digest);
        assert.equal(modelCalls,1);assert.equal(countCalls,1);
      }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
    }
    const runs=await readdir(join(root,"coding-repair-receipts"));let formats=0;let warm=0;
    for(const run of runs){
      const files=await readdir(join(root,"coding-repair-receipts",run));formats+=files.filter(file=>file.startsWith("format-")).length;
      const reuse=JSON.parse(await readFile(join(root,"coding-repair-receipts",run,"reuse.json"),"utf8")).summary;
      if(reuse.hits===1){warm++;assert.equal(reuse.modelRequests,0);assert.equal(reuse.finalFreshVerification,true);}
    }
    assert.equal(formats,1);assert.equal(warm,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
