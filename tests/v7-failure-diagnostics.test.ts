import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {describe,it} from "node:test";
import {describeBenchmarkFailure,assertOfflineRecovery,type BenchmarkStage} from "../proof/v7-failure-diagnostics.ts";
import {evaluatePair} from "../proof/v7-live-evaluation.ts";
import {runCodingRepairController} from "../src/coding-repair-controller.ts";
import {baseline} from "../proof/v7-live-fixture.ts";
import {sha256} from "../src/canonical.ts";
import type {ProgramVerificationResult} from "../src/coding-repair-types.ts";

const execFileAsync=promisify(execFile);
describe("offline V7 failure diagnostics",()=>{
  for(const [message,code] of [
    ["Coding repair proposal exceeds its changed-line limit.","CHANGED_LINE_LIMIT"],
    ["Coding repair proposal targets a stale artifact.","STALE_ARTIFACT"],
    ["Coding repair proposal attempted a strategy escalation.","STRATEGY_MISMATCH"],
    ["Coding repair proposal targets a protected path.","PROTECTED_PATH"],
    ["Luna repair output failed the bounded proposal contract.","MODEL_OUTPUT_CONTRACT"],
    ["Coding repair model exceeded or malformed its accounted cost.","MODEL_COST_INVALID"],
  ]) it(`retains a bounded ${code} reason instead of only Error`,()=>{
    assert.deepEqual(describeBenchmarkFailure(new Error(message),"candidate_validation"),{stage:"candidate_validation",code});
  });
  it("never copies provider prose, secrets, expected outputs, stacks, or causes",()=>{
    const marker="PRIVATE_EXPECTED_AND_SECRET_SENTINEL";
    const error=new Error(marker,{cause:marker});error.name=marker;error.stack=marker;
    const result=describeBenchmarkFailure(error,"model_request");
    assert.deepEqual(result,{stage:"model_request",code:"UNCLASSIFIED_ERROR"});
    assert(!JSON.stringify(result).includes(marker));
    assert.deepEqual(Object.keys(result),["stage","code"]);
  });
  it("does not invoke a message getter",()=>{
    let invoked=0;const error=new Error();
    Object.defineProperty(error,"message",{get(){invoked++;throw new Error("secret");}});
    assert.equal(describeBenchmarkFailure(error,"model_request").code,"UNCLASSIFIED_ERROR");
    assert.equal(invoked,0);
  });
  it("fails closed for a hostile descriptor trap",()=>{
    const error=new Proxy(new Error(),{getOwnPropertyDescriptor(){throw new Error("secret");}});
    assert.equal(describeBenchmarkFailure(error,"model_request").code,"UNCLASSIFIED_ERROR");
  });
  it("bounds an untrusted stage rather than serializing it",()=>{
    const result=describeBenchmarkFailure(null,"secret" as BenchmarkStage);
    assert.deepEqual(result,{stage:"unknown",code:"UNCLASSIFIED_ERROR"});
  });
  it("is deterministic and does not reinterpret an old generic Error",()=>{
    const error=new Error("Error");
    assert.equal(JSON.stringify(describeBenchmarkFailure(error,"candidate_validation")),
      JSON.stringify(describeBenchmarkFailure(error,"candidate_validation")));
    assert.equal(describeBenchmarkFailure(error,"candidate_validation").code,"UNCLASSIFIED_ERROR");
  });
  it("does not turn an errored comparison into a speed claim",()=>{
    const code=describeBenchmarkFailure(new Error("Coding repair proposal exceeds its changed-line limit."),"candidate_validation").code;
    const result=evaluatePair({verifiedComplete:false,timeMs:1,costUsd:0.01,error:code},
      {verifiedComplete:true,timeMs:20,costUsd:0.01,error:null});
    assert.equal(result.valid,false);assert.equal(result.speedRatio,null);assert.equal(result.target300PercentMet,false);
  });
  it("rejects a spent live authorization regardless of self-test flags",()=>{
    assert.throws(()=>assertOfflineRecovery(["--live"]),/authorization.*consumed/i);
    assert.throws(()=>assertOfflineRecovery(["--self-test","--live"]),/authorization.*consumed/i);
    assert.doesNotThrow(()=>assertOfflineRecovery([]));
    assert.doesNotThrow(()=>assertOfflineRecovery(["--self-test","--all-wrong"]));
  });
  it("captures an actual controller boundary rejection without another verifier or model call",async()=>{
    let modelCalls=0,verifierCalls=0;
    const fp="f".repeat(64),artifact="a".repeat(64);
    const verification:ProgramVerificationResult={passed:false,score:0.8,artifactDigest:artifact,
      failures:[{kind:"behavior",code:"FAILED",file:"src/queue.ts",line:1,column:0,fingerprint:fp,
        evidenceDigest:"e".repeat(64),severity:"medium",existedBeforeRepair:true}],
      completedChecks:["source_policy","syntax","typecheck","artifact_integrity"],evidenceDigests:[]};
    await assert.rejects(()=>runCodingRepairController({baseline,
      verify:async()=>{verifierCalls++;return structuredClone(verification);},
      model:{async propose(){
        modelCalls++;const current=baseline.files.find(f=>f.path==="src/queue.ts")!;
        return {proposal:{schemaVersion:1,baseArtifactDigest:artifact,failureFingerprint:fp,strategy:"surgical",
          changes:[{path:current.path,expectedContentDigest:sha256(current.content),replacementText:current.content+"\n// probe\n".repeat(81)}],limitations:[]},
          inputTokens:10,outputTokens:10,accountedCostUsd:0.001};
      }}}),error=>{
        assert.equal(describeBenchmarkFailure(error,"candidate_validation").code,"CHANGED_LINE_LIMIT");return true;
      });
    assert.equal(modelCalls,1);assert.equal(verifierCalls,1);
  });
  it("the runner itself rejects --live before provider access, even with credential-shaped input",async()=>{
    const launch=`globalThis.fetch=async()=>{throw new Error("NETWORK_MUST_NOT_BE_USED");};
      process.argv.push("--live","--acknowledge-max-spend-usd=0.15");
      await import("./proof/live-v7-comparison.ts");`;
    await assert.rejects(()=>execFileAsync(process.execPath,["--import","tsx","--input-type=module","-e",launch],{
      env:{...process.env,OPENAI_API_KEY:"NOT_A_REAL_KEY",SARA_BENCHMARK_COMMIT_SHA:"b451a41dc7add73613c0580a9b101ddd390a93a6"},
      timeout:15000,maxBuffer:65536}),error=>{
        const result=error as Error&{stderr:string;stdout:string};
        assert.match(result.stderr,/authorization.*consumed/i);
        assert(!result.stdout.includes("MODEL_ATTEMPT"));
        assert(!result.stderr.includes("NETWORK_MUST_NOT_BE_USED\n"));
        return true;
      });
  });
});
