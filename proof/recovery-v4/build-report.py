"""Build the review report from frozen evaluation plus fresh verification metadata."""
from pathlib import Path
import json,sys
p=Path(__file__).resolve().parent;r=p/'report'
s=json.loads((r/'summary.json').read_text());rev=json.loads((r/'source-revisions.json').read_text());v=json.loads((r/'verification.json').read_text())
lines=['# SARA failed-batch attribution: candidate rejected','',
'''The controller really does over-attribute a failed batch: it marks every intermediate edit as failed even though only the final state was tested. Narrowing suppression to the final tested transition restores useful prerequisite reuse and increases synthetic resolutions. **Reject this candidate:** when feedback is ignored, it can leave a regressing intermediate prefix at budget exhaustion. Fresh grading rejects that patch, but the mandatory no-added-retained-regression gate fails. The latest non-rejected active producer and qualification pins remain unchanged.

This is one completed engineering cycle: one development experiment, one frozen candidate, one held-out execution, no tuning after evaluation. It is a valid negative acceptance result despite completion gains. No paid model calls, new services, hosting expense, merge, deployment, NICO change, live allowance activation or SWE-bench attempts occurred.

## Fair comparison and results

A = original PR135 conventional producer. B = latest non-rejected PR137 controller at the confirmed checkpoint. C = isolated terminal-transition attribution experiment, never installed as the active producer. The previously rejected three-rejection cap is historical evidence only.

15 fixture scenarios span five toy program families. There are 45 scenario-policy conditions and three counterbalanced executions, giving 405 producer outcomes. Policies, repeats, related parameter variations and duplicated fault-control tasks are not independent task evidence. The runner's legacy `distinctTasks` field counts fixture records; it must not be read as 15 independent task families. Never pool these rates with previous rounds.

Each count below uses one repetition. Resolution means the frozen patch passes separate fresh public and private grading with complete accounting and allowed authority. A producer may exhaust its budget yet leave a patch the separate grader resolves; those outcomes are shown explicitly.''','',
'| Response policy | Variant | Resolved / 15 scenarios | Recoveries after failed repair | Of those, producer finished | Resolved after exhaustion | Retained public regressions |',
'|---|---|---:|---:|---:|---:|---:|']
for policy,arms in s['policies'].items():
 for arm,x in arms.items():lines.append(f"| {policy} | {arm} | {x['resolved']} | {x['recoveries']} | {x['recoveriesFinishedByProducer']} | {x['resolvedAfterExhaustion']} | {x['retainedRegressions']} |")
