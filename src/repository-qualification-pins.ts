import { readFile } from "node:fs/promises";
import { sha256 } from "./canonical.ts";
import { KERNEL_BENCHMARK_PINS } from "./repeat-kernel-pins.ts";

// Offline regression qualification only. Live repeat runs retain their old
// immutable source pins and fail closed on this changed kernel.
export const REPOSITORY_QUALIFICATION_PINS = Object.freeze({ ...KERNEL_BENCHMARK_PINS,
  "src/kernel.ts": "62e1d374f19d5d566e92f5e71ff4e7e4920d93c80cd8d20084d2715410e36f38",
  "src/repository-executor.ts": "069dfd230a954aff37c5cf8f207105e9ec627858ec36054b811031c9d4a105bf",
  "src/repeat-kernel-benchmark.ts": "6b4385adb6e1b431e1610d96d7654def0b156431688725d3aaad1aa5c26a92a6",
  "src/repository-official-judge.ts": "2a46f37dad012746fcfaeacca97c58f70d339f9e9a764e7d3baf5b036f8c7018",
  "scripts/swe-bench-judge.py": "7c84fdefd06fad4665362419145ba737c4801064189ab7dceee33789b509ab0d",
});
export async function assertRepositoryQualificationImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(REPOSITORY_QUALIFICATION_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error(`REPOSITORY_QUALIFICATION_SOURCE_DRIFT:${path}`);
  }
}
