# SARA recovery: frozen, zero-cost synthetic evaluation

**Decision: the candidate meets the predeclared synthetic acceptance gate and merits review as a narrow repository-controller fix. It does not establish superiority over conventional SARA or justify production activation.** Improved Reparodynamic SARA resolved 7/13 cases, current Reparodynamic SARA 3/13, and conventional SARA 8/13. Four gains over the current controller, no lost current-controller successes, and one remaining loss against conventional SARA were preserved. Actual SWE-bench execution remains **0/20**; no live allowance, provider API or deployment was activated.

## What changed and why

The existing repository producer already had public-test observations, failed-edit memory, rollback to a passing champion, and bounded escalation from surgical to deep scope. The concrete defect was narrower: it remembered failed edits by action text alone. An edit that failed before another prerequisite changed stayed forbidden after that prerequisite changed.

The candidate binds a failed action to its starting patch digest. It also recognizes the identical starting/resulting patch transition even if an edit uses a different text anchor, restoring that rejected state and checking the restoration. Each failed test adds a bounded failure-memory record binding the candidate digest, exact public-test event digest, and recent action/transition hashes. Existing dispatch, output, retry, scope and wall limits remain in force. Memory is per producer invocation, with no task/variant/run sharing; sets are bounded by the existing model-request ceiling, and each new evidence record includes at most eight hashes of each kind plus omission counts.

This is one coherent change to failure identity, not a new repair planner. The shared model substitute selects alternative public hypotheses in response to failed tests and reads actual resulting files. The controller permits a formerly failed edit in a changed context and still rejects it in an unchanged context. Fresh evaluation decides whether the new context helped. Failure attribution across a multi-edit batch remains conservative: it is evidence that the batch failed, not proof that every constituent edit was causal. `baselinePassed` in the new event means whether a passing champion exists at that moment, rather than an immutable statement about the initial checkout.

A development prerequisite fixture demonstrated the defect before implementation. Two new behavioral regression tests fail against the exact original producer and pass against the candidate: changed prerequisites permit reuse, and different anchors cannot retain an identical failed state transition. The second behavior is demonstrated by the focused tests; no held-out case exercises expanded-anchor equivalence, so no held-out benefit is attributed to it.

## Comparison and acceptance

Counts below use one outcome per case, not the 117 repeated producer runs as independent evidence.

| Measure | A conventional | B current Reparodynamic | C improved Reparodynamic |
|---|---:|---:|---:|
| Resolved synthetic cases | 8/13 | 3/13 | 7/13 |
| Resolved after a post-baseline failed repair test | 7 | 2 | 6 |
| Model-substitute requests | 135 | 151 | 139 |
| Producer tool steps, including freezes/restores | 197 | 195 | 195 |
| Producer public-test calls | 41 | 40 | 40 |
| Separate grading test processes | 32 | 32 | 32 |
| Explicit regression rollbacks | 0 | 2 | 2 |
| Known retained public regressions | 0 | 0 | 0 |
| Unavailable regression grades | 2 | 2 | 2 |
| Executed identical action/context repeats | 0 | 0 | 0 |
| Duplicate proposals suppressed | 0 | 10 | 2 |
| Scope proposals suppressed | 0 | 4 | 4 |
| Test-budget exhaustion | 1 | 1 | 1 |
| Completed grading / failed / blocked | 10 / 1 / 2 | 10 / 1 / 2 | 10 / 1 / 2 |
| Producer slots unrun | 0 | 0 | 0 |
| Observed total prompt bytes | 889,108 | 1,161,168 | 1,094,175 |
| Physical provider calls / model spend | 0 / $0 | 0 / $0 | 0 / $0 |

All cases, counters and median timings are in [comparison.md](comparison.md). Each variant ran all 13 cases three times, rotating first position A/B/C. Outcome and selected counter reproducibility checks passed. Repetitions measure repeatability and local timing; they do not enlarge the independent task sample.

