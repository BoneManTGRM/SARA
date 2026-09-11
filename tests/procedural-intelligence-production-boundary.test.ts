import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProductionRailwayIdentity } from "../src/production-procedural-reuse.ts";

const expected = {
  projectId: "38244a88-dc3d-44bd-ba81-ccfd5309b8c2",
  serviceId: "ecb1a55e-5ae1-447e-885b-0bbe31b352b5",
  serviceName: "sara-operator",
  environmentId: "5d9e378d-459b-4300-983b-9457f140aff5",
  environmentName: "production",
  volumeMountPath: "/data",
};

test("production procedural reuse proof is bound to the actual Railway project, service, environment, and persistent volume", () => {
  assert.doesNotThrow(() => validateProductionRailwayIdentity({
    stateDirectory: "/data",
    runtime: expected,
  }));

  assert.throws(() => validateProductionRailwayIdentity({
    stateDirectory: "/data",
    runtime: { ...expected, serviceName: "another-service" },
  }), /PROCEDURAL_PRODUCTION_RUNTIME_IDENTITY_MISMATCH/);

  assert.throws(() => validateProductionRailwayIdentity({
    stateDirectory: "/tmp/ephemeral",
    runtime: expected,
  }), /PROCEDURAL_PRODUCTION_STATE_NOT_ON_PERSISTENT_VOLUME/);
});
