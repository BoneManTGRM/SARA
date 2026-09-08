# SARA recovery and live-diagnostics decision

Accept v5 as a narrow, isolated candidate for controlled real-model evaluation. Both frozen simulation gates pass. Keep the active controller unchanged until that capability check; this is not production or SWE-bench qualification. The workflow and dashboard fixes are implemented, verified and prepared for review, with no merge, deployment or historical-task replay.

## What changed and why

The previous v4 experiment allowed useful prerequisite edits to be reconsidered after a failed batch, but it could export an untested regressing prefix at exhaustion. V5 adds one mechanism relative to v4: choose the already frozen public-passing champion for export when termination leaves a different candidate. It makes no additional tool/model/test calls and does not claim a physical rollback. Cleanup still fences execution; fresh grading is separate. If the baseline is red and no passing champion exists, existing final grading behavior remains.

B-to-C includes both the previously isolated terminal-transition attribution and the new export selection. It is a two-part recovery fix, not a one-variable comparison against B. The new mechanism is isolated by the v4-to-v5 focused counterexample: both unsafe-export assertions fail against v4 and pass against v5. Working active memory, rollback, scope limits, independent verification and accounting remain intact.

## Results

| Evidence set | Policy | A conventional | B current | C v5 |
|---|---|---:|---:|---:|
| development | responsive | 9/15 | 4/15 | 9/15 |
| development | imperfect | 7/15 | 3/15 | 8/15 |
| development | unresponsive | 1/15 | 1/15 | 1/15 |
| heldout | responsive | 2/2 | 0/2 | 2/2 |
| heldout | imperfect | 2/2 | 0/2 | 2/2 |
| heldout | unresponsive | 0/2 | 0/2 | 0/2 |

The 15 earlier scenarios are development/regression replay, not untouched evidence this cycle. The two new heldout families are string joining and numeric sorting. Do not pool these sets or count policies/repetitions as independent tasks. All 405 development and 54 heldout outcomes froze before fresh grading; there were no excluded or unrun slots. Fault-induced failed and blocked outcomes remain in the full comparison.

C gains both new tasks over B under responsive and imperfect policies, matches A there, and helps neither under ignored feedback. On the replay, C matches A under responsive feedback and resolves one more under imperfect feedback; these are simulator-specific descriptive outcomes. C retains zero public regressions and loses no B-resolved condition across either set. The v4 unsafe-prefix counterexample is removed by rejecting its export. Unresponsive exhaustion remains costly; no arbitrary retry cap was added.

## Accounting and overhead

Counts below are one canonical repetition per policy; repetitions measure variability, not extra independent successes. Complete counters, failures, timing medians, prompt volume, partial-progress proxies and separate grading process counts are in each summary.json and comparison.md. Existing host economic cost and real provider-token cost are not measured. Physical provider calls and new financial expense were zero.

| Set | Policy | Variant | Requests | Tools | Public tests |
|---|---|---|---:|---:|---:|
| development | responsive | A | 140 | 203 | 42 |
| development | responsive | B | 146 | 203 | 42 |
| development | responsive | C | 143 | 216 | 42 |
| development | imperfect | A | 180 | 264 | 67 |
| development | imperfect | B | 196 | 231 | 46 |
| development | imperfect | C | 193 | 244 | 46 |
| development | unresponsive | A | 168 | 250 | 68 |
| development | unresponsive | B | 446 | 329 | 36 |
| development | unresponsive | C | 446 | 339 | 36 |
| heldout | responsive | A | 22 | 32 | 6 |
| heldout | responsive | B | 24 | 32 | 6 |
| heldout | responsive | C | 22 | 36 | 6 |
| heldout | imperfect | A | 34 | 50 | 12 |
| heldout | imperfect | B | 36 | 38 | 6 |
| heldout | imperfect | C | 34 | 42 | 6 |
| heldout | unresponsive | A | 32 | 48 | 12 |
| heldout | unresponsive | B | 100 | 68 | 4 |
| heldout | unresponsive | C | 100 | 72 | 4 |

Both sets meet the predeclared gate: gains in two distinct families under responsive AND imperfect policies; no B-resolved loss; no added public regression; negative controls remain rejected. Equal-outcome ceilings: +4 requests, +4 tools, +1 public test; median time <=1.35B+50 ms; prompt bytes <=1.4B+4096. Policy totals for requests/tools/tests <=1.35B. Local timing is nondeterministic and shared-host measurements are descriptive. Counterbalanced execution order was used. Per-attempt ceilings remain 50 reservations, 200 tool steps, six public tests, 2 MiB observations and 30 minutes. Cleanup and evaluator activity retain their existing distinct accounting.

## Four iteration methods

1. Minimal case: an untested b=1 edit after a passing b=0 state must not be exported at exhaustion. The falsifier is export of that untested patch, extra budget use, or lost verified alternatives. Focused tests exercise empty and nonempty champions and useful-prefix recovery. One candidate was developed; no threshold tuning.
2. Fixed conditions: the substitute, program, fixtures, settings and original A/B snapshots were frozen in a commit before C. New program branches implement the two task semantics for all variants. Model substitute bytes are unchanged from v4. All variants share policy and fault settings. One v4-to-v5 mechanism is isolated in focused tests; A/B/C evaluates the composed candidate.
3. Critique: rejecting a regression is not task completion. Fresh private grading establishes fixture resolution. Unresponsive policies show no completion benefit; extra tool work remains. Finite-domain enumeration supplies repair capability. No hidden answers are supplied by C. Gains are not evidence that a real model will select a better repair.
4. Reordering: exact content-identical JSON prompt variants are preserved in prompt-order/. Objective, observations, strategy and limits are reordered without wording or authority changes. The substitute parses JSON keys and ignores order, so quality effects cannot be measured. No invented order sensitivity or successful ordering claim.

