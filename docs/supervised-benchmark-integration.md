# Supervised benchmark integration

## Disposition

Continue active draft PR90, based on `fbd12c6100f325fb46b16bc9f07d0e27ac403613`. PR88's V7 implementation and PR89's historical live evidence remain frozen. The useful PR91 diagnostic tests are incorporated here; PR91 remains closed and unmerged. No production merge, deployment, provider request, new credential, or paid authorization is part of this change.

This completes the **offline code integration** from owner admission through the actual Railway CLI command into the worker and the original V7 controller/verifier. It does not claim an actual Railway SSH connection, deployment, production installation, or new speed result. The external SSH boundary is substituted in offline tests; worker, transport framing, launch script, admission ledger, controller, and executable verifier are real.

## Execution boundary

`scripts/launch-supervised-benchmark.ts` loads the source-checked contract, reads a private owner grant, and calls `runSupervisedBenchmark`. The supervisor atomically persists and flushes the experiment claim before invoking a single `railway ssh` command. The grant binds experiment, contract, implementation, deployment, expiry and a maximum $0.15 frozen-rate reserve. A restart, failed connection, partial claim, replacement deployment or concurrent process cannot reuse that experiment in the same retained private ledger. There is no reconnect loop or persistent tmux session.

Railway's default command is `proof/benchmark-worker.ts --idle`. It has no provider key. Explicit SSH starts a worker that proves its source-manifest/contract and deployment identity over the owner channel before any token counting or generation. The reviewed worker refuses a provider key and has no direct provider-client path. This is application-level confinement, not an operating-system network sandbox or protection against a malicious owner changing code.

The owner broker applies bounded frames, monotonic request IDs, count-before-generation, fixed medium reasoning and 8000 output-token ceiling, three generations per arm, six total, and equal physical reserve partitions. Model replies are field-allowlisted. Disconnects and session timeout abort outstanding provider work; uncertain generation cost retains its prior reservation. The owner audit is flushed, hash-chained, and contains digests/counters rather than prompts, source, raw errors, secrets or hidden-test outputs. Worker results must match the admitted contract and their canonical pair digest.

Claims are never deleted or refunded after uncertainty. Ledger storage must be on a durable local filesystem retained by the trusted owner supervisor, with private permissions and exclusive-create semantics. No ephemeral fallback or NFS support exists, and the helper cannot prove storage durability or defend against privileged deletion/bypass. A new owner machine without the retained ledger is NOT a safe retry mechanism.

## No paid trial hidden in this integration

The new source-bound contract `v7-supervised-offline-01` has `paidAllowed:false`. `--mode live` is rejected before SSH or provider creation. The historical consumed V6/V7 contracts remain denied, and direct `--live` on the old-named harness remains blocked. Offline mode uses scripted replies in the owner process, not live model calls. Synthetic counters are labeled as such; they are not billing or evidence of model accuracy/speed. Offline supervised output has no speed ratio or 300% success claim. Any future paid comparison needs a fresh task, reviewed contract and explicit owner authorization, not a flag override or reuse of this task for a favorable result.

The launcher does not create/deploy services, provision keys, register SSH identities, change Railway variables or clear staged changes. It requires an already reviewed inert nonproduction worker, existing owner SSH access, and exact identifiers supplied in the private grant. These operational prerequisites were NOT configured or tested against Railway here.

## Diagnostics and the original scanning finding

The controller's PR90 validation order, repair policy, cycle/file/line/spend ceilings and independent verifier are unchanged. The canonical allowlist now also supplies the harness categories, removing four naming inconsistencies. Exception getters, proxies, prose, stacks and causes are not evaluated or copied. Unknown accounting stays null. Known pre-rejection usage stays available in the owner's ledger; missing worker-side cost bounds are not emitted as zero.

The PR89 CodeQL comment `3939049799` flagged improper code sanitization at `proof/v7-live-fixture.ts:90`. That code constructed executable test strings using replacements/interpolation. The integrated fixture imports the literal original verifier bytes instead. No assertion is removed, weakened, recomputed from model output, or disclosed to the model. Regression identities:

- Original 77-assertion protected source SHA256: `5cf00d63ef6fb47f0807ef4bb073a3087171bfdb50d0c96a88102a3046453365`.
- Original baseline canonical digest: `2703dd83f694f9ae16a486171621beb4c8c0de1230192d49efe5a0c2f3997b40`.
- Original reference canonical digest: `2eb0fccbddf8d28aaad0afc44ed548bae54170589747d83a1459254a0ace2732`.

The historical alert on frozen PR89 is not dismissed or relabeled. Read the new exact-head CodeQL result separately; a successful scanner job is not a vulnerability-free guarantee. Parent code/security review only, not an independent human or separate-agent review.

## Verification and reproduction

The focused suite contains 69 checks covering existing PR90 admission/rejection behavior, inherited PR91 diagnostics, actual launcher CLI integration, concurrent starts, replacement deployments, complete verifier success, a real controller line-limit rejection, protocol abuse, credential refusal, disconnect cancellation, result identity and exact static-fixture parity. Local development used a disclosed untracked transpilation loader because the locked npm packages were unavailable. Local focused tests and standalone typecheck passed. A full local verify attempt timed out and included a timing-dependent idle-start test failure; that test now waits for the actual startup message with a bounded timeout, and all focused checks pass. Do not call the timed-out run successful.

Recorded test-first failures cover the new admission/worker seams and review repairs. The additional actual-CLI integration test was added after implementation as regression coverage, not claimed as an initial failing TDD test. Exact-head GitHub CI uses `npm ci --ignore-scripts` and the committed dependency lock, runs full verification, both harness self-tests and a separate HTTP repeat, and archives source plus logs. Completion claims require those actual results.

Commands after installing the locked dependencies:

    npm run verify
    node --import tsx proof/live-v7-comparison.ts --self-test
    node --import tsx proof/live-v7-comparison.ts --self-test --all-wrong
    npm run proof:http
    node --import tsx scripts/launch-supervised-benchmark.ts --mode plan

The last command displays the contract and cannot spend. The execution CLI requires absolute `--grant`, `--ledger`, and `--output` paths plus `--mode offline`. The grant document contains `{grant:{experimentId,contractDigest,implementationCommit,deploymentId,expiresAt,maximumPhysicalSpendUsd},railway:{projectId,environmentId,serviceId,instanceId}}` and must be a private regular file. Never commit grants, keys, ledgers or result files. Keep the same durable ledger across owner process restarts.

## Historical evidence remains unchanged

The primary compact-first completion was 26.411340542 seconds; the unintended second start completed in 22.133120439 seconds. Both compact artifacts passed all 77 original assertions. Both controls aborted without a preserved proposal source or detailed original error. Their cause cannot be retroactively determined. Both comparisons remain inconclusive, not zero-percent results or speed successes. The old interval-task 45.30-second baseline cannot be substituted. The latest valid matched speed evidence remains the earlier single-task +109.19%; +300% remains unproven.

## Primary implementation references

Railway's SSH CLI documents pinned deployment-instance commands, piped non-PTY input and the reconnect behavior of `--session`: https://docs.railway.com/cli/ssh . This launcher deliberately omits `--session`. Node filesystem flags and exclusive-create limitations: https://nodejs.org/api/fs.html#file-system-flags . The references describe platform behavior, not a claim of live connectivity verification.
