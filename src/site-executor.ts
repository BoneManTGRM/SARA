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
  try {
    const result = await runClaimedSiteDirective(
      dependencies.kernel,
      dependencies.stateDirectory,
      claimed.directive,
      dependencies.publisher,
    );
    await dependencies.record(claimed.directive.id, claimed.claim.id, result);
    return "SHADOW_RECORDED";
  } catch (error) {
    const failureInput = error instanceof Error
      ? `${error.name}:${error.message}`
      : "UnknownError:non-error rejection";
    const result: SiteDirectiveFailedResult = {
      schemaVersion: 1,
      status: "FAILED",
      maximumCostUsd: 0,
      generatorId: siteGeneratorId(claimed.directive),
      failureCode: "SELF_BUILD_EXECUTION_FAILED",
      failureDigest: sha256(failureInput),
      lessons: [
        "The candidate was rejected before production authority was possible.",
        "Inspect the bounded workflow logs and fix the verified failure before retrying.",
      ],
    };
    await dependencies.record(claimed.directive.id, claimed.claim.id, result);
    throw new Error("Self-build directive failed after recording bounded evidence.");
  }
}
