# SARA recovery, round three: policy-sensitive stopping

**Decision: reject the new stopping candidate. Keep the latest PR137 controller unchanged.** Stopping after three rejections of the same known failed edit reduced unresponsive-policy requests from 346 to 146, but lost four tasks that the current controller solved under an imperfect response policy. The primary efficiency target was met; the mandatory no-loss requirement failed. There is no recommendation to promote this experiment.

The candidate is retained in `proof/recovery-v3/candidate-producer.txt`, with regression tests and reproducible evaluation. `src/repository-producer.ts`, live pins and offline qualification pins remain byte-for-byte unchanged from the confirmed checkpoint. Prior experiments and reports are preserved. No production deployment, paid model call, hosting change or live allowance activation occurred. SWE-bench remains **0/20**.

## What the causal audit established

Existing SARA code enforces rollback, context-bound failed-edit suppression, scope escalation, accounting and one reconsideration of an unrepaired finish. Earlier substitutes supplied the repair hypotheses and decided how to react to controller feedback. Fresh local grading established correctness of toy configurations in separate state; it did not establish that a real model could discover or use the repair. The previously unresponsive substitute's failure was not evidence that SARA lacked memory or rollback.

The actionable gap examined here was resource use during stagnation: the latest controller can reject a known failed edit repeatedly while continuing to call the substitute until its 50-request limit. The candidate adds a per-invocation counter keyed by the existing context-bound failed tactic and stops after its third rejection. No tests, authority rules, scope limits or resource ceilings change. The counter is bounded by existing model-request limits. It affects exact repeated failed tactics; existing transition-equivalence rejection remains unchanged and is not newly generalized by this experiment.

The minimal development test shows the causal tradeoff. A responsive policy recovers with all three controllers. An imperfect policy eventually recovers with A and B in 15 calls, but C stops in 10 without a repair. An unresponsive policy drives B to 50 calls; C stops in 10. This was one development experiment. Its negative finding was recorded before candidate freezing; the threshold was not tuned to the imperfect policy. The separate frozen evaluation measured the breadth of the same tradeoff, without reopening the acceptance criteria.

## All four iteration methods

| Method | Executed work | Evidence and decision |
|---|---|---|
| Start simple, then expand | One minimal failed-edit loop; one proposed stop mechanism | The focused baseline assertion fails because B uses ten allowed requests rather than stopping at five; the candidate stops at five and preserves rollback/cleanup. |
| Single-variable testing | Only the failed-tactic rejection threshold differs between B and C | Same finite-domain substitute, policy, inputs, limits and evaluator. Responsive behavior is unchanged; imperfect-policy losses reject the change. |
| Reflection | Review savings against retained and lost verified repairs | Lower requests are not automatically better recovery. No-loss takes precedence over efficiency; candidate remains unaccepted. |
| Component reordering | Inspect actual producer serialization and capture an exact development prompt; prepare a content-identical reordered version | The substitute parses JSON keys and does not model member-order effects. Ordering quality was not measured. No order-sensitive rule or real-model call was introduced. |

`prompt-order/original.json` is a captured B development prompt after a failed repair. `prompt-order/objective-evidence-first.json` changes only the top-level member order to instruction, issue, observations, limits, strategy, repository and baseCommit. Parsed objects were checked equal. Both retain the existing chronological observations, current-candidate information, failure memory and permitted actions. They are exact candidate inputs for a later authorized real-model experiment, not evidence that reordering improves model behavior.

## Three variants and policy results

A is conventional SARA from original PR135. B is the latest controller at confirmed PR137 head f6198d5, including both previously implemented improvements. C is the new, isolated stopping experiment. B is not the older Reparodynamic controller used in round two.

The same 13 task fixtures were evaluated under three response policies and three counterbalanced repetitions: **39 task/policy conditions and 351 producer outcomes**. These are 13 task scenarios, not 39 or 351 independent tasks. Related misleading/fault controls are not independent program diversity. Counts below use one repetition per condition; repeated outcomes and selected counters matched.

