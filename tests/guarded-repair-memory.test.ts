import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {GuardedRepairMemory,type Scope} from '../proof/guarded-repair-memory.ts';
import {baseline,reference,objective,acceptanceCriteria} from '../proof/v7-live-fixture.ts';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {runCodingRepairController} from '../src/coding-repair-controller.ts';
import {loadConstitution} from '../src/constitution.ts';
import {sha256} from '../src/canonical.ts';
import type {ProgramVerificationResult} from '../src/coding-repair-types.ts';
let good:ProgramVerificationResult,bad:ProgramVerificationResult,constitutionDigest:string;
const scope:Scope={contract:sha256('contract'),dependencies:sha256('dependencies'),verifier:sha256('verifier'),policy:sha256('policy')};
before(async()=>{constitutionDigest=(await loadConstitution()).digest;good=await verify(reference);bad=await verify(baseline);assert(good.passed);assert(!bad.passed);});
function verify(candidate:typeof baseline){return verifyGenomeLabProgramCandidate({candidate,objective,acceptanceCriteria,constitutionDigest});}
function learned(){const m=new GuardedRepairMemory();const id=m.learn(baseline,reference,good,scope);return {m,id};}
test('learns only an artifact actually matching successful verification',()=>{const {m,id}=learned();assert.match(id,/^[0-9a-f]{64}$/);assert.equal(m.size,1);assert(m.lookup(baseline,bad,scope,'surgical'));});
test('never learns failed verification',()=>{const m=new GuardedRepairMemory();assert.throws(()=>m.learn(baseline,reference,bad,scope));assert.equal(m.size,0);});
test('rejects verified-artifact substitution',()=>{const other=structuredClone(reference);other.files[1].content+='\n// different artifact';assert.throws(()=>new GuardedRepairMemory().learn(baseline,other,good,scope));});
test('rejects protected-test mutation even with spoofed pass',()=>{const other=structuredClone(reference);other.files[2].content+='\n// changed';assert.throws(()=>new GuardedRepairMemory().learn(baseline,other,good,scope));});
for(const key of Object.keys(scope) as (keyof Scope)[])test(`invalidates on ${key} identity change`,()=>{const {m}=learned();assert.equal(m.lookup(baseline,bad,{...scope,[key]:sha256('different')},'surgical'),null);});
test('invalidates source changes, including cosmetic changes',()=>{const {m}=learned();const other=structuredClone(baseline);other.files[1].content+='\n// changed';assert.equal(m.lookup(other,bad,scope,'surgical'),null);});
test('rejects quarantine replay without inventing a diagnosis',()=>{const {m,id}=learned();m.quarantine(id,sha256('actual verifier failure evidence'));assert.equal(m.lookup(baseline,bad,scope,'surgical'),null);});
test('returned proposals cannot mutate retained memory',()=>{const {m}=learned();const p=m.lookup(baseline,bad,scope,'surgical')!;p.changes[0].replacementText='bad';assert.notEqual(m.lookup(baseline,bad,scope,'surgical')!.changes[0].replacementText,'bad');});
test('a reused recipe passes the actual controller with fresh verification',async()=>{const {m}=learned();let verifierCalls=0;const run=await runCodingRepairController({baseline:structuredClone(baseline),verify:async c=>{verifierCalls++;return verify(c);},model:{async propose(r){const p=m.lookup(r.candidate,r.verification,scope,r.strategy);assert(p);return {proposal:p,inputTokens:0,outputTokens:0,accountedCostUsd:0};}}});const final=await verify(run.champion);assert(run.verification.passed);assert(final.passed);assert.equal(final.artifactDigest,good.artifactDigest);assert.equal(verifierCalls,2);assert.equal(run.receipts.length,1);});
