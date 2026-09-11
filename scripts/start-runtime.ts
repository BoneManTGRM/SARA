import { spawn } from "node:child_process";
import { resolve } from "node:path";

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
  await import("../src/main.ts");

  const sourceRevision = process.env.RAILWAY_GIT_COMMIT_SHA ?? "";
  const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID ?? "";
  if (/^[a-f0-9]{40}$/u.test(sourceRevision) && /^[A-Za-z0-9-]{8,}$/u.test(deploymentId)) {
    try {
      const { runProductionProceduralReuseProof } = await import("../src/procedural-intelligence.ts");
      const proof = await runProductionProceduralReuseProof({
        stateDirectory: resolve(process.env.SARA_STATE_DIRECTORY ?? "./state"),
        sourceRevision,
        deploymentId,
        grantedAuthorities: ["runtime_read"],
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
      }));
    } catch {
      console.error(JSON.stringify({ event: "sara_procedural_reuse_proof", status: "failed_closed" }));
    }
  }
}
