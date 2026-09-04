import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  activateApprovedAutonomousPaidMandate,
  autonomousPaidMandateDigest,
} from "../src/autonomous-paid-mandate-bootstrap.ts";
import { SaraKernel } from "../src/kernel.ts";

describe("exact autonomous paid mandate bootstrap", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function fixture() {
    const stateDirectory = await mkdtemp(join(tmpdir(), "sara-autonomous-mandate-"));
    directories.push(stateDirectory);
    const ownerToken = "production-owner-token-fixture";
    const ownerTokenSha256 = createHash("sha256").update(ownerToken).digest("hex");
    return {
      kernel: await SaraKernel.boot({ stateDirectory, ownerTokenSha256 }),
      ownerToken,
    };
  }

  it("activates only the exact digest-authorized, owner-authenticated bounded mandate", async () => {
    const { kernel, ownerToken } = await fixture();
    const digest = autonomousPaidMandateDigest();
    const activated = await activateApprovedAutonomousPaidMandate({
      kernel,
      ownerToken,
      approvedDigest: digest,
      now: new Date("2026-09-04T01:00:00.000Z"),
    });
    assert.equal(activated?.digest, digest);
    assert.deepEqual(activated?.allowedActions, ["fixed_service_fulfillment", "verified_report_delivery"]);
    assert.deepEqual(activated?.allowedChannels, ["approved_api"]);
    assert.deepEqual(activated?.allowedServiceIds, ["public-repository-readiness-snapshot"]);
    assert.equal((await kernel.getStatus()).standingMandate?.digest, digest);
  });

  it("rejects a wrong digest or owner credential and becomes inactive at expiration", async () => {
    const { kernel, ownerToken } = await fixture();
    await assert.rejects(
      activateApprovedAutonomousPaidMandate({
        kernel,
        ownerToken,
        approvedDigest: "a".repeat(64),
        now: new Date("2026-09-04T01:00:00.000Z"),
      }),
      /does not match/u,
    );
    await assert.rejects(
      activateApprovedAutonomousPaidMandate({
        kernel,
        ownerToken: "wrong-owner-token",
        approvedDigest: autonomousPaidMandateDigest(),
        now: new Date("2026-09-04T01:00:00.000Z"),
      }),
      /OWNER_AUTHENTICATION_FAILED/u,
    );
    assert.equal(await activateApprovedAutonomousPaidMandate({
      kernel,
      ownerToken,
      approvedDigest: autonomousPaidMandateDigest(),
      now: new Date("2026-10-04T00:00:00.000Z"),
    }), null);
  });

  it("does not reactivate an explicitly revoked mandate during a later bootstrap", async () => {
    const { kernel, ownerToken } = await fixture();
    const digest = autonomousPaidMandateDigest();
    const owner = kernel.authenticateOwnerToken(ownerToken);
    const activated = await activateApprovedAutonomousPaidMandate({
      kernel,
      ownerToken,
      approvedDigest: digest,
      now: new Date("2026-09-04T01:00:00.000Z"),
    });
    assert.ok(activated);
    await kernel.revokeStandingMandate(owner, activated.id, "Owner stopped autonomous fulfillment.");
    await assert.rejects(
      activateApprovedAutonomousPaidMandate({
        kernel,
        ownerToken,
        approvedDigest: digest,
        now: new Date("2026-09-05T01:00:00.000Z"),
      }),
      /revoked and cannot be reactivated/u,
    );
    assert.ok((await kernel.getStatus()).standingMandate?.revokedAt);
  });
});
