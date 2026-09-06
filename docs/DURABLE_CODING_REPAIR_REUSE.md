# Durable exact-source repair reuse

## Scope and activation

The owner-authenticated `/api/jobs/:id/self-build` TypeScript path now uses a private,
bounded learned-repair store when Reparodynamic coding is already `canary`. `off`
and `shadow` retain their previous behavior and never read or populate this store.
This change does not alter the frozen live benchmark, renew its grants, call a
provider at startup, or automatically create a job. Existing authorization, job
budget, cycle limits, sandbox checks and promotion requirements still apply.
The returned mutation remains subject to the kernel's normal SHADOW/promotion
boundary. The existing in-memory proof prototype is unchanged.

## What is learned

Only source changes from a successful ordinary controller run are eligible. A
separate fresh full verification of the final candidate must pass, its source
digest must agree, and the existing receipt/run callbacks must succeed before
learning. The kernel subsequently performs its own independent verification; a
learned proposal is not a kernel promotion or proof of universal correctness.

Keys bind the exact complete starting candidate (including protected test bytes
and metadata), failure fingerprints, owner identity, objective, acceptance
criteria, missing capabilities, constitution, relevant implementation source,
locked dependencies and Node/platform/architecture identity. A changed key misses.
Job IDs are intentionally not in the key, so the same authorized contract can
reuse a repair across distinct jobs. Test contents are not stored in the recipe;
they are bound by the key. The store is not a general cross-repository retriever.

A hit supplies only an ordinary bounded repair proposal. The normal controller
still checks source hashes, file/line limits, protected paths and the actual
candidate. It still rolls back failures. A second fresh final verification and
the kernel verification remain mandatory. No PASS result, mutable compiler AST,
model response or hidden-test answer is cached as acceptance authority.

A failed hit is quarantined before the next normal controller cycle. It consumes
one of the existing cycles, not an extra hidden retry. The fallback model retains
the original remaining-cost limit. Unknown paid errors are not retried by this
layer. Memory misses, capacity exhaustion and ordinary unavailable-store errors
fall back to the normal generator without accepting unchecked source.

## Persistence and limits

The store is `<stateDirectory>/coding-repair-memory-v1/memory.json`, private to the
existing service volume. One exclusive directory lock serializes all readers and
writers; no lock is automatically broken. A process crash can therefore disable
reuse rather than lose a revocation. Writes use a private exclusive temporary
file, file synchronization, atomic rename and directory synchronization. A failure
after the rename begins retains the lock. A failed quarantine persistently
disables the entire store, including after restart, instead of reviving a recipe.
These are fail-closed application controls, not a claim that storage hardware can
never lose data. Symlink/nonregular/nonprivate/oversized/corrupt files are rejected.

At most 128 identities and 2 MiB of state are retained. Entries and quarantines
are not evicted or overwritten. Each recipe is limited to the existing six-file,
240-line deep ceiling; surgical retrieval also checks its two-file, 80-line ceiling.
Each replacement is capped at 16 KiB. Different evidence cannot resurrect a
quarantined identity. An ordinary missing/corrupt store never becomes authority.
Checksums detect inconsistency, not malicious writes by someone already controlling
the service account; fresh verification and the kernel remain essential.

Each run writes a private `coding-repair-receipts/:runId/reuse.json` with lookup
hits/misses, actual repair-model invocations, recipe identities/cycles, learning,
quarantine, unavailable-store status and extra verification status. Controller
strategy names continue to describe the chosen repair policy; the reuse receipt
distinguishes a retrieved proposal from a paid generation. Cached proposals have
zero provider token usage and zero model charge. No dollar saving is invented.

## Evidence and performance boundary

Run `node --import tsx --test tests/coding-repair-memory.test.ts
 tests/reusable-coding-candidate-generator.test.ts tests/coding-repair-reuse-http.test.ts`
(on one command line) and `npm run verify` without provider credentials.

The HTTP regression uses the actual server, owner authorization, model adapter,
controller, isolated verifier, durable receipts and kernel. Its model client is a
scripted fixture. It performs a cold repair, reboots the kernel/server, and verifies
that a second equivalent job uses no model execution or token-count call while
still returning a kernel-verified SHADOW mutation. Unauthenticated and repeated
same-job requests remain denied.

