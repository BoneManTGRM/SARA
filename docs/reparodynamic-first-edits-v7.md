# V7 compact-first simulation experiment

## Scope and decision

This is an opt-in experimental output format, not a demonstrated 300% coding-speed improvement.
It is stacked on frozen V6 `d9a5ef84aa44b809fc8af87a027c5ad3eb059000` and must remain unmerged.
No paid model call, production activation, budget expansion, model substitution or reasoning downgrade is included.

The earlier LIVE V6 transport result measured 45.299230 seconds for full-file replies versus 21.654930 seconds for compact continuations, using the same controller. Its shared first proposal took 12.499053 seconds. It is not an unassisted-Luna baseline.

A +300% speed target means 4x throughput. Against that particular observed full-file duration the deadline is 11.324807 seconds, including verification. The old shared first response alone exceeds the deadline. Even zero subsequent latency would yield an optimistic ceiling of 3.6242x under those recorded timings. This is a conditional bound, not a prediction of future network or model latency.

## Minimum implementation

`createLunaCodingRepairModel` accepts `experimentalCompactFirstProposal: true` only with `compactRepairContinuations: true`. This opts the first repair into the existing literal anchored-edit schema, decoder and full-proposal validation. Everything then passes through the unchanged controller and original verifier.

Defaults and the V6 continuation-only option retain the exact old first prompt. No existing caller enables the new option. No new model request, retries, reasoning schedule, file permission or budget is introduced. All previous path/anchor/size checks still apply, including on cycle one.

**Benchmark contract warning:** Enabling this option changes the first prompt/output schema. It must NOT be silently enabled in an old shared-first live comparison. A future paid experiment requires a distinct preregistered contract and fair first-call accounting. The original V6 result is not reclassified or overwritten.

## Executed offline mechanism experiments

Run `npm run proof:reparodynamic-first-edits-v7`.

Six fixtures (clamp, inclusive count, batch count, run length, CSV quoting and canonical tags) are checked against independently derived expected outputs. Three scripted response schedules are used: correct first, correct second and all three wrong. Each schedule is replayed through full-file, V6 continuation-only and experimental compact-first modes.

The 54 actual controller executions preserved canonical proposal digests, final artifact digests and completion outcomes across formats: 36 expected completions and 18 correctly uncompleted runs. The original executable Genome Lab verifier is called after every proposal and again independently at the end, with no cache or weakened acceptance. Test content remains unchanged and hidden from the simulated client. Network requests are forbidden by the proof.

These are scripted response simulations, NOT 54 live model runs or estimates of model accuracy. The script fixes semantic candidate sequences identically; it does not reward the new mode with better solutions. Local scripted execution timings are NOT coding-speed measurements. Synthetic token/cost counters are labeled and are not actual billing.

First-call response-byte reductions on these small fixtures ranged from 6.98% to 41.97%, with 361 additional prompt bytes for the compact instructions. Extra schema/input overhead can offset savings; bytes are not provider tokens or response time. Compact-first is therefore not enabled by default.

## Trace-calibrated sensitivity analysis (separate evidence artifact)

The downloadable Python simulator enumerates 80 assumption combinations (two first-call policies, five latency multipliers and eight hypothetical success probabilities). It retains failed-job time/cost, three-cycle limits, baseline verification, every candidate verification and the final audit. The original live JSON checksum binds calibration. Success probabilities are assumptions, not inferred from one trace.

At the observed successful compact-continuation call duration of 6.855458 seconds and a conservative observed verifier mean of 0.606655 seconds:

| Hypothetical compact calls until success | Projected total | Projected speed versus original full-file arm |
|---|---:|---:|
| 1 | 8.675 s | 5.22x (+422.16%) |
| 2 | 16.138 s | 2.81x (+180.71%) |
| 3 | 23.600 s | 1.92x (+91.95%) |

The one-call row assumes that the new first prompt solves the task and has the latency of an observed later compact call. Neither premise is established. It must never be described as a new measured 422% gain. With one call, model/accounting time must be no more than about 9.505 seconds to fit the target after three verification executions. No simulated accuracy result establishes live noninferiority.

## Verification record

Initial test-only run: 8 tests, 2 passed and 6 expected failures on unchanged V6. After the small adapter change: all passed. Two additional defense tests cover extra authority and the unchanged first-cycle changed-line ceiling; final focused V6+V7 run: 31/31. Separate sensitivity-analysis unit tests: 9/9. Raw records and checksums are retained in the downloadable evidence bundle. GitHub CI status must be read for the exact candidate head rather than inferred from this document.

A first full local mechanism invocation hit the tool timeout after 11 of 54 arms; it is not counted as a complete experiment. One uninterrupted retry completed all 54. No paid call occurred in either attempt.

## Authority

Three cycles; surgical two files/80 changed lines; deep six files/240 changed lines; existing $0.15 logical ceiling and matched physical ceiling unchanged. All protected paths unchanged. No customer pricing changes, package addition, merge, deploy or promotion. Parent review only; no independent human/agent review is claimed.

## Next evidence gate

Keep the target fixed and use a fresh frozen multi-family corpus with reference validation, no answer leakage, order counterbalancing and repeated matched live trials under a separately approved total budget. Count failed, malformed and first-call-tie outcomes. Keep model, reasoning, environment, tests and authority fixed; first-prompt encoding is the explicit treatment. Require accuracy noninferiority and no higher cost per verified completion before recommending activation. Do not rerun or select tasks until the desired speed appears.
