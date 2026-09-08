import { readFile } from "node:fs/promises";
import { sha256 } from "./canonical.ts";
import { KERNEL_BENCHMARK_PINS } from "./repeat-kernel-pins.ts";

// Offline regression qualification only. Live repeat runs retain their old
// immutable source pins and fail closed on this changed kernel.
export const REPOSITORY_QUALIFICATION_PINS = Object.freeze({ ...KERNEL_BENCHMARK_PINS,
  "src/server.ts": "1a9c6d422ef52e0dad99781c9bca34471fa7236fe36702f980ab40f6f075e6f9",
  "src/main.ts": "b4dd67c4cdad3a9510d4f7d3a95cc2a395f5354e0695852cbc4324b6d641b3e2",
  "src/kernel.ts": "1d188d1b12490c81cd6888da26b251fe4e3ef370af08939c7e1d5960d996bc70",
  "src/repository-executor.ts": "069dfd230a954aff37c5cf8f207105e9ec627858ec36054b811031c9d4a105bf",
  "src/repeat-kernel-benchmark.ts": "6b4385adb6e1b431e1610d96d7654def0b156431688725d3aaad1aa5c26a92a6",
  "src/repository-official-judge.ts": "2a46f37dad012746fcfaeacca97c58f70d339f9e9a764e7d3baf5b036f8c7018",
  "scripts/swe-bench-judge.py": "6b5887a9cea4e6ecf124e0a7b82601ec2f7187e580a6591a8c44329d77b90a66",
});
export async function assertRepositoryQualificationImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(REPOSITORY_QUALIFICATION_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error(`REPOSITORY_QUALIFICATION_SOURCE_DRIFT:${path}`);
  }
}
