import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256 } from "../src/canonical.ts";
import { SaraKernel, SARA_PRINCIPAL } from "../src/kernel.ts";
import {
  REVENUE_CAPABILITY_EVIDENCE_VERSION,
  verifiedRevenueCapabilities,
} from "../src/revenue-capability-bootstrap.ts";
import { PILOT_REQUIRED_CAPABILITIES } from "../src/revenue-pilot.ts";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "sara-capability-migration-"));
  cleanup.push(path);
  return path;
}

describe("versioned production revenue capability migration", () => {
  it("registers exact implementation-bound capabilities once and survives restart", async () => {
    const stateDirectory = await directory();
    const options = {
      stateDirectory,
      ownerTokenSha256: sha256("capability-owner"),
      bootstrapRevenueCapabilities: true,
    };
    const first = await SaraKernel.boot(options);
    const firstStatus = await first.getStatus();
    assert.deepEqual(firstStatus.capabilities.map(({ id }) => id).sort(), [...PILOT_REQUIRED_CAPABILITIES].sort());
    assert.ok(firstStatus.capabilities.every((capability) =>
      capability.status === "available" &&
      capability.registration?.evidenceVersion === REVENUE_CAPABILITY_EVIDENCE_VERSION &&
      /^[a-f0-9]{64}$/u.test(capability.registration.implementationDigest)
    ));
    const registrationCount = (await first.inspectAudit()).filter(({ type }) => type === "capability_registered").length;

    const restarted = await SaraKernel.boot(options);
    assert.equal(
      (await restarted.inspectAudit()).filter(({ type }) => type === "capability_registered").length,
      registrationCount,
    );
  });

  it("refuses conflicting available evidence rather than overwriting it", async () => {
    const stateDirectory = await directory();
    const base = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256("capability-owner") });
    const candidate = (await verifiedRevenueCapabilities())[0]!;
    await base.registerCapability(SARA_PRINCIPAL, {
      ...candidate,
      registration: { ...candidate.registration!, evidenceDigest: "f".repeat(64) },
    });
    await assert.rejects(
      () => SaraKernel.boot({
        stateDirectory,
        ownerTokenSha256: sha256("capability-owner"),
        bootstrapRevenueCapabilities: true,
      }),
      /changed without a stronger evidence version/iu,
    );
  });

  it("replaces limited evidence but preserves a stronger future version", async () => {
    const stateDirectory = await directory();
    const base = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256("capability-owner") });
    const [candidate] = await verifiedRevenueCapabilities();
    await base.registerCapability(SARA_PRINCIPAL, { ...candidate!, status: "limited" });
    const migrated = await SaraKernel.boot({
      stateDirectory,
      ownerTokenSha256: sha256("capability-owner"),
      bootstrapRevenueCapabilities: true,
    });
    assert.equal((await migrated.getStatus()).capabilities.find(({ id }) => id === candidate!.id)?.status, "available");

    const strongerDirectory = await directory();
    const stronger = await SaraKernel.boot({ stateDirectory: strongerDirectory, ownerTokenSha256: sha256("capability-owner") });
    await stronger.registerCapability(SARA_PRINCIPAL, {
      ...candidate!,
      registration: { ...candidate!.registration!, evidenceVersion: 2 },
    });
    const preserved = await SaraKernel.boot({
      stateDirectory: strongerDirectory,
      ownerTokenSha256: sha256("capability-owner"),
      bootstrapRevenueCapabilities: true,
    });
    assert.equal(
      (await preserved.getStatus()).capabilities.find(({ id }) => id === candidate!.id)?.registration?.evidenceVersion,
      2,
    );
  });
});
