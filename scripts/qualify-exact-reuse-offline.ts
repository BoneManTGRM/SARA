import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runKernelCodingBenchmark } from "../src/exact-reuse-kernel-benchmark.ts";
const correct = `export type Booking = Readonly<{start:number;end:number}>;
export type TimeWindow = Readonly<{start:number;end:number}>;
export function freeWindows(dayStart:number,dayEnd:number,bookings:readonly Booking[]):TimeWindow[]{
 if(!Number.isFinite(dayStart)||!Number.isFinite(dayEnd)||dayStart>=dayEnd)return [];
 const busy=bookings.filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start)
 .map(b=>({start:Math.max(dayStart,b.start),end:Math.min(dayEnd,b.end)})).filter(b=>b.end>b.start)
 .sort((a,b)=>a.start-b.start||a.end-b.end);
 let cursor=dayStart;const result:TimeWindow[]=[];
 for(const b of busy){if(b.start>cursor)result.push({start:cursor,end:b.start});cursor=Math.max(cursor,b.end);}
 if(cursor<dayEnd)result.push({start:cursor,end:dayEnd});return result;
}`;
function model(failGeneration = 0) {
  let calls = 0, counts = 0; const prompts: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/input_tokens")) { counts++; return new Response('{"input_tokens":100}'); }
    calls++; prompts.push(body.input);
    assert.equal(body.model, "gpt-5.6-luna"); assert.equal(body.reasoning.effort, "medium"); assert.equal(body.max_output_tokens, 8000);
    assert.doesNotMatch(body.input, /clips, sorts and merges|ignores invalid bookings/);
    if (calls === failGeneration) throw new Error("INJECTED_UNCERTAIN_PROVIDER_REQUEST");
    const p = JSON.parse(body.input.split("\n").slice(2).join("\n"));
    const file = p.files.find((f: {path:string}) => f.path === "src/free-windows.ts"); assert(file);
    const answer = { schemaVersion: 1, baseArtifactDigest: p.currentArtifactDigest,
      failureFingerprint: p.failures[0].fingerprint, strategy: p.requiredStrategy,
      changes: [{ path: file.path, expectedContentDigest: file.contentDigest, replacementText: correct }], limitations: [] };
    return new Response(JSON.stringify({ id: `scripted-${calls}`, model: "gpt-5.6-luna", status: "completed",
      usage: { input_tokens: 100, output_tokens: 80 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] }));
  };
  return { fetchImpl, calls: () => calls, counts: () => counts, prompts };
}

const directory = process.argv[2];
if (!directory) throw new Error("OFFLINE_OUTPUT_REQUIRED");
const stub = model();
await runKernelCodingBenchmark({ directory, benchmarkId: randomUUID(), apiKey: "SCRIPTED_NEVER_LIVE",
  executionKind: "scripted_offline", beforeDispatch: async () => {}, fetchImpl: stub.fetchImpl });
const summary = JSON.parse(await readFile(join(directory,"trace/kernel-summary.json"),"utf8")).payload;
console.log(JSON.stringify({allComplete:summary.allComplete,rows:summary.rows,setupMilliseconds:summary.setupMilliseconds,aggregates:summary.aggregates,classification:"SCRIPTED_OFFLINE_NOT_LUNA"}));
