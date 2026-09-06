import { readFile } from "node:fs/promises";
import { canonicalJson, sha256 } from "./canonical.ts";
import { LIVE_CODING_BENCHMARK_CORPUS, LIVE_CODING_BENCHMARK_PROTECTED_FILES } from "./coding-repair-live-benchmark-case.ts";
import { runCodingBenchmarkArm } from "./current-coding-benchmark-runner.ts";
import { createLunaCodingRepairModel } from "./luna-coding-repair-model.ts";
import { createAdaptiveCodingRepairModel } from "./adaptive-coding-repair-model.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";
import { codingTypecheckHost } from "./fresh-typecheck-host.ts";
import { codingRepairCandidateDigest } from "./experimental-v5/coding-repair-verification.ts";
import type { NativeCodingVerifier } from "./native-coding-verifier.ts";
import type { WorkerModelClient } from "./model-router.ts";
import type { ProgramCandidateProposal } from "./types.ts";
import type { ProgramVerificationResult } from "./coding-repair-types.ts";

export const CURRENT_COMPONENT_PINS: Readonly<Record<string, string>> = Object.freeze({
  "src/coding-repair-controller.ts": "39e65a56c55887cddaedca740c6b5f9edcaccb90e702c3ed744ae5d3a302df95",
  "src/coding-repair-benchmark-runner.ts": "3f8e379315de19805ebcf3f08bfce1e46b3597f2a85ff38ed75cbe6f9fbb0b88",
  "src/coding-repair-live-benchmark-case.ts": "5f7447e5891014dea5a9e846ef4734303b53146a0c30c16f43447ff65015d752",
  "src/luna-coding-repair-model.ts": "89604cbd580ab462327d8842355367a15bbaeaec553b01eab984d2bafcbfe2bb",
  "src/adaptive-coding-repair-model.ts": "54659c595bf4067018a7502a6b3caf7b49e3e81cc00bf87c01521a61b063fa12",
  "src/native-coding-verifier.ts": "ad7842db6ec189a0687abec3489b9a1d5c821f2229b5e53afdcc52e8fd2d3364",
  "src/fresh-typecheck-host.ts": "60d416068edd83c8c1e307a025fd9eac26306acbb66a3d6143e128c1b6c25376",
  "src/genome-lab-verifier.ts": "6c3618bd6ffac193265dd7f687388543a41d059b625ad1cdc800dc5f115721c9",
  "src/genome-lab.ts": "ab1427a29742c1f657df3544e36197fa6dfa7a0103c472faa4618e18fe0692da",
  "src/coding-repair-policy.ts": "f24b1fe0e91a8fa2e1472eeb4e998a7b24950947111cb36509e594203ce321cf",
  "src/coding-repair-prompt.ts": "3a0d72545d0c26823e09a0fd8f837c9c48854e4726aad3af1ff14b8a82d97e57",
  "src/openai-worker.ts": "2ba236b2c5fc27948e36bc80e9f5b694c09636616f18d4d2ea875db3a856ba29",
  "src/model-router.ts": "8431213cab7d59c6a5c307c1051aa853c259f4103a28f6d7b4a0ca6fea534699",
  "src/kernel.ts": "5a8b43f02dec91fd13bd389fd685fed6f9242dbe699e4e600bf7f96d30b513bb",
  "src/server.ts": "f5fd34325bda481675c09de3bbc60dd4eae0007111a16eef3211604fc76248e7",
  "package.json": "f4dad9294070b398d28663ac878bf68ee12cdeedbcadcf83f28b49819d21504b",
  "package-lock.json": "2af53c1b9447041cb7bc2ed9526f9c3fde51f395fb5a19c8482c90c35552bf0e",
  "tools/native-checker/package-lock.json": "9b4a2c83fe958e49d19019593cbfc1026424a70edf9e4c243b2cf8de15abe44a",
  "tools/native-checker/integrity.json": "4429dc7b890f14428b3ffc8fc629c4c7c2bfe21a15121a4b97d1e583c1d4e7a2"
});
export async function assertCurrentImplementation(): Promise<void> {
  for (const [path, digest] of Object.entries(CURRENT_COMPONENT_PINS)) {
    if (sha256(await readFile(new URL(`../${path}`, import.meta.url))) !== digest) throw new Error("CURRENT_PILOT_COMPONENT_DRIFT");
  }
}
export function currentBenchmarkCase() {
  const task = structuredClone(LIVE_CODING_BENCHMARK_CORPUS.cases[0]!);
  task.caseId = "current-free-windows-001";
  // Internal candidate includes protected tests for the current digest contract.
  // Existing prompt builder omits all tests. They are never supplied as feedback.
  task.baseline.files.push(...structuredClone(LIVE_CODING_BENCHMARK_PROTECTED_FILES));
  return task;
}
function guard(candidate: ProgramCandidateProposal): void {
  const baseline = currentBenchmarkCase().baseline;
  if (candidate.files.length !== baseline.files.length || new Set(candidate.files.map(f => f.path)).size !== candidate.files.length ||
      candidate.files.some(f => !baseline.files.some(b => b.path === f.path))) throw new Error("CURRENT_PILOT_FILE_SCOPE");
  for (const original of LIVE_CODING_BENCHMARK_PROTECTED_FILES) {
    if (candidate.files.find(f => f.path === original.path)?.content !== original.content) throw new Error("CURRENT_PILOT_PROTECTED_TEST_CHANGED");
  }
}
function redacted(value: ProgramVerificationResult): ProgramVerificationResult {
  const hidden = value.failures.filter(f => f.file.startsWith("tests/"));
  if (!hidden.length) return value;
  const code = "PROTECTED_ACCEPTANCE_FAILURE";
  const evidenceDigest = sha256(canonicalJson({ code, artifactDigest: value.artifactDigest }));
  return { ...value, failures: [...value.failures.filter(f => !f.file.startsWith("tests/")), {
    kind: "behavior", code, file: "", line: 0, column: 0, severity: "high", existedBeforeRepair: true,
    evidenceDigest, fingerprint: evidenceDigest,
  }], evidenceDigests: [evidenceDigest] };
}
type OldInput = Parameters<typeof runCodingBenchmarkArm>[0];
export async function runCurrentCodingBenchmarkArm(input: Omit<OldInput, "model" | "verify" | "verifyFinal"> & {
  client: WorkerModelClient; native: Pick<NativeCodingVerifier, "verify">;
  beforeDispatch(): Promise<void>;
}): Promise<Awaited<ReturnType<typeof runCodingBenchmarkArm>>> {
  input = { ...input, ...(input.limits ? { limits: structuredClone(input.limits) } : {}) };
  const started = performance.now();
  const task = structuredClone(input.benchmarkCase), context = structuredClone(input.context);
  if (canonicalJson(task) !== canonicalJson(currentBenchmarkCase())) throw new Error("CURRENT_PILOT_TASK_DRIFT");
  const seen = new Map<string, ProgramCandidateProposal>();
  const verify = async (candidate: ProgramCandidateProposal, phase: "loop" | "final" | "independent") => {
    candidate = structuredClone(candidate); guard(candidate); await input.beforeDispatch();
    const args = { candidate, objective: context.objective, acceptanceCriteria: context.acceptanceCriteria, constitutionDigest: context.constitutionDigest };
    const result = redacted(await (phase === "loop" && input.method === "luna_reparodynamic"
      ? input.native.verify(args, input.beforeDispatch)
      : verifyGenomeLabProgramCandidate({ ...args, ...(phase === "final" ? { experimentalCompilerCache: codingTypecheckHost("canary") } : {}) })));
    if (result.artifactDigest !== codingRepairCandidateDigest(candidate)) throw new Error("CURRENT_PILOT_ARTIFACT_MISMATCH");
    seen.set(result.artifactDigest, structuredClone(candidate));
    return result;
  };
  const model = input.method === "luna_reparodynamic"
    ? createAdaptiveCodingRepairModel({ client: input.client, context,
      onFormat: decision => input.onEvidence?.("model_request", { phase: "format_intent_before_dispatch", decision }) })
    : createLunaCodingRepairModel({ client: input.client, context });
  const result = await runCodingBenchmarkArm({ method: input.method, benchmarkCase: task, context, limits: input.limits,
    model, verify: candidate => verify(candidate, "loop"), verifyFinal: candidate => verify(candidate, "final"),
    onEvidence: input.onEvidence });
  const finalCandidate = seen.get(result.finalArtifactDigest);
  if (!finalCandidate) throw new Error("CURRENT_PILOT_FINAL_SOURCE_MISSING");
  // Separate fresh original check; this is NOT a kernel mutation or promotion.
  const final = await verify(finalCandidate, "independent");
  await input.onEvidence?.("verification", { phase: "independent_default_TS5", candidate: finalCandidate, verification: final });
  return { ...result, verifiedComplete: result.verifiedComplete && final.passed,
    finalScore: final.score, finalArtifactDigest: final.artifactDigest,
    failureCode: result.verifiedComplete && !final.passed ? "independent_verification_failed" : result.failureCode,
    verifierEvidenceDigests: [...new Set([...result.verifierEvidenceDigests, ...final.evidenceDigests])],
    activeExecutionMilliseconds: Math.max(.001, performance.now() - started) };
}
