# Adaptive bounded coding-repair output

The owner-authenticated canary self-build route now selects the representation of
an uncached surgical repair before it calls the existing coding-model adapter.
A localized source module of at least 2,048 UTF-8 bytes, or an unlocalized repair
with a source module of at least 4,096 bytes, selects the existing literal-edit
contract from the first attempt. Smaller repairs and deep repairs keep the
existing full-file contract. These fixed thresholds are a conservative heuristic,
not a calibrated latency or model-quality predictor.

The selection does not read protected test text or test size for its decision.
It checks the candidate and its current failed-verification digest, preserves the
controller-owned strategy/cycle/budget, and snapshots the request and context
across asynchronous receipt persistence. The normal byte-identical small-task
prompt and all direct/frozen benchmark callers remain unchanged. Off and shadow
modes do not enable the adaptive model in the server.

Literal edits expand against the exact original file digest. Absent, ambiguous,
overlapping, stale, protected-path, oversized or malformed edits are rejected by
the existing expander and proposal validator. Expansion is not verification: the
result still goes through unchanged mutation admission, fresh compilation and
isolated behavioral tests, the reuse wrapper's final check and independent kernel
verification. Invalid or uncertain provider output never causes an unaccounted
second full-file request. Existing controller limits and usage errors remain.

`coding-repair-receipts/<runId>/format-<cycle>.json` records a hash-bound format
**intent before dispatch**, not evidence of provider execution or success. It
contains only decision metadata, no source or hidden-test contents. The exclusive
private write is synchronized before token counting or execution. Receipt failure
is fatal to that attempt. Cache hits do not call the adapter or create format
intents. The new adapter and its dependencies enter repair-memory implementation
identity, so old implementation-scoped recipes invalidate rather than being
silently promoted. Generated programs still require the existing SHADOW/promotion
process; no autonomous production promotion is added.

## Tests and reproducible evidence

`tests/adaptive-coding-repair-model.test.ts` covers selection boundaries, byte
counting, protected-test independence, small prompt equivalence, input mutation,
receipt failures, stale/malformed output, charged-error preservation and real
verifier rejection of wrong behavior, wrong types and prohibited capabilities.
The HTTP integration test exercises the real local server and kernel, observes
compact output for a large cold job, restarts, and verifies learned repair reuse
without a second model or token-count call. Its model is scripted, not a provider.

Run `npm run verify`, then run
`node --import tsx proof/adaptive-repair-format.ts <new-output-directory>` in a
credential-free checkout. Existing output directories are rejected. The proof
uses three related authored multi-function programs (32, 64 and 128 scale
functions), known scripted repair responses, and three alternating pairs per
program: 18 completed jobs and 72 fresh full verifier invocations. Two checks
are controller checks, one mirrors the extra wrapper check, and the fourth is a
post-return diagnostic, not live kernel evidence. The HTTP test separately covers
the real kernel. Every unchanged scale function is exercised by the tests.

In the retained local run, 2,310-byte source modules kept full output (2,726-byte
response JSON). For 4,550-byte and 9,087-byte modules, response JSON decreased
from 4,998 and 9,599 bytes respectively to 459 bytes (90.82% and 95.22% smaller).
The compact prompt grew by 361 bytes; inputs are still sent in full. All paired
final program digests matched. This measures serialized JSON bytes, **not
billable tokens**, autonomous problem solving or production speed. In the same
scripted run, total processing was essentially flat (14.896s versus 14.804s),
and the two compact-selected groups were locally slower. There was no provider
latency or injected delay. Do not turn these byte savings into a time/cost ratio
or a 35x / +3,400% claim. A new live output-format qualification remains separate
from the completed and consumed benchmark authorizations.

No grants, model settings, provider endpoint, acceptance tests, frozen benchmark,
NICO integration, infrastructure, or production credentials are changed here.
