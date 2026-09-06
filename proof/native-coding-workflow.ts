import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { sha256, canonicalJson } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
import type { WorkerModelClient } from "../src/model-router.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";
import { largeCandidate } from "../tests/helpers/adaptive-repair-fixture.ts";

const output = resolve(process.argv[2] ?? "native-coding-workflow-results");
await mkdir(output, { recursive: false, mode: 0o700 });
const offset = Number(process.argv[3] ?? 0);
const fixtures: ProgramCandidateProposal[] = [
  { schemaVersion: 1, candidateKind: "typescript_program", programName: "Positive total", summary: "Authored workflow fixture", limitations: [], files: [
    { path: "src/index.ts", content: 'export { total } from "./value.ts";' },
    { path: "src/value.ts", content: 'export function total(values: number[]): number { return values.filter(v => v > 0).reduce((s,v) => s+v,0); }' },
    { path: "tests/value.test.ts", content: 'import { total } from "../src/index.ts"; if(total([1,-3,4,0])!==5 || total([])!==0) throw new Error("protected");' }] },
  { schemaVersion: 1, candidateKind: "typescript_program", programName: "Balanced parentheses", summary: "Authored workflow fixture", limitations: [], files: [
    { path: "src/index.ts", content: 'export { balanced } from "./value.ts";' },
    { path: "src/value.ts", content: 'export function balanced(text: string): boolean { let n=0; for (const c of text) { if(c==="(") n++; if(c===")") n--; if(n<0) return false; } return n===0; }' },
    { path: "tests/value.test.ts", content: 'import { balanced } from "../src/index.ts"; if(!balanced("(())") || balanced(")(") || balanced("(()") || !balanced("")) throw new Error("protected");' }] },
  largeCandidate(true, 64),
];
const protocol = { schemaVersion: 1, sourceTree: process.env.SARA_RESEARCH_SOURCE_TREE ?? "unrecorded", offset,
  kind: "ACTUAL_LOCAL_HTTP_KERNEL_SCRIPTED_MODEL_NOT_LIVE_PROVIDER", arms: ["legacy", "native"],
  fixtures: fixtures.map(f => f.programName), episodes: ["cold", "repeat", "type_error", "unresolved"],
  providerCalls: 0, artificialProviderDelays: 0, includeFailures: true,
  description: "Both arms use released adaptive repair/memory behavior, original TS5 final and actual kernel verification. Only repair-loop verification changes. Separate private state per arm. Boot/readiness counted separately. Kernel jobs/HTTP authentication are real local code; revenue and provider responses are test fixtures." };
