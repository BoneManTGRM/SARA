import { readFile } from "node:fs/promises";
import { sha256 } from "./canonical.ts";
import { KERNEL_BENCHMARK_PINS } from "./repeat-kernel-pins.ts";

// Offline regression qualification only. Live repeat runs retain their old
// immutable source pins and fail closed on this changed kernel.
export const REPOSITORY_QUALIFICATION_PINS = Object.freeze({ ...KERNEL_BENCHMARK_PINS,
  "src/server.ts": "1a9c6d422ef52e0dad99781c9bca34471fa7236fe36702f980ab40f6f075e6f9",
  "src/main.ts": "b4dd67c4cdad3a9510d4f7d3a95cc2a395f5354e0695852cbc4324b6d641b3e2",
  "src/kernel.ts": "031a925d386321d3eb164aa0c9f36ed3dc5c9f4631bdecf941595b6c96821d5c",
  "src/repository-executor.ts": "c9f1045fbc804a39b98b7983338424357177d26374c8a138eb6644141ab416e3",
  "src/repeat-kernel-benchmark.ts": "6b4385adb6e1b431e1610d96d7654def0b156431688725d3aaad1aa5c26a92a6",
  "src/repository-official-judge.ts": "925a69b848f97a196e81c363cad8ed12f954aabcf1800dce36a2aa9ddd45ab1b",
  "scripts/swe-bench-judge.py": "6e405be3fba63e2bddc86ef6677c62021f7c47e3ac0edde7d461af9478d001bd",
  "scripts/swe-judge-fixture-proxy.py": "4be35347797db03a384d858a393ce3084df8fd38f329a407734699eed3bbd645",
  "scripts/swe-judge-fixture-runtime.py": "1c1dfd992f83e25c0b6fc75d0679aa207f72745f3e011586553f450d4ea259a9",
  "src/observed-reuse-benchmark.ts": "38681ff2cf96c46df503f31b33fb7c861cbad8613847514a19489cde7d3bec8f",
  "src/benchmark-dispatch-budget.ts": "a2ff33a296ae4696193c091cd94344627090810a2572d07b874be0fe5d181006",
  "src/repository-producer.ts": "43e7577723f987736fd0b7fcd3665659b657d3002bc7a11ccc0a251694bcbc08",
  "src/repository-comparison.ts": "fa9d3cabfcd25d501db4adba68243275dd915628a249d89b034b6bcfb6cbcec9",
  "src/repository-luna-model.ts": "6f7b048e4920ea87686a4f75ee6207485acffbf630abe1407f2f1506df141f45",
  "src/repository-benchmark-permit.ts": "941d9cf4563117bee9b35da4e91779545797cae88aa7e63ada13444b055e2e0b",
  "src/repository-benchmark-runner.ts": "4cfa935bdc66ee13dab80de54cb7f933a230bbfae7ca4c1cb813fd0548f9681c",
});
export async function assertRepositoryQualificationImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(REPOSITORY_QUALIFICATION_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error(`REPOSITORY_QUALIFICATION_SOURCE_DRIFT:${path}`);
  }
}
