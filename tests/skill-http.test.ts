import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import { createSaraServer } from "../src/server.ts";
import type { CandidateGenerator, OwnerApproval } from "../src/types.ts";

describe("SARA verified skill owner API", () => {
  const token = "skill-http-owner-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const auth = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  let directory: string;
  let baseUrl: string;
  let kernel: SaraKernel;
  let server: ReturnType<typeof createSaraServer>;
  let mutationId: string;
  let skillId: string;

  function approval(stage: "CANARY" | "LIMITED_PRODUCTION"): OwnerApproval {
    return {
      approvalId: `approve-${stage.toLowerCase()}`,
      action: "production_promotion",
      targetId: `${mutationId}:${stage}`,
      approvedAt: "2026-09-02T00:00:00.000Z",
      ownerId: "OWNER",
    };
  }

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "sara-skill-http-"));
    kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: tokenHash });
    const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
      objective: "Build a callable uppercase skill.",
      expectedOwnerValue: 5,
      requiredCapabilities: ["uppercase-text"],
      acceptanceCriteria: ["String input becomes uppercase and other input returns null."],
      maximumBudgetUsd: 0,
    });
    const generator: CandidateGenerator = {
      id: "http-skill-builder",
      external: false,
      maximumCostUsd: 0,
      async generate() {
        return {
          schemaVersion: 1,
          skillName: "Uppercase Text",
          summary: "Uppercases one string.",
          source: [
            "export function runSkill(input: unknown): unknown {",
            '  return typeof input === "string" ? input.toUpperCase() : null;',
            "}",
            "",
          ].join("\n"),
          tests: [
            { name: "text", input: "sara", expected: "SARA" },
            { name: "reject number", input: 4, expected: null },
          ],
          limitations: ["String input only."],
        };
      },
    };
    const built = await kernel.runSelfBuildCycle(SARA_PRINCIPAL, job.id, generator);
    mutationId = built.mutation.id;
    skillId = (await kernel.getStatus()).skills.at(-1)!.id;
    server = createSaraServer(kernel, { ownerTokenSha256: tokenHash });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps capability binding and execution behind owner authentication", async () => {
    const bindUrl = `${baseUrl}/api/skills/${skillId}/bind-capability`;
    const bindBody = JSON.stringify({ capabilityId: "uppercase-text", capabilityName: "Uppercase text" });
    assert.equal((await fetch(bindUrl, { method: "POST", body: bindBody })).status, 401);
    assert.equal((await fetch(bindUrl, { method: "POST", headers: auth, body: bindBody })).status, 200);

    const owner = kernel.authenticateOwnerToken(token);
    await kernel.promoteMutation(owner, mutationId, "CANARY", approval("CANARY"));
    await kernel.promoteMutation(owner, mutationId, "LIMITED_PRODUCTION", approval("LIMITED_PRODUCTION"));

    const executeUrl = `${baseUrl}/api/capabilities/uppercase-text/execute`;
    const executeBody = JSON.stringify({ input: "sara" });
    assert.equal((await fetch(executeUrl, { method: "POST", body: executeBody })).status, 401);
    const response = await fetch(executeUrl, { method: "POST", headers: auth, body: executeBody });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { output: string }).output, "SARA");
  });
});