| Response policy | Measure | A conventional | B latest PR137 | C experiment |
|---|---|---:|---:|---:|
| Responsive | Resolved | 7/13 | 7/13 | 7/13 |
| Responsive | Successful recoveries | 6 | 6 | 6 |
| Responsive | Requests / tools / public tests | 120 / 174 / 36 | 113 / 168 / 36 | 113 / 168 / 36 |
| Responsive | Retained public regressions | 1 | 0 | 0 |
| Imperfect | Resolved | 5/13 | 6/13 | 2/13 |
| Imperfect | Successful recoveries | 4 | 5 | 1 |
| Imperfect | Requests / tools / public tests | 148 / 217 / 55 | 151 / 190 / 40 | 128 / 165 / 36 |
| Imperfect | Retained public regressions | 1 | 0 | 0 |
| Unresponsive | Resolved | 1/13 | 1/13 | 1/13 |
| Unresponsive | Successful recoveries | 0 | 0 | 0 |
| Unresponsive | Requests / tools / public tests | 130 / 193 / 56 | 346 / 255 / 32 | 146 / 155 / 32 |
| Unresponsive | Retained public regressions | 5 | 0 | 0 |

Across the 39 correlated task/policy conditions, resolution counts are A 13, B 14, C 10. Total substitute requests are 398, 610 and 387; tools 584, 613 and 488; producer public tests 147, 108 and 104. These descriptive totals must not be presented as a task success-rate estimate under an unknown real-world policy distribution. B's synthetic advantage over A under one policy is not benchmark superiority.

The complete 39-row table, including every failed, exhausted, stopped and blocked outcome, is in `comparison.md`. All 351 scheduled evaluation producers ran; no held-out slots were omitted or rerun. Each policy/variant cell has ten completed grades, one injected verifier failure and two blocked grades. The unavailable regression grades remain unknown, not zero regressions. All negative controls were rejected by all variants.

A successful recovery means a resolved task with at least one failed public repair test after the initial baseline. A rollback by itself is not a recovery. B and C each perform five explicit regression rollbacks per policy. B/C suppress 0/15/115 versus 0/15/15 duplicate proposals under responsive/imperfect/unresponsive policies. Executed identical action/context duplicate edits are zero in every group; repeated re-tests and suppressed proposals are counted separately, not claimed as semantic edit diversity. Scope suppressions are 2/5/24 for both B and C.

C adds five early stops under the imperfect policy and five under the unresponsive policy. Exhausted outcomes by policy are A 1/3/8, B 1/3/8, C 1/3/3. A single earlier development startup rejected the policy identifier separator before any model/tool action: the original log is retained. The common harness was corrected to use valid identifiers and re-frozen before candidate editing. No held-out data was involved in that correction.

## Acceptance and overhead

Before implementation, the work card froze the primary target: at least 20% fewer substitute requests on unresolved unresponsive cases across at least two program families. Mandatory constraints were no B-resolved losses under any policy, no added retained regressions, rejection of designated negatives, and bounded overhead. On identical A/B/C outcomes C could add at most two tools/tests per case and its median producer duration had to remain within 1.25 times B plus 25 ms.

C cuts requests by 80% on five unresponsive conditions across affine, clamp, discount and identity families. Across all unresponsive conditions the reduction is 57.8%. It also loses intercept-invariant, upper-bound-invariant, zero-price-invariant and the related misleading-loop condition under the imperfect policy. Removing the related stress condition still leaves three lost cases across three mathematical families. **The gate is false regardless of the request savings.** All timing and tool/test overhead bounds passed. Exact gate calculations and all timing bounds are in summary.json/results.json.

No new monetary cost was introduced. Physical provider calls and model spend remain zero. Total prompt bytes by responsive/imperfect/unresponsive policy are A 738,609 / 1,008,803 / 759,770; B 758,117 / 1,361,758 / 6,777,307; C 758,116 / 1,122,340 / 2,605,340. Tiny byte differences with unchanged behavior can arise from timing-derived strategy evidence. Bytes are not provider tokens or bills. Local producer timing includes child processes, Git and scheduling; it is not isolated CPU overhead or coding speed.

Every producer retains ceilings of 50 model reservations, 200 tool steps, six public tests, 2 MiB observed output and 30 minutes. Budget assertions passed across all 351 outcomes. One reserved request per policy/variant is blocked by authority before reaching the substitute, so reservations exceed actual calls by one in each group. Unknown dispatched usage remains unreconciled and blocks grading.

Each policy/variant uses 32 separate evaluator processes: 11 baseline checks, 11 fresh public checks and ten private checks. The verifier-failure fixture stops before its private check; authority/accounting fixtures are blocked before grading. Those fixed evaluator calls are outside producer ceilings and identical across A/B/C. No evaluation outcome is accepted merely because production stopped early or public tests passed.

