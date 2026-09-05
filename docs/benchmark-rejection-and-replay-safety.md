# Benchmark rejection diagnostics and replay safety

This is an offline engineering follow-up, stacked on V7 b451a41dc7add73613c0580a9b101ddd390a93a6. Do not merge, deploy, enable a provider, or rerun the consumed V7 contract. The original PR89 harness and its paid evidence remain frozen.

## Observed incident

The primary V7 queue run e4ff85cd-319c-4d30-baf0-d75666abd3ca completed its compact-first arm in 26.411340542 seconds. The full-file arm returned a model response but aborted with only Error recorded, before a controller receipt or final artifact. The response source was not saved. The exact historical rejection cannot be recovered from that evidence and must not be invented.

A second deployment 5e97e091-9173-4c31-9c42-5cb3032cd2d4 repeated the pair unintentionally. Both results were INCONCLUSIVE. Four observed generations cost $0.0134840 in frozen token-rate estimates, not reconciled billing. The runner was retired at 835799c6-701f-42b2-bdab-16afc43dbccf. No further paid run is part of this change.

## Controller diagnostics

The existing post-response cost, proposal and changed-line validations are unchanged. A rejection now carries an exact allowlisted reason, cycle, retained champion digest, proposal digest when canonicalizable, input/output usage, known run spend and evidence digest. Unknown or malformed accounting stays null. Raw source, protected tests, arbitrary error messages and provider prose are not copied into evidence. Legacy name-only catches receive the reason in the bounded Error.name as well.

This does not turn a rejected proposal into a success, add a retry, raise a limit, or skip verification. It does not retroactively diagnose the lost historical control. Model/network failures before a returned controller response remain outside this narrow instrumentation.

## Owner-side admission gate

The optional proof/benchmark-run-admission.ts is a supervisor-side library, not an enabled live launcher. It requires an explicitly supplied, separately authorized grant bound to a contract, implementation and exact deployment, an expiry, a physical ceiling no greater than $0.15, and an existing private ledger directory. The consumed V6 and V7 contract digests are denied outright.

An atomic exclusive-create claim is keyed by experiment rather than deployment. Concurrent processes sharing one persistent local ledger admit at most one launch. Claims are flushed before success; failure never deletes the claim, so uncertain attempts remain consumed. Missing, permissive or symlinked ledgers deny admission. The gate refuses to run inside a Railway deployment rather than silently relying on its ephemeral filesystem.

This is not a remote authorization service. A trusted owner supervisor must retain the same ledger on durable local storage and invoke the gate before granting execution. Node documents that O_EXCL may not work on network filesystems; NFS is not supported. The helper cannot verify storage durability or stop a caller that bypasses it. It is not yet wired to a deployed Railway launcher. That integration remains a prerequisite for another paid trial; no volume or new credentials have been added to the temporary runner.

References: https://nodejs.org/api/fs.html#file-system-flags and https://docs.railway.com/deployments/reference#ephemeral-storage.

## Offline verification

The recorded initial focused RED run had 18 expected failures. Following implementation, 18 passed; six additional tests exercise digest stability, prior spend, incomplete claims, ephemeral-runner rejection, independent processes and ledger permissions. Final focused suite: 24/24. The repository tests passed 334/334 locally; the encompassing local verification command timed out during typecheck and is not counted as a full pass. Exact-head GitHub verification must be read before declaring completion.

Run:

    node --import tsx --test tests/coding-repair-rejection.test.ts tests/benchmark-run-admission.test.ts
    npm run verify

No provider calls are made by these tests. No claim of faster model coding, accuracy improvement, or a +300% result follows from this diagnostic/safety work. The actual latest valid speed observation remains the separate V6 interval-task comparison, 2.09x on one case, not a general multiplier.
