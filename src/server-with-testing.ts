import type { SaraKernel } from "./kernel.ts";
import type { WorkerModelClient } from "./model-router.ts";
import type { PublicRepositoryEvidenceCollector } from "./public-repository-evidence.ts";
import { createSaraServer } from "./server.ts";

export type RevenuePilotTestingServerOptions = Parameters<typeof createSaraServer>[1] & {
  revenuePilotTesting?: {
    modelClient: WorkerModelClient;
    repositoryEvidenceCollector: PublicRepositoryEvidenceCollector;
    monthlyBudgetUsd: number;
  };
};

export function createSaraServerWithTesting(
  kernel: SaraKernel,
  options: RevenuePilotTestingServerOptions,
): ReturnType<typeof createSaraServer> {
  const { revenuePilotTesting: _testing, ...baseOptions } = options;
  return createSaraServer(kernel, baseOptions);
}
