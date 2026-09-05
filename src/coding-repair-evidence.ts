import { canonicalJson, sha256 } from "./canonical.ts";

export type AuthorityBoundBenchmarkEvidence<T> = T & {
  authorityDigest: string;
  evidenceEnvelopeDigest: string;
};

export function bindCodingRepairBenchmarkAuthority<
  T extends { authority: unknown; contractDigest: string; pairDigest: string },
>(result: T): AuthorityBoundBenchmarkEvidence<T> {
  const authorityDigest = sha256(canonicalJson(result.authority));
  const evidenceEnvelopeDigest = sha256(canonicalJson({
    schemaVersion: 1,
    authorityDigest,
    contractDigest: result.contractDigest,
    pairDigest: result.pairDigest,
  }));
  return {
    ...result,
    authorityDigest,
    evidenceEnvelopeDigest,
  };
}
