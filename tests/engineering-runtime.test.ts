import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaraKernel } from "../src/kernel.ts";
import { sha256 } from "../src/canonical.ts";
import type { Json } from "../src/digital-capabilities/schema.ts";
type RuntimeProof = { status: string; provenance: string; sourceRevision: string; productionBehaviorClaimed: boolean; capabilityCount: number; checks: Record<string, boolean>; receiptDigests: string[]; authorityDelta: number };
type Runner = (input: { kernel: SaraKernel; sourceRevision: string; deploymentId: string; environment: "ISOLATED" | "PRODUCTION" }) => Promise<RuntimeProof>;
async function getRunner(): Promise<Runner> {
  const module = await import("../src/digital-capabilities/engineering/runtime-proof.ts").catch(() => null);
  assert.equal(typeof module?.runSafeEngineeringRuntimeProof, "function", "Engineering capability deployment requires an actual safe-runtime proof runner.");
  return module!.runSafeEngineeringRuntimeProof as Runner;
}
for (const stopped of [false, true]) test(`all seventeen engineering capabilities run without effects while emergency stop is ${stopped}`, async () => {
  const run = await getRunner(), directory = await mkdtemp(join(tmpdir(), "sara-engineering-runtime-"));
  try {
    const kernel = await SaraKernel.boot({ stateDirectory: directory, ownerTokenSha256: sha256("runtime-test-owner") });
    if (stopped) await kernel.setEmergencyStop(kernel.authenticateOwnerToken("runtime-test-owner"), true);
    const before = await kernel.getStatus();
    const input = { kernel, sourceRevision: "a".repeat(40), deploymentId: "isolated-fixture-deployment", environment: "ISOLATED" as const };
    const proof = await run(input);
    assert.equal(proof.status, "VERIFIED"); assert.equal(proof.capabilityCount, 17); assert.equal(proof.receiptDigests.length, 17);
    assert.equal(proof.productionBehaviorClaimed, false); assert.equal(proof.provenance, "ISOLATED"); assert.equal(proof.authorityDelta, 0);
    assert.ok(Object.values(proof.checks).every(Boolean));
    const auditCount = (await kernel.inspectAudit()).length;
    assert.deepEqual((await run(input)).receiptDigests, proof.receiptDigests);
    assert.equal((await kernel.inspectAudit()).length, auditCount);
    const after = await kernel.getStatus();
    assert.deepEqual(after.realizedProfit, before.realizedProfit); assert.deepEqual(after.standingMandate, before.standingMandate);
    assert.equal(after.emergencyStopped, stopped); assert.deepEqual(after.mutations, before.mutations);
    const registered = (await kernel.inspectCapabilityContracts()).filter(row => proof.receiptDigests.length && row.id !== "self-benchmark-runner");
    assert.ok(registered.length >= 17);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
