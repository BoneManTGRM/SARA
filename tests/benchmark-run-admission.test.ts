import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { benchmarkClaimKey, claimBenchmarkRun } from "../proof/benchmark-run-admission.ts";
const retired="88674aed1970e107e1e92aec10f8cfc52f58f0b8f757d42883f45ef0128c18c1";
function input(directory:string){return {ledgerDirectory:directory,grant:{experimentId:"offline-admission-test",contractDigest:"a".repeat(64),implementationCommit:"b".repeat(40),deploymentId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",expiresAt:2000,maximumPhysicalSpendUsd:0.15},observed:{contractDigest:"a".repeat(64),implementationCommit:"b".repeat(40),deploymentId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},now:1000};}
async function directoryTest(fn:(directory:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),"sara-admission-test-"));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test("denies consumed V7 contract before claiming anything",()=>directoryTest(async d=>{const x=input(d);x.grant.contractDigest=retired;x.observed.contractDigest=retired;await assert.rejects(()=>claimBenchmarkRun(x),/RETIRED_CONTRACT/u);assert.deepEqual(await readdir(d),[]);}));
for(const field of ["contractDigest","implementationCommit","deploymentId"] as const)test(`denies ${field} mismatch without touching ledger`,()=>directoryTest(async d=>{const x=input(d);x.observed[field]=field==="deploymentId"?"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb":"c".repeat(field==="contractDigest"?64:40);await assert.rejects(()=>claimBenchmarkRun(x),/IDENTITY_MISMATCH/u);assert.deepEqual(await readdir(d),[]);}));
test("requires an explicit external ledger; never falls back to container tmp",async()=>{const x=input("");await assert.rejects(()=>claimBenchmarkRun(x),/LEDGER_REQUIRED/u);});
test("expired grants cannot run",()=>directoryTest(async d=>{const x=input(d);x.now=x.grant.expiresAt;await assert.rejects(()=>claimBenchmarkRun(x),/EXPIRED_GRANT/u);}));
test("budget cannot increase",()=>directoryTest(async d=>{const x=input(d);x.grant.maximumPhysicalSpendUsd=0.16;await assert.rejects(()=>claimBenchmarkRun(x),/INVALID_GRANT/u);}));
test("atomic claim admits only one concurrent launch and survives a new invocation",()=>directoryTest(async d=>{
 const x=input(d);const attempts=await Promise.allSettled(Array.from({length:12},()=>claimBenchmarkRun(x)));
 assert.equal(attempts.filter(a=>a.status==="fulfilled").length,1);
 const names=await readdir(d);assert.equal(names.length,1);const record=JSON.parse(await readFile(join(d,names[0]),"utf8"));assert.equal(record.maximumPhysicalSpendUsd,0.15);
 await assert.rejects(()=>claimBenchmarkRun(input(d)),/ALREADY_CLAIMED/u);
 const changed=input(d);changed.grant.deploymentId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";changed.observed.deploymentId=changed.grant.deploymentId;
 await assert.rejects(()=>claimBenchmarkRun(changed),/ALREADY_CLAIMED/u);
}));
test("renaming an experiment cannot replay the same contract",()=>directoryTest(async d=>{
 const first=input(d);await claimBenchmarkRun(first);
 const renamed=input(d);renamed.grant.experimentId="renamed-experiment";
 await assert.rejects(()=>claimBenchmarkRun(renamed),/ALREADY_CLAIMED/u);
 assert.equal((await readdir(d)).length,1);
}));
test("an incomplete claim still blocks rather than granting a replay",()=>directoryTest(async d=>{
 const {writeFile}=await import("node:fs/promises");const x=input(d);const key=benchmarkClaimKey(x.grant.contractDigest);
 await writeFile(join(d,key+".json"),"partial",{mode:0o600});await assert.rejects(()=>claimBenchmarkRun(x),/ALREADY_CLAIMED/u);
}));
test("rejects a disposable Railway process instead of using its ephemeral ledger",()=>directoryTest(async d=>{
 const previous=process.env.RAILWAY_DEPLOYMENT_ID;process.env.RAILWAY_DEPLOYMENT_ID=input(d).grant.deploymentId;
 try{await assert.rejects(()=>claimBenchmarkRun(input(d)),/EXTERNAL_SUPERVISOR_REQUIRED/u);}finally{if(previous===undefined)delete process.env.RAILWAY_DEPLOYMENT_ID;else process.env.RAILWAY_DEPLOYMENT_ID=previous;}
}));
test("two independent processes cannot both consume the same grant",()=>directoryTest(async d=>{
 const {execFile}=await import("node:child_process");const {promisify}=await import("node:util");const run=promisify(execFile);
 const code=`import {claimBenchmarkRun} from './proof/benchmark-run-admission.ts'; try { await claimBenchmarkRun(${JSON.stringify(input(d))}); console.log('CLAIMED'); } catch(e) { console.log(e.message); }`;
 const results=await Promise.all([1,2].map(()=>run(process.execPath,["--import","tsx","--input-type=module","-e",code],{env:{PATH:process.env.PATH},timeout:10000})));
 assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),["ALREADY_CLAIMED","CLAIMED"]);
}));
test("refuses missing, symlinked or permissive ledger directories",()=>directoryTest(async d=>{
 const {chmod,symlink,mkdir}=await import("node:fs/promises");await assert.rejects(()=>claimBenchmarkRun(input(join(d,"missing"))),/LEDGER_UNAVAILABLE/u);
 const ledger=join(d,"ledger");await mkdir(ledger,{mode:0o700});const link=join(d,"link");await symlink(ledger,link);await assert.rejects(()=>claimBenchmarkRun(input(link)),/LEDGER_UNAVAILABLE/u);
 await chmod(ledger,0o777);await assert.rejects(()=>claimBenchmarkRun(input(ledger)),/LEDGER_UNAVAILABLE/u);
}));
