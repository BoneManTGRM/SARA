import type { ProgramCandidateProposal } from "./types.ts";

export type CodingRepairSourceChangeSummary = {
  schemaVersion: 1;
  path: string;
  beforeContentDigest: string;
  afterContentDigest: string;
  addedSignals: string[];
  removedSignals: string[];
  signalDigest: string;
};

export function summarizeCodingRepairSourceChanges(_input: {
  before: ProgramCandidateProposal;
  after: ProgramCandidateProposal;
  changedPaths: readonly string[];
}): CodingRepairSourceChangeSummary[] {
  return [];
}
