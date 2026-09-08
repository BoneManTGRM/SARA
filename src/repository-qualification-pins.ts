import { readFile } from "node:fs/promises";
import { sha256 } from "./canonical.ts";
import { KERNEL_BENCHMARK_PINS } from "./repeat-kernel-pins.ts";

// Offline regression qualification only. Live repeat runs retain their old
// immutable source pins and fail closed on this changed kernel.
export const REPOSITORY_QUALIFICATION_PINS = Object.freeze({ ...KERNEL_BENCHMARK_PINS,
  "src/server.ts": "1a9c6d422ef52e0dad99781c9bca34471fa7236fe36702f980ab40f6f075e6f9",
  "src/main.ts": "b4dd67c4cdad3a9510d4f7d3a95cc2a395f5354e0695852cbc4324b6d641b3e2",
  "src/kernel.ts": "031a925d386321d3eb164aa0c9f36ed3dc5c9f4631bdecf941595b6c96821d5c",
  "src/repository-executor.ts": "a28b05949025544860583214f39189bc7a15740dac5875616a9f5d189618f98d",
  "src/repeat-kernel-benchmark.ts": "6b4385adb6e1b431e1610d96d7654def0b156431688725d3aaad1aa5c26a92a6",
  "src/repository-official-judge.ts": "925a69b848f97a196e81c363cad8ed12f954aabcf1800dce36a2aa9ddd45ab1b",
  "scripts/swe-bench-judge.py": "6e405be3fba63e2bddc86ef6677c62021f7c47e3ac0edde7d461af9478d001bd",
  "scripts/swe-judge-fixture-proxy.py": "4be35347797db03a384d858a393ce3084df8fd38f329a407734699eed3bbd645",
  "scripts/swe-judge-fixture-runtime.py": "1c1dfd992f83e25c0b6fc75d0679aa207f72745f3e011586553f450d4ea259a9",
  "src/observed-reuse-benchmark.ts": "38681ff2cf96c46df503f31b33fb7c861cbad8613847514a19489cde7d3bec8f",
  "src/benchmark-dispatch-budget.ts": "b5563467a3d935720527e6bd40d407080255d288ae8775db5cf6f8ffb204c2b7",
  "src/repository-producer.ts": "ebd51c94a5a48571ad61233e12d02a2ccffe97d568f8640b79c01ad72e5b6e21",
  "src/repository-comparison.ts": "fa9d3cabfcd25d501db4adba68243275dd915628a249d89b034b6bcfb6cbcec9",
  "src/repository-luna-model.ts": "51bc8eb8729f16994e7620505de820890de52818dd3eb0feee5e46af185914a9",
  "src/repository-benchmark-permit.ts": "941d9cf4563117bee9b35da4e91779545797cae88aa7e63ada13444b055e2e0b",
  "src/repository-benchmark-runner.ts": "4cfa935bdc66ee13dab80de54cb7f933a230bbfae7ca4c1cb813fd0548f9681c",
});
export async function assertRepositoryQualificationImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(REPOSITORY_QUALIFICATION_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error(`REPOSITORY_QUALIFICATION_SOURCE_DRIFT:${path}`);
  }
}
