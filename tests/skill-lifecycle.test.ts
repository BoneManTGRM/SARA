import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import type { CandidateGenerator, OwnerApproval, SkillCandidateProposal } from "../src/types.ts";

const cleanup: string[] = [];
const OWNER_TOKEN = "skill-lifecycle-owner-token";
const OWNER_TOKEN_DIGEST = createHash("sha256").update(OWNER_TOKEN).digest("hex");

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function proposal(): SkillCandidateProposal {
  return {
    schemaVersion: 1,
    skillName: "Numeric Scorer",
    summary: "Scores finite numeric input inside the isolated skill runtime.",
    source: [
      "export function runSkill(input: unknown): unknown {",
      '  if (typeof input !== "number" || !Number.isFinite(input)) return null;',
      "  return input * 2;",
      "}",
      "",
    ].join("\n"),
    tests: [
      { name: "finite number", input: 4, expected: 8 },
      { name: "reject text", input: "4", expected: null },
    ],
    limitations: ["Accepts one finite number."],
  };
}

function generator(): CandidateGenerator {
  return {
    id: "zero-cost-skill-builder",
    external: false,
    maximumCostUsd: 0,
    async generate() {
      return proposal();
    },
  };
}

function brittleGenerator(): CandidateGenerator {
  return {
    id: "zero-cost-brittle-builder",
    external: false,
    maximumCostUsd: 0,
    async generate() {
      return {
        ...proposal(),
        source: [
          "export function runSkill(input: unknown): unknown {",
          '  if (input === 13) throw new Error("unexpected input");',
          '  if (typeof input !== "number" || !Number.isFinite(input)) return null;',
          "  return input * 2;",
          "}",
          "",
        ].join("\n"),
      };
    },
  };
}

function approval(ownerId: string, mutationId: string, stage: "CANARY" | "LIMITED_PRODUCTION"): OwnerApproval {
  return {
    approvalId: `approve-${stage.toLowerCase()}-${mutationId}`,
    action: "production_promotion",
    targetId: `${mutationId}:${stage}`,
    approvedAt: "2026-09-02T00:00:00.000Z",
    ownerId,
  };
}

async function prepared(): Promise<{
  kernel: SaraKernel;
  stateDirectory: string;
  owner: ReturnType<SaraKernel["authenticateOwnerToken"]>;
  mutationId: string;
  skillId: string;
}> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sara-skill-lifecycle-"));
  cleanup.push(stateDirectory);
  const kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
  const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
  const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
    objective: "Build a reusable numeric scoring capability.",
    expectedOwnerValue: 10,
    requiredCapabilities: ["numeric-scoring"],
    acceptanceCriteria: ["Finite numeric input is doubled and all other input returns null."],
    maximumBudgetUsd: 0,
  });
  const built = await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, generator());
  const skill = (await kernel.getStatus()).skills.at(-1);
  assert.ok(skill);
  return { kernel, stateDirectory, owner, mutationId: built.mutation.id, skillId: skill.id };
}