Before candidate evaluation, the work card required at least two additional resolved cases over B across at least two program families, no B-resolved loss, no added retained public regression, and rejection of all negative controls. For cases with identical A/B/C resolution, C could add at most two tools/tests per case and its median producer duration had to stay within 1.25 times B plus 25 ms. The frozen gate passed. Gains were affine-prerequisites, clamp-bounds, discount-fee and misleading-output, spanning three program families. Removing misleading-output as related stress evidence still leaves three gains across those families. The underlying prerequisite-retry pattern is shared: these are varied toy functions, not independent discoveries of multiple recovery mechanisms.

On the gate's equal-outcome cases C added zero tools and zero public tests; all median timing bounds passed. A no-benefit example, regression-alternative, resolves in all variants: B/C need 15 tools versus A's 13 because they restore and freeze the bad candidate. C also carries 42,825 prompt bytes versus B's 40,145 there, with median durations 126 versus 112 ms. Straight-repair adds 15 ms median over B (87 versus 72); unsolvable-test-limit adds 21 ms (254 versus 233). These timings include toy repository operations and local scheduling; they are not isolated CPU overhead, coding speed, or provider cost measurements.

The report corrects one descriptive shorthand without changing evaluation: frozen `table[*].recovery` requires more than one failed public test and misses regression-alternative, which starts green and has one failed repair. `summarize.py` instead counts a resolved case with any failed test after the initial baseline. Raw results, gate, fixtures and candidate are unchanged. The simulator's `repeatedEdits` counter means executed identical action-and-starting-content repeats; it does not claim general semantic repetition detection. A's repeated-regression re-tests the same bad candidate without performing another edit. B/C suppress two duplicate proposals, roll back, then the substitute incorrectly finishes after testing the restored green baseline. The private evaluator rejects that unresolved outcome. This remains a limitation and explains C's 7 versus A's 8 successes.

The 32 grading processes per variant include 11 baseline checks, 11 fresh public checks and 10 private checks. The injected verifier failure prevents its private check. Two interrupted/accounting cases are blocked before grading. These fixed evaluator calls are outside producer test ceilings and identical across variants. Producer model reservations are 136/152/140, one greater than actual substitute calls in each arm because the authority hook blocks a reserved dispatch. Unknown accounting remains unresolved rather than converted to zero exposure.

## Representative behavior

Full event digests, action text, public outputs, selected memory records and final grades are in [traces.md](traces.md); all candidate patches remain in the raw results.

- **Changed prerequisites:** affine-prerequisites begins with `(a,b)=(0,0)` and failing public tests. `(2,0)` fails, so C records its exact patch and test evidence. The shared substitute rejects that hypothesis, returns `a` to zero and tries `(0,3)`, which also fails. It then tests the different explanation that both terms are needed, trying `(2,3)`. B suppresses `a:0→2` because it failed earlier; C permits it because the starting patch now includes `b=3`. C passes public checks and, only after all producers freeze, fresh checks at inputs 0 and -2. The already-failing initial state does not trigger a spurious regression rollback.
- **New regression with alternative:** mode 0 passes public tests but leaves the issue unresolved. Mode 1 fails; C records evidence and rolls back to mode 0. The substitute advances to mode 2, which passes both fresh public and private evaluation. B also succeeds; this is preserved safety behavior, not a new solved task attributed to C.
- **Repeated ineffective proposal:** mode 1 fails and is rolled back. Two same-context proposals are suppressed. The substitute tests restored mode 0 and prematurely finishes; the private test fails. Rollback removed the regression but did not solve the task.
- **Misleading evidence:** the diagnostic says to change `a`, not `b`; the substitute uses exit status and actual state, not prose interpretation. This checks tolerance of misleading text in this adapter, not real-model diagnostic reasoning.
- **Different scope:** deep-whole-file cannot fit within the existing 80-line surgical bound. Repeated public failures trigger existing deep escalation, allowing the whole-file candidate under its 240-line bound. B and C both solve it; no new escalation capability is claimed.
- **Verification/accounting:** public-green-hidden-bug fails the private evaluator despite public green. Verifier-unavailable is marked failed. Authority interruption blocks the next dispatch; uncertain-dispatch leaves one unreconciled model request and blocks grading. No case is accepted on these paths.

