# SARA recovery improvement, round two

**Decision: recommend the bounded continuation change for review. It passes the frozen synthetic gate, improves over the prior Reparodynamic controller, and still does not outperform conventional SARA.** On this round's 15 cases: A conventional resolves 9, B the previous PR137 controller resolves 4, and C the new controller resolves 8. C has four gains, no B-resolved losses, and no retained public regressions. A retains one regression on an unsolvable control; that outcome is not accepted by the evaluator.

This is a separate experiment. The previous 13-case results and source stages remain unchanged. Their repeated-regression failure is now development evidence for this follow-up. The updated shared model substitute and new case mix mean that 8/15 must not be compared directly with the previous 7/13 as a measured effect.

## Small change and causal evidence

Previously, after a failed repair was rolled back, the producer accepted `finish` unconditionally. A model could recheck the restored green baseline and finish without an issue repair. The first fix's context-sensitive edit memory did not address this stopping behavior.

C now records the failure-memory event associated with a rollback to the initial empty patch. If the model then requests finish with that empty patch, and model budget remains, C emits one `reject_finish` decision bound to that failure evidence and asks for a materially different hypothesis within the remaining original budget. It allows the next explicit stop. It does not manufacture a failing test, choose the correct repair, increase limits, or accept a patch itself. There is no intervention without an observed rollback to the initial state, on a nonempty repair, in the conventional arm, or at the final model reservation. Every later action still passes existing authority and resource admission. State is isolated per invocation.

Two behavioral tests fail against B before the change: one expects a viable alternative to be attempted after the premature finish, the other expects exactly one reconsideration when budget remains and no additional dispatch at the ceiling. Both pass against C. The development replay of the old repeated-regression case changes B unresolved to C resolved, using 16 substitute requests, 20 tool steps and four public tests. The already-successful alternative case stays successful, and the old public-green/hidden-defect case remains rejected. No candidate changes were made after this development result and the recorded freeze.

## Three-variant results

Counts represent one outcome per case. Three counterbalanced repetitions test repeatability and measure local timing; they are not additional independent tasks.

| Measure | A conventional | B prior PR137 | C improved |
|---|---:|---:|---:|
| Synthetic cases resolved | 9/15 | 4/15 | 8/15 |
| Resolved after a failed repair test | 8 | 3 | 7 |
| Model-substitute requests | 162 | 157 | 179 |
| Producer model reservations | 163 | 158 | 180 |
| Tool steps including freeze/restore | 236 | 211 | 235 |
| Producer public tests | 48 | 43 | 47 |
| Separate grading test processes | 38 | 38 | 38 |
| Explicit regression rollbacks | 0 | 7 | 7 |
| Retained public regressions | 1 | 0 | 0 |
| Unavailable regression grades | 2 | 2 | 2 |
| Executed identical action/context repeats | 0 | 0 | 0 |
| Duplicate proposals suppressed | 0 | 12 | 12 |
| Scope proposals suppressed | 0 | 4 | 4 |
| Finish reconsiderations | 0 | 0 | 6 |
| Test-budget exhaustion | 1 | 1 | 1 |
| Grading completed / failed / blocked | 12 / 1 / 2 | 12 / 1 / 2 | 12 / 1 / 2 |
| Prompt bytes observed | 1,054,131 | 1,149,333 | 1,428,384 |
| Provider calls / spend | 0 / $0 | 0 / $0 | 0 / $0 |

All 15 case outcomes, per-case requests/tool steps/public tests and median producer milliseconds are in comparison.md. All 135 producer slots completed on the evaluation invocation, with no omissions. A prior invocation failed before any producer started because a completed development run's temporary import filename remained. The failed launch log is retained; its 135 planned slots were unrun. Only the two owned, hash-matching temporary files were removed, and the identical frozen command was reissued. This was an infrastructure recovery before any held-out output or grading existed, not a candidate or fixture revision. The successful invocation has 135 frozen producer outcomes and 135 recorded grade dispositions, including blocked and failed grades.

