import { execFileSync } from "node:child_process";
import { persistentBenchmarkStateDirectory } from "../src/coding-benchmark-owner.ts";

// Read-only capability inventory. This does not create a grant, initialize an
// execution claim, send a provider request, or qualify any benchmark image.
const blockers: string[] = [];
let docker = false, persistentStateDirectory: string | null = null;
try {
  execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8", timeout: 10000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"],
  });
  docker = true;
} catch { blockers.push("DOCKER_RUNNER_UNAVAILABLE"); }
try { persistentStateDirectory = await persistentBenchmarkStateDirectory(process.env.SARA_STATE_DIRECTORY); }
catch { blockers.push("PERSISTENT_BENCHMARK_STORAGE_UNAVAILABLE"); }
const modelCredentialPresent = Boolean(process.env.OPENAI_API_KEY?.trim());
const ownerCredentialPresent = Boolean(process.env.SARA_OWNER_TOKEN?.trim() && process.env.SARA_OWNER_TOKEN_SHA256?.trim());
if (!modelCredentialPresent) blockers.push("MODEL_CREDENTIAL_UNAVAILABLE");
if (!ownerCredentialPresent) blockers.push("OWNER_AUTHENTICATION_CONFIGURATION_UNAVAILABLE");
console.log(JSON.stringify({ schemaVersion: 1, scope: "current_runner_capabilities_only", docker,
  persistentStateDirectory, modelCredentialPresent, ownerCredentialPresent,
  credentialsVerified: false, runnerCapabilitiesAvailable: blockers.length === 0, blockers,
  grantActivated: false, modelCalls: 0, executionClaimCreated: false,
  remainingRequiredGates: ["all_ten_images_and_official_controls_qualified", "fresh_source_bound_registration",
    "authenticated_owner_approval_of_exact_allowance", "runtime_authority_configured"] }, null, 2));
