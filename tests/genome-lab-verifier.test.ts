import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyProgramCandidate } from "../src/genome-lab-verifier.ts";
import type { ProgramCandidateProposal } from "../src/types.ts";

function candidate(valueSource: string): ProgramCandidateProposal {
  return {
    schemaVersion: 1, candidateKind: "typescript_program", programName: "Verifier fixture", summary: "fixture", limitations: [],
    files: [
      { path: "src/index.ts", content: 'export { value } from "./value.ts";\n' },
      { path: "src/value.ts", content: valueSource },
      { path: "tests/value.test.ts", content: "export const hiddenAcceptance = true;\n" },
    ],
  };
}

describe("Genome Lab structured verifier", () => {
  it("returns stable structured TypeScript failures instead of model prose", async () => {
    const first = await verifyProgramCandidate({ candidate: candidate("export const value: number = 'bad';\n") });
    const second = await verifyProgramCandidate({ candidate: candidate("export const value: number = 'bad';\n") });
    assert.equal(first.passed, false);
    assert(first.failures.some((failure) => failure.code === "TS2322"));
    assert.equal(first.failures.find((failure) => failure.code === "TS2322")?.fingerprint, second.failures.find((failure) => failure.code === "TS2322")?.fingerprint);
  });

  it("requires an independent behavior check before PASS", async () => {
    const withoutBehavior = await verifyProgramCandidate({ candidate: candidate("export const value: number = 42;\n") });
    const withBehavior = await verifyProgramCandidate({ candidate: candidate("export const value: number = 42;\n"), behaviorCheck: async () => [] });
    assert.equal(withoutBehavior.passed, false);
    assert.equal(withBehavior.passed, true);
  });

  it("fails closed on prohibited capabilities", async () => {
    const checked = await verifyProgramCandidate({ candidate: candidate("export const value = process.env.SECRET;\n"), behaviorCheck: async () => [] });
    assert.equal(checked.passed, false);
    assert(checked.failures.some((failure) => failure.kind === "security"));
  });
});
