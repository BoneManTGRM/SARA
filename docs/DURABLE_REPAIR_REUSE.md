# Durable exact-repair reuse — implementation candidate

This change is based on reviewed main `5009c6304a5aca2e7bef0d85caeadd1044965454`.
Release status is recorded by its exact-head PR checks and deployment receipts,
not inferred from this document. This is not a 35x performance claim and does
not authorize any new paid benchmark or expansion of a job budget.

## Execution path

The owner-authenticated self-build route creates a per-job reuse session only in
existing Reparodynamic **canary** mode. Off and shadow preserve their previous
behavior. There is no new endpoint, scheduler, infrastructure, grant, or automatic
promotion. The kernel still independently verifies generated artifacts and retains
its existing mutation stage and promotion requirements.

The normal controller still verifies the baseline before requesting a proposal.
The reuse session checks an exact recipe key before calling the existing model
adapter. On a matching recipe it returns only a bounded source-change proposal,
with zero model tokens and zero new model charge. All ordinary controller
admission and candidate verification run unchanged. A second fresh final check
is required before a completed run can be learned, and the kernel subsequently
performs its own verification. This does not cache a verifier PASS.

## Eligibility and invalidation

The key binds the complete candidate, including unchanged tests and metadata,
objective, acceptance criteria, missing capabilities, constitution digest, and
base-generator identity. An implementation digest binds verifier, source guard,
controller, policy, prompt, reuse, wrapper, server, canonicalization, validation
helpers, lockfile, and compiler configuration. Actual Node and TypeScript versions,
platform and architecture also contribute. Contract/source/test/dependency/runtime
changes therefore do not silently reuse an old scope.

This is exact-source reuse, not semantic similarity or automatic cross-repository
transfer. Recalled memory text and the edited historical diagnostic solutions are
not imported. The existing paid benchmark, its hidden tests, and its two consumed
grants are unchanged and do not opt into this new reuse path.

## Durable storage and failure handling

Recipes live in a private `coding-repair-reuse-v1` directory under the existing
state root. Source-only changes are immutable, size bounded, integrity checked,
and admitted through the existing mutation-policy validator. A Linux filesystem
exclusive directory lock serializes learning and lookup. A bounded FIFO queue
coordinates short I/O operations across store objects in the same Node process
(32 outstanding operations per directory, 128 total). This prevents local warm
lookup contention from unnecessarily becoming generation requests. It does not
share model results, merge jobs, or suppress fresh checks. Saturation, other
processes, and interrupted filesystem locks remain fail-closed cache misses.
There is no automatic lock stealing or timeout-based lock recovery. File writes are
exclusive, reject final-component symlinks, and are synchronized before a record
is available. Reads reject symlinks, hard links, nonregular files, corruption, and
oversized input. Directory canonicalization rejects symlinked store locations.
The configured state root and operating-system account remain trusted; checksums
are not signatures or protection against a compromised host.

A failed fresh recipe verification permanently quarantines its key. A quarantine
marker survives process recreation, is not removed by relearning, and can be
created even while another cache operation holds the store lock. Quarantine is
rechecked after all mandatory run/event persistence callbacks as well as during
final verification. An observed revocation aborts the return and appends a
`return_boundary_rejected` event; any earlier `run_finished` record is not
authority to accept it. This is not an atomic guarantee against a different
process revoking a recipe after the check. The kernel independently verifies
the returned code and enforces its existing promotion requirements. At most 128
identities are retained; capacity stops learning rather than evicting revocations.
A crashed lock is not automatically cleared. Store unavailability falls back to
the existing authorized model path, within the same controller budget and cycle
limits. Corrupt records are not overwritten or laundered as new successful ones.
Failure to persist required provenance aborts, rather than triggering a model call.

Provenance records are separate private `reuse-NNN.json` files in the existing
per-job repair-receipt directory. They distinguish a recipe hit, model fallback,
quarantine, final verification, and learning outcome. The existing controller's
strategy field describes its routing decision, not proof that a model was called;
use these provenance records to distinguish the proposal source. Controller run
timing and reuse-session timing are not total job turnaround time; the proof uses
an outside timer that also includes scope construction, learning and all checks.

## Verification and measurement

`tests/coding-repair-reuse.test.ts` covers restart, invalidation, quarantine,
capacity, mutation isolation, malformed/oversized/symlink records, concurrency,
failed final checks, failed receipt persistence, fallbacks, and fresh execution by
the actual isolated verifier.

`tests/coding-repair-reuse-http.test.ts` boots the real local owner-authenticated
HTTP route and kernel twice from the same state directory. It uses a scripted
model adapter, not a provider. It checks anonymous rejection, one model-adapter
invocation across two matching jobs, durable provenance, and independently
kernel-executed evidence for both resulting mutations.

`proof/durable-repair-reuse.ts` compares three credential-free paths: fresh
scripted generation, ordinary in-memory repair reuse, and the new durable reuse.
Each starts cold on three authored fixtures and performs three rounds. Every job
has four fresh verifier invocations. Timings include setup/learning, receipts,
cache I/O, and verification. No inference latency is included or simulated. The
ordinary-memory control is expected to avoid exactly the same repeated model
adapter calls; this proof cannot establish a Reparodynamics-specific speedup.
Run it with a new output directory and no credentials:

```
SARA_REUSE_PROOF_OUTPUT=/tmp/sara-reuse-new-run node --import tsx proof/durable-repair-reuse.ts
```

The full repository gate remains `npm run verify`; exact-source CI and CodeQL
are required before a future merge. A new real reuse comparison requires a
separate bounded authorization and a protocol that distinguishes cold learning,
exact repeats, new tasks, misses, failures, and ordinary-memory controls.

## Concurrency regression evidence

Eight additional tests cover simultaneous warm lookups, simultaneous reuse
sessions, simultaneous learning, revocation during run/event persistence,
bounded queue overflow, recovery after a failed record read, and retained
interrupted locks. The five original failing interleavings were observed RED
on the prior unpublished candidate before their fixes. Timing measurements
use supplied scripted repairs without provider latency; avoided calls must not
be described as an autonomous model speedup. Cold simultaneous identical jobs
are not deduplicated: without an already verified recipe, each retains its
own existing generation path and authorization.
