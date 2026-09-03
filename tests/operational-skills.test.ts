import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SaraKernel } from "../src/kernel.ts";
import {
  compileOperationalSkillProvenance,
  routeOperationalSkills,
  type OperationalSkillRecord,
} from "../src/operational-skills.ts";

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);

function metadata() {
  return {
    schemaVersion: 1 as const,
    skillId: "repository-evidence-triage",
    activationTerms: ["repository", "evidence", "readiness"],
    knownFailureModes: ["A moving branch may invalidate previously observed evidence."],
    sources: [
      {
        kind: "repository" as const,
        uri: "https://github.com/example/project",
        immutableRevision: COMMIT,
        contentSha256: SHA,
        licenseSpdx: "Apache-2.0",
        licenseEvidenceUri: `https://github.com/example/project/blob/${COMMIT}/LICENSE`,
        attribution: "Example Project contributors",
      },
    ],
  };
}

function record(input: Partial<OperationalSkillRecord> = {}): OperationalSkillRecord {
  const provenance = compileOperationalSkillProvenance(metadata());
  return {
    schemaVersion: 1,
    mutationId: "11111111-1111-4111-8111-111111111111",
    candidateDigest: "c".repeat(64),
    name: "Repository Evidence Triage",
    summary: "Routes immutable repository evidence through bounded checks.",
    stage: "CANARY",
    loadable: true,
    productionAuthority: false,
    executionAuthority: "none",
    provenance,
    ...input,
  };
}

describe("SARA operational skill layer", () => {
  it("binds immutable, license-cleared source metadata to a provenance digest", () => {
    const compiled = compileOperationalSkillProvenance(metadata());

    assert.match(compiled.provenanceDigest, /^[a-f0-9]{64}$/);
    assert.equal(compiled.instructionAuthority, false);
    assert.equal(compiled.productionAuthority, false);
    assert.deepEqual(compiled.allowedRuntimeAuthorities, []);
    assert.equal(compiled.sources[0]?.immutableRevision, COMMIT);
  });

  it("rejects moving repository refs, unknown licenses, credentials, and unverifiable evidence", () => {
    assert.throws(
      () => compileOperationalSkillProvenance({ ...metadata(), sources: [{ ...metadata().sources[0]!, immutableRevision: "main" }] }),
      /40-character commit/,
    );
    assert.throws(
      () => compileOperationalSkillProvenance({ ...metadata(), sources: [{ ...metadata().sources[0]!, licenseSpdx: "GPL-3.0-only" }] }),
      /not approved/,
    );
    assert.throws(
      () => compileOperationalSkillProvenance({ ...metadata(), sources: [{ ...metadata().sources[0]!, uri: "https://token@example.com/project" }] }),
      /credentials/,
    );
    assert.throws(
      () => compileOperationalSkillProvenance({ ...metadata(), sources: [{ ...metadata().sources[0]!, contentSha256: "0".repeat(64) }] }),
      /non-zero SHA-256/,
    );
    assert.throws(
      () => compileOperationalSkillProvenance({
        ...metadata(),
        sources: [{ ...metadata().sources[0]!, licenseEvidenceUri: "https://github.com/example/project/blob/main/LICENSE" }],
      }),
      /same immutable commit/,
    );
    assert.throws(
      () => compileOperationalSkillProvenance({ ...metadata(), runtimeAuthority: "network" } as ReturnType<typeof metadata>),
      /unsupported fields/,
    );
  });

  it("routes only relevant owner-promoted records and never grants execution authority", () => {
    const result = routeOperationalSkills([
      record(),
      record({
        mutationId: "22222222-2222-4222-8222-222222222222",
        stage: "SHADOW",
        loadable: false,
      }),
      record({
        mutationId: "33333333-3333-4333-8333-333333333333",
        name: "Invoice Formatter",
        summary: "Formats an internal invoice draft.",
        provenance: compileOperationalSkillProvenance({
          ...metadata(),
          skillId: "invoice-formatter",
          activationTerms: ["invoice", "format"],
        }),
      }),
    ], "Check public repository readiness evidence", 3);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.skillId, "repository-evidence-triage");
    assert.equal(result[0]?.executionAuthority, "none");
    assert.equal(result[0]?.productionAuthority, false);
  });

  it("does not force a weak route", () => {
    assert.deepEqual(routeOperationalSkills([record()], "prepare an invoice", 3), []);
  });

  it("keeps a verified distillation in SHADOW until an exact owner promotion", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-operational-skill-"));
    const token = `owner-${randomUUID()}`;
    const kernel = await SaraKernel.boot({
      stateDirectory,
      ownerTokenSha256: createHash("sha256").update(token).digest("hex"),
    });
    const owner = kernel.authenticateOwnerToken(token);
    const job = await kernel.createSelfDevelopmentJob(owner, {
      objective: "Distill immutable repository evidence into a bounded operational skill.",
      expectedOwnerValue: 1,
      requiredCapabilities: ["operational-skill-distillation"],
      acceptanceCriteria: ["The candidate passes isolated behavioral checks and retains source provenance."],
      maximumBudgetUsd: 0,
    });
    const execution = await kernel.runSelfBuildCycle(owner, job.id, {
      id: "test-operational-distiller",
      external: false,
      maximumCostUsd: 0,
      async generate() {
        return {
          schemaVersion: 1,
          skillName: "Repository Evidence Triage",
          summary: "Routes immutable repository evidence through bounded checks.",
          source: [
            "export function runSkill(input: unknown): unknown {",
            '  return typeof input === "string" ? input.trim().toLowerCase() : null;',
            "}",
            "",
          ].join("\n"),
          tests: [{ name: "normalizes", input: " Evidence ", expected: "evidence" }],
          limitations: ["The candidate cannot fetch, mutate, deploy, spend, or contact anyone."],
          operational: metadata(),
        };
      },
    });

    const shadow = await kernel.inspectOperationalSkills();
    assert.equal(shadow.shadowCandidates.length, 1);
    assert.equal(shadow.loadableSkills.length, 0);
    assert.deepEqual(await kernel.routeOperationalSkillContext("repository evidence"), []);

    await kernel.promoteMutation(owner, execution.mutation.id, "CANARY", {
      approvalId: randomUUID(),
      action: "production_promotion",
      targetId: `${execution.mutation.id}:CANARY`,
      approvedAt: new Date().toISOString(),
      ownerId: owner.id,
    });

    const promoted = await kernel.inspectOperationalSkills();
    assert.equal(promoted.shadowCandidates.length, 0);
    assert.equal(promoted.loadableSkills.length, 1);
    assert.equal((await kernel.routeOperationalSkillContext("repository evidence"))[0]?.skillId, "repository-evidence-triage");
  });
});
