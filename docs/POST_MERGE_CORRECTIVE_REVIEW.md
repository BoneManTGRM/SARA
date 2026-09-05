# Corrective review of the PR90 consolidation

The owner requested correction of issues that should have been caught before merging.
The reviewed baseline is main `195b2e379b0644bd27581fd7452ddff30d2b83c8`, with tree
`b95834d559ade04c882aa9500016e9a8ac4fc378`, identical to candidate `bc99d0801cdd0cc26d66c51f54c294d44acfb59e`.
The earlier passing tests did not cover the defects below. This correction does not
claim that source isolation or a green CI run makes defective code acceptable.

## Reproduced defects and corrections

| Boundary | Reproduction | Correction |
|---|---|---|
| Experimental V5 verification | A claimed pass with no required checks, no evidence, an invalid digest, or a different artifact digest was accepted. Unknown check names reached model input. | Validate bounded typed verification records; require all five checks for a pass; independently recompute candidate source identity before accepting the returned digest. |
| Experimental V5 accounting | A model response retained by its caller could be changed during asynchronous verification, making receipts and the gauge disagree with the accounted total. | Snapshot the response before validation or asynchronous verification; preserve known request cost when later verification is rejected. |
| Experimental proposal contract | Extra authority fields and an oversized single-line replacement were accepted by the isolated validator. | Enforce the exact root/change fields, typed arrays, and the existing 16 KiB per-file replacement ceiling before source analysis. |
| Guarded repair memory | A regex-coercible array was accepted as verification evidence; a non-boolean lookup result could select a recipe. | Use strict primitive digest and verification checks; malformed lookup evidence cannot select a recipe. |
| External claim helper | A regex-coercible array was accepted as an experiment identifier. | Require primitive string identifiers before filesystem admission. |
| Historical pair arithmetic | Finite positive input times could overflow the derived ratio or percentage, producing an unsupported successful speed claim. | Reject non-finite or underflowed comparison arithmetic; return null metrics and INCONCLUSIVE. Historical evidence is not rescored. |
| Optional compiler cache | A mutated SourceFile escaped into another host; identical callback source text with different captured state reused the wrong parse context. | Retain immutable declaration text only. Reparse each request with its actual current options/callback. Do not retain or share mutable AST nodes. |

## Regression evidence and review requirements

`tests/post-merge-correctness.test.ts` contains 16 negative regression cases and
one positive integration control using the real TypeScript verifier with a scripted
repair and an explicit behavior callback. On the original unmodified source tree,
all 16 negative regressions failed and the positive control passed. No provider
model was used. The same test file must pass against the corrective source.

Existing isolated-controller test fixtures now use the repository's canonical
artifact identity and nonempty evidence instead of placeholder hashes or empty
proof arrays. Their existing behavioral assertions remain. The cache test now
requires fresh nodes rather than preserving the defective cross-request identity.
The original acceptance corpus, production controller, frozen comparison task,
protected benchmark tests, package manifest/lockfile and production startup remain
unchanged. No tests are disabled or marked skipped.

Before merging this corrective PR, require complete CI and CodeQL on its final
source, a final integrated diff review, and an exact tree comparison. Local timeout
logs are not counted as successful verification. Review is AI source review, not
an independent human approval or a mathematical guarantee of no remaining defects.

## Operational and evidence boundaries

The compiler compatibility class remains default-off. Its counters explicitly say
`reuseKind: immutable_declaration_text`; a hit is not a skipped parse. This removes
an unsafe optimization and establishes no new coding-speed or memory-usage claim.
Fresh Program/checker construction and independent behavioral checks remain.

Structured evidence validation checks completeness and source binding; it cannot
turn a dishonest verifier or caller-invented hashes into trustworthy evidence.
The verifier and the source of owner grants must remain trusted. Repair memory is
still an in-memory proof mechanism, not production cross-job learning.

No experimental feature is activated. No production deployment, paid model
request, price change, historical benchmark replay or hold release is performed.
The original unresolved $0.15 hold and consumed contracts remain unchanged.
PR69 and NICO/Gmail work are outside this correction.
