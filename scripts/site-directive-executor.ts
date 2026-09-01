import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { GithubDraftPullRequestPublisher } from "../src/github-draft-publisher.ts";
import { SaraKernel } from "../src/kernel.ts";
import { executeOneSiteDirective } from "../src/site-executor.ts";
import {
  claimSiteDirective,
  recordSiteDirectiveResult,
  requestGithubOidcToken,
} from "../src/site-executor-client.ts";

const workspaceValue = process.env.GITHUB_WORKSPACE;
const runnerTempValue = process.env.RUNNER_TEMP;
if (!workspaceValue || !runnerTempValue) {
  throw new Error("GitHub workspace and runner temp directories are required.");
}
const repository = resolve(workspaceValue);
const stateDirectory = resolve(runnerTempValue, "sara-self-build-state");
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });

const oidcToken = await requestGithubOidcToken();
const kernel = await SaraKernel.boot({ stateDirectory });
const outcome = await executeOneSiteDirective({
  kernel,
  stateDirectory,
  claim: () => claimSiteDirective(oidcToken),
  record: (directiveId, claimId, result) =>
    recordSiteDirectiveResult(oidcToken, directiveId, claimId, result),
  publisher: new GithubDraftPullRequestPublisher({ repository }),
});

console.log(outcome === "NO_DIRECTIVE" ? "No authorized self-build directive is queued." : "Verified SHADOW draft PR evidence recorded.");
