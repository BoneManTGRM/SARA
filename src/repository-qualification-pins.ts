import { readFile } from "node:fs/promises";
import { sha256 } from "./canonical.ts";
import { KERNEL_BENCHMARK_PINS } from "./repeat-kernel-pins.ts";

// Offline regression qualification only. Live repeat runs retain their old
// immutable source pins and fail closed on this changed kernel.
export const REPOSITORY_QUALIFICATION_PINS = Object.freeze({ ...KERNEL_BENCHMARK_PINS,
  "src/server.ts": "0a46b8e34b0bfafb0b6c9a4ddf3b75670099c133c6428751c9fd5f4cfc8aa8e4",
  "src/main.ts": "5e154b711c8e0ad2053027f69d6b778e41bfaca0087030f780e5d160f5c49455",
  "src/kernel.ts": "798f4d7c5c4183f2e79044aee38e2528e06762f2df580f5391b19f115670824a",
  "src/repository-executor.ts": "1511d2bb10df04735d72932e98347a79c373f43ccc4d3fdb47a1fedd1180b7e5",
  "src/repeat-kernel-benchmark.ts": "6b4385adb6e1b431e1610d96d7654def0b156431688725d3aaad1aa5c26a92a6",
  "src/repository-official-judge.ts": "8ce923961c6d64f33eb71f259ffe48d2d515ca0c7ae256325d5081f8b02fb506",
  "scripts/swe-bench-judge.py": "6e405be3fba63e2bddc86ef6677c62021f7c47e3ac0edde7d461af9478d001bd",
  "scripts/swe-judge-fixture-proxy.py": "4be35347797db03a384d858a393ce3084df8fd38f329a407734699eed3bbd645",
  "scripts/swe-judge-fixture-runtime.py": "1c1dfd992f83e25c0b6fc75d0679aa207f72745f3e011586553f450d4ea259a9",
  "src/observed-reuse-benchmark.ts": "38681ff2cf96c46df503f31b33fb7c861cbad8613847514a19489cde7d3bec8f",
  "src/benchmark-dispatch-budget.ts": "b5563467a3d935720527e6bd40d407080255d288ae8775db5cf6f8ffb204c2b7",
  "src/repository-producer.ts": "ebd51c94a5a48571ad61233e12d02a2ccffe97d568f8640b79c01ad72e5b6e21",
  "src/repository-comparison.ts": "fa9d3cabfcd25d501db4adba68243275dd915628a249d89b034b6bcfb6cbcec9",
  "src/repository-luna-model.ts": "51bc8eb8729f16994e7620505de820890de52818dd3eb0feee5e46af185914a9",
  "src/repository-benchmark-permit.ts": "941d9cf4563117bee9b35da4e91779545797cae88aa7e63ada13444b055e2e0b",
  "src/repository-benchmark-runner.ts": "693e351847f7f084e172778c49b755287950624c4653dbea4eb8a605660a56e0",
  "src/repository-cloud-auth.ts": "6ea46b9d884b08757ec9b0b117564813905f3096b8757b2dfae764f7193bcd15",
  "src/repository-cloud-broker.ts": "814eb12eff05b1ae6fa8f464a2a4242fdeae6ff8a06835939752e8eb6fb358d3",
  "src/repository-cloud-files.ts": "ec8c785fb47a654d576bc0a672217e3956d80b3164773fe40757d719f5387838",
  "src/repository-cloud-package.ts": "23c8be65028114f5e4eeb98ce7214210bbc216d3fcbee91b220df0c412b1a68d",
  "src/repository-cloud-protocol.ts": "9ea851bad30121f1d5ce22c036909e98cc635b5fb875e3afe2496f907211c25b",
  "src/repository-cloud-runtime.ts": "43cc855b254b746a933a68fb1846f2da61ddcfd039c8bd0abd13c62f99f00dac",
  "src/repository-cloud-worker.ts": "a46f5dd3312c1f023106f1d2d4fe439ec578042bc418c8c00d37bf97eebed2aa",
  "scripts/repository-cloud-worker.ts": "0821fec26de15277a2a33ce77a3d755c8b2afa024ffa1fee20a896b4d65cf6e9",
  "scripts/prepare-cloud-judge.py": "c780459567b09a5b4f51842fae8fd356399d1867b3fabc0dd7edb8a020ed2a5a",
});
export async function assertRepositoryQualificationImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(REPOSITORY_QUALIFICATION_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error(`REPOSITORY_QUALIFICATION_SOURCE_DRIFT:${path}`);
  }
}
