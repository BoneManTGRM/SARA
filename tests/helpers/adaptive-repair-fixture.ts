import { sha256 } from "../../src/canonical.ts";
import type { CodingRepairModel } from "../../src/coding-repair-controller.ts";
import type { ProgramCandidateProposal } from "../../src/types.ts";
export const needle = "Math.min(9, Math.max(0, value))";
export const replacement = "Math.min(10, Math.max(0, value))";
export const fixtureContext = { objective: "Clamp finite numbers between zero and ten; preserve all scale functions.",
  acceptanceCriteria: ["clamp(100) equals 10; negative numbers yield zero", "Every exported scale function retains its multiplier"],
  constitutionDigest: "a".repeat(64), missingCapabilities: [], memoryContext: { memories: [], contextDigest: "b".repeat(64) } };
/** Authored multi-function fixture. Every unchanged function is exercised; not a novel model task. */
export function largeCandidate(fixed = false, count = 64): ProgramCandidateProposal {
  const names = Array.from({ length: count }, (_, index) => `scale${index}`);
  const source = `export function clamp(value: number): number { return ${fixed ? replacement : needle}; }\n` +
    names.map((name, index) => `export function ${name}(value: number): number { return value * ${index + 1}; }\n`).join("");
  return { schemaVersion: 1, candidateKind: "typescript_program", programName: "Clamped scale functions", summary: "Authored output-format fixture", limitations: [],
    files: [ { path: "src/index.ts", content: 'export * from "./value.ts";\n' }, { path: "src/value.ts", content: source },
      { path: "tests/value.test.ts", content: `import {clamp,${names.join(",")}} from "../src/index.ts";\n// PRIVATE_ADAPTIVE_ORACLE\n` +
        'if(clamp(100)!==10 || clamp(-1)!==0 || clamp(5)!==5) throw new Error("clamp failed");\n' +
        names.map((name, index) => `if(${name}(3)!==${3 * (index + 1)}) throw new Error("scale failed");\n`).join("") } ] };
}
export function responseFor(request: Parameters<CodingRepairModel["propose"]>[0], compact: boolean) {
  const source = request.candidate.files.find(file => file.path === "src/value.ts")!;
  return { schemaVersion: 1, baseArtifactDigest: request.verification.artifactDigest,
    failureFingerprint: request.verification.failures[0].fingerprint, strategy: request.strategy,
    changes: [{ path: source.path, expectedContentDigest: sha256(source.content),
      ...(compact ? { edits: [{ find: needle, replace: replacement }] } : { replacementText: source.content.replace(needle, replacement) }) }], limitations: [] };
}
