import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import * as ts from "typescript";
import { canonicalJson, sha256 } from "./canonical.ts";
import { buildVerifiedSkillCandidate, digestArtifactTree } from "./genome-lab.ts";
import type { SkillCandidateProposal, SkillTestVector } from "./types.ts";

const execute = promisify(execFile);
const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_JSON_BYTES = 32 * 1024;
const FILES = ["manifest.json", "skill.ts", "verification.ts", "verification.json", "runtime/skill.mjs", "runtime/verification.mjs"].sort();

/** Evidence fingerprint, never operational authorization. Paths are intentionally excluded. */
export async function qualificationEnvironmentDigest(): Promise<string> {
  const files = ["./learning-qualification.ts", "./genome-lab.ts", "./canonical.ts", "./operational-skills.ts", "../package-lock.json"];
  const sources = await Promise.all(files.map(async file => ({ file, digest: sha256(await readFile(new URL(file, import.meta.url))) })));
  return sha256(canonicalJson({ schemaVersion: 1, nodeMajor: process.versions.node.split(".")[0], typescript: ts.version, sources }));
}

function boundedJson(value: unknown): string {
  const encoded = canonicalJson(value);
  if (Buffer.byteLength(encoded) > MAX_JSON_BYTES) throw new Error("Learning execution input or output exceeds its bound.");
  return encoded;
}

async function checkArtifact(directory: string, expected: string): Promise<void> {
  if (!DIGEST.test(expected)) throw new Error("Learning artifact digest is invalid.");
  if (await realpath(directory) !== resolve(directory)) throw new Error("Learning artifact paths may not traverse symbolic links.");
  const files: string[] = [];
  let bytes = 0;
  async function walk(relative: string): Promise<void> {
    const path = join(directory, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("Learning artifact contains a symbolic link.");
    if (stat.isDirectory()) {
      if (relative !== "" && relative !== "runtime") throw new Error("Learning artifact contains an unsupported directory.");
      for (const entry of await readdir(path)) await walk(relative ? `${relative}/${entry}` : entry);
    } else {
      if (!stat.isFile() || !FILES.includes(relative)) throw new Error("Learning artifact contains an unsupported file.");
      bytes += stat.size;
      if (bytes > 512 * 1024) throw new Error("Learning artifact exceeds its size bound.");
      files.push(relative);
    }
  }
  await walk("");
  if (canonicalJson(files.sort()) !== canonicalJson(FILES)) throw new Error("Learning artifact is incomplete.");
  if (await digestArtifactTree(directory) !== expected) throw new Error("Learning artifact no longer matches its verified candidate digest.");
}

/** Parse data only; never evaluate a retained producer verification script. */
function producerVectors(source: string): SkillTestVector[] {
  const file = ts.createSourceFile("verification.ts", source, ts.ScriptTarget.ES2022, true);
  const declarations = file.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
  const vectors = declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "vectors");
  if (vectors.length !== 1 || !vectors[0].initializer || !ts.isAsExpression(vectors[0].initializer)) {
    throw new Error("Learning artifact lacks its original producer vectors.");
  }
  return JSON.parse(vectors[0].initializer.expression.getText(file)) as SkillTestVector[];
}