describe("SARA verified skill lifecycle", () => {
  it("turns a self-built SHADOW artifact into an owner-bound available capability", async () => {
    const { kernel, stateDirectory, owner, mutationId, skillId } = await prepared();
    const shadow = (await kernel.getStatus()).skills.find((skill) => skill.id === skillId);
    assert.equal(shadow?.status, "shadow");
    assert.equal(shadow?.source.generatorId, "zero-cost-skill-builder");
    assert.equal(shadow?.source.maximumCostUsd, 0);
    assert.equal(shadow?.capabilityId, undefined);

    await assert.rejects(
      () => kernel.bindSkillCapability(SARA_PRINCIPAL, skillId, "numeric-scoring", "Numeric scoring"),
      /verified owner/i,
    );
    const bound = await kernel.bindSkillCapability(owner, skillId, "numeric-scoring", "Numeric scoring");
    assert.equal(bound.capabilityId, "numeric-scoring");
    assert.equal((await kernel.getStatus()).capabilities.find((item) => item.id === "numeric-scoring")?.status, "limited");
    await assert.rejects(() => kernel.executeRegisteredSkill(SARA_PRINCIPAL, "numeric-scoring", 4), /not available/i);

    await kernel.promoteMutation(owner, mutationId, "CANARY", approval(owner.id, mutationId, "CANARY"));
    assert.equal((await kernel.getStatus()).skills.find((skill) => skill.id === skillId)?.status, "canary");
    await kernel.promoteMutation(
      owner,
      mutationId,
      "LIMITED_PRODUCTION",
      approval(owner.id, mutationId, "LIMITED_PRODUCTION"),
    );
    assert.equal((await kernel.getStatus()).skills.find((skill) => skill.id === skillId)?.status, "available");
    assert.equal((await kernel.getStatus()).capabilities.find((item) => item.id === "numeric-scoring")?.status, "available");

    const execution = await kernel.executeRegisteredSkill(SARA_PRINCIPAL, "numeric-scoring", 4);
    assert.equal(execution.output, 8);
    assert.match(execution.inputDigest, /^[a-f0-9]{64}$/u);
    assert.match(execution.outputDigest, /^[a-f0-9]{64}$/u);
    assert.equal(execution.skillId, skillId);

    const restarted = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
    const durable = (await restarted.getStatus()).skills.find((skill) => skill.id === skillId);
    assert.equal(durable?.executionCount, 1);
    assert.equal(durable?.lastExecution?.succeeded, true);
    assert.equal((await restarted.executeRegisteredSkill(SARA_PRINCIPAL, "numeric-scoring", 5)).output, 10);
  });

  it("quarantines a promoted skill when its verified artifact is changed", async () => {
    const { kernel, stateDirectory, owner, mutationId, skillId } = await prepared();
    await kernel.bindSkillCapability(owner, skillId, "numeric-scoring", "Numeric scoring");
    await kernel.promoteMutation(owner, mutationId, "CANARY", approval(owner.id, mutationId, "CANARY"));
    await kernel.promoteMutation(
      owner,
      mutationId,
      "LIMITED_PRODUCTION",
      approval(owner.id, mutationId, "LIMITED_PRODUCTION"),
    );
    const skill = (await kernel.getStatus()).skills.find((item) => item.id === skillId);
    assert.ok(skill?.artifactRelativePath);
    const runtimePath = join(stateDirectory, skill.artifactRelativePath, "runtime", "skill.mjs");
    await writeFile(runtimePath, `${await readFile(runtimePath, "utf8")}\n// tampered\n`);

    await assert.rejects(
      () => kernel.executeRegisteredSkill(SARA_PRINCIPAL, "numeric-scoring", 4),
      /no longer matches its verified candidate digest/i,
    );
    const state = await kernel.getStatus();
    assert.equal(state.skills.find((item) => item.id === skillId)?.status, "quarantined");
    assert.equal(state.capabilities.find((item) => item.id === "numeric-scoring")?.status, "missing");
  });

  it("quarantines a promoted skill after an unexpected runtime failure", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-skill-runtime-failure-"));
    cleanup.push(stateDirectory);
    const kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: OWNER_TOKEN_DIGEST });
    const owner = kernel.authenticateOwnerToken(OWNER_TOKEN);
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Build a deliberately brittle numeric scoring capability for quarantine testing.",
      expectedOwnerValue: 10,
      requiredCapabilities: ["brittle-scoring"],
      acceptanceCriteria: ["Declared vectors pass, but unexpected runtime failures must quarantine the capability."],
      maximumBudgetUsd: 0,
    });
    const built = await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, brittleGenerator());
    const skill = (await kernel.getStatus()).skills.at(-1);
    assert.ok(skill);
    await kernel.bindSkillCapability(owner, skill.id, "brittle-scoring", "Brittle scoring");
    await kernel.promoteMutation(owner, built.mutation.id, "CANARY", approval(owner.id, built.mutation.id, "CANARY"));
    await kernel.promoteMutation(
      owner,
      built.mutation.id,
      "LIMITED_PRODUCTION",
      approval(owner.id, built.mutation.id, "LIMITED_PRODUCTION"),
    );

    await assert.rejects(
      () => kernel.executeRegisteredSkill(SARA_PRINCIPAL, "brittle-scoring", 13),
      /failed closed/i,
    );
    const state = await kernel.getStatus();
    assert.equal(state.skills.find((item) => item.id === skill.id)?.status, "quarantined");
    assert.equal(state.capabilities.find((item) => item.id === "brittle-scoring")?.status, "missing");
    await assert.rejects(
      () => kernel.executeRegisteredSkill(SARA_PRINCIPAL, "brittle-scoring", 4),
      /not available/i,
    );
  });
});
