import { spawn } from "node:child_process";
import { once } from "node:events";
import { isAbsolute, relative, resolve, sep } from "node:path";

function pathContains(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

if (process.env.SARA_RUN_CODING_SPEED_BENCHMARK === "true") {
  const child = spawn(
    process.execPath,
    ["scripts/standalone-coding-speed-live.mjs"],
    { stdio: "inherit", env: process.env },
  );
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Coding-speed benchmark exited via signal ${signal}.`));
      else resolveExit(code ?? 1);
    });
  });
  process.exit(exitCode);
} else {
  const { installOwnerDashboardThemeRuntime } = await import("../src/owner-dashboard-theme-runtime.ts");
  installOwnerDashboardThemeRuntime();
  const { kernel, server } = await import("../src/main.ts");
  if (!server.listening) await once(server, "listening");

  const sourceRevision = process.env.RAILWAY_GIT_COMMIT_SHA ?? "";
  const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID ?? "";
  const stateDirectory = resolve(process.env.SARA_STATE_DIRECTORY ?? "./state");

  try {
    const { readProductionStateFingerprint } = await import("../src/production-state-fingerprint.ts");
    const state = await readProductionStateFingerprint(stateDirectory);
    const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    const persistentVolumeMountMatches = typeof volumeMount === "string" &&
      volumeMount.length > 0 && pathContains(volumeMount, stateDirectory);
    console.log(JSON.stringify({
      event: "sara_release_state_attestation",
      status: "verified",
      schemaVersion: 1,
      sourceRevision: /^[a-f0-9]{40}$/u.test(sourceRevision) ? sourceRevision : null,
      deploymentId: /^[A-Za-z0-9-]{8,}$/u.test(deploymentId) ? deploymentId : null,
      applicationVersion: process.env.npm_package_version ?? null,
      stateDirectoryClass: persistentVolumeMountMatches ? "persistent_volume" : "configured_other",
      persistentVolumeMountMatches,
      workerConfiguration: {
        autonomousLearningEnabled: process.env.SARA_AUTONOMOUS_LEARNING_ENABLED === "true",
        workersPlan: process.env.SARA_WORKERS_PLAN === "free"
          ? "free"
          : process.env.SARA_WORKERS_PLAN
            ? "configured_nonfree"
            : "missing",
        cloudflareConfigured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
        ownerAuthenticationConfigured: Boolean(process.env.SARA_OWNER_TOKEN_SHA256 || process.env.SARA_OWNER_TOKEN),
      },
      state,
    }));
  } catch {
    console.error(JSON.stringify({
      event: "sara_release_state_attestation",
      status: "not_verified",
      sourceRevision: /^[a-f0-9]{40}$/u.test(sourceRevision) ? sourceRevision : null,
      deploymentId: /^[A-Za-z0-9-]{8,}$/u.test(deploymentId) ? deploymentId : null,
    }));
  }

  if (/^[a-f0-9]{40}$/u.test(sourceRevision) && /^[A-Za-z0-9-]{8,}$/u.test(deploymentId)) {
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("TCP_RUNTIME_ADDRESS_REQUIRED");
      const { runSafeCapabilityRuntimeProof } = await import("../src/digital-capabilities/production-proof.ts");
      const proof = await runSafeCapabilityRuntimeProof({ kernel, port: address.port, sourceRevision, deploymentId, environment: "PRODUCTION" });
      console.log(JSON.stringify({ event: "sara_capability_runtime_proof", ...proof }));
    } catch {
      console.error(JSON.stringify({ event: "sara_capability_runtime_proof", status: "failed_closed", sourceRevision, deploymentId }));
    }
    try {
      const { runSafeEngineeringRuntimeProof } = await import("../src/digital-capabilities/engineering/runtime-proof.ts");
      const proof = await runSafeEngineeringRuntimeProof({ kernel, sourceRevision, deploymentId, environment: "PRODUCTION" });
      console.log(JSON.stringify({ event: "sara_engineering_runtime_proof", ...proof }));
    } catch {
      console.error(JSON.stringify({ event: "sara_engineering_runtime_proof", status: "failed_closed", sourceRevision, deploymentId }));
    }
    try {
      const { runBoundProductionProceduralReuseProof } = await import("../src/production-procedural-reuse.ts");
      const proof = await runBoundProductionProceduralReuseProof({
        stateDirectory,
        sourceRevision,
        deploymentId,
        grantedAuthorities: ["runtime_read"],
        runtime: {
          projectId: process.env.RAILWAY_PROJECT_ID ?? "",
          serviceId: process.env.RAILWAY_SERVICE_ID ?? "",
          serviceName: process.env.RAILWAY_SERVICE_NAME ?? "",
          environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? "",
          environmentName: process.env.RAILWAY_ENVIRONMENT_NAME ?? "",
          volumeMountPath: process.env.RAILWAY_VOLUME_MOUNT_PATH ?? "",
        },
      });
      console.log(JSON.stringify({
        event: "sara_procedural_reuse_proof",
        status: proof.outcome === "VERIFIED" ? "verified" : "not_verified",
        taskFamily: proof.taskFamily,
        classification: proof.classification,
        playbook: proof.playbook,
        applicability: proof.applicability,
        priorEvidence: proof.priorEvidence,
        freshVerification: proof.freshVerification,
        efficiency: proof.efficiency,
        runtimeBoundary: proof.runtimeBoundary,
      }));
    } catch {
      console.error(JSON.stringify({ event: "sara_procedural_reuse_proof", status: "failed_closed" }));
    }
  }
}
