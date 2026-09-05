# One-use live coding benchmark readiness

This is the existing matched coding runner, not a new benchmark engine. It does
not authorize a model call, clear historical exposure, or make production canary
promotion automatic.

## This continuation's unresolved execution

The owner authorized one matched task for $0.15 total, equally divided into
$0.075 per arm. The attempt identifier is
`41267154-ba42-496a-bb79-1656898ac716`. Its original source was
`30a7cb3c21a77b65bf7ba2c4c393897850e61eeb`; its original authority digest was
`6ceb8530c59902abd842483a059e337a30f4979eceaa0f93979269dd2e5c4f0c`.

Railway deployment `65030156-647b-40b5-9291-9c5c6d2be9df` followed an attempted
pre-deploy configuration. The available deployment summaries and main-volume
files cannot establish whether its ephemeral pre-deploy container dispatched a
provider request. Absence of receipts is not proof of zero spending.

`CODING_BENCHMARK_CONTINUATION` therefore holds $0.15 as unresolved exposure.
It is not a confirmed charge. No new ID, source, directory, restart, environment
flag, or HTTP request can clear this hold. Resolving it requires a reviewed
source change linked to authoritative original execution or provider usage
records. No hold-clear endpoint or override flag is provided. If a prior request
occurred, retain its outcome; do not rerun it as a new favorable trial.

## Owner routes on the existing operator

Both routes use the existing Bearer owner authentication, including rejection
of missing/incorrect credentials. The read route performs no model requests.

- `GET /api/coding-benchmark/readiness` returns readiness, each blocking
  condition, exact deployed source identity, fixed grant and arm limits, the
  source-bound authority digest, and unresolved exposure separately from billing.
- `POST /api/coding-benchmark/run` accepts only `benchmarkId`, `sourceRevision`
  and `authorityDigest` from that readiness record. It returns HTTP 423 while
  the hold, emergency stop, or another preflight condition blocks execution.
  It does not accept a task, model, command, path, budget or override.

Successful admission uses only `scripts/benchmark-matched-coding-evidence.ts`.
There is no schedule, new service, pre-deploy hook, automatic startup benchmark,
or historical-runner activation. The launch requires the existing real `/data`
volume and a private lab subdirectory under SARA's existing state directory.
Its irreversible launch claim precedes spawning; the runner's existing fsynced
execution claim also precedes provider work. Missing receipts and expired
processes never authorize replay. The CLI independently checks the current
owner credential, live local-kernel health/Constitution/emergency-stop state,
source identity, fixed grant and persistent mount.

The worker process inherits only the credentials/configuration necessary for
this benchmark. Candidate execution remains in the existing Genome Lab child
process with a separate temporary artifact, restricted environment, AST checks,
permissions, timeout and memory ceiling. Do not represent Node permissions or
AST filtering as a complete security boundary against arbitrary hostile code.
The task permits only the existing bounded pure TypeScript candidates.

## Frozen comparison, unchanged by readiness repair

The `live-summarize-ledger-001` task, broken starting files and verifier-owned
acceptance tests in `src/coding-repair-live-benchmark-case.ts` are unchanged.
Hidden acceptance source stays out of candidate-writable files and model
prompts. Both arms use the same GPT-5.6 Luna route, medium reasoning, 30,000 input
and 8,000 output token ceilings, up to three attempts, independent failure
memory and fresh final verification. Full replacements remain enabled; compact
output and compiler caching remain off. The preregistered order is active
Reparodynamic first, then conventional best-so-far patch/retry/memory.

Both arms share SARA policy, model worker, verification and lesson infrastructure.
Only the pre-existing controller selection/repair behavior differs. Results
would not measure all Reparodynamics versus none, and a single task cannot
establish a general speed or accuracy gain. The value 5 in the canary metadata
is historical benchmark metadata, not a measurement of production traffic.

## Evidence and costs

Private immutable trace files preserve each candidate verification (including
rejected solutions and the fresh final check), parsed model proposals and
failures, response text, actual returned model identity, provider request and
response IDs, usage, elapsed timings and content hashes. Secret headers and raw
reasoning content are not persisted. A provider model-identity mismatch cannot
produce a successful arm. Evidence failures stop rather than silently disappear.

Each generation has an exclusive fsynced conservative reservation before
network dispatch. The existing model planner enforces token/resource ceilings.
At the route's verified $0.20/M input and $1.20/M output rates, 30,000 input plus
8,000 output tokens reserves at most $0.0156 for one generation. Returned output
usage includes billed reasoning tokens. This is an estimate, not an invoice.
The paired authorization remains the outer ceiling. Token-count requests are
separately identified rather than represented as paid generations.

An unsuccessful arm with unknown usage retains its whole $0.075 allocation.
The other arm's separate allocation does not authorize retrying the failed arm.
If both are unknown, all $0.15 remains reserved. Known estimates, unknown
reservations and confirmed provider billing must never be conflated.

Arm elapsed time includes source verification, model calls, retries, failures,
rollback work and synchronous arm trace writes. CLI elapsed time additionally
includes preflight, binding, arm/pair persistence and summary work. Process/module
startup, deployment, CI, download and subsequent auditing are separate setup
costs. Terminal-accounting write/console shutdown are outside the recorded
CLI elapsed sample. Do not call HTTP latency coding speed. A failed/incomplete
arm does not yield a successful-task speed ratio.

## Verification

Run `npm run verify`. Focused safety coverage is in
`tests/coding-benchmark-readiness.test.ts`,
`tests/coding-benchmark-artifact-audit.test.ts`,
`tests/coding-benchmark-owner-http.test.ts`, and the existing
`tests/coding-repair-benchmark*.test.ts` suite. Synthetic correct/wrong solutions,
provider failures, replay/concurrency, final-verification failures, evidence
failures and reservation boundaries are offline test evidence only. They are
not a paid Luna trial. Successful live launch and actual coding outcomes remain
unverified until the historical accounting and all readiness checks are closed.