await writeFile(join(output, "protocol.json"), JSON.stringify(protocol, null, 2));
const rows: Record<string, unknown>[] = [];
const arms = new Map<string, { server: ReturnType<typeof createSaraServer>; kernel: SaraKernel; url: string; calls: number; tokens: number; repair: string; unresolved: boolean; startupMs: number }>();
const token = "local-native-workflow-only", ownerTokenSha256 = sha256(token);
try {
 for (const arm of (offset % 2 ? ["native", "legacy"] : ["legacy", "native"])) {
  const start = performance.now(), stateDirectory = join(output, arm);
  const kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256 });
  await kernel.recordLedgerEntry(kernel.authenticateOwnerToken(token), { kind: "revenue", source: "customer", amountUsd: 1000,
    realized: true, recurringMonthly: false, description: "Synthetic local qualification funding", occurredAt: "2026-09-06T00:00:00.000Z" });
  const data = { kernel, server: null as unknown as ReturnType<typeof createSaraServer>, url: "", calls: 0, tokens: 0, repair: "", unresolved: false, startupMs: 0 };
  const modelClient: WorkerModelClient = { routeKey: "openai:gpt-5.6-luna:paid", maximumWallTimeMs: 1000,
   async countInputTokens() { data.tokens++; return 100; },
   async execute(input) {
    data.calls++;
    const p = JSON.parse(input.prompt.split("\n").slice(2).join("\n"));
    const f = p.files.find((f: { path: string }) => f.path === "src/value.ts");
    const compact = input.prompt.includes("SARA_CODING_REPAIR_EDITS_V1");
    const target = data.unresolved ? 'export const deliberatelyUnresolved: number = "wrong";' : data.repair;
    return { outputText: JSON.stringify({ schemaVersion: 1, baseArtifactDigest: p.currentArtifactDigest,
      failureFingerprint: p.failures[0].fingerprint, strategy: p.requiredStrategy,
      changes: [{ path: f.path, expectedContentDigest: f.contentDigest,
        ...(compact ? { edits: [{ find: f.content, replace: target }] } : { replacementText: target }) }], limitations: [] }), inputTokens: 100, billableOutputTokens: 50 };
   } };
  const nativeVerifier = arm === "native" ? (await NativeCodingVerifier.create())! : undefined;
  data.server = createSaraServer(kernel, { ownerTokenSha256, stateDirectory,
    reparodynamicCoding: { mode: "canary", modelClient, stateDirectory, ...(nativeVerifier ? { nativeVerifier } : {}) } });
  await new Promise<void>(resolve => data.server.listen(0, "127.0.0.1", resolve));
  const address = data.server.address(); assert(address && typeof address !== "string"); data.url = `http://127.0.0.1:${address.port}`;
  data.startupMs = performance.now() - start; arms.set(arm, data);
 }
 for (let i = 0; i < fixtures.length; i++) for (const [e, episode] of protocol.episodes.entries()) {
  const correct = fixtures[i], baseline = structuredClone(correct);
  const source = correct.files.find(f => f.path === "src/value.ts")!;
  const file = baseline.files.find(f => f.path === source.path)!;
  file.content = i === 0 ? source.content.replace("v > 0", "v < 0") : i === 1 ? source.content.replace("n===0", "n!==0") : source.content.replace("Math.min(10,", "Math.min(9,");
  if (episode === "type_error") file.content += '\nexport const typeFault: number = "bad";';
  if (episode === "unresolved") file.content += '\n// deliberately unresolved case, distinct scope';
  const accepted: Record<string, string> = {};
  for (const arm of ((i + e + offset) % 2 ? ["native", "legacy"] : ["legacy", "native"])) {
   const data = arms.get(arm)!; data.repair = source.content; data.unresolved = episode === "unresolved";
   const callBefore = data.calls, tokensBefore = data.tokens, start = performance.now();
   const job = await data.kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: `Repair ${correct.programName}`,
     acceptanceCriteria: ["All original protected tests pass"], requiredCapabilities: [], expectedOwnerValue: 1, maximumBudgetUsd: 0.15 });
   const response = await fetch(`${data.url}/api/jobs/${job.id}/self-build`, { method: "POST",
     headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ proposal: baseline }) });
   const body = await response.json() as { evidence: {attestation: string}; mutation: {stage:string; candidateDigest: string} }; const elapsedMs = performance.now() - start;
   if (episode === "unresolved") assert(response.status >= 400, JSON.stringify(body));
   else { assert.equal(response.status, 201, JSON.stringify(body)); assert.equal(body.evidence.attestation, "kernel_executed");
     assert.equal(body.mutation.stage, "SHADOW"); accepted[arm] = body.mutation.candidateDigest; }
   const row = { fixture: i, episode, arm, elapsedMs, httpStatus: response.status, completed: response.status === 201,
     calls: data.calls - callBefore, tokenCountCalls: data.tokens - tokensBefore, jobId: job.id,
     finalDigest: accepted[arm] ?? null, responseDigest: sha256(canonicalJson(body)) };
   rows.push(row); await writeFile(join(output, `response-${i}-${e}-${arm}.json`), JSON.stringify(body));
   await writeFile(join(output, "rows.json"), JSON.stringify(rows, null, 2)); console.log(JSON.stringify(row));
  }
  if (episode !== "unresolved") assert.equal(accepted.legacy, accepted.native);
 }
 await writeFile(join(output, "completion.json"), JSON.stringify({ complete: true, rows: rows.length,
   startupMs: Object.fromEntries([...arms].map(([name, d]) => [name, d.startupMs])), node: process.version,
   rowsDigest: sha256(canonicalJson(rows)), protocolDigest: sha256(canonicalJson(protocol)) }, null, 2));
} finally { for (const { server } of arms.values()) await new Promise<void>(resolve => server.close(() => resolve())); }
