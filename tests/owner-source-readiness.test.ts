import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SaraKernel} from '../src/kernel.ts';
import {sha256} from '../src/canonical.ts';
import {requestsSoftwareInspection,resolveSoftwareTarget} from '../src/owner-software-work.ts';
import type {SoftwareSourceEvidence} from '../src/software-source-reader.ts';
import {createSourceReport} from '../src/owner-source-report.ts';
import {verifySourceReport} from '../src/owner-source-report-verifier.ts';

const revision='a'.repeat(40),repository='BoneManTGRM/Nicos-Adventures';
const request={requestId:'synthetic-source-readiness',text:`Review ${repository} at exact revision ${revision} for release readiness. Gather the source and existing CI evidence yourself. Produce a report with prioritized, source-linked findings, what remains untested, and the next decision.`};
export function sourceFixture():SoftwareSourceEvidence {
 const sourceText=JSON.stringify({name:'synthetic',scripts:{build:'tsc'}});
 return {schemaVersion:1,actor:'SARA_RUNTIME',evidenceLabel:'EXTERNAL_READ_ONLY',collectionMode:'anonymous_read_only',repository:`https://github.com/${repository}`,immutableCommitSha:revision,treeSha:'b'.repeat(40),defaultBranch:'main',collectedAt:'2026-09-14T00:00:00Z',inventoryTruncated:false,files:[{path:'package.json',role:'manifest',gitBlobSha:createHash('sha1').update(`blob ${Buffer.byteLength(sourceText)}\0${sourceText}`).digest('hex'),contentSha256:sha256(sourceText),byteLength:Buffer.byteLength(sourceText),permalink:`https://github.com/${repository}/blob/${revision}/package.json`,sourceText,sourceTruncated:false,trust:'UNTRUSTED_SOURCE'}],ciQueryStatus:'OBSERVED',ciRuns:[{id:42,headSha:revision,name:'Synthetic CI',status:'completed',conclusion:'failure',url:`https://github.com/${repository}/actions/runs/42`}],requestsUsed:5,limitations:['SYNTHETIC test evidence. Bounded selection; unsampled files are unknown.']};
}

test('ordinary readiness wording retains the exact requested revision and source-only scope',()=>{
 assert.equal(requestsSoftwareInspection(request.text),true);
 const resolved=resolveSoftwareTarget(request.text);
 assert.deepEqual(resolved.missing,[]);
 assert.equal((resolved.target as any)?.revision,revision);
 assert.equal(resolved.target?.scope,'INSPECTION');
});

test('independent verifier rejects unsupported claims, wrong scope, omitted failure, corrupt bytes and mismatched CI',()=>{
 const source=sourceFixture(),report=createSourceReport(source);
 assert.deepEqual(verifySourceReport(source,report,source.repository,revision),[]);
 const changed=structuredClone(report);changed.findings[0]!.confidence='POTENTIAL';
 assert.ok(verifySourceReport(source,changed,source.repository,revision).length);
 const omitted=structuredClone(report);omitted.findings=[];
 assert.ok(verifySourceReport(source,omitted,source.repository,revision).length);
 const corrupt=structuredClone(report);corrupt.artifact.markdown+='All application tests passed.';
 corrupt.artifact.sha256=sha256(corrupt.artifact.markdown);corrupt.artifact.byteLength=Buffer.byteLength(corrupt.artifact.markdown);
 assert.ok(verifySourceReport(source,corrupt,source.repository,revision).length);
 assert.ok(verifySourceReport(source,report,'https://github.com/other/repo',revision).length);
 assert.ok(verifySourceReport(source,report,source.repository,'c'.repeat(40)).length);
 const ci=structuredClone(source);ci.ciRuns![0]!.headSha='c'.repeat(40);
 assert.ok(verifySourceReport(ci,createSourceReport(ci),ci.repository,revision).length);
 const bytes=structuredClone(source);bytes.files[0]!.sourceText='{}';
 assert.ok(verifySourceReport(bytes,createSourceReport(bytes),bytes.repository,revision).length);
 const partial=structuredClone(source);partial.files=[];
 assert.ok(verifySourceReport(partial,createSourceReport(partial),partial.repository,revision).length);
});

test('unavailable CI and truncated manifest stay unknown; no fabricated finding quota or browser claim',()=>{
 const source=sourceFixture();source.ciRuns=[];source.ciQueryStatus='UNAVAILABLE';source.files[0]!.sourceTruncated=true;
 const report=createSourceReport(source);
 assert.deepEqual(report.findings,[]);assert.deepEqual(verifySourceReport(source,report,source.repository,revision),[]);
 assert.match(report.artifact.markdown,/No matching CI evidence/);assert.match(report.artifact.markdown,/No supported material findings/);
 assert.match(report.artifact.markdown,/Browser startup and live-site behavior were not tested/);
});

test('conflicting and malformed explicit revisions cannot silently become latest-head inspection',()=>{
 for(const text of [`${request.text} Also revision ${'c'.repeat(40)}.`,`Review repository ${repository} at revision abc123 for release readiness.`])assert.equal(resolveSoftwareTarget(text).target,null);
});

test('SYNTHETIC source-only runtime produces verified durable report and replays after restart without browser or collection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-source-report-'));let collections=0,browsers=0;
 const options={stateDirectory:directory,ownerTokenSha256:sha256('synthetic-owner'),softwareRuntime:{inspectSource:async(_repository:string,_scope:string,options?:{revision?:string})=>{collections++;assert.equal(options?.revision,revision);return sourceFixture();},testJourney:async()=>{browsers++;throw new Error('SYNTHETIC browser unavailable');}}};
 try{
  const kernel=await SaraKernel.boot(options),owner=kernel.authenticateOwnerToken('synthetic-owner');
  const result=await kernel.executeOwnerMessage(owner,request);
  assert.equal(result.status,'COMPLETE');assert.equal(browsers,0);assert.equal(collections,1);
  const source=result.receipts.find(r=>r.capability.id==='software-source-inspector')!.output as any;
  const report=source.evidence.report;
  assert.ok(report.artifact.markdown.includes(revision));
  assert.match(report.artifact.markdown,/failure/);assert.match(report.artifact.markdown,/not executed/i);
  assert.equal(report.artifact.sha256,sha256(report.artifact.markdown));
  assert.equal(report.artifact.byteLength,Buffer.byteLength(report.artifact.markdown));
  const checked=result.receipts.find(r=>r.capability.id==='software-evidence-reviewer')!.output as any;
  assert.equal(checked.evidence.reportSha256,report.artifact.sha256);
  const reboot=await SaraKernel.boot(options);
  const replay=await reboot.resumeOwnerMessage(reboot.authenticateOwnerToken('synthetic-owner'),request.requestId);
  assert.deepEqual(replay.receipts,result.receipts);assert.equal(collections,1);assert.equal(browsers,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