## Fairness, substitutions and limitations

A and B execute an exact saved copy of the original `runRepositoryProducer`; C executes the changed producer. B and C differ only in that producer implementation. The common settings, substitute, task hypotheses, initial files, tests, patch validation, fault injections and grading policy are identical. The candidate was frozen after development and before the first held-out run, with no subsequent implementation or simulator tuning.

The simulator uses real producer parsing, recurrence/scope control, budgets, observation history, rollback orchestration, accounting and repository patch validation. It substitutes a deterministic local model, a narrow local Git sandbox, toy applications, and a separate local grader. The production comparison orchestrator expects its live two-arm task manifest; the simulation uses explicit three-arm orchestration in `run.mts` rather than altering the live runner. Production authority/kernel acceptance, Docker security isolation, judge-controlled task environments, model transport and live accounting are not qualified by this simulation. Faults are explicit fixture injections.

The substitute receives producer-visible observations and public configuration hypotheses only. Its implementation does not inspect variant identity, hidden tests, reference patches or grading answers. It reads actual source and reacts to observed test exit status; it is not an observation-blind action replay. However, the ordered public hypotheses are hand authored and usually include the solution. They substantially simplify repair generation. The adapter ignores controller-specific memory event kinds and natural-language diagnostics; the new evidence record is bound and tested, but useful interpretation of that record by a real model is unmeasured.

Each producer and grader has a fresh local Git directory. All 117 producer outcomes are written exclusively and fsynced before any private grading. The evaluator validates and applies the frozen patch in a separate fresh checkout, reruns public tests and uses private cases. The evaluator shares `program.cjs` with public testing: it is independent of the producer's mutable state, not an independently implemented oracle. Some private cases add little coverage (notably constant-mode/sum fixtures). Local file hashes detect changes relative to the manifest; they are not an external tamper-proof attestation.

The 3 development and 13 held-out fixtures were assistant authored. Held-out means unused for candidate tuning after the recorded freeze, not independent external qualification or blind author access. Related stress/fault cases remain in totals but are not claimed as independent application diversity. This is a small, deterministic synthetic experiment. It establishes neither SWE-bench performance, Luna capability, provider savings, nor expected real coding speed.

There is no random sampling: hypotheses and response policy are deterministic, so no seed is claimed. Wall-clock timestamps, elapsed times, Git metadata and timing-related event digests can vary. The frozen harness checks resolution, grade status, restores, edits, exact repeats and substitute calls across repetitions; it does not assert byte-identical complete logs. All variants have ceilings of 50 model reservations, 200 tool steps, six public tests, 2 MiB observed output and 30 minutes per producer. Additional failure records increase prompt size, bounded by existing request limits. No token-cost model or paid service is used.

## Source and evidence provenance

| Stage | Local commit | GitHub commit | Exact tree |
|---|---|---|---|
| Original PR #135 | `2d5e8de6c24d628041b85a6e9d20284170baa8f5` | `31752fe68dfaa6ce8c33d145390b576db0693a28` | `6c9ce0e799d64558cb978f41e105d5f39e0e51cf` |
| Fixtures and gate frozen | `a95a4ec9537273438626b9fa5476f22663ffe109` | `f1ebc14ee24545bc60a6ab2036d6aee72af7f9d3` | `06b2653fcdba36a24eac2ba42f37fdcef3923b87` |
| Evaluated candidate | `e1e9aa477028f040f6e2fc1202b769fada783501` | `53684fe40c5ed7fab2780d1c2b8dbd40eed1af47` | `bb0b1ba6de22dec800584c252bbcf2598c6e853c` |