lines+=['', '''C gains five scenario conditions over B under both responsive and imperfect policies, spanning affine, clamp and discount families. The misleading-price parameter variation is not extra independent diversity. It loses no B-resolved case. All four extra resolutions with unresponsive C occur after exhaustion: the controller permits useful work, but the substitute does not recognize successful recovery. This is not demonstrated repair intelligence or reliable stopping.

Comparison with A is separate: C ties A under responsive feedback and has one more resolved condition under imperfect feedback in this fixture set. These descriptive synthetic counts establish no conventional-SARA superiority or real-model distribution.

## Causal diagnosis and four iteration methods

1. **Start simple.** Development begins at a=0,b=0, with the requirement f(x)=2x. The substitute first edits a to 2 and b to 1. The zero-input public invariant fails, and rollback restores the baseline. B also suppresses reusing the untested a=2 prerequisite. Source cause: the failed-test branch copies every pending tactic and transition into failed memory. Falsification condition: B permits the prerequisite or C fails to unblock it with the same substitute and ceilings. Observed: B fails, C resolves under responsive and imperfect policies; focused baseline assertions fail for the expected state mismatch.
2. **Single variable.** Only suppression attribution changes. C tracks the chronological final accepted tactic and transition; after a failed test, only those exact context-bound keys are suppressed. Untested earlier tactic keys remain bounded, separately labeled evidence. The full candidate and failed test still have exact digest bindings. No retry cap, scope limit, model policy, verifier or budget changes. Common model and program bytes match v3 exactly. Simulator corrections were frozen before C: sufficient public requirement descriptions and common post-freeze partial-state measurements. All arms use that same setup.
3. **Reflection.** Actual separate grades demonstrate new resolved patches, not just rollbacks. Alternatives reuse a requirement-aligned first edit and change the failing second edit. The finite-domain substitute supplies both choices; it neither reads the new memory labels nor discovers code repairs. Useful fields can coexist with harmful overall behavior. The preserved prefix-regression counterexample falsifies safe acceptance. No threshold tuning or second candidate was attempted.
4. **Component reordering.** Existing prompts are canonically ordered by key. Exact B development prompt and a content-identical issue/evidence-first ordering are retained in `prompt-order/`. Objective, state observations, failure evidence, rejected actions, instruction and limits are present; a separately computed remaining-budget field is not. The unchanged substitute parses keys and ignores ordering, so effectiveness is unmeasurable. No order sensitivity was added. The two files are preparation for later real-model testing, not a successful ordering experiment.

## Representative causal traces

- **Scale / imperfect / B:** a=3 followed by b=2; zero-input invariant fails; memory marks both context-bound edits failed; rollback; reusing a=3 is suppressed; bounded finish leaves the original defect. Fresh grading fails the stated three-times-input requirement.
- **Scale / imperfect / C:** identical first batch fails; only the terminal b transition becomes suppressible; rollback; a=3 can be reused; repeated terminal b=2 proposals remain suppressed; the shared policy eventually selects b=0. Producer public tests and fresh separate grading pass. No budget increase.
- **Price / unresponsive / C:** the batch fails and rolls back; the useful rate prefix is reused, while the known failed fee transition remains suppressed. The producer exhausts all 50 reservations. Separate grading finds the remaining prefix correct. This is a correct frozen patch, not successful producer decision-making.
- **Unsafe prefix / unresponsive / C:** public requirement is f(x)=2x-2; initial f(x)=0 passes the public invariant f(1)=0. After the failed a=2,b=1 batch rolls back, C permits the a=2,b=0 prefix. It blocks repeating the tested b=1 transition, but ignored feedback never selects b=-2. At exhaustion the prefix returns 2 at x=1: a retained public regression. B leaves the baseline and retains no regression. The separate grader rejects C; the acceptance gate fails.
- **Public-green unresolved, verifier unavailable, authority interruption, uncertain dispatch:** preserved as negative outcomes under all arms and policies. Public green never substitutes for private grading. Uncertain usage remains incomplete and blocks grading.

`traces.md` contains exact event details, evidence and patch digests, producer status and fresh grading output; the evidence archive contains complete events for all 405 outcomes.

## Predeclared gate

Primary: at least two additional B-unresolved scenarios across at least two program families under BOTH responsive and imperfect policies. Mandatory: no loss of any B-resolved condition under any policy; no added retained public regression; all designated negatives rejected; unchanged verification, authority and per-attempt ceilings.

Equal-outcome C-B limits: +4 requests, +4 tools, +1 public test, median producer wall time <=1.35*B+50ms, prompt bytes <=1.4*B+4096. Total requests, tools and tests for each policy <=1.35*B. The gate was declared in the work card/settings before implementation. Gains and diversity pass, no-loss passes, overhead passes, negative controls pass, but retained-regression safety FAILS. That mandatory failure determines REJECT regardless of score.''','',
'## Accounting, repetition and overhead','',
'| Policy | Arm | Requests / reservations | Tools / public tests | Regression rollbacks | Duplicate proposals suppressed | Repeated exact edits executed | Exhausted | Prompt bytes | Sum of case median producer ms |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for policy,arms in s['policies'].items():
 for arm,x in arms.items():lines.append(f"| {policy} | {arm} | {x['requests']} / {x['reservations']} | {x['tools']} / {x['tests']} | {x['regressionRollbacks']} | {x['duplicateProposalsSuppressed']} | {x['repeatedEditsExecuted']} | {x['exhausted']} | {x['promptBytes']} | {x['sumCaseMedianProducerMs']} |")
lines+=['','''All arms retain 50 model reservations, 200 tool steps, six producer public tests, 2 MiB observed output and 30 minutes per producer. Restores and patch freezes consume tool steps. Continuations consume original reservations. Requests are actual substitute invocations; reservations also include admission that fails before model invocation. Each policy/arm contains one uncertain-accounting case; usage is not reset or converted to known zero.

Physical provider invocations and incremental provider/hosting expense: zero. Existing computer economic cost is unmeasured. Model-reported tokens are zero because the substitute does not use a model tokenizer; actual prompt bytes and observed output bytes are measured. Fewer simulated calls are not provider savings.

Elapsed values include repository operations, child public-test processes and controller work. They are local end-to-end overhead measurements, not isolated controller CPU time or real coding-speed measurements. Request, tool and prompt differences expose controller-induced extra work. Timing remains nondeterministic. Policies/actions have no randomness; no real-model seed control is claimed. SHA-bound inputs and three repeated checks establish reproducible action/outcome counters, not deterministic wall time.

Fresh grader processes and partial-state probes are outside producer accounting and reported separately. Private grading uses a fresh Git checkout, validates and applies the frozen patch, and runs the same public evaluator followed by held-out test inputs in separate child processes. The evaluator and public runner share `program.cjs`; this is fresh-state verification, not an independent implementation of the oracle. No kernel production acceptance, real Docker judge, or official SWE-bench environment is exercised.''','',
'## Partial progress and all terminal outcomes','',
'| Policy | Arm | Finally requirement-aligned scenarios | Alignment losses / reuses | Grading outcomes | Producer outcomes | Grading test processes | Uncertain accounting |',
'|---|---|---:|---:|---|---|---:|---:|']
for policy,arms in s['policies'].items():
 for arm,x in arms.items():
  q=x['partialProgress'];lines.append(f"| {policy} | {arm} | {q['scenariosFinallyAligned']} / {q['scenariosAssessed']} | {q['alignmentLossTransitions']} / {q['alignmentReuseTransitions']} | {x['gradeOutcomes']} | {x['producerOutcomes']} | {x['gradingProcesses']} | {x['uncertainAccounting']} |")
lines+=['','''Partial progress is assessed only after producer freeze against publicly stated requirements: selected fields match part of the requirement. It is not a verified intermediate repair, as the unsafe-prefix case demonstrates. Rollback losses of these fields are counted separately from final task resolution. Complete per-condition metrics include scope suppression, repeated failed public tests, unavailable regression grades, observed output volume and unreconciled reservations in `summary.json` and raw results.

No held-out launch failed, no held-out execution was rerun, and no scenario was removed. All 405 producers froze before any private grading. Blocked cases remain blocked; they are not silent unrun omissions. There are no omitted or unrun scheduled producers. One local Anti-Churn reservation setup failed because raw policy-file bytes were hashed instead of canonical JSON. It started no verification or simulation; the diagnostic was preserved, the digest construction repaired, and the single full gate was then reserved. It did not change the simulator or candidate.

## Validity audit and remaining limitations

- Controller-enforced: context-specific suppression, scope limits, rollback, one bounded reconsideration, operation admission/accounting, and the intended change in which transitions are labeled failed.
- Substitute-supplied: finite-domain enumeration, per-policy patience 1/4/infinity, response to tests/readback, eventual alternative choice and green-test finish. All variants share identical implementation/settings. It never sees grading cases, reference patches or variant identity. Public `space` metadata is a hand-authored capability boundary. The substitute ignores requirement semantics and the new failure-memory label; a win demonstrates controller permissiveness for supplied search capability.
- Separately verified: frozen patch behavior on fresh public/private examples, no added hidden acceptance for uncertain accounting, and the concrete retained-regression counterexample.
- Untested: general repair discovery, nuanced evidence interpretation, prompt-order effects, real-model responsiveness distribution, production sandbox acceptance and official benchmark performance.

Public descriptions now state the intended repair. Hidden inputs assess those stated requirements rather than introducing secret objectives. No deliberate underspecified objective is included. Some public tests intentionally permit legacy behavior and are incomplete, as explicitly stated in the issue. `public-test-insufficient` demonstrates the substitute's inability to use the sufficient requirement description.

Assistant-authored held-out fixtures are not independent external qualification. Related cases, the small toy language and authored search domains limit generality. The gains span three program families but are not a statistical estimate of real-world effect. Historical rounds remain immutable and are not pooled.

## Source identity and reproducibility''','']
for k in ['checkpointRemote','checkpointLocal','checkpointTree','commonFreezeLocal','commonFreezeRemote','commonFreezeTree','candidateFreezeLocal','candidateFreezeRemote','candidateFreezeTree','candidateSha256']:lines.append(f'- {k}: `{rev[k]}`')
lines+=['','Source SHA-256:','']
for k,x in rev['sources'].items():lines.append(f'- `{k}`: `{x}`')
lines+=['','Frozen fixture/setup SHA-256:','']
freeze=json.loads((p/'freeze.json').read_text())
for k,x in freeze['files'].items():lines.append(f'- `{k}`: `{x}`')
lines+=['',f"Environment: `{rev['environment']}`.",'', '''Source snapshots, `freeze.json`, `candidate-freeze.json`, integrity checks and source revisions are included. The archive includes the full frozen source tree and unchanged prior-round evidence archive for exact reconstruction. Later reporting commits do not alter the candidate, fixtures, model, evaluator or gate.

From the included source tree with the existing Node dependencies available (do not install paid services):

```bash
node --import tsx proof/recovery-v4/run.mts --phase development --baseline-only --output /tmp/sara-v4-dev-baseline-new
python proof/recovery-v4/check-baseline-regressions.py
node --import tsx --test tests/recovery-candidate-v4.test.ts tests/repository-producer.test.ts
node --import tsx proof/recovery-v4/run.mts --phase development --output /tmp/sara-v4-dev-candidate-new
node --import tsx proof/recovery-v4/run.mts --phase heldout --output /tmp/sara-v4-heldout-new
python proof/recovery-v4/summarize.py /tmp/sara-v4-heldout-new /tmp/sara-v4-summary-new
python proof/recovery-v4/verify.py
```

Use new output directories; the runner refuses to overwrite frozen outcomes. Reproduction of the now-inspected evaluation is a replay, not a new untouched evaluation. The baseline-check wrapper expects the three assertions to fail and exits zero only for that expected rejection. Its internal baseline test command exits one. `verify.py` temporarily stages the isolated C source for strict TypeScript checking and removes it in `finally`; it does not replace active source.

## Fresh verification''','']
lines += [f'- Focused regression command: exit {v["focusedExit"]}, {v["focusedTests"]}/{v["focusedTests"]} passed (17 active producer tests plus three candidate tests).',
 f'- Baseline red command: exit {v["baselineRedExit"]}, all three new assertions fail for the intended prerequisite suppression.',
 f'- Full `python proof/recovery-v4/verify.py` / `npm run verify`: exit {v["fullGateExit"]}, {v["repositoryTests"]}/{v["repositoryTests"]} repository tests; candidate-inclusive typecheck; all configured proof stages; {v["httpTests"]}/{v["httpTests"]} separate HTTP checks.',
 '- Active producer, prior evidence and historical qualification pins unchanged. One full gate, no equivalent rerun.',
 '- The prior checkpoint GitHub test check was observed green. This cycle\'s local checks are not evidence of remote CI at its later reporting head.', '',
'''## Plugin use and completion evidence

Engineering Guardrails guided repository instruction review, one causal change, red/green tests and the full gate. Coordinator inspection found no enabled board; the existing isolated worktree remained the sole implementation surface, with no additional agents or foreign-worktree edits. PMC has no configured vault; repository reports/work cards supply verified continuation memory, without starting a vault-setup project. AI Psychiatry root-cause, anti-gaming and completion-evidence skills informed the predeclared gate and rejection. Anti-Churn reserved and linked one exact full-gate result; it did not override behavioral acceptance. GitHub publishes the draft review only. OpenAI Library preserves the downloadable report/archive. OpenAI Docs, Railway and Vercel were unnecessary and unused.

The completion contract is satisfied by: reproducible diagnosis and exact candidate diff; one bounded development record; frozen A/B/C policy evaluation with all outcomes and metrics; exact prompt-order artifacts with an explicit unmeasurable label; fresh focused/full verification; a rejected-candidate decision; unchanged active source; draft PR and downloadable evidence; and the future experiment below. A passing engineering gate does not convert the behavioral rejection into acceptance.

## Smallest remaining real-model experiment

A separately authorized six-attempt mechanism pilot: three public, fully specified multi-edit repository issues, paired B/C attempts using one fixed real model/version and identical per-attempt ceilings. Include two distinct cases where a useful first edit accompanies a failing second edit and one case where the reused prefix itself regresses. Freeze tasks before calls, remove supplied repair domains, alternate B/C order, isolate state, preserve all outcomes, and grade frozen patches separately in fresh task environments. Record whether the model uses actual evidence to revise the bad part, safely verifies reused prefixes and finishes within budget.

C remains an explicitly rejected diagnostic experiment. Do not activate it in production; a real-model win would not erase the known unresponsive counterexample or authorize promotion. The immediate engineering unknown is how to preserve useful batch reuse while preventing an untested prefix from being retained at termination. Addressing that requires a new bounded cycle, not an after-the-fact amendment to this candidate.

Future requirements: an existing suitable isolated executor, judge-controlled or separately maintained test environments, access to the chosen model, and fresh explicit authorization for a hard capped allowance and six attempts. No current allowance is activated, and no price or free real-model capacity is assumed. The earlier $15.60 authorization remains paused. This small pilot could test a mechanism; it would not establish SWE-bench superiority, Luna capability, provider savings or real coding-speed improvement.

## Complete scenario-policy table
''']
lines.append((r/'comparison.md').read_text().split('\n',2)[2])
(r/'REPORT.md').write_text('\n'.join(lines)+'\n')
print(r/'REPORT.md')