## Representative traces

Full selected event digests, test outputs, failure memory, rejected proposals, final patches and fresh grades are in traces.md and raw results.json.

- **Imperfect intercept recovery, B:** initial `(a,b)=(0,0)` passes at input zero. Finite enumeration first tries `(0,1)`, which fails that invariant. B records failure and restores `(0,0)`. The substitute reproposes the same failed edit three times; B blocks each. After observing enough nonprogress, the common imperfect policy advances to `(1,0)`, a different explanation that changes slope while preserving the zero intercept. Public testing and later fresh private tests at 2 and -1 pass.
- **Same observations, C:** C performs the same rollback and three rejections, then stops before the read that would have triggered the alternative. The unchanged baseline passes public testing but fails private grading. The lost repair is observable, not an inferred hypothetical cost.
- **Unresponsive intercept loop:** B suppresses the known bad proposal until its 50-request ceiling. C stops after three rejections and ten requests. Both remain unresolved; both avoid retaining the regression. C saves work here but does not create a repair.
- **Responsive clamp repair:** after a failing upper-bound candidate, the policy immediately advances to an alternative lower-bound change. A/B/C resolve; C's stop rule never triggers. This is the no-benefit control for the added mechanism.
- **Other controls:** an already-failing baseline is not mislabeled as a regression; scope-restricted edits exercise existing escalation; public-green-unresolved is rejected privately; no-valid-domain-point stays unresolved; the six-test cap is enforced; verifier failure, authority interruption and uncertain accounting do not become acceptance.

## Fairness and capability limits

This round replaces supplied complete solution hypotheses with enumeration of a public finite configuration domain. It uses the same implementation and settings in A/B/C. The substitute reads the actual edited state and public test exit status; it never inspects arm identity, task identity, hidden cases, reference patches or grading answers. Public domain ordering determines the search order. A domain often contains a correct configuration, so this is bounded search over hand-authored knobs, not general coding or independent repair discovery.

Problem statements provide the public search domain and a generic repair instruction, not a rich natural-language bug specification. Some private requirements cannot be derived from that public information. Those fixtures test grading rejection and controlled search trajectories, not whether a coding model could understand a fully specified issue.

The three policies require one, four or infinitely many observed failures/nonprogress events before advancing to another enumerated configuration. These are explicit sensitivity assumptions, not measured distributions of real-model behavior. Patience four deliberately challenges a threshold of three rejections: the loss is a constructed boundary counterexample, not an estimate of how often real models would be cut off. Reads, tests and rollbacks create different legitimate observation trajectories between controllers. The substitute also handles public rejected-finish feedback using the same policy for all variants; no private answer is supplied by that branch. A model that never changes hypotheses cannot recover from a wrong first choice in this setup. That does not prove a universal impossibility for real models or all controller designs.

The real repository producer, parser, candidate validation, failure memory, rollback dispatch, scope control and accounting are used. The model adapter, toy application, narrow local Git sandbox, fault injections and three-arm/policy orchestration are substitutes. Docker isolation, production kernel acceptance, real model transport, judge-controlled task environments and the live two-arm runner are not qualified here. Fresh grading validates and applies the frozen patch in an independent local checkout, then runs public/private cases in separate child processes. Public and private checking share program.cjs; this is separate state, not an independently implemented oracle.

All producers were written exclusively and fsynced before any private grading. The reporting script verifies that producer records remain unchanged when grading fields are added. Hashes were frozen before candidate development and rechecked. Hashes provide internal reproducibility, not independent timestamp or tamper-proof attestation.

These fixtures are assistant authored. The old evaluation informed diagnosis and is development evidence for this cycle; old artifacts retain their historical labels. The new held-out set was not used to adjust the candidate. Evaluation after a negative development result deliberately characterized its breadth rather than searching for a favorable threshold. No seed is claimed: policy execution is deterministic, but timings, temporary UUID filenames and timing-derived digests are not. Temporary UUIDs avoid the prior filename-collision problem; they do not affect repair decisions. No ordering effectiveness or real-model responsiveness was measured.

## Revisions and reproduction