`node --import tsx proof/durable-repair-reuse.ts` runs 15 alternating-order pairs
across three authored constant-value fixtures, charging the three cold learning
jobs and all storage/scope costs. Both sides perform three full verifications per
job and receive identical scripted source repairs without delays. Expect 15
scripted generator invocations without reuse versus three with reuse, not a
measured live-model acceleration. The no-reuse CPU path can be faster because it
avoids memory overhead and its scripted generation is essentially instantaneous.
The receipt reports that result as measured, without adding historical live
provider latency or multiplying unrelated ratios. Partial executions are not
complete measurements. The 35x / +3400% end-to-end target remains unproven.

Future live qualification must use a fresh explicitly authorized bounded trial,
record cold/new and eligible-repeat workloads separately, preserve all failures,
charge learning/fallback/verification/storage, and include an equivalent ordinary-
memory comparison before attributing an advantage specifically to Reparodynamics.
Historical grants/results and their original source/test pins remain untouched.


## Converged concurrency and return-boundary protections

The previously separate PR114 candidate was not deployed as a competing store.
Its two fixes were reimplemented on this PR113 store without dropping owner or
failure-fingerprint keys, private-file permissions, the 2MiB bound, atomic
writes, or durable store disablement after uncertain quarantine.

A bounded FIFO serializes short local transactions across store objects: 32
outstanding operations per directory, 128 total. It prevents contended warm
lookups from unnecessarily becoming model calls. Models and verification never
run inside that queue. Saturation or a different process's existing lock remains
an optional cache failure; no lock is stolen, and cold simultaneous generation
is not deduplicated.

After all mandatory run and reuse-summary callbacks, every accepted recipe is
read and checked again for revocation and exact identity. Failed/rolled-back
hits are not treated as accepted contributions to a subsequent verified model
fallback. The earlier summary is not authority to return a revoked candidate.
This is not an atomic guarantee against revocation after the last check; the
kernel still independently verifies and retains its SHADOW/promotion barriers.

Five new concurrency/revocation regressions first failed on the original PR113
source before these fixes, then passed. Additional regressions cover bounded
queue overflow, corrupted-state recovery and retained interrupted locks. These
are credential-free tests, not a new paid comparison or a 35x performance claim.


## Bounded cold-learning coordination

A same-process coordinator now covers the first repair cycle when an exact
eligible recipe is not yet in memory. Its identity binds the private directory,
existing owner/task/source/test/failure scope, generator ID, strategy and remaining
model allowance. A leader runs its own unchanged bounded controller. Followers
receive only a completion notification, then read the durable recipe again and
execute their own fresh baseline/repair/final checks. The kernel still performs
its own verification. Warm reads without a learner remain parallel. No source,
allowance, token usage, authorization or PASS is shared by the coordinator.

Followers are released after required run and reuse receipts and return-boundary
checks. A newly learned recipe is quarantined (or the store is durably disabled
by the existing quarantine mechanism) if a later mandatory callback fails.
Leader failure, missing/revoked/ineligible results, coordinator saturation or
follower timeout abort that follower without another model dispatch. Later
separately authorized jobs retain normal admission and accounting controls.

Limits: 32 active identities, 32 waiters per identity and 128 waiters total.
A follower times out after a nominal 30 seconds; Node event-loop scheduling can
delay timers, so this is not a hard real-time guarantee. Timeout removes its
listener but never steals or evicts an unresolved leader. Coordination is local,
not persisted or distributed; filesystem locks are not held over model/verifier
work. No startup flags, budgets, historical grants, protected tests or frozen
benchmark implementation change. Coordinator source contributes to reuse scope.

Run proof/cold-repair-learning.ts with SARA_CONTROL_ROOT pointing to the exact
PR114 source and a new SARA_COLD_EVIDENCE_DIRECTORY. The control wrapper digest
is pinned. All generation is scripted; compilation and behavioral verification
are real. Cold waiting and storage are included. Fewer generator calls do not
establish live latency gains. Ordinary memory with equivalent single-flight
coordination can supply the same mechanism; no unique Reparodynamics effect or
35x performance is asserted.
