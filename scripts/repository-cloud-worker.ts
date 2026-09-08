import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLOUD_AUDIENCE, CLOUD_MAX_BYTES, cloudRecord } from "../src/repository-cloud-protocol.ts";
import { createRepositoryCloudWorkerEngine, runRepositoryCloudWorker } from "../src/repository-cloud-worker.ts";

const phase = process.argv[2];
if (!["producer", "judge"].includes(phase ?? "") || process.env.GITHUB_REPOSITORY !== "BoneManTGRM/SARA"
  || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_RUN_ATTEMPT !== "1"
  || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || process.env.OPENAI_API_KEY || process.env.SARA_OWNER_TOKEN) throw Error("CLOUD_WORKER_HOST_CONTRACT");
const directory = await mkdtemp(join(tmpdir(), "sara-cloud-worker-"));
let token: { value: string; until: number } | undefined;
async function readJson(response: Response) {
  if (!response.ok || !response.body) throw Error(`CLOUD_HTTP_${response.status}`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const p = await reader.read(); if (p.done) break; bytes += p.value.byteLength;
    if (bytes > CLOUD_MAX_BYTES) throw Error("CLOUD_HTTP_SIZE"); chunks.push(p.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return cloudRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
}
async function oidc() {
  if (token && Date.now() < token.until) return token.value;
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
  if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com") || url.username || url.password
    || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw Error("CLOUD_OIDC_CONFIGURATION");
  url.searchParams.set("audience", CLOUD_AUDIENCE);
  const result = await readJson(await fetch(url, { headers: { authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error", signal: AbortSignal.timeout(10000) }));
  if (typeof result.value !== "string" || result.value.length > 24000) throw Error("CLOUD_OIDC_RESPONSE");
  token = { value: result.value, until: Date.now() + 60000 }; return token.value;
}
async function call(body: Record<string, unknown>) {
  const serialized = JSON.stringify(body);
  for (let retry = 0; ; retry++) {
    try {
      return await readJson(await fetch(CLOUD_AUDIENCE, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${await oidc()}`, "content-type": "application/json" }, body: serialized }));
    } catch (error) {
      // Retry delivery of exactly the same idempotent envelope, never execution.
      if (retry >= 2 || /CLOUD_HTTP_4/.test(String(error))) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
const run = (command: string, args: string[], timeout: number) => promisify(execFile)(command, args,
  { timeout, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" } });
const signal = AbortSignal.timeout(110 * 60000);
await runRepositoryCloudWorker({ phase: phase as "producer" | "judge", call, signal,
  async prepare(assignment) {
    if (assignment.phase !== phase) throw Error("CLOUD_WORKER_PHASE");
    if (phase === "producer") {
      if (!/^ghcr\.io\/bonemantgrm\/sara-swe-public-[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(assignment.environment.image)) throw Error("CLOUD_WORKER_IMAGE");
      await run("docker", ["pull", assignment.environment.image], 15 * 60000);
    } else {
      await run("docker", ["pull", assignment.judge!.image], 15 * 60000);
      if (assignment.judge!.fixtureProxyImage) await run("docker", ["pull", assignment.judge!.fixtureProxyImage], 5 * 60000);
      await run("python3", ["scripts/prepare-cloud-judge.py", "--dataset", join(directory, "judge.parquet")], 5 * 60000);
    }
    return createRepositoryCloudWorkerEngine({ assignment, directory,
      ...(phase === "judge" ? { judge: { datasetPath: join(directory, "judge.parquet"), harnessPath: join(process.env.RUNNER_TEMP!, "harness") } } : {}) });
  },
});
console.log("Repository cloud worker completed its single assigned phase; model credentials remained on the authority.");