## Screenshot diagnosis and fixes

Task 7c3a6b53-35c1-42a3-9dc5-83988f5aa7c2 failed in [self-build run 34160079894](https://github.com/BoneManTGRM/SARA/actions/runs/34160079894), at source 9c763cf36efbc548774725fa318acbe8dad2e7e6. Its stored error digest matches `Error:Repository verification failed with exit code 1; output length 251426.` The individual historical checks cannot be recovered because child output was discarded. We do not claim that every historical failure has been explained.

A reproducible current setup defect exists: self-build ran root npm ci but omitted the pinned native verifier compiler required by repository tests. A clean archived source fails ENOENT without the subpackage; the same test passes with the existing pinned dependency. The workflow now runs its existing build-native-checker script before claiming work. No test weakening, dependency upgrade or larger workflow budget. The offline prerequisite control is not a newly executed hosted self-build.

Executor failures now retain a safe stage code, an output digest for failed publication commands and a strictly allowlisted workflow URL. Raw output stays private. A lost success-recording response stops as uncertain and does not issue a contradictory failure write. Existing immutable records and task state are preserved.

The owner-authenticated dashboard now projects only curated failure messages and trusted GitHub links. It shows failed tasks or expired claims instead of an unqualified idle headline, dates events, clarifies the unsupported browser stream, and fixes low-contrast capability text. This file-based executor still has no browser video. No browser capability or successful repair of the historical task is fabricated. Saved site version 50 has not been deployed.

## Verification

- Full `npm run verify`: exit 0, 1,104/1,104 repository tests, strict typecheck and every configured proof; separate HTTP proof 14/14.
- Focused recovery/executor/publisher: 13/13. The two v5 safety assertions fail against v4 as expected; the existing alternative recovery still passes.
- Site build succeeded; all 90 site tests passed, including authenticated safe diagnostics and hostile URL/raw-output rejection. No browser visual QA was performed.
- Development repair failures are preserved: initial site insertion syntax error, TypeScript phase-narrowing error, then a mechanical double-property typo caught by tests. The first full gate failed on that typo; it was corrected before a fresh full gate passed. These are implementation corrections, not heldout tuning.
- The inherited summary script retained v4-specific count labels and trace names; descriptive reporting was corrected after evaluation in build-report.py. Frozen producer outcomes, evaluator and acceptance gate did not change. The original summary failure log is preserved.

## Research applied

[Anthropic agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) distinguishes environment outcomes from transcript claims and capability testing from regression testing. That supports separate fresh grading and retained negative controls. [LangGraph persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence) describes checkpointed state; here the existing immutable champion is reused without adding a framework. [SWE-agent trajectories](https://swe-agent.com/latest/usage/trajectories/) supports inspectable execution traces; this package retains actions, observations and grading evidence. These sources motivate engineering choices, not SARA performance claims.

## Limits and next experiment

The substitute enumerates a supplied finite parameter domain. It does not discover arbitrary code repairs, interpret semantic requirements or model real feedback distributions. Its responsive/imperfect/unresponsive policies are programmed sensitivity controls. Toy local Git repositories and child-process assertions substitute for Docker task environments, real models, remote transport and an external judge. Assistant-authored heldout tasks are not independent qualification. Seed control is unnecessary for deterministic policies; timing and runtime UUIDs are not deterministic. No SWE-bench, Luna-capability, provider-savings or real coding-speed claim is supported. Actual SWE-bench remains 0/20; the $15.60 allowance remains inactive.

Smallest next capability experiment: six matched real-model attempts, B/C on three independently chosen repository tasks (useful partial repair, misleading evidence and delayed recovery). Freeze the same model/version/settings, tools, starting commits and per-attempt ceilings; supply requirements, not a solution menu; keep tests separate and grade fresh. Use this to test whether real feedback changes the next hypothesis without unsafe export. Prompt-order quality should be a separate content-identical experiment, not mixed into the controller comparison. Exact cost estimate and a fresh bounded authorization are required before any provider call; existing hosting must be confirmed to add no expense. No such calls are authorized or executed here.

## Reproduction and provenance

Source revisions are in source-revisions.json; frozen content hashes in ../freeze.json and ../candidate-freeze.json. Reproduce in a clean source checkout with the pinned existing dependencies:

```sh
node --import tsx proof/recovery-v5/run.mts --phase development --output /tmp/sara-v5-development-new
node --import tsx proof/recovery-v5/run.mts --phase heldout --output /tmp/sara-v5-heldout-new
node --import tsx --test tests/recovery-candidate-v5.test.ts tests/site-executor.test.ts tests/github-draft-publisher.test.ts
python proof/recovery-v5/check-bootstrap.py
npm run verify
```

Use fresh output directories: the runner refuses overwriting frozen artifacts. Raw result JSON includes every event and final grade. Report summaries are descriptive. Site source is separately pinned; its review patch and source archive are included in the evidence package. No PMC vault is configured; CHECKPOINT.md is the retained navigation record.
