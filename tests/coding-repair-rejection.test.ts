import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import { classifyCodingRepairRejection, CodingRepairRejectedAttemptError } from "../src/coding-repair-rejection.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import type { CodingRepairProposal, ProgramVerificationResult } from "../src/coding-repair-types.ts";

const source = "export const value = 1;\n";
const baseline: ProgramCandidateProposal = {schemaVersion:1,candidateKind:"typescript_program",programName:"Rejection probe",summary:"Offline diagnostic test",limitations:[],files:[{path:"src/value.ts",content:source},{path:"tests/value.test.ts",content:"PRIVATE_TEST_OUTPUT"}]};
const verification: ProgramVerificationResult = {passed:false,score:0.8,artifactDigest:sha256("artifact"),failures:[{kind:"behavior",code:"FAIL",file:"src/value.ts",line:1,column:1,evidenceDigest:sha256("evidence"),fingerprint:sha256("failure"),severity:"medium",existedBeforeRepair:true}],completedChecks:["source_policy","syntax","typecheck","artifact_integrity"],evidenceDigests:[]};
function proposal():CodingRepairProposal{return {schemaVersion:1,baseArtifactDigest:verification.artifactDigest,failureFingerprint:verification.failures[0].fingerprint,strategy:"surgical",changes:[{path:"src/value.ts",expectedContentDigest:sha256(source),replacementText:"export const value = 2;\n"}],limitations:[]};}

test("diagnostic allowlist rejects model prose, spoofed codes, and unknown messages",()=>{
 assert.equal(classifyCodingRepairRejection(new Error("Coding repair proposal targets a stale artifact.")),"STALE_ARTIFACT");
 for(const value of [new Error("PRIVATE_TEST_OUTPUT secret"), {code:"STALE_ARTIFACT",message:"model says so"}, null]) assert.equal(classifyCodingRepairRejection(value),"UNKNOWN_REJECTION");
 assert.equal(classifyCodingRepairRejection(new Error("Coding repair proposal targets a stale artifact. PRIVATE_TEST_OUTPUT")),"UNKNOWN_REJECTION");
});
for(const [code,mutate] of [
 ["STALE_ARTIFACT",(p:CodingRepairProposal)=>{p.baseArtifactDigest=sha256("stale");}],
 ["UNKNOWN_FAILURE",(p:CodingRepairProposal)=>{p.failureFingerprint=sha256("other");}],
 ["STRATEGY_MISMATCH",(p:CodingRepairProposal)=>{p.strategy="deep";}],
 ["UNKNOWN_OR_DUPLICATE_FILE",(p:CodingRepairProposal)=>{p.changes[0].path="src/absent.ts";}],
 ["PROTECTED_PATH",(p:CodingRepairProposal)=>{p.changes[0].path="tests/value.test.ts";}],
 ["STALE_FILE_DIGEST",(p:CodingRepairProposal)=>{p.changes[0].expectedContentDigest=sha256("stale");}],
 ["EMPTY_REPLACEMENT",(p:CodingRepairProposal)=>{p.changes[0].replacementText=" ";}],
 ["CHANGED_LINE_LIMIT",(p:CodingRepairProposal)=>{p.changes[0].replacementText="export const value = 2;\n"+"// line\n".repeat(81);}],
] as const) test(`captures ${code} with known usage, unchanged champion, and no hidden content`,async()=>{
 let calls=0,verifications=0;const p=proposal();mutate(p);
 await assert.rejects(()=>runCodingRepairController({baseline,verify:async()=>{verifications++;return verification;},model:{async propose(){calls++;return {proposal:p,inputTokens:120,outputTokens:50,accountedCostUsd:0.003};}}}),error=>{
  assert(error instanceof CodingRepairRejectedAttemptError);
  assert.equal(error.evidence.reasonCode,code);assert.equal(error.evidence.cycle,1);
  assert.equal(error.evidence.accountedCostUsd,0.003);assert.equal(error.evidence.inputTokens,120);
  assert.equal(error.evidence.outputTokens,50);assert.equal(error.evidence.knownRunSpendUsd,0.003);
  assert.equal(error.evidence.usageUnknown,false);assert.equal(error.evidence.retainedArtifactDigest,verification.artifactDigest);
  assert.equal(error.evidence.disclosure,"structured_only");
  assert(!JSON.stringify(error).includes("PRIVATE_TEST_OUTPUT"));assert(!JSON.stringify(error).includes("replacementText"));
  assert.match(error.evidence.evidenceDigest,/^[a-f0-9]{64}$/u);return true;
 });
 assert.equal(calls,1);assert.equal(verifications,1);assert.equal(baseline.files[0].content,source);
});
test("malformed accounting remains unknown, never replaced with a zero cost",async()=>{
 await assert.rejects(()=>runCodingRepairController({baseline,verify:async()=>verification,model:{async propose(){return {proposal:proposal(),inputTokens:NaN,outputTokens:10,accountedCostUsd:NaN};}}}),error=>{
  assert(error instanceof CodingRepairRejectedAttemptError);assert.equal(error.evidence.reasonCode,"MODEL_COST_INVALID");assert.equal(error.evidence.accountedCostUsd,null);assert.equal(error.evidence.usageUnknown,true);return true;
 });
});
test("bounded diagnostic digest is stable and legacy name-only capture keeps the reason",async()=>{
 const errors:CodingRepairRejectedAttemptError[]=[];
 for(let i=0;i<2;i++) await assert.rejects(()=>runCodingRepairController({baseline,verify:async()=>verification,model:{async propose(){const p=proposal();p.baseArtifactDigest=sha256("stale");return {proposal:p,inputTokens:120,outputTokens:50,accountedCostUsd:0.003};}}}),error=>{assert(error instanceof CodingRepairRejectedAttemptError);errors.push(error);return true;});
 assert.deepEqual(errors[0].evidence,errors[1].evidence);assert(errors[0].name.endsWith(":STALE_ARTIFACT"));assert(Object.isFrozen(errors[0].evidence));
});
test("a later rejection retains cost already spent on a verified improvement",async()=>{
 let calls=0;
 await assert.rejects(()=>runCodingRepairController({baseline,verify:async c=>({...verification,score:c.files[0].content===source?0.6:0.8,artifactDigest:sha256(c.files[0].content)}),model:{async propose(r){calls++;return {proposal:{...proposal(),baseArtifactDigest:r.verification.artifactDigest,changes:[{path:calls===1?"src/value.ts":"src/absent.ts",expectedContentDigest:sha256(r.candidate.files[0].content),replacementText:"export const value = 2;\n"}]},inputTokens:120,outputTokens:50,accountedCostUsd:0.003};}}}),error=>{
  assert(error instanceof CodingRepairRejectedAttemptError);assert.equal(error.evidence.cycle,2);assert.equal(error.evidence.knownRunSpendUsd,0.006);assert.equal(error.evidence.accountedCostUsd,0.003);return true;
 });assert.equal(calls,2);
});