There is one fewer actual substitute call than model reservation per variant because the authority control rejects the second reserved call before it reaches the substitute. Uncertain dispatch retains one unreconciled request and blocks grading; it is not erased as free, certain execution. The 38 evaluator processes per variant comprise 13 separate baseline checks, 13 fresh public checks and 12 private checks. The verifier-error control stops before its private check; two blocked cases never enter grading. These fixed evaluator calls are outside producer ceilings and identical in all variants.

## Frozen acceptance and overhead

The predeclared contract requires at least two additional resolved cases over B across two program families, no B-resolved loss, no added retained public regression, and rejection of all designated negative controls. On cases where A/B/C have identical resolution, C may add at most two tool/test calls per case, and its median producer duration must remain within 1.25 times B plus 25 ms. Limits remain 50 model reservations, 200 tools, six public tests, 2 MiB observed output, and 30 minutes per producer. The same limits apply to every variant.

The gate passed: four gains across affine, clamp and discount families; no losses; all negative controls rejected. Dropping the related misleading-output stress case still leaves three gains across three program families. These functions differ mathematically but share the same rollback/repeated-hypothesis pattern. That is limited mechanism coverage, not evidence of broad independent repair intelligence.

C spends 22 more substitute calls, 24 more tool steps and four more public tests than B across the 15 cases. Each additional success costs five more requests, six tools and one public test; two unsuccessful reconsiderations cost one request each. This is useful extra work within equal ceilings, not a speedup or provider saving. On equal A/B/C outcomes C adds zero tools/tests and passes every frozen timing bound. For example no-alternative still fails, costs one extra request and goes from 109 to 110 ms median. The separate stubborn-model case also fails and costs one extra request (110 to 111 ms). It was outside the A/B/C-equal gate because A solves it, but its unfavorable outcome and overhead are retained.

The gates do not constrain total prompt-byte growth or total calls on newly successful cases; those quantities are reported above. Prompt volume rises about 24% versus B in this round. The deterministic substitute charges zero and reports zero tokens; these byte counts cannot predict real model token costs. Local producer duration includes Git, child-process tests, hashing and machine scheduling. It is not an isolated controller-CPU measurement or real coding speed.

## Traces and remaining failure

Full evidence-bound traces are in traces.md; every event and patch remains in results.json and producer-freeze.json.

- **Affine recovery:** `(a,b)=(0,0)` passes a public test at zero while the issue requires slope 4. `(1,1)` fails that invariant. C records the exact candidate/test evidence and rolls back to `(0,0)`. Repeated proposals of `(1,1)` are suppressed. The model tests the restored baseline and requests finish. C rejects that stop once, citing the rollback's failure-memory event. The shared substitute advances to the next public hypothesis `(4,0)`, which preserves the zero invariant and tests a different explanation: change the slope without introducing an intercept. Public testing passes; later fresh private tests at 2 and -1 pass. B stops at `(0,0)` and fails private grading.
- **Clamp recovery:** the bad hypothesis changes both bounds and breaks the public lower-bound invariant. After rollback and bounded reconsideration, the alternative preserves the lower bound and changes only the upper bound. Fresh grading checks high and interior values. This is a different functional explanation, not merely different edit wording.
- **Discount recovery:** adding a fee breaks the zero-price invariant. The alternative uses a discount rate with zero fee, preserving that invariant while changing nonzero prices. Private checks validate that different explanation.
- **No available alternative:** C offers one reconsideration, the substitute has no remaining hypothesis, and C permits stop. Both B/C retain the original baseline but the issue remains unresolved. A retains the bad candidate and fails fresh public grading. Removing a regression is not counted as a solution.
- **Ignored feedback:** the stubborn substitute ignores the rejection and immediately requests finish again. C stops after one opportunity and private grading rejects the unchanged baseline. A resolves this case through its different observation trajectory. This is the retained loss versus conventional SARA and direct evidence that the improvement depends on model responsiveness.
- **Other controls:** public-pass-unresolved fails private grading without triggering an unjustified recovery intervention. Scope escalation remains the existing surgical-to-deep mechanism. Exhausted-search stops at six producer tests. Independent-verifier-error fails, authority interruption blocks dispatch, and uncertain accounting blocks grading. No negative control is accepted.

