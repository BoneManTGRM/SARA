import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { canonicalJson } from "../src/canonical.ts";
import { launchOwnerSupervisedBenchmarkOnce } from "../proof/benchmark-run-supervisor.ts";

const run = promisify(execFile);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sara-supervisor-"));
  await mkdir(join(root, "proof"));
  await mkdir(join(root, "ledger"), { mode: 0o700 });
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  await run("git", ["config", "user.name", "test"], { cwd: root });
  const runner = "export const marker=1;\n";
  const contract = { schemaVersion: 1, caseId: "future-case" };
  await writeFile(join(root, "proof/runner.ts"), runner);
  await writeFile(join(root, "proof/contract.json"), JSON.stringify(contract));
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-qm", "fixture"], { cwd: root });
  const head = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  return {
    root,
    input: {
      repoRoot: root,
      ledgerDirectory: join(root, "ledger"),
      grant: { experimentId:"future-case", contractDigest:digest(canonicalJson(contract)), implementationCommit:head,
        deploymentId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt:2000, maximumPhysicalSpendUsd:0.15 },
      contractPath:"proof/contract.json", runnerPath:"proof/runner.ts", runnerDigest:digest(runner), apiKey:"test-secret", now:1000,
    },
  };
}

async function withFixture(fn:(x:Awaited<ReturnType<typeof fixture>>)=>Promise<void>) {
  const x=await fixture(); try { await fn(x); } finally { await rm(x.root,{recursive:true,force:true}); }
}

test("executes one exact source with a minimal secret-bearing environment",()=>withFixture(async({input})=>{
  let seen:any;
  await launchOwnerSupervisedBenchmarkOnce({...input,execute:async value=>{seen=value;return 0;}});
  assert.equal(seen.env.OPENAI_API_KEY,"test-secret");
  assert.equal(seen.env.SARA_BENCHMARK_COMMIT_SHA,input.grant.implementationCommit);
  assert.equal(seen.env.RAILWAY_DEPLOYMENT_ID,undefined);
  assert.deepEqual(Object.keys(seen.env).sort(),["NODE_ENV","OPENAI_API_KEY","SARA_BENCHMARK_COMMIT_SHA","SARA_OWNER_SUPERVISED"].sort());
  assert.equal((await readdir(input.ledgerDirectory)).length,1);
}));

test("a failed child still consumes the contract and cannot be replayed",()=>withFixture(async({input})=>{
  await assert.rejects(()=>launchOwnerSupervisedBenchmarkOnce({...input,execute:async()=>7}),/BENCHMARK_CHILD_FAILED/u);
  await assert.rejects(()=>launchOwnerSupervisedBenchmarkOnce({...input,execute:async()=>0}),/ALREADY_CLAIMED/u);
}));

test("source, contract and runner identity mismatches fail before claiming",()=>withFixture(async({root,input})=>{
  await assert.rejects(()=>launchOwnerSupervisedBenchmarkOnce({...input,runnerDigest:"c".repeat(64),execute:async()=>0}),/RUNNER_IDENTITY_MISMATCH/u);
  assert.deepEqual(await readdir(input.ledgerDirectory),[]);
  await writeFile(join(root,"proof/contract.json"),JSON.stringify({schemaVersion:1,caseId:"changed"}));
  await assert.rejects(()=>launchOwnerSupervisedBenchmarkOnce({...input,execute:async()=>0}),/CONTRACT_IDENTITY_MISMATCH/u);
  assert.deepEqual(await readdir(input.ledgerDirectory),[]);
}));

test("Railway environment cannot act as the owner supervisor",()=>withFixture(async({input})=>{
  const old=process.env.RAILWAY_PROJECT_ID; process.env.RAILWAY_PROJECT_ID="project";
  try { await assert.rejects(()=>launchOwnerSupervisedBenchmarkOnce({...input,execute:async()=>0}),/EXTERNAL_SUPERVISOR_REQUIRED/u); }
  finally { if(old===undefined) delete process.env.RAILWAY_PROJECT_ID; else process.env.RAILWAY_PROJECT_ID=old; }
  assert.deepEqual(await readdir(input.ledgerDirectory),[]);
}));

test("provider key and arbitrary parent environment are not persisted or forwarded",()=>withFixture(async({input})=>{
  const old=process.env.PRIVATE_SENTINEL;process.env.PRIVATE_SENTINEL="do-not-forward";let seen:any;
  try { await launchOwnerSupervisedBenchmarkOnce({...input,execute:async value=>{seen=value;return 0;}}); }
  finally { if(old===undefined) delete process.env.PRIVATE_SENTINEL; else process.env.PRIVATE_SENTINEL=old; }
  assert.equal(seen.env.PRIVATE_SENTINEL,undefined);
  const names=await readdir(input.ledgerDirectory);assert.equal(names.length,1);
  const ledger=await import("node:fs/promises").then(fs=>fs.readFile(join(input.ledgerDirectory,names[0]),"utf8"));
  assert(!ledger.includes("test-secret"));assert(!ledger.includes("do-not-forward"));
}));
