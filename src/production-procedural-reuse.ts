import { isAbsolute, relative, resolve } from "node:path";
import { runProductionProceduralReuseProof } from "./procedural-intelligence.ts";

export interface ProductionRailwayRuntimeIdentity {
  projectId: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  environmentName: string;
  volumeMountPath: string;
}

const EXPECTED_PRODUCTION_RUNTIME: Readonly<ProductionRailwayRuntimeIdentity> = Object.freeze({
  projectId: "38244a88-dc3d-44bd-ba81-ccfd5309b8c2",
  serviceId: "ecb1a55e-5ae1-447e-885b-0bbe31b352b5",
  serviceName: "sara-operator",
  environmentId: "5d9e378d-459b-4300-983b-9457f140aff5",
  environmentName: "production",
  volumeMountPath: "/data",
});

function sameRuntimeIdentity(actual: ProductionRailwayRuntimeIdentity): boolean {
  return actual.projectId === EXPECTED_PRODUCTION_RUNTIME.projectId &&
    actual.serviceId === EXPECTED_PRODUCTION_RUNTIME.serviceId &&
    actual.serviceName === EXPECTED_PRODUCTION_RUNTIME.serviceName &&
    actual.environmentId === EXPECTED_PRODUCTION_RUNTIME.environmentId &&
    actual.environmentName === EXPECTED_PRODUCTION_RUNTIME.environmentName &&
    actual.volumeMountPath === EXPECTED_PRODUCTION_RUNTIME.volumeMountPath;
}

export function validateProductionRailwayIdentity(input: {
  stateDirectory: string;
  runtime: ProductionRailwayRuntimeIdentity;
}): { stateDirectory: string; runtime: ProductionRailwayRuntimeIdentity } {
  if (!sameRuntimeIdentity(input.runtime)) throw new Error("PROCEDURAL_PRODUCTION_RUNTIME_IDENTITY_MISMATCH");

  const stateDirectory = resolve(input.stateDirectory);
  const volumeMountPath = resolve(input.runtime.volumeMountPath);
  const relativeStatePath = relative(volumeMountPath, stateDirectory);
  if (relativeStatePath.startsWith("..") || isAbsolute(relativeStatePath)) {
    throw new Error("PROCEDURAL_PRODUCTION_STATE_NOT_ON_PERSISTENT_VOLUME");
  }

  return { stateDirectory, runtime: structuredClone(input.runtime) };
}

export async function runBoundProductionProceduralReuseProof(input: {
  stateDirectory: string;
  sourceRevision: string;
  deploymentId: string;
  grantedAuthorities: string[];
  runtime: ProductionRailwayRuntimeIdentity;
}): Promise<any> {
  const boundary = validateProductionRailwayIdentity({ stateDirectory: input.stateDirectory, runtime: input.runtime });
  const proof = await runProductionProceduralReuseProof({
    stateDirectory: boundary.stateDirectory,
    sourceRevision: input.sourceRevision,
    deploymentId: input.deploymentId,
    grantedAuthorities: input.grantedAuthorities,
  });
  return {
    ...proof,
    runtimeBoundary: {
      projectId: boundary.runtime.projectId,
      serviceId: boundary.runtime.serviceId,
      serviceName: boundary.runtime.serviceName,
      environmentId: boundary.runtime.environmentId,
      environmentName: boundary.runtime.environmentName,
      volumeMountPath: boundary.runtime.volumeMountPath,
      stateDirectory: boundary.stateDirectory,
    },
  };
}
