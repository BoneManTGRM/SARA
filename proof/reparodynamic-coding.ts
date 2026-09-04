import assert from "node:assert/strict";
import { sha256 } from "../src/canonical.ts";
import { runCodingRepairController } from "../src/coding-repair-controller.ts";
import type { CodingFailureSignal, ProgramVerificationResult } from "../src/coding-repair-types.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

const baseline: ProgramCandidateProposal = {
  schemaVersion: 1,
  candidateKind: "typescript_program",
  programName: "Offline repair proof",
  summary: "A deterministic offline repair fixture.",
  limitations: [],
  files: [
    { path: "src/index.ts", content: 'export { answer } from "./value.ts";\n' },
    { path: "src/value.ts", content: "export const answer: number = 'wrong';\n" },
    { path: "tests/value.test.ts", content: "// immutable hidden-test stand-in\n" },
  ],
};

function verification(candidate: ProgramCandidateProposal): ProgramVerificationResult {
  const content = candidate.files.find((file) => file.path === "src/value.ts")?.content ?? "";
  const digest = sha256(JSON.stringify(candidate.files));
  const failure: CodingFailureSignal = {
    kind: "type", code: "TS2322", file: "src/value.ts", line: 1, column: 14,
    evidenceDigest: sha256("TS2322-evidence"), fingerprint: sha256("TS2322:src/value.ts:1"),
    severity: "medium", existedBeforeRepair: true,
  };
  return {
    passed: content === "export const answer: number = 42;\n",
    score: content === "export const answer: number = 42;\n" ? 1 : 0.8,
    artifactDigest: digest,
    failures: content === "export const answer: number = 42;\n" ? [] : [failure],
    completedChecks: ["source_policy", "syntax", "typecheck", "behavior_tests", "artifact_integrity"],
    evidenceDigests: [sha256(content)],
  };
}

const initial = verification(baseline);
const run = await runCodingRepairController({
  baseline,
  verify: async (candidate) => verification(candidate),
  model: {
    async propose() {
      return {
        proposal: {
          schemaVersion: 1,
          baseArtifactDigest: initial.artifactDigest,
          failureFingerprint: initial.failures[0].fingerprint,
          strategy: "surgical",
          changes: [{
            path: "src/value.ts",
            expectedContentDigest: sha256("export const answer: number = 'wrong';\n"),
            replacementText: "export const answer: number = 42;\n",
          }],
          limitations: [],
        },
        inputTokens: 100,
        outputTokens: 40,
        accountedCostUsd: 0.01,
      };
    },
  },
});

assert.equal(run.state, "VERIFIED_CANDIDATE");
assert.equal(run.receipts[0]?.outcome, "verified_complete");
assert.equal(run.accountedCostUsd, 0.01);
console.log(JSON.stringify({ result: "PASS", state: run.state, receipts: run.receipts.length }));
