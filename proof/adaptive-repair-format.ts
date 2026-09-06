import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { createAdaptiveCodingRepairModel, selectRepairOutputFormat } from "../src/adaptive-coding-repair-model.ts";
import { createLunaCodingRepairModel } from "../src/luna-coding-repair-model.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { verifyGenomeLabProgramCandidate } from "../src/genome-lab-verifier.ts";
import { codingRepairCandidateDigest } from "../src/experimental-v5/coding-repair-verification.ts";
import { largeCandidate, needle, replacement, fixtureContext } from "../tests/helpers/adaptive-repair-fixture.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
const output=resolve(process.argv[2] ?? "adaptive-format-evidence");
await mkdir(output,{recursive:false,mode:0o700});
const protocol={schemaVersion:1,classification:"SCRIPTED_OUTPUT_REPRESENTATION_NOT_LIVE_SPEED",
  source:process.env.SARA_RESEARCH_SOURCE_TREE ?? "unrecorded",rounds:3,widths:[32,64,128],
  arms:["full","adaptive"],providerCalls:0,injectedDelays:0,
  description:"Three synthetic related multi-function programs. Every unchanged function is tested. Known scripted repairs, not autonomous tasks. Four fresh full verifications per completed job. Timings are retained but do not measure inference savings."};
await writeFile(join(output,"protocol.json"),JSON.stringify(protocol,null,2));
const rows:Record<string,unknown>[]=[];
for(const width of protocol.widths) for(let round=0;round<protocol.rounds;round++){
  for(const arm of (round%2 ? ["adaptive","full"] : ["full","adaptive"])){
    const start=performance.now(),baseline=largeCandidate(false,width);let verifications=0,calls=0,promptBytes=0,responseBytes=0,selected="full_files";
    const client:WorkerModelClient={routeKey:"openai:gpt-5.6-luna:paid",maximumWallTimeMs:1000,
      async countInputTokens(prompt){assert.doesNotMatch(prompt,/PRIVATE_ADAPTIVE_ORACLE/);promptBytes+=Buffer.byteLength(prompt);return 100;},
      async execute(input){calls++;const payload=JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
        const file=payload.files.find((file:{path:string})=>file.path==="src/value.ts");
        const compact=input.prompt.includes("SARA_CODING_REPAIR_EDITS_V1");
        const response={schemaVersion:1,baseArtifactDigest:payload.currentArtifactDigest,failureFingerprint:payload.failures[0].fingerprint,
          strategy:payload.requiredStrategy,changes:[{path:file.path,expectedContentDigest:file.contentDigest,
            ...(compact?{edits:[{find:needle,replace:replacement}]}:{replacementText:file.content.replace(needle,replacement)})}],limitations:[]};
        const outputText=JSON.stringify(response);responseBytes+=Buffer.byteLength(outputText);
        return {outputText,inputTokens:100,billableOutputTokens:50};}};
    const model=arm==="adaptive"?createAdaptiveCodingRepairModel({client,context:fixtureContext,onFormat:async decision=>{
      selected=decision.format;await writeFile(join(output,`${width}-${round}-${arm}-intent.json`),JSON.stringify(decision));
    }}):createLunaCodingRepairModel({client,context:fixtureContext});
    const verify=async(candidate:typeof baseline)=>{verifications++;return verifyGenomeLabProgramCandidate({candidate,...fixtureContext});};
    const run=await runCodingRepairController({baseline,verify,model});
    assert.equal(run.state,"VERIFIED_CANDIDATE");assert.equal(run.receipts.length,1);
    const wrapperEquivalent=await verify(run.champion);assert(wrapperEquivalent.passed);
    assert.equal(wrapperEquivalent.artifactDigest,codingRepairCandidateDigest(largeCandidate(true,width)));
    // Separate post-return diagnostic mirrors the remaining check count; it is not live kernel evidence.
    const postReturn = await verify(run.champion);assert(postReturn.passed);assert.equal(postReturn.artifactDigest,wrapperEquivalent.artifactDigest);
    assert.equal(verifications,4);assert.equal(calls,1);
    assert.deepEqual(baseline,largeCandidate(false,width));
    if(arm==="adaptive")assert.equal(selected,selectRepairOutputFormat({candidate:baseline,verification:run.baselineVerification,
      cycle:1,strategy:"surgical",remainingCostUsd:0.075}).format);
    const row={width,round,arm,selected,sourceBytes:Buffer.byteLength(baseline.files[1].content),promptBytes,responseBytes,
      calls,verifications,verified:true,artifactDigest:wrapperEquivalent.artifactDigest,elapsedMilliseconds:performance.now()-start};
    rows.push(row);await writeFile(join(output,`${width}-${round}-${arm}-run.json`),JSON.stringify(run,null,2));
    await writeFile(join(output,"rows.json"),JSON.stringify(rows,null,2));
    console.log(JSON.stringify(row));
  }
}
await writeFile(join(output,"completion.json"),JSON.stringify({completed:true,jobs:rows.length,protocolDigest:sha256(canonicalJson(protocol)),rowsDigest:sha256(canonicalJson(rows))},null,2));
