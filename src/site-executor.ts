import { PublicationCommandFailure } from "./github-draft-publisher.ts";
import { sha256 } from "./canonical.ts";
import type { SaraKernel } from "./kernel.ts";
import type { SiteDirectiveClaim, SiteDirectiveFailedResult } from "./site-executor-client.ts";
import {
  runClaimedSiteDirective,
  siteGeneratorId,
  type DraftPullRequestPublisher,
  type SiteDirectiveShadowResult,
} from "./site-directive.ts";

type ExecutorDependencies = {
  kernel: SaraKernel;
  stateDirectory: string;
  executionUrl?: string;
  claim(): Promise<SiteDirectiveClaim | null>;
  record(
    directiveId: string,
    claimId: string,
    result: SiteDirectiveShadowResult | SiteDirectiveFailedResult,
  ): Promise<void>;
  publisher: DraftPullRequestPublisher;
};

export async function executeOneSiteDirective(
  dependencies: ExecutorDependencies,
): Promise<"NO_DIRECTIVE" | "SHADOW_RECORDED"> {
  const claimed = await dependencies.claim();
  if (!claimed) return "NO_DIRECTIVE";
  const execution: { phase: "candidate" | "publication" | "recording" } = { phase: "candidate" };
  try {
    const result = await runClaimedSiteDirective(
      dependencies.kernel,
      dependencies.stateDirectory,
      claimed.directive,
      { async publish(candidate) { execution.phase = "publication"; return dependencies.publisher.publish(candidate); } },
    );
    execution.phase = "recording";
    await dependencies.record(claimed.directive.id, claimed.claim.id, result);
    return "SHADOW_RECORDED";
  } catch (error) {
    // A lost recording response does not prove the published result was rejected.
    // Preserve uncertainty instead of issuing a contradictory second write.
    if (execution.phase === "recording") throw new Error("Self-build result recording is uncertain; reconcile the existing claim before retrying.");
    const failureCode = error instanceof PublicationCommandFailure ? error.failureCode
      : execution.phase === "publication" ? "DRAFT_PUBLICATION_FAILED" : "CANDIDATE_VERIFICATION_FAILED";
    const failureInput = error instanceof Error
      ? `${error.name}:${error.message}`
      : "UnknownError:non-error rejection";
    const result: SiteDirectiveFailedResult = {
      schemaVersion: 1,
      status: "FAILED",
      maximumCostUsd: 0,
      generatorId: siteGeneratorId(claimed.directive),
      failureCode,
      ...(error instanceof PublicationCommandFailure ? { outputDigest: error.outputDigest } : {}),
      ...(dependencies.executionUrl && /^https:\/\/github\.com\/BoneManTGRM\/SARA\/actions\/runs\/[1-9][0-9]*$/.test(dependencies.executionUrl) ? { executionUrl: dependencies.executionUrl } : {}),
      failureDigest: sha256(failureInput),
      lessons: [
        "The candidate was rejected before production authority was possible.",
        "Inspect the bounded workflow logs and fix the verified failure before retrying.",
      ],
    };
    await dependencies.record(claimed.directive.id, claimed.claim.id, result);
    throw new Error(`Self-build directive failed after recording bounded evidence. [${failureCode}]`);
  }
}
