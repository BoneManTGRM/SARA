// A credential-free subprocess probe; the only side effect is a local marker.
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withCodingBenchmarkExecution, type CodingBenchmarkManifest } from "../../src/coding-repair-benchmark-store.ts";
const [stateDirectory, manifestPath, mode] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CodingBenchmarkManifest;
try {
  await withCodingBenchmarkExecution({ stateDirectory, manifest, execute: async () => {
    await appendFile(join(stateDirectory, "execution-marker.txt"), "executed\n");
    if (mode === "crash") process.exit(57);
  } });
} catch (error) {
  if (error instanceof Error && /claimed|consumed/iu.test(error.message)) process.exitCode = 23;
  else throw error;
}
