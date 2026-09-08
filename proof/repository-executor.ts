import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { RepositorySession, repositoryBinding, verifyRepositoryArtifact,
  type RepositoryEnvironment, type RepositoryTask } from "../src/repository-executor.ts";

// Actual Docker controls, never mocked. An unavailable daemon fails this proof.
const scratch = await mkdtemp(join(tmpdir(), "sara-repository-proof-"));
const output = process.env.SARA_REPOSITORY_PROOF_OUTPUT ?? join(scratch, "evidence");
await mkdir(output, { recursive: true });
const run = (command: string, args: string[], cwd = scratch) => execFileSync(command, args, {
  cwd, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024,
});
let kernel: SaraKernel | undefined;
try {
  run("docker", ["info"]);
  // Resolve a qualification runtime to immutable ID before building/running.
  run("docker", ["pull", "node:22-bookworm"]);
  const runtime = run("docker", ["image", "inspect", "node:22-bookworm", "--format={{index .RepoDigests 0}}"] ).trim();
  const base = join(scratch, "base"); await mkdir(base);
  await writeFile(join(base, "value.cjs"), "module.exports = 1;\n");
  await writeFile(join(base, "test.cjs"), "require('node:assert/strict').equal(require('./value.cjs'), 2);\n");
  run("git", ["init"], base);
  run("git", ["-c", "user.name=Qualification", "-c", "user.email=qualification@invalid", "add", "."], base);
  run("git", ["-c", "user.name=Qualification", "-c", "user.email=qualification@invalid", "commit", "-m", "Public negative-control fixture"], base);
  const baseCommit = run("git", ["rev-parse", "HEAD"], base).trim();
  await writeFile(join(scratch, "Dockerfile"), `FROM ${runtime}\nCOPY --chown=1000:1000 base /sara/base\nUSER 1000:1000\n`);
  run("docker", ["build", "--iidfile", join(scratch, "image-id"), scratch]);
  const environment: RepositoryEnvironment = { schemaVersion: 1, repository: "qualification/public-fixture", baseCommit,
    image: (await readFile(join(scratch, "image-id"), "utf8")).trim(), publicTestCommand: ["node", "test.cjs"], timeoutSeconds: 10 };
  kernel = await SaraKernel.boot({ stateDirectory: output, ownerTokenSha256: sha256("qualification-only-owner-token"), repositoryEnvironments: [environment] });
  const receipts = [];
  for (const control of ["base-fails", "patch-passes", "workspace-poison-fails"] as const) {
    const task: RepositoryTask = { instanceId: control, problemStatement: "Return two.", arm: "conventional", runId: "docker-qualification" };
    const binding = repositoryBinding(environment, task);
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: `Qualify ${control}`, expectedOwnerValue: 1,
      requiredCapabilities: ["repository-executor"], acceptanceCriteria: ["Fresh public fixture test"], maximumBudgetUsd: 0 });
    const receipt = await kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, job.id, binding.environmentDigest, task, {
      id: "zero-cost-docker-control", external: false, maximumCostUsd: 0,
      async generate() {
        const session = await RepositorySession.start(environment);
        try {
          if (control === "patch-passes") await session.mustRun(["node", "-e", "require('fs').writeFileSync('value.cjs','module.exports = 2;\\n')"]);
          const patch = await session.freezePatch();
          // Producer-only poisoned test must not influence the fresh verifier.
          if (control === "workspace-poison-fails") await session.mustRun(["node", "-e", "require('fs').writeFileSync('test.cjs','process.exit(0)')"]);
          return { ...binding, patch };
        } finally { await session.close(); }
      },
    });
    assert.equal(receipt.exitCode === 0, control === "patch-passes", control);
    await verifyRepositoryArtifact(output, receipt);
    receipts.push({ control, receipt });
  }
  const events = await kernel.inspectAudit();
  assert.equal(events.filter(e => e.type === "repository_build_cycle_completed").length, 3);
  assert.equal(events.filter(e => e.type === "mutation_created").length, 0);
  const positive = receipts[1]!.receipt;
  const originalPatch = await readFile(join(output, positive.artifactRelativePath, "patch.diff"), "utf8");
  await writeFile(join(output, positive.artifactRelativePath, "patch.diff"), "tampered");
  await assert.rejects(verifyRepositoryArtifact(output, positive), /ARTIFACT_MISMATCH/);
  await writeFile(join(output, positive.artifactRelativePath, "patch.diff"), originalPatch);
  await verifyRepositoryArtifact(output, positive);
  await writeFile(join(output, "qualification.json"), JSON.stringify({ runtime, environment, receipts,
    tamperRejected: true, modelCalls: 0, benchmarkAttempts: 0, officialBenchmarkScore: null }, null, 2));
  console.log("PASS: real Docker base failure, repaired patch, fresh-state poison rejection, artifact tamper rejection; no model calls.");
} finally {
  await kernel?.closeVerificationWorkers();
  // Evidence lives outside temporary build context when invoked by CI.
  if (process.env.SARA_REPOSITORY_PROOF_OUTPUT) await rm(scratch, { recursive: true, force: true });
}
