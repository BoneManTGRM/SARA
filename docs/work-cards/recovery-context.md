# Context-bound repair recovery experiment

Scope: repository producer failure memory, local synthetic evaluator and focused
regressions. No deployment, model API, live grant, hosting change or NICO change.
Baseline GitHub source: 31752fe68dfaa6ce8c33d145390b576db0693a28;
local equal-tree source: 2d5e8de6c24d628041b85a6e9d20284170baa8f5.

Observed mechanism: failedTactics currently hashes the edit alone. An edit that
failed before another prerequisite changed is suppressed in the new context.
Existing rollback, recurrence escalation and prompt observation history already
exist. The candidate will bind failed tactics to the pre-edit patch state and
retain a concise binding to the failed candidate and public-test evidence.
It does not infer that all different contexts are useful, solve an issue itself,
or weaken the final verifier. Same-context repeats remain suppressed.

Acceptance, frozen before candidate evaluation:
- Three variants: original conventional A, original reparodynamic B, changed
  reparodynamic C. Exact baseline bytes retained in proof/recovery.
- Same deterministic observation-responsive model, public hypotheses, limits,
  initial files, public tester and separate fresh grading in every variant.
- C must resolve at least two more held-out cases than B across at least two
  distinct program families, with no B-resolved case lost and no additional
  retained public regression. Report comparison with A independently.
- All negative controls must reject false acceptance; uncertain dispatch must
  remain unreconciled and interruption must prevent later dispatch.
- Maximum 50 requests, 200 tools, six public tests, 2 MiB observed output and
  30 minutes per attempt for all variants. No budget widening or hidden retries.
- Added C tool/test calls on cases with identical A/B/C outcomes: at most two
  per case. Local median C runtime on those cases <=1.25 times B plus 25 ms,
  using three counterbalanced repetitions; timing is fixture overhead only.
- Freeze fixture/model/evaluator/settings hashes before candidate changes.
  Freeze candidate before held-out evaluation. No tuning against held-out
  results. Failed acceptance leaves an unaccepted draft experiment.

Fresh source tests and npm run verify are required. Historical live source pins
are immutable; only offline qualification pins may track this candidate.