## Simulator changes, fairness and limits

The new common substitute retains the previous read/edit/test policy and public hypothesis list, adding a response to rejected finish: try the next available hypothesis, or stop if no hypothesis remains. The stubborn setting ignores that feedback. Each case uses the same setting in A/B/C. The implementation never inspects variant identity, hidden tests, grading answers or reference patches. It reacts to public policy feedback; no controller branch or model rule provides a correct repair. Nevertheless the hand-authored public candidate list normally contains a solution, so the experiment does not test discovery of new repairs.

The updated adapter intentionally reads `decision.action === reject_finish`. An inherited comment in frozen model.ts says controller-specific event names do not enter the adapter; that comment is stale for this round. The executable code and this disclosure define the actual substitution. Frozen bytes were preserved instead of editing the simulator after evaluation. The model observes the public rejection but does not semantically interpret its natural-language directive or evidence hashes. Real-model use of those details remains unverified.

A executes original PR135 producer bytes. B executes the exact previous PR137 producer. C executes the new producer. Both frozen snapshots are included. The new harness, model, fixtures, tests, settings and initial states are common to all variants; only the controller changes between B and C. The round-two harness explicitly imports both historical snapshots, adds the common stubborn-substitute setting, uses fixture-marked negative controls, and corrects the first round's descriptive recovery count to mean a failed post-baseline repair test. Those changes were frozen before candidate editing. Old round-one files remain untouched.

The real repository producer, patch validation, observations, budget admission, rollback, accounting and scope control are used. Toy applications, a narrow local Git sandbox, deterministic model, fault injection and local three-arm comparison orchestration substitute for real model transport, Docker executor, production two-arm runner, judge tasks and kernel acceptance. The evaluator uses fresh Git state, validates and applies frozen patches, and runs public/private cases in separate child processes. All 135 producer outcomes are written exclusively and fsynced before private grading. Public and private testing share program.cjs, so this is state-isolated verification, not a separately implemented oracle or Docker security qualification.

The 15 fixtures are assistant authored. Related misleading/stubborn/fault/scope controls are deliberately retained and are not counted as independent new application diversity. The old scope fixture was adapted for coverage, not used as a new success claim. Three earlier held-out cases form this round's development set. None of this is independent external qualification. No random seed is claimed: action policy is deterministic; timing and timing-derived event digests are not. The harness asserts selected outcomes and counters across repetitions, not byte-identical complete logs. File hashes establish internal reproducibility, not external tamper-proof attestation.

## Source revisions and reproduction

| Stage | Local commit | GitHub commit | Tree |
|---|---|---|---|
| Prior reviewed state B | `14f6301e1d355c37f975fb13605eb68de04604ac` | `11d3f47770fe3b24ae8447a4cab46258edaa17a2` | `13b00df5dae1b5775913cd1c650a86b56a872aa5` |
| Round-two fixtures/gate | `b4a5d5a41137db232cc5aae8f00769b36d66a554` | `3368c811a64bc0585e9eabe768d2a2dccb4fe65b` | `537b433f7b65fa0a568bf3fd286bae3b3de1ee90` |
| Evaluated C | `c7b6fa18ca1b465f55fae5f8fada21d44007ed56` | `0ddad1bc7030e00f3fc01809b31f5ce4f0131700` | `fc192259d1f75e5c5d1562e369dc84abab6d1e69` |

