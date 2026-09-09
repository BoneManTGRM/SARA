import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import { compileLearningCampaign, type LearningCampaignInput } from "../src/learning-campaign.ts";
import type { CandidateGenerator } from "../src/types.ts";

const execute = promisify(execFile);
const ownerToken = "local-requalification-test-owner";
const campaign: LearningCampaignInput = { id: "qualification-repair-campaign", maximumRequests: 10, contracts: [{
  capabilityId: "catalog-shape-preserver", objective: "Preserve an authorized catalog value without alteration.",
  publicCriteria: ["Return the complete input unchanged."], estimatedEffort: 1,
  acceptanceTests: [{ name: "independent record", input: { sentinel: "hidden-oracle-value" }, expected: { sentinel: "hidden-oracle-value" } },
    { name: "independent null", input: null, expected: null }],
}] };

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "sara-requalification-"));
  const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(ownerToken) });
  const owner = kernel.authenticateOwnerToken(ownerToken);
  const now = new Date();
  await kernel.activateStandingMandate(owner, { id: "qualified-skill-learning", ownerId: owner.id,
    allowedActions: ["business_candidate_development"], allowedChannels: ["internal"], allowedServiceIds: ["skill-learning"],
    maximumCostPerActionUsd: 0, maximumDailyActions: 2, maximumConcurrentActions: 1,
    startsAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
  }, { approvalId: "test-mandate", ownerId: owner.id, action: "required_owner_approval_change",
    targetId: "standing-mandate:qualified-skill-learning", approvedAt: now.toISOString() });
  await kernel.configureLearningCampaign(owner, campaign, compileLearningCampaign(campaign).digest);
  await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, { objective: "Preserve catalog input for an authorized workflow.",
    expectedOwnerValue: 3, requiredCapabilities: ["catalog-shape-preserver"],
    acceptanceCriteria: ["Preserve authorized catalog values."], maximumBudgetUsd: 0 });
  return { directory, kernel, owner };
}

const echo: CandidateGenerator = { id: "qualification-fixture", external: false, maximumCostUsd: 0,
  async generate(input) {
    assert.doesNotMatch(JSON.stringify(input), /hidden-oracle-value/u);
    return { schemaVersion: 1, skillName: "Preserve shape", summary: "Deterministic test fixture",
      source: "export function runSkill(input: unknown): unknown { return input; }",
      tests: [{ name: "producer scalar", input: 1, expected: 1 }], limitations: ["Engineering fixture only"] };
  },
};

