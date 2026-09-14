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
  it('preserves frozen serving v8 inventory evidence and prior audit through the source-readiness upgrade and restart', async () => {
    const stateDirectory=await directory();
    const options={stateDirectory,ownerTokenSha256:sha256('synthetic-v8-owner')};
    const old=await SaraKernel.boot(options);
    const candidate=(await verifiedRevenueCapabilities())[0]!;
    await old.registerCapability(SARA_PRINCIPAL,{...candidate,evidence:['implementation-sha256:009f3917714c4045f95e24a6d34acc18de2368f657527654130e32a86d6bda50'],registration:{...candidate.registration!,evidenceVersion:8,implementationDigest:'009f3917714c4045f95e24a6d34acc18de2368f657527654130e32a86d6bda50',evidenceDigest:'e1ea08239cb20f297658352965ef37b9cd9a8e04041b7136f0737c61f99dbf3c'}});
    const prefix=await old.inspectAudit();
    const upgraded=await SaraKernel.boot({...options,bootstrapRevenueCapabilities:true});
    assert.deepEqual((await upgraded.inspectAudit()).slice(0,prefix.length),prefix);
    assert.equal((await upgraded.getStatus()).capabilities.find(c=>c.id===candidate.id)?.registration?.evidenceVersion,9);
    const events=await upgraded.inspectAudit();
    const restarted=await SaraKernel.boot({...options,bootstrapRevenueCapabilities:true});
    const after=await restarted.inspectAudit();
    assert.deepEqual(after.slice(0,events.length),events);
    assert.deepEqual(after.slice(events.length).map(e=>e.type),['system_booted']);
    assert.deepEqual((await restarted.getStatus()).capabilities,(await upgraded.getStatus()).capabilities);
  });
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
      registration: { ...candidate!.registration!, evidenceVersion: REVENUE_CAPABILITY_EVIDENCE_VERSION + 1 },
    });
    const preserved = await SaraKernel.boot({
      stateDirectory: strongerDirectory,
      ownerTokenSha256: sha256("capability-owner"),
      bootstrapRevenueCapabilities: true,
    });
    assert.equal(
      (await preserved.getStatus()).capabilities.find(({ id }) => id === candidate!.id)?.registration?.evidenceVersion,
      REVENUE_CAPABILITY_EVIDENCE_VERSION + 1,
    );
  });

  it("upgrades the previous production evidence version after implementation changes", async () => {
    const stateDirectory = await directory();
    const base = await SaraKernel.boot({ stateDirectory, ownerTokenSha256: sha256("capability-owner") });
    const [candidate] = await verifiedRevenueCapabilities();
    await base.registerCapability(SARA_PRINCIPAL, {
      ...candidate!,
      registration: {
        ...candidate!.registration!,
        evidenceVersion: REVENUE_CAPABILITY_EVIDENCE_VERSION - 1,
        implementationDigest: "a".repeat(64),
        evidenceDigest: "b".repeat(64),
      },
    });

    const migrated = await SaraKernel.boot({
      stateDirectory,
      ownerTokenSha256: sha256("capability-owner"),
      bootstrapRevenueCapabilities: true,
    });
    const upgraded = (await migrated.getStatus()).capabilities.find(({ id }) => id === candidate!.id);
    assert.equal(upgraded?.registration?.evidenceVersion, REVENUE_CAPABILITY_EVIDENCE_VERSION);
    assert.equal(upgraded?.registration?.implementationDigest, candidate!.registration?.implementationDigest);
  });
});
