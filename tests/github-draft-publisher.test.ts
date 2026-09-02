import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { digestArtifactTree } from "../src/genome-lab.ts";
import {
  GithubDraftPullRequestPublisher,
  type CommandInvocation,
  type CommandResult,
} from "../src/github-draft-publisher.ts";

async function artifact(): Promise<{ directory: string; digest: string }> {
  const directory = await mkdtemp(join(tmpdir(), "sara-publisher-artifact-"));
  await mkdir(join(directory, "runtime"), { mode: 0o700 });
  const files = {
    "skill.ts": "export function runSkill(input: unknown) { return input; }\n",
    "verification.ts": "// behavioral verifier\n",
    "manifest.json": `${JSON.stringify({ kind: "generated_skill_candidate", productionAuthority: false })}\n`,
    "verification.json": `${JSON.stringify({ result: "PASS", exitCode: 0, command: "kernel:isolated-typescript-behavioral-verification" })}\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content, { mode: 0o600 });
  }
  await writeFile(join(directory, "runtime", "skill.mjs"), "export const x = 1;\n", { mode: 0o600 });
  await chmod(directory, 0o700);
  return { directory, digest: await digestArtifactTree(directory) };
}

async function programArtifact(): Promise<{ directory: string; digest: string }> {
  const directory = await mkdtemp(join(tmpdir(), "sara-publisher-program-"));
  await Promise.all([
    mkdir(join(directory, "project", "src"), { recursive: true, mode: 0o700 }),
    mkdir(join(directory, "project", "tests"), { recursive: true, mode: 0o700 }),
    mkdir(join(directory, "runtime"), { mode: 0o700 }),
  ]);
  await Promise.all([
    writeFile(join(directory, "manifest.json"), `${JSON.stringify({ kind: "generated_typescript_program_candidate", productionAuthority: false })}\n`, { mode: 0o600 }),
    writeFile(join(directory, "verification.json"), `${JSON.stringify({ result: "PASS", exitCode: 0, command: "kernel:isolated-typescript-program-verification" })}\n`, { mode: 0o600 }),
    writeFile(join(directory, "project", "src", "index.ts"), "export { double } from './math.ts';\n", { mode: 0o600 }),
    writeFile(join(directory, "project", "src", "math.ts"), "export const double = (value: number) => value * 2;\n", { mode: 0o600 }),
    writeFile(join(directory, "project", "tests", "math.test.ts"), "// verified test source\n", { mode: 0o600 }),
    writeFile(join(directory, "runtime", "private.mjs"), "export const runtimeOnly = true;\n", { mode: 0o600 }),
  ]);
  return { directory, digest: await digestArtifactTree(directory) };
}

describe("GitHub draft PR publisher", () => {
  it("publishes a verified multi-file program tree but excludes its executable runtime", async () => {
    const source = await programArtifact();
    const repository = await mkdtemp(join(tmpdir(), "sara-publisher-repo-"));
    const run = async (invocation: CommandInvocation): Promise<CommandResult> => {
      const command = [invocation.file, ...invocation.args].join(" ");
      if (command === "git status --porcelain") return { exitCode: 0, stdout: "", stderr: "" };
      if (command.includes("ls-remote")) return { exitCode: 2, stdout: "", stderr: "missing" };
      if (command === "npm run verify") return { exitCode: 0, stdout: "all checks passed\n", stderr: "" };
      if (command === "git rev-parse HEAD") return { exitCode: 0, stdout: `${"9".repeat(40)}\n`, stderr: "" };
      if (command.startsWith("gh pr create")) return { exitCode: 0, stdout: "https://github.com/BoneManTGRM/SARA/pull/31\n", stderr: "" };
      if (command.startsWith("gh pr view")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ url: "https://github.com/BoneManTGRM/SARA/pull/31", isDraft: true, state: "OPEN", headRefOid: "9".repeat(40) }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const publisher = new GithubDraftPullRequestPublisher({ repository, run });
    const evidence = await publisher.publish({
      directiveId: "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
      candidateDigest: source.digest,
      artifactDirectory: source.directory,
      mutationId: "78e6fccc-d230-48cd-9049-8d41d83bc799",
      jobId: "2c693b5d-5607-4db7-8888-2229f2323c07",
      stage: "SHADOW",
    });
    assert.equal(evidence.verification[0]?.command, "kernel:isolated-typescript-program-verification");
    const target = join(repository, "generated", "candidates", "12f1399e-4d2b-4f64-91b4-20ac93006ec3");
    assert.match(await readFile(join(target, "project", "src", "index.ts"), "utf8"), /double/);
    await assert.rejects(() => readFile(join(target, "runtime", "private.mjs")), /ENOENT/);
  });

  it("copies only verified candidate evidence, verifies the repository, and opens a draft PR", async () => {
    const source = await artifact();
    const repository = await mkdtemp(join(tmpdir(), "sara-publisher-repo-"));
    const invocations: CommandInvocation[] = [];
    const run = async (invocation: CommandInvocation): Promise<CommandResult> => {
      invocations.push(invocation);
      const command = [invocation.file, ...invocation.args].join(" ");
      if (command === "git status --porcelain") return { exitCode: 0, stdout: "", stderr: "" };
      if (command.includes("ls-remote")) return { exitCode: 2, stdout: "", stderr: "missing" };
      if (command === "npm run verify") return { exitCode: 0, stdout: "all checks passed\n", stderr: "" };
      if (command === "git rev-parse HEAD") return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command.startsWith("gh pr create")) {
        return { exitCode: 0, stdout: "https://github.com/BoneManTGRM/SARA/pull/7\n", stderr: "" };
      }
      if (command.startsWith("gh pr view")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ url: "https://github.com/BoneManTGRM/SARA/pull/7", isDraft: true, state: "OPEN", headRefOid: "a".repeat(40) }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const publisher = new GithubDraftPullRequestPublisher({ repository, run });
    const evidence = await publisher.publish({
      directiveId: "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
      candidateDigest: source.digest,
      artifactDirectory: source.directory,
      mutationId: "78e6fccc-d230-48cd-9049-8d41d83bc799",
      jobId: "2c693b5d-5607-4db7-8888-2229f2323c07",
      stage: "SHADOW",
    });
    assert.equal(evidence.draftPrUrl, "https://github.com/BoneManTGRM/SARA/pull/7");
    assert.equal(evidence.commitSha, "a".repeat(40));
    assert.equal(evidence.verification.length, 2);
    const target = join(repository, "generated", "candidates", "12f1399e-4d2b-4f64-91b4-20ac93006ec3");
    assert.match(await readFile(join(target, "skill.ts"), "utf8"), /runSkill/);
    await assert.rejects(() => readFile(join(target, "runtime", "skill.mjs")), /ENOENT/);
    const receipt = JSON.parse(await readFile(join(target, "execution-receipt.json"), "utf8"));
    assert.equal(receipt.candidateDigest, source.digest);
    assert.equal(receipt.stage, "SHADOW");
    assert.equal(receipt.productionAuthority, false);
    assert.ok(invocations.some((item) => item.file === "npm" && item.args.join(" ") === "run verify"));
    assert.ok(invocations.some((item) => item.file === "gh" && item.args.includes("--draft")));
    assert.equal(
      evidence.verification[1]?.outputDigest,
      sha256(canonicalJson({ stdout: "all checks passed\n", stderr: "" })),
    );
  });

  it("fails before Git operations when the verified artifact digest changed", async () => {
    const source = await artifact();
    const repository = await mkdtemp(join(tmpdir(), "sara-publisher-repo-"));
    let called = false;
    const publisher = new GithubDraftPullRequestPublisher({
      repository,
      run: async () => {
        called = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    await assert.rejects(
      () => publisher.publish({
        directiveId: "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
        candidateDigest: "f".repeat(64),
        artifactDirectory: source.directory,
        mutationId: "78e6fccc-d230-48cd-9049-8d41d83bc799",
        jobId: "2c693b5d-5607-4db7-8888-2229f2323c07",
        stage: "SHADOW",
      }),
      /artifact digest changed/,
    );
    assert.equal(called, false);
  });

  it("opens a missing draft PR for an exact previously-pushed candidate without rewriting it", async () => {
    const source = await artifact();
    const repository = await mkdtemp(join(tmpdir(), "sara-publisher-repo-"));
    const invocations: CommandInvocation[] = [];
    const commitSha = "b".repeat(40);
    const sourceTreeDigest = "c".repeat(64);
    const receipt = {
      schemaVersion: 1,
      directiveId: "12f1399e-4d2b-4f64-91b4-20ac93006ec3",
      mutationId: "78e6fccc-d230-48cd-9049-8d41d83bc799",
      jobId: "2c693b5d-5607-4db7-8888-2229f2323c07",
      candidateDigest: source.digest,
      sourceTreeDigest,
      stage: "SHADOW",
      productionAuthority: false,
      verification: [{ command: "npm run verify", exitCode: 0, outputDigest: "d".repeat(64) }],
    };
    const run = async (invocation: CommandInvocation): Promise<CommandResult> => {
      invocations.push(invocation);
      const command = [invocation.file, ...invocation.args].join(" ");
      if (command === "git status --porcelain") return { exitCode: 0, stdout: "", stderr: "" };
      if (command.includes("ls-remote")) return { exitCode: 0, stdout: `${commitSha}\trefs/heads/existing\n`, stderr: "" };
      if (command === "git rev-parse FETCH_HEAD") return { exitCode: 0, stdout: `${commitSha}\n`, stderr: "" };
      if (command.startsWith("git show FETCH_HEAD:")) return { exitCode: 0, stdout: JSON.stringify(receipt), stderr: "" };
      if (command.startsWith("gh pr list")) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (command.startsWith("gh pr create")) {
        return { exitCode: 0, stdout: "https://github.com/BoneManTGRM/SARA/pull/8\n", stderr: "" };
      }
      if (command.startsWith("gh pr view")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            url: "https://github.com/BoneManTGRM/SARA/pull/8",
            isDraft: true,
            state: "OPEN",
            headRefOid: commitSha,
          }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const publisher = new GithubDraftPullRequestPublisher({ repository, run });
    const evidence = await publisher.publish({
      directiveId: receipt.directiveId,
      candidateDigest: source.digest,
      artifactDirectory: source.directory,
      // A restart creates fresh trace IDs. The immutable branch receipt must
      // retain valid original IDs while authority remains bound to the exact
      // directive, candidate digest, commit, and SHADOW evidence.
      mutationId: "80f3deef-4e10-4bb2-8072-b99436497e14",
      jobId: "7c0e0fdb-9cc7-4bc2-9ba7-feb96c8e81f1",
      stage: "SHADOW",
    });

    assert.equal(evidence.draftPrUrl, "https://github.com/BoneManTGRM/SARA/pull/8");
    assert.equal(evidence.commitSha, commitSha);
    assert.equal(evidence.sourceTreeDigest, sourceTreeDigest);
    assert.ok(invocations.some((item) => item.file === "gh" && item.args.includes("--draft")));
    assert.ok(!invocations.some((item) => item.file === "git" && ["checkout", "add", "commit", "push"].includes(item.args[0] ?? "")));
  });

  it("preserves a legacy mismatched branch and publishes an exact digest-qualified candidate", async () => {
    const source = await artifact();
    const repository = await mkdtemp(join(tmpdir(), "sara-publisher-repo-"));
    const invocations: CommandInvocation[] = [];
    const directiveId = "12f1399e-4d2b-4f64-91b4-20ac93006ec3";
    const commitSha = "e".repeat(40);
    const legacyReceipt = {
      schemaVersion: 1,
      directiveId,
      mutationId: "78e6fccc-d230-48cd-9049-8d41d83bc799",
      jobId: "2c693b5d-5607-4db7-8888-2229f2323c07",
      candidateDigest: "f".repeat(64),
      sourceTreeDigest: "c".repeat(64),
      stage: "SHADOW",
      productionAuthority: false,
      verification: [{ command: "npm run verify", exitCode: 0, outputDigest: "d".repeat(64) }],
    };
    let branchLookups = 0;
    const run = async (invocation: CommandInvocation): Promise<CommandResult> => {
      invocations.push(invocation);
      const command = [invocation.file, ...invocation.args].join(" ");
      if (command === "git status --porcelain") return { exitCode: 0, stdout: "", stderr: "" };
      if (command.includes("ls-remote")) {
        branchLookups += 1;
        return branchLookups === 1
          ? { exitCode: 0, stdout: `${"b".repeat(40)}\trefs/heads/legacy\n`, stderr: "" }
          : { exitCode: 2, stdout: "", stderr: "missing" };
      }
      if (command === "git rev-parse FETCH_HEAD") return { exitCode: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
      if (command.startsWith("git show FETCH_HEAD:")) {
        return { exitCode: 0, stdout: JSON.stringify(legacyReceipt), stderr: "" };
      }
      if (command === "npm run verify") return { exitCode: 0, stdout: "all checks passed\n", stderr: "" };
      if (command === "git rev-parse HEAD") return { exitCode: 0, stdout: `${commitSha}\n`, stderr: "" };
      if (command.startsWith("gh pr create")) {
        return { exitCode: 0, stdout: "https://github.com/BoneManTGRM/SARA/pull/10\n", stderr: "" };
      }
      if (command.startsWith("gh pr view")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            url: "https://github.com/BoneManTGRM/SARA/pull/10",
            isDraft: true,
            state: "OPEN",
            headRefOid: commitSha,
          }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const publisher = new GithubDraftPullRequestPublisher({ repository, run });
    const evidence = await publisher.publish({
      directiveId,
      candidateDigest: source.digest,
      artifactDirectory: source.directory,
      mutationId: "80f3deef-4e10-4bb2-8072-b99436497e14",
      jobId: "7c0e0fdb-9cc7-4bc2-9ba7-feb96c8e81f1",
      stage: "SHADOW",
    });

    const expectedBranch = `sara/directive-${directiveId}-${source.digest.slice(0, 12)}`;
    assert.equal(evidence.draftPrUrl, "https://github.com/BoneManTGRM/SARA/pull/10");
    assert.ok(invocations.some((item) => item.file === "git" && item.args.join(" ") === `checkout -b ${expectedBranch}`));
    assert.ok(invocations.some((item) => item.file === "git" && item.args.join(" ") === `push origin HEAD:refs/heads/${expectedBranch}`));
    assert.ok(!invocations.some((item) => item.args.includes("--force")));
  });
});