test("independent rejection becomes a durable hidden-safe lesson and one unchanged-contract repair after restart", async () => {
  const { directory, kernel } = await setup();
  let calls = 0;
  const generator: CandidateGenerator = { ...echo, async generate(input) {
    calls++;
    if (calls === 2) assert.match(JSON.stringify(input.memoryContext), /Independent acceptance failed; hidden answers withheld/u);
    const proposal = await echo.generate(input);
    return { ...proposal, source: calls === 1 ? "export function runSkill(input: unknown): unknown { return 1; }" : "export function runSkill(input: unknown): unknown { return input; }" };
  } };
  try {
    assert.equal((await kernel.runLearningWorkerTick(generator)).status, "rejected");
    const first = await kernel.getStatus();
    const root = first.jobs.find(job => job.learningCampaignId)!;
    const child = first.jobs.find(job => job.learningParentJobId === root.id)!;
    assert.ok(child);
    assert.equal(child.learningContractDigest, root.learningContractDigest);
    assert.deepEqual(child.workCard.acceptanceCriteria, root.workCard.acceptanceCriteria);
    const recalled = await kernel.recallMemory({ query: root.workCard.objective, scope: "global", categories: ["failure"], limit: 12 });
    const memory = recalled.relevant.find(item => item.id === `learning-failure-${root.id}`)!;
    assert.ok(memory.dependencies.some(value => value.startsWith("candidate:")));
    assert.doesNotMatch(JSON.stringify(memory), /hidden-oracle-value/u);
    const reboot = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(ownerToken) });
    assert.equal((await reboot.runLearningWorkerTick(generator)).status, "qualified");
    await reboot.qualifyLearningJob(root.id); // Recovery of the same failure must not duplicate its child.
    assert.equal((await reboot.getStatus()).jobs.filter(job => job.learningParentJobId === root.id).length, 1);
    await reboot.runLearningWorkerTick(generator);
    assert.equal(calls, 2);
    const status = await reboot.learningCampaignStatus();
    assert.equal(status.campaign?.reserved, 2);
    assert.equal(status.qualifications.length, 2);
    assert.match((status.qualifications[0] as unknown as { environmentDigest: string }).environmentDigest, /^[a-f0-9]{64}$/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a new process requalifies a promoted retained artifact after a verifier environment change without generation or re-promotion", async () => {
  const { directory, kernel, owner } = await setup();
  const copy = await mkdtemp(join(tmpdir(), "sara-new-verifier-"));
  try {
    assert.equal((await kernel.runLearningWorkerTick(echo)).status, "qualified");
    const mutation = (await kernel.getStatus()).mutations[0]!;
    await kernel.promoteMutation(owner, mutation.id, "CANARY", { approvalId: "test-exact-promotion", ownerId: owner.id,
      action: "production_promotion", targetId: `${mutation.id}:CANARY`, approvedAt: new Date().toISOString() });
    const root = fileURLToPath(new URL("../", import.meta.url));
    for (const path of ["src", "constitution", "package.json", "package-lock.json"]) await cp(join(root, path), join(copy, path), { recursive: true });
    await symlink(join(root, "node_modules"), join(copy, "node_modules"), "dir");
    const verifier = join(copy, "src", "learning-qualification.ts");
    await writeFile(verifier, `${await readFile(verifier, "utf8")}\n// Isolated verifier revision for restart regression.\n`);
    const program = `
      import assert from "node:assert/strict";
      import { SaraKernel } from "./src/kernel.ts";
      import { sha256 } from "./src/canonical.ts";
      const [directory, token, mutationId] = JSON.parse(process.argv[1]);
      const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256(token) });
      const owner = kernel.authenticateOwnerToken(token);
      await assert.rejects(() => kernel.invokeLearnedSkill(owner, "catalog-shape-preserver", 7), /QUALIFIED_APPROVED_CURRENT/);
      let calls = 0;
      const generator = { id: "must-not-generate", external: false, maximumCostUsd: 0, async generate() { calls++; throw new Error("Unexpected generation"); } };
      assert.equal((await kernel.runLearningWorkerTick(generator)).status, "qualified");
      assert.equal((await kernel.getStatus()).mutations.find(m => m.id === mutationId).stage, "CANARY");
      assert.deepEqual((await kernel.invokeLearnedSkill(owner, "catalog-shape-preserver", { fresh: [9, 8] })).output, { fresh: [9, 8] });
      await kernel.runLearningWorkerTick(generator);
      const status = await kernel.learningCampaignStatus();
      assert.equal(calls, 0);
      assert.equal(status.campaign.reserved, 1);
      assert.equal(status.qualifications.length, 2);
      assert.notEqual(status.qualifications[0].environmentDigest, status.qualifications[1].environmentDigest);
      process.stdout.write(JSON.stringify({ requalified: true, requests: status.campaign.reserved, generated: calls }));
    `;
    const result = await execute(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", program,
      "--", JSON.stringify([directory, ownerToken, mutation.id])], { cwd: copy, env: { NODE_NO_WARNINGS: "1" }, timeout: 30_000, maxBuffer: 64 * 1024 });
    assert.deepEqual(JSON.parse(result.stdout), { requalified: true, requests: 1, generated: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(copy, { recursive: true, force: true });
  }
});
