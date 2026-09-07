# Bounded kernel verification and dispatch observability

This is an owner-directed candidate built from the PR #124 SARA release. It has
not been published, deployed or granted a paid benchmark authorization by its
local test scripts. Historical paid trials and their source pins remain frozen.

## Acceptance remains with the kernel

Self-build admission and final acceptance are serialized through the existing
mutation authority. Expensive compilation and isolated behavioral execution are
moved outside that global mutation lock. Before execution the kernel rechecks
job and owner authority, recording the last emergency-stop event hash. Before
acceptance it rechecks those authorities, requires the same emergency-stop epoch,
and verifies the produced artifact again. A stop followed by resume during the
verification window still rejects that job. Every successful job retains its
own fresh original compiler state, isolated behavioral check, artifact, kernel
attestation and required acceptance events. Generated capabilities remain SHADOW.

The default scheduler overlaps at most two existing builds and queues at most
32; queued work expires after 30 seconds. This is cooperative JavaScript/child-I/O
concurrency, not parallel JavaScript CPU compilation. Synchronous compiler work
can still block the event loop. There is no cross-process coordination guarantee.

An optional one- or two-worker mode is selected only at trusted process boot by
SARA_KERNEL_VERIFICATION_WORKERS. It defaults to 0. Workers receive no process
credentials, create fresh compiler state, and continue using the existing
isolated generated-code runner. Timed-out results cannot be accepted or retried;
active verification drains before cleanup/shutdown. Worker threads do not replace
the sandbox and are not acceptance authority. The worker experiment consumed more
memory and performed worse including initialization; it is not enabled by default.

Failures before acceptance remove only the new unreferenced private artifact.
After an acceptance event might reference it, uncertain receipt failures preserve
the artifact for recovery. This change does not make multiple event appends an
atomic transaction or guarantee revocation after the acceptance lock is acquired.

## Honest timing and request accounting

The kernel return includes timings through the last required acceptance-event
commit. HTTP serialization/network time is outside that field and is measured
separately by the benchmark client. Generator/reuse timers are not substituted
for whole HTTP completion.

Each production coding-run client receives a narrow dispatch journal for the
existing OpenAI Responses/count-input endpoints. Intent is recorded before fetch;
actual invocation counts do not depend on a subsequent successful reuse callback.
Completion records indicate response receipt, not validated repair or confirmed
billing. Unknown execution retains uncertainty and closes that journal without
retry. No prompt, credential or response body is copied into these metadata
receipts. Existing job budgets and the model adapter remain responsible for cost
admission and usage interpretation. This is not a provider-neutral adapter yet.

Historical benchmark grants, runner implementations and source pins are not
updated to authorize these changed components. Their source-pin tests now assert
refusal on drift rather than treating a consumed benchmark as runnable. The
original full historical protocol is separately verified on the exact baseline.
A future live experiment needs fresh authority and a new full-kernel harness.

## Required local qualification

Run the default and optional worker modes with real compiler/behavior execution,
including stop, stop-and-resume, queue saturation, deadlines, cleanup, source
mutation isolation, failed provider dispatch and private receipts. Run actual
local authenticated HTTP cold/restart/reuse jobs with explicitly scripted model
responses. Preserve independent checks, model-call counts and final artifacts.

Performance comparisons must retain initialization, all predetermined process
pairs and unfavorable outcomes. Never multiply storage, serving or worker ratios
by the historical live 20.89x best / 16.26x pooled repeat observations. Neither
these scripted tests nor deployment health constitutes a new live maximum.
