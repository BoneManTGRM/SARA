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

describe("GitHub draft PR publisher", () => {
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
      mutationId: receipt.mutationId,
      jobId: receipt.jobId,
      stage: "SHADOW",
    });

    assert.equal(evidence.draftPrUrl, "https://github.com/BoneManTGRM/SARA/pull/8");
    assert.equal(evidence.commitSha, commitSha);
    assert.equal(evidence.sourceTreeDigest, sourceTreeDigest);
    assert.ok(invocations.some((item) => item.file === "gh" && item.args.includes("--draft")));
    assert.ok(!invocations.some((item) => item.file === "git" && ["checkout", "add", "commit", "push"].includes(item.args[0] ?? "")));
  });
});
