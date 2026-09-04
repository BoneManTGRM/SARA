import { canonicalJson, sha256 } from "./canonical.ts";
import type { CodingRepairProposal, CodingRepairReceipt } from "./coding-repair-types.ts";

export function digestCodingRepairProposal(proposal: CodingRepairProposal): string {
  return sha256(canonicalJson(proposal));
}

export function assertReceiptChain(receipts: readonly CodingRepairReceipt[]): void {
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    if (receipt.cycle !== index + 1) throw new Error("Coding repair receipt cycle is not contiguous.");
    if (index > 0) {
      const previous = receipts[index - 1];
      const expected = previous.afterArtifactDigest ?? previous.beforeArtifactDigest;
      if (receipt.beforeArtifactDigest !== expected) throw new Error("Coding repair receipt chain is not artifact-bound.");
    }
    if (receipt.accountedCostUsd < 0 || !Number.isFinite(receipt.accountedCostUsd)) {
      throw new Error("Coding repair receipt cost is invalid.");
    }
  }
}
