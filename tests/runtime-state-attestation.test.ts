import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { test } from "node:test";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function readRuntimeAttestation(stateDirectory: string, volumeMount: string): Promise<Record<string, unknown>> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/start-runtime.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: "0",
        SARA_HOST: "127.0.0.1",
        SARA_STATE_DIRECTORY: stateDirectory,
        SARA_OWNER_TOKEN_SHA256: sha256("runtime-attestation-test-owner"),
        SARA_AUTONOMOUS_LEARNING_ENABLED: "false",
        SARA_REPARODYNAMIC_CODING_MODE: "off",
        SARA_LIVE_PROOF_ON_START: "false",
        OPENAI_API_KEY: "",
        CLOUDFLARE_ACCOUNT_ID: "",
        CLOUDFLARE_API_TOKEN: "",
        RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
        RAILWAY_DEPLOYMENT_ID: "test-deployment-1",
        RAILWAY_VOLUME_MOUNT_PATH: volumeMount,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for runtime attestation. stdout=${stdout.slice(-2_000)} stderr=${stderr.slice(-2_000)}`));
      }, 15_000);

      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Runtime exited before attestation. code=${code} signal=${signal} stdout=${stdout.slice(-2_000)} stderr=${stderr.slice(-2_000)}`));
      });
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        for (const line of stdout.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("{")) continue;
          try {
            const value = JSON.parse(trimmed) as Record<string, unknown>;
            if (value.event !== "sara_release_state_attestation") continue;
            clearTimeout(timeout);
            resolve(value);
            return;
          } catch {
            // Other startup output is intentionally ignored.
          }
        }
      });
    });
  } finally {
    await stopChild(child);
  }
}

test("runtime attestation recognizes a state directory nested under the Railway volume mount", async () => {
  const volumeRoot = await mkdtemp(join(tmpdir(), "sara-runtime-volume-"));
  try {
    const attestation = await readRuntimeAttestation(join(volumeRoot, "sara"), volumeRoot);
    assert.equal(attestation.status, "verified");
    assert.equal(attestation.persistentVolumeMountMatches, true);
    assert.equal(attestation.stateDirectoryClass, "persistent_volume");
  } finally {
    await rm(volumeRoot, { recursive: true, force: true });
  }
});

test("runtime attestation rejects a path-prefix collision outside the Railway volume mount", async () => {
  const parent = await mkdtemp(join(tmpdir(), "sara-runtime-prefix-"));
  try {
    const volumeRoot = join(parent, "data");
    const stateDirectory = join(parent, "data-other", "sara");
    const attestation = await readRuntimeAttestation(stateDirectory, volumeRoot);
    assert.equal(attestation.status, "verified");
    assert.equal(attestation.persistentVolumeMountMatches, false);
    assert.equal(attestation.stateDirectoryClass, "configured_other");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