A is original remote source `31752fe68dfaa6ce8c33d145390b576db0693a28`. Producer SHA-256 values: A `ebd51c94a5a48571ad61233e12d02a2ccffe97d568f8640b79c01ad72e5b6e21`, B `3a168cddfb464cae1870ddf31eead17b0b7ea38df77b8fd490a11e041d15411f`, C `941d5fe29021d1195bda14855c0ed9d7f38ed0e9dc317da2f5ff58eef0dbfd5b`. Exact fixture, simulator and work-card hashes are in proof/recovery-v2/freeze.json. candidate-freeze.json binds C. Tree equality was checked when publishing commits with connector-generated metadata. Publication followed the local freeze/evaluation and is not an external attestation of evaluation timing.

Use the evaluated source or the later reporting-only snapshot in the evidence package, with existing Node v24.19.0, Git 2.51.1, Python 3.12.13 and installed package-lock dependencies. No network or provider credentials are required for simulation. Output directories must be unused and src writable for temporary historical imports. Avoid concurrent harness invocations in the same worktree. If an interrupted prior invocation left temporary imports, verify their ownership and snapshot hashes before cleaning them; never overwrite unrelated files.

```sh
node --import tsx proof/recovery-v2/run.mts --phase development --baseline-only --output /tmp/sara-v2-development-baseline
node --import tsx proof/recovery-v2/run.mts --phase development --output /tmp/sara-v2-development-candidate
node --import tsx proof/recovery-v2/run.mts --phase heldout --output /tmp/sara-v2-heldout
python proof/recovery-v2/summarize.py /tmp/sara-v2-heldout /tmp/sara-v2-report
node --import tsx --test tests/repository-producer.test.ts
npm run typecheck
taskset -c 0,1 npm run verify
```

Use two available CPU IDs for the repository suite if 0 and 1 are unavailable. Affinity only bounds test-suite concurrency; held-out timing completed before the suite began. Inspect results.json.gate.accepted because a valid negative experiment can exit zero. To reproduce round one, use its saved source snapshot; its frozen candidate hash intentionally rejects running the later controller as the old candidate.

## Next real-model check

The next useful experiment should directly test the exposed dependency: can the same real model respond to the rejection with a justified alternative without a supplied solution list? Freeze two distinct real-repository rollback cases and one no-alternative control. Use A/B/C, identical model/version/settings, fresh state, equal ceilings and independent hidden acceptance: nine attempts. Preserve failed and ignored-feedback outcomes, costs and accounting gaps. This would be a mechanism pilot, not a benchmark or a strong estimate under model variability; repeated paired trials would follow only if useful.

No such real-model experiment is authorized or activated by this simulation work. Actual SWE-bench attempts remain **0/20**. The $15.60 allowance, paid APIs, deployed system and hosting were untouched. This report supports no SWE-bench superiority, Luna capability, provider savings or real coding-speed claim.

## Verification and recommendation

Fresh verification completed on evaluated C: **17/17 focused repository-producer tests**, both new assertions fail against exact B source, typecheck passes, and `taskset -c 0,1 npm run verify` exits **0** with **1,093/1,093 tests**, all configured demo/proof stages and the separate **14/14 HTTP proof** passing. No repository-suite retry was needed. `check-baseline-regressions.py` safely reproduces the two expected baseline failures; its wrapper exits zero only after observing the expected test-runner failure summary. All 135 recorded producers were also checked against original request/tool/test ceilings and the single-continuation maximum. Frozen source/fixture/settings hashes were rechecked unchanged after evaluation.

Logs, their SHA-256 hashes, both development result sets, the initial launch failure/cleanup record, and every held-out producer/grade are included in the evidence package. `summary.json`, `comparison.md` and `traces.md` are generated descriptively from frozen outcomes by summarize.py; they do not change scoring or rerun producers. Existing rollback, equivalence suppression, scope, accounting, authority and independent-verification tests remain green. Historical live pins stay unchanged; only the offline producer pin follows C.

The predeclared synthetic gate is satisfied, so this merits review as a narrow bounded recovery change in draft PR137. It is not a production promotion recommendation or proof that a real model will use the opportunity well. Subsequent commits add only reports/reproduction scripts; no evaluated controller or simulator was tuned against held-out results. Remote CI is not claimed from these local results.