| Stage | Local commit | GitHub commit |
|---|---|---|
| Confirmed latest B | fa6a6d8428c24611158554a6a6c7e748862a6774 | f6198d5cdc8595fd889f7edbc61ad14d5bb6dd31 |
| Initial experiment freeze | b81c1686d7e08efb7180064bd9060a0a22f9da95 | 4484cbb899449c76229172e760c538867e05ec65 |
| Corrected pre-candidate freeze | 4f809f4604b65974389006c5c46225c380b8c012 | b0c9c2514905e5238db8fea788b34373d2e07e2f |
| Frozen unaccepted C | 1bef810244500eb924c7492e23f84ebd5d28ef48 | deb45cc8fdca72b6825892274e793a01ab5d3236 |

Exact tree equality was checked when publishing the source stages. GitHub metadata yields different commit IDs; publication is not an external attestation of the earlier local evaluation time. A is original PR135 source 31752fe68dfaa6ce8c33d145390b576db0693a28. Producer SHA-256: A ebd51c94a5a48571ad61233e12d02a2ccffe97d568f8640b79c01ad72e5b6e21; B 941d5fe29021d1195bda14855c0ed9d7f38ed0e9dc317da2f5ff58eef0dbfd5b; C 7e22c6297d62159599e248d8fff1af4c2624e32c1bb03bbf44c8467f3b8b523d.

The archive includes full source, all snapshots, fixture and settings hashes in freeze.json, candidate-freeze.json, all raw results/logs, prompt variants, prior evidence and SHA256SUMS. Use existing Node v24.19.0, Git 2.51.1, Python 3.12.13 and pinned repository dependencies. No credentials or network access are needed for simulation. Use unused output directories and a writable src directory for temporary historical-source imports.

```sh
node --import tsx proof/recovery-v3/run.mts --phase development --baseline-only --output /tmp/sara-v3-baseline
node --import tsx proof/recovery-v3/run.mts --phase development --output /tmp/sara-v3-development
node --import tsx proof/recovery-v3/run.mts --phase heldout --output /tmp/sara-v3-heldout
python proof/recovery-v3/summarize.py /tmp/sara-v3-heldout /tmp/sara-v3-report
node --import tsx --test tests/repository-producer.test.ts tests/recovery-candidate-v3.test.ts
python proof/recovery-v3/verify.py
```

The evaluation returns zero for a successfully recorded negative experiment. Inspect gate.accepted. verify.py stages a temporary TypeScript copy of the isolated candidate so the repository typecheck checks it too, runs the full gate with two available CPUs, and removes that copy. It never replaces active producer source or pins. Earlier rounds must be reproduced using their own saved sources and settings, not by substituting this round's results.

## Smallest useful real-model follow-up

After separate authorization for a real model and suitable runtime, use two real-repository issues that can require revising a failed repair plus one no-alternative control. Compare current B with the frozen experimental stopping rule, using the same model/version/settings, fresh state, equal caps and independent hidden verification: six paired-condition attempts total. Supply no solution list. Measure whether repeated proposals predict abandonment or precede successful recovery, retaining all failed and unreconciled outcomes. The experiment is to test the stopping assumption; the candidate remains rejected unless new evidence justifies a separately reviewed design.

This is a small mechanism pilot, not a benchmark or a reliable estimate of model variability. Additional matched repeats would be needed for a broader claim. Prompt-order comparison would be a separate single-variable experiment using the retained inputs, not an additional change mixed into those runs. None of these paid or real-model actions was activated here.

## Fresh verification

The combined focused run passed **19/19 tests**: 17 tests for the unchanged current producer and two for the isolated experiment. Against B, the new stopping assertion fails as expected (ten requests rather than five), while the alternative-before-threshold check passes. The baseline reproduction wrapper verifies that exact one-failure/one-pass summary and exits zero only for the expected result.

The full repository gate, run with a temporary TypeScript copy of the candidate included in typechecking, completed with **exit 0**, **1,095/1,095 repository tests**, typecheck, all configured demo/proof stages and the separate **14/14 HTTP tests** passing. No full-suite retry was needed. The temporary candidate copy was removed after the gate. These checks establish implementation consistency and preserve the existing controls; they do not override the failed behavioral acceptance gate.

The final integrity check confirmed unchanged frozen simulator/fixture/settings/work-card hashes, unchanged candidate bytes, unchanged active producer bytes and equal parsed content in the two prompt-order variants. Full commands and logs, log hashes and the earlier development startup failure are retained. `verification-logs.json` and `integrity.json` record the evidence. No remote CI result is inferred from local verification.

Draft PR137 is updated with this unaccepted experiment and the decision to retain the prior controller. No merge, promotion, deployment or live model execution was performed.
