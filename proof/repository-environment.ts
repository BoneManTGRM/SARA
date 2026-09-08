import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { RepositorySession, type RepositoryEnvironment } from "../src/repository-executor.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Environment JSON and output directory required");
await mkdir(output, { recursive: true });
const environment = JSON.parse(await readFile(input, "utf8")) as RepositoryEnvironment;
let session: RepositorySession | undefined;
const receipt = { environment, environmentPrepared: false, publicTestsPassed: false,
  modelRequests: 0, benchmarkAttempts: 0, error: null as string | null, exitCode: null as number | null };
// Host-selected read-only diagnostics: an exec child can be OOM-killed while
// the container's sleep process survives. Preserve cgroup counters before
// cleanup; Docker's container-level OOMKilled field alone misses this case.
const resourceCommand = ["sh", "-c", "for name in memory.current memory.peak memory.max memory.events pids.current pids.max pids.events; do file=/sys/fs/cgroup/$name; if test -r \"$file\"; then printf '%s\\n' \"$name\"; cat \"$file\"; fi; done"];
async function recordResources(label: string) {
  try {
    if (!session) return;
    const result = await session.run(resourceCommand);
    await writeFile(join(output, `resources-${label}.log`), result.output);
    console.log(`PUBLIC_ENVIRONMENT_RESOURCES_${label.toUpperCase()}\n${result.output}`);
  } catch {
    // Diagnostics never turn a failed test into a pass or replace its receipt.
    await writeFile(join(output, `resources-${label}.log`), "RESOURCE_DIAGNOSTICS_UNAVAILABLE\n");
  }
}
try {
  session = await RepositorySession.start(environment);
  receipt.environmentPrepared = true;
  await recordResources("before");
  const result = await session.run(environment.publicTestCommand);
  await writeFile(join(output, "public-tests.log"), result.output);
  receipt.exitCode = result.exitCode;
  receipt.publicTestsPassed = result.exitCode === 0;
} catch (error) { receipt.error = error instanceof Error ? error.message : "PREPARATION_FAILED"; }
finally {
  await recordResources("after");
  try { await session?.close(); } catch (error) { receipt.error = `CLEANUP_FAILED:${String(error)}`; receipt.publicTestsPassed = false; }
  await writeFile(join(output, "public-environment-receipt.json"), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify(receipt));
process.exitCode = receipt.environmentPrepared && receipt.publicTestsPassed ? 0 : 1;