function rejectPrototypeEscapes(source: string): void {
  const file = ts.createSourceFile("skill.ts", source, ts.ScriptTarget.ES2022, true);
  function visit(node: ts.Node): void {
    if (ts.isComputedPropertyName(node) || ((ts.isIdentifier(node) || ts.isStringLiteral(node))
      && (["constructor", "prototype", "__proto__"].includes(node.text) || node.text.startsWith("__")))) {
      throw new Error("Learning source contains a prohibited prototype or computed binding.");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}

async function withVerifiedCopy<T>(input: { artifactDirectory: string; candidateDigest: string }, action: (modulePath: string) => Promise<T>): Promise<T> {
  await checkArtifact(input.artifactDirectory, input.candidateDigest);
  const manifest = JSON.parse(await readFile(join(input.artifactDirectory, "manifest.json"), "utf8"));
  const verification = JSON.parse(await readFile(join(input.artifactDirectory, "verification.json"), "utf8"));
  if (manifest.kind !== "generated_skill_candidate" || manifest.productionAuthority !== false || verification.result !== "PASS"
      || verification.exitCode !== 0 || verification.command !== "kernel:isolated-typescript-behavioral-verification") {
    throw new Error("Learning execution requires a verified pure-skill candidate without production authority.");
  }
  const proposal: SkillCandidateProposal = {
    schemaVersion: 1, skillName: manifest.skillName, summary: manifest.summary, limitations: manifest.limitations,
    source: await readFile(join(input.artifactDirectory, "skill.ts"), "utf8"),
    tests: producerVectors(await readFile(join(input.artifactDirectory, "verification.ts"), "utf8")),
  };
  // The original guard rejects property access but older artifacts may use destructuring.
  // Apply this before any producer-vector execution in the disposable reconstruction.
  rejectPrototypeEscapes(proposal.source);
  const temporary = await mkdtemp(join(tmpdir(), "sara-learning-qualification-"));
  try {
    // Reuse the original source guard, strict compiler and isolated behavioral verifier.
    // This reconstructs a disposable candidate; no retained files are modified.
    const rebuilt = await buildVerifiedSkillCandidate({
      schemaVersion: 1, role: "sandboxed_coding_executor", jobId: randomUUID(), constitutionDigest: manifest.constitutionDigest,
      objective: manifest.objective, acceptanceCriteria: manifest.acceptanceCriteria, missingCapabilities: [],
      maximumBudgetUsd: 0, prohibitedActions: [], requiredProcess: [], requiredOutput: [],
    }, proposal, temporary, randomUUID());
    const modulePath = join(rebuilt.artifactDirectory, "runtime", "skill.mjs");
    const [compiled, retained] = await Promise.all([readFile(modulePath), readFile(join(input.artifactDirectory, "runtime", "skill.mjs"))]);
    if (!compiled.equals(retained)) throw new Error("Learning artifact source and compiled module disagree.");
    await checkArtifact(input.artifactDirectory, input.candidateDigest);
    const result = await action(modulePath);
    await checkArtifact(input.artifactDirectory, input.candidateDigest);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function invoke(modulePath: string, input: unknown): Promise<unknown> {
  const encoded = boundedJson(input);
  // Only the input reaches this child. Hidden acceptance expectations stay in the parent.
  const runner = `import { runSkill } from ${JSON.stringify(pathToFileURL(modulePath).href)};
const output = await Promise.resolve(runSkill(JSON.parse(process.argv[1])));
process.stdout.write(JSON.stringify({output}, (_key, value) => {
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol"
      || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Non-JSON skill output");
  return value;
}));`;
  const { stdout, stderr } = await execute(process.execPath, ["--permission", `--allow-fs-read=${modulePath}`,
    "--disallow-code-generation-from-strings", "--max-old-space-size=64", "--input-type=module", "--eval", runner, "--", encoded], {
    cwd: tmpdir(), env: { NODE_NO_WARNINGS: "1" }, timeout: 3_000, maxBuffer: 64 * 1024, encoding: "utf8",
  });
  if (stderr) throw new Error("Learning execution produced unexpected diagnostics.");
  const result = JSON.parse(stdout) as { output?: unknown };
  boundedJson(result.output);
  return result.output;
}

export async function executeLearningArtifact(input: { artifactDirectory: string; candidateDigest: string; input: unknown }): Promise<{ output: unknown; environmentDigest: string }> {
  try {
    const environmentDigest = await qualificationEnvironmentDigest();
    const output = await withVerifiedCopy(input, modulePath => invoke(modulePath, input.input));
    if (await qualificationEnvironmentDigest() !== environmentDigest) throw new Error("Environment changed.");
    return { output, environmentDigest };
  } catch {
    // Never propagate child diagnostics, producer data, paths or stack traces to learning feedback.
    throw new Error("Learning artifact execution rejected: integrity, isolation, runtime, or output validation failed.");
  }
}

export async function qualifyLearningArtifact(input: { artifactDirectory: string; candidateDigest: string; contractDigest: string; tests: SkillTestVector[] }): Promise<{
  candidateDigest: string; contractDigest: string; environmentDigest: string; testsPassed: number; evidenceDigest: string;
}> {
  try {
    if (!DIGEST.test(input.contractDigest) || !Array.isArray(input.tests) || input.tests.length < 1 || input.tests.length > 64) {
      throw new Error("Invalid independent acceptance contract.");
    }
    const tests = JSON.parse(boundedJson(input.tests)) as SkillTestVector[];
    const environmentDigest = await qualificationEnvironmentDigest();
    const observedDigests = await withVerifiedCopy(input, async modulePath => {
      const observed: string[] = [];
      for (const vector of tests) {
        const output = await invoke(modulePath, vector.input);
        if (boundedJson(output) !== boundedJson(vector.expected)) throw new Error("Independent acceptance mismatch.");
        observed.push(sha256(boundedJson(output)));
      }
      return observed;
    });
    if (await qualificationEnvironmentDigest() !== environmentDigest) throw new Error("Environment changed.");
    const receipt = { candidateDigest: input.candidateDigest, contractDigest: input.contractDigest, environmentDigest, testsPassed: tests.length };
    return { ...receipt, evidenceDigest: sha256(canonicalJson({ ...receipt, testsDigest: sha256(canonicalJson(tests)), observedDigests })) };
  } catch {
    // No hidden input, expected value, output, test name or child error enters feedback.
    throw new Error("Learning qualification rejected: independent acceptance or artifact validation failed.");
  }
}
