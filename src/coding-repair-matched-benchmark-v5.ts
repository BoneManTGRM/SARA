import { runMatchedCodingRepairBenchmarkV3 } from "./coding-repair-matched-benchmark-v3.ts";

export async function runMatchedCodingRepairBenchmarkV5(
  input: Parameters<typeof runMatchedCodingRepairBenchmarkV3>[0],
) {
  return runMatchedCodingRepairBenchmarkV3(input);
}
