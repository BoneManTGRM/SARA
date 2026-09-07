import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingDispatchJournal } from "../src/coding-dispatch-journal.ts";
import { inspectExclusiveKernelContinuation } from "../src/coding-benchmark-owner.ts";
import { KERNEL_CODING_BENCHMARK_GRANT as kernelGrant, OBSERVED_REUSE_BENCHMARK_GRANT as componentGrant,
  CODING_BENCHMARK_CONTINUATION } from "../src/coding-benchmark-readiness.ts";
import { writeBenchmarkAudit } from "../src/coding-benchmark-audit.ts";

async function fixture(fn: (directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sara-kernel-integration-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
for (const [active, other] of [[kernelGrant, componentGrant], [componentGrant, kernelGrant]] as const) {
  test(`only one continuation allowance: ${active.benchmarkId} observes every competing claim`, () => fixture(async root => {
    assert.deepEqual(await inspectExclusiveKernelContinuation(root, active.benchmarkId), { benchmarkId: other.benchmarkId, status: "not_started", files: [] });
    const trace = join(root, "coding-repair-benchmarks", other.benchmarkId, "trace");
    await writeBenchmarkAudit(trace, "owner-launch-claim.json", { benchmarkId: other.benchmarkId, replayAllowed: false });
    const status = await inspectExclusiveKernelContinuation(root, active.benchmarkId);
    assert.equal(status?.status, "claimed"); assert.deepEqual(status?.files, ["trace/owner-launch-claim.json"]);
  }));
}
test("partial competing evidence is not treated as a fresh allowance", () => fixture(async root => {
  const trace = join(root,"coding-repair-benchmarks",componentGrant.benchmarkId,"trace");
  await mkdir(trace,{recursive:true});
  const { writeFile } = await import("node:fs/promises"); await writeFile(join(trace,"owner-launch-claim.json"),"{partial");
  assert.equal((await inspectExclusiveKernelContinuation(root,kernelGrant.benchmarkId))?.status,"claimed");
}));
test("historical held grants are outside the new alternatives and stay unmodified", () => fixture(async root => {
  assert.equal(await inspectExclusiveKernelContinuation(root,CODING_BENCHMARK_CONTINUATION.benchmarkId),null);
  assert.equal(CODING_BENCHMARK_CONTINUATION.unresolvedExposureUsd,.15);
}));
test("journal body deadline records uncertainty and never dispatches a retry", () => fixture(async root => {
  const controller = new AbortController(); let calls=0; let timer: ReturnType<typeof setTimeout> | undefined;
  const journal = new CodingDispatchJournal({ directory: join(root,"journal"), beforeDispatch:async()=>{},fetchImpl:async()=>{
    calls++; timer=setTimeout(()=>controller.abort(),20); return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("{"));}}));
  }});
  try {
    await assert.rejects(journal.fetch("https://api.openai.com/v1/responses",{method:"POST",body:"{}",signal:controller.signal}),/ABORTED/);
    assert.equal(journal.snapshot().generationAttempts,1);assert.equal(journal.snapshot().uncertainAttempts,1);
    await assert.rejects(journal.fetch("https://api.openai.com/v1/responses",{method:"POST",body:"{}"}),/CLOSED/);
    assert.equal(calls,1);
  }finally{if(timer)clearTimeout(timer);}
}));
test("journal rejects malformed provider UTF8 instead of hashing replacement text", () => fixture(async root => {
  const journal=new CodingDispatchJournal({directory:join(root,"journal"),beforeDispatch:async()=>{},fetchImpl:async()=>new Response(new Uint8Array([0xff]))});
  await assert.rejects(journal.fetch("https://api.openai.com/v1/responses",{method:"POST",body:"{}"}));
  assert.equal(journal.snapshot().responsesReceived,0);assert.equal(journal.snapshot().uncertainAttempts,1);
}));
test("journal preserves consumed body for caller with request metadata but no source leakage", () => fixture(async root => {
  const secretBody='{"data":"private-candidate-body"}';
  const journal=new CodingDispatchJournal({directory:join(root,"journal"),beforeDispatch:async()=>{},fetchImpl:async()=>new Response(secretBody,{headers:{"x-request-id":"req-integration"}})});
  const response=await journal.fetch("https://api.openai.com/v1/responses",{method:"POST",body:"{}"});
  assert.equal(await response.text(),secretBody);assert.equal(journal.snapshot().responsesReceived,1);
  const {readdir}=await import("node:fs/promises");for(const name of await readdir(join(root,"journal")))assert.doesNotMatch(await readFile(join(root,"journal",name),"utf8"),/private-candidate-body/);
}));
