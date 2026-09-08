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
try {
  session = await RepositorySession.start(environment);
  receipt.environmentPrepared = true;
  const result = await session.run(environment.publicTestCommand);
  await writeFile(join(output, "public-tests.log"), result.output);
  receipt.exitCode = result.exitCode;
  receipt.publicTestsPassed = result.exitCode === 0;
} catch (error) { receipt.error = error instanceof Error ? error.message : "PREPARATION_FAILED"; }
finally {
  try { await session?.close(); } catch (error) { receipt.error = `CLEANUP_FAILED:${String(error)}`; receipt.publicTestsPassed = false; }
  await writeFile(join(output, "public-environment-receipt.json"), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify(receipt));
process.exitCode = receipt.environmentPrepared && receipt.publicTestsPassed ? 0 : 1;
