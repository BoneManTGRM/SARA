import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as ts from "typescript";
import { sha256 } from "../src/canonical.ts";
import { buildVerifiedSkillCandidate, digestArtifactTree } from "../src/genome-lab.ts";
import { executeLearningArtifact, qualificationEnvironmentDigest, qualifyLearningArtifact } from "../src/learning-qualification.ts";
import type { ExecutorHandoff } from "../src/handoff.ts";

const handoff: ExecutorHandoff = {
  schemaVersion: 1, role: "sandboxed_coding_executor", jobId: randomUUID(), constitutionDigest: "a".repeat(64),
  objective: "Double finite numeric inputs", acceptanceCriteria: ["Double finite numbers and reject other input"],
  missingCapabilities: [], maximumBudgetUsd: 0, prohibitedActions: [], requiredProcess: [], requiredOutput: [],
};
const correctSource = 'export function runSkill(input: unknown): unknown { return typeof input === "number" && Number.isFinite(input) ? input * 2 : null; }';

async function fixture(source: string, fn: (artifact: Awaited<ReturnType<typeof buildVerifiedSkillCandidate>>) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sara-qualification-test-"));
  try {
    const artifact = await buildVerifiedSkillCandidate(handoff, {
      schemaVersion: 1, skillName: "Numeric Doubler", summary: "Double finite input numbers", source,
      tests: [{ name: "producer happy path", input: 1, expected: 2 }], limitations: ["Pure scalar computation only"],
    }, join(root, "genome-lab"), randomUUID());
    await fn(artifact);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("independent acceptance rejects overfitting despite passing producer vectors without exposing hidden values", async () => {
  await fixture('export function runSkill(input: unknown): unknown { return 2; }', async artifact => {
    const before = await digestArtifactTree(artifact.artifactDirectory);
    await assert.rejects(qualifyLearningArtifact({ ...artifact, contractDigest: sha256("contract"),
      tests: [{ name: "hidden sentinel acceptance", input: 9247, expected: 18494 }],
    }), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Learning qualification rejected: independent acceptance or artifact validation failed.");
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify(error).includes("18494"));
      return true;
    });
    assert.equal(await digestArtifactTree(artifact.artifactDirectory), before);
  });
});

test("independent qualification binds evidence and new-input reuse does not alter the artifact", async () => {
  await fixture(correctSource, async artifact => {
    const before = await digestArtifactTree(artifact.artifactDirectory);
    const receipt = await qualifyLearningArtifact({ ...artifact, contractDigest: sha256("double finite numbers"), tests: [
      { name: "negative", input: -7, expected: -14 }, { name: "reject text", input: "7", expected: null },
      { name: "zero", input: 0, expected: 0 },
    ] });
    assert.equal(receipt.testsPassed, 3);
    assert.equal(receipt.candidateDigest, artifact.candidateDigest);
    assert.match(receipt.evidenceDigest, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.environmentDigest, await qualificationEnvironmentDigest());
    assert.equal("productionAuthority" in receipt, false);
    const reused = await executeLearningArtifact({ ...artifact, input: 12.5 });
    assert.equal(reused.output, 25);
    assert.equal(reused.environmentDigest, receipt.environmentDigest);
    assert.equal(await digestArtifactTree(artifact.artifactDirectory), before);
  });
});

test("retained source tampering and compiled-source mismatch are rejected", async () => {
  await fixture(correctSource, async artifact => {
    const path = join(artifact.artifactDirectory, "runtime", "skill.mjs");
    await writeFile(path, 'export function runSkill() { return 999; }');
    await assert.rejects(executeLearningArtifact({ ...artifact, input: 1 }), /execution rejected/u);
    // Even a caller supplying a new tree digest cannot bypass correspondence validation.
    await assert.rejects(executeLearningArtifact({ ...artifact, candidateDigest: await digestArtifactTree(artifact.artifactDirectory), input: 1 }), /execution rejected/u);
  });
});

test("source policy is rechecked even when forged verification metadata and tree digest agree", async () => {
  await fixture(correctSource, async artifact => {
    await writeFile(join(artifact.artifactDirectory, "skill.ts"), 'export function runSkill(input: unknown): unknown { return process.env.SECRET; }');
    await assert.rejects(executeLearningArtifact({ ...artifact, candidateDigest: await digestArtifactTree(artifact.artifactDirectory), input: 1 }), /execution rejected/u);
  });
});

test("program artifacts, symlinks, empty acceptance and oversized input are rejected", async () => {
  await fixture(correctSource, async artifact => {
    await assert.rejects(qualifyLearningArtifact({ ...artifact, contractDigest: sha256("empty"), tests: [] }), /qualification rejected/u);
    await assert.rejects(executeLearningArtifact({ ...artifact, input: "x".repeat(33 * 1024) }), /execution rejected/u);
    const manifestPath = join(artifact.artifactDirectory, "manifest.json");
    const original = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(original), kind: "generated_typescript_program_candidate" }));
    await assert.rejects(executeLearningArtifact({ ...artifact, candidateDigest: await digestArtifactTree(artifact.artifactDirectory), input: 1 }), /execution rejected/u);
    await writeFile(manifestPath, original);
    const runtime = join(artifact.artifactDirectory, "runtime", "skill.mjs");
    await rm(runtime);
    await symlink(join(artifact.artifactDirectory, "skill.ts"), runtime);
    await assert.rejects(executeLearningArtifact({ ...artifact, input: 1 }), /execution rejected/u);
  });
});

test("a skill that loops only on new input is terminated by the isolated execution deadline", async () => {
  await fixture('export function runSkill(input: unknown): unknown { if (input === 99) { while (true) {} } return 2; }', async artifact => {
    await assert.rejects(executeLearningArtifact({ ...artifact, input: 99 }), /execution rejected/u);
  });
});

test("non-JSON and excessive outputs are rejected instead of becoming apparent valid results", async () => {
  await fixture('export function runSkill(input: unknown): unknown { if (input === 98) return NaN; if (input === 99) return "x".repeat(100000); return 2; }', async artifact => {
    await assert.rejects(qualifyLearningArtifact({ ...artifact, contractDigest: sha256("NaN is not null"),
      tests: [{ name: "nonfinite is invalid", input: 98, expected: null }],
    }), /qualification rejected/u);
    await assert.rejects(executeLearningArtifact({ ...artifact, input: 99 }), /execution rejected/u);
  });
});

test("older producer verification cannot authorize constructor-destructuring code generation", async () => {
  // This harmless payload passed the historical guard before its repair. Reconstruct
  // that legacy tree without asking the now-current initial verifier to accept it.
  await fixture(correctSource, async artifact => {
    const source = 'export function runSkill(input: unknown): unknown { const { constructor: factory } = (() => 2); const calculate = factory("return 2"); return calculate(); }';
    await writeFile(join(artifact.artifactDirectory, "skill.ts"), source);
    await writeFile(join(artifact.artifactDirectory, "runtime", "skill.mjs"), ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
    await assert.rejects(executeLearningArtifact({ ...artifact, candidateDigest: await digestArtifactTree(artifact.artifactDirectory), input: 1 }), /execution rejected/u);
  });
});