Local and GitHub commit IDs differ because the connector creates commits with its own metadata; tree identity was checked. Fixture freezing and candidate execution occurred locally before publication; publication preserves those two source stages but is not an external timestamp attestation of the earlier evaluation.

The original producer SHA-256 is `ebd51c94a5a48571ad61233e12d02a2ccffe97d568f8640b79c01ad72e5b6e21`; the candidate is `3a168cddfb464cae1870ddf31eead17b0b7ea38df77b8fd490a11e041d15411f`. All fixture, simulator and gate hashes are in `proof/recovery/freeze.json`; `candidate-freeze.json` binds the evaluated implementation. `summary.json` includes SHA-256 hashes of both raw evidence files. The evidence archive includes full candidate source, patch, logs, all development outputs and held-out outputs. Historical live qualification pins remain untouched; only the separate offline qualification pin follows the candidate.

## Reproduce locally

Use the evaluated source snapshot with existing Node.js, Git, Python 3, and the repository's installed dependencies (tsx and TypeScript). No provider credentials or network access are needed for simulation. The commands require unused output directories and writable `src` for a temporary import of the original producer. Do not run concurrent harness invocations in the same worktree. Dependencies are pinned in package-lock.json; an environment without those dependencies must supply them before attempting offline reproduction.

```sh
node --import tsx proof/recovery/run.mts --phase development --baseline-only --output /tmp/sara-recovery-baseline
node --import tsx proof/recovery/run.mts --phase development --output /tmp/sara-recovery-development
node --import tsx proof/recovery/run.mts --phase heldout --output /tmp/sara-recovery-heldout
python proof/recovery/summarize.py /tmp/sara-recovery-heldout /tmp/sara-recovery-report
node --import tsx --test tests/repository-producer.test.ts
npm run typecheck
taskset -c 0,1 npm run verify
```

Use two available CPU IDs for the last command if 0 and 1 are unavailable. CPU affinity bounds repository-suite concurrency on this shared machine; it was not applied to or used to change simulation budgets. Held-out timing was completed before the full suite began. The executable evaluator can return zero for a valid experiment whose gate fails: inspect `results.json.gate.accepted`, not just process exit status.

## Smallest next real-model experiment

After separate authorization and provision of a usable model/runtime, freeze three small real-repository issues with independent tests: two distinct prerequisite/context-recovery issues and one repeated-regression negative control. Run A/B/C once per issue with the same pinned model configuration, tools, initial state and per-attempt ceilings: nine attempts, no supplied solution hypotheses and no reuse of failed-run memory across arms. Require independent fresh verification and report every failure, accounting gap and extra call. This would test whether a real model produces and uses the context-sensitive alternatives without scripted hypotheses. It is a bounded mechanism check, not a statistically persuasive benchmark. Repeat paired trials would then be needed to address model variability. Use supported seeds only and do not claim determinism from them alone. None of those attempts was run here; this does not consume or replace the paused 20-attempt SWE-bench comparison.

## Verification results

On the evaluated candidate, `node --import tsx --test tests/repository-producer.test.ts` passed **15/15**, including both new behavioral regressions. Running those two assertions against frozen original source failed both as expected (exit 1); `proof/recovery/check-baseline-regressions.py` reproduces that comparison without changing the working producer. `npm run typecheck` passed. `taskset -c 0,1 npm run verify` completed with exit 0: **1,091/1,091 tests**, typecheck, all configured demo/proof stages, and the separate **14/14 HTTP tests** passed. The suite includes rollback, budget/authority, accounting, task isolation, live-pin rejection and offline-pin validation coverage. No full-suite retries were needed for this candidate run.

Runtime: Node v24.19.0, Git 2.51.1, Python 3.12.13. Full logs and their hashes are included in the evidence archive. Subsequent additions are reporting/reproduction files only; evaluated controller, frozen fixtures and simulator have not changed. Remote CI is not claimed by these local verification results.
