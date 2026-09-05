import { assertCodingBenchmarkSourceRevision } from "./coding-repair-benchmark-command.ts";

export type CodingBenchmarkSourceIdentityMethod = "git_checkout" | "railway_deployment_metadata";

export function verifyCodingBenchmarkSourceIdentity(input: {
  expectedRevision: string;
  gitRevision?: string;
  gitTrackedChanges?: string;
  railwayGitCommitSha?: string;
}): CodingBenchmarkSourceIdentityMethod {
  const hasGitIdentity = input.gitRevision !== undefined || input.gitTrackedChanges !== undefined;
  if (hasGitIdentity) {
    if (input.gitRevision === undefined || input.gitTrackedChanges === undefined) {
      throw new Error("The coding benchmark received incomplete Git source identity evidence.");
    }
    assertCodingBenchmarkSourceRevision(input.expectedRevision, input.gitRevision);
    if (input.gitTrackedChanges.trim()) {
      throw new Error("The live coding benchmark requires a clean tracked source checkout.");
    }
    return "git_checkout";
  }

  const railwayRevision = input.railwayGitCommitSha?.trim().toLowerCase() ?? "";
  if (!railwayRevision) {
    throw new Error("The live coding benchmark could not establish exact source identity.");
  }
  try {
    assertCodingBenchmarkSourceRevision(input.expectedRevision, railwayRevision);
  } catch {
    throw new Error("Railway deployment source revision does not match the benchmark-bound revision.");
  }
  return "railway_deployment_metadata";
}
