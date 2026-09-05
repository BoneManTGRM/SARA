# PR70 integration: isolated causal-novelty V5 experiment

The owner requested completion and merging of the remaining SARA PRs. This
integration is based on main 0103cf266f052b8f9c14c4123280560902a77aca and preserves
original PR70 head e07fe3e3965a8fea6d43efb3767e01595a7cecc9 in Git ancestry.

## Integrated behavior

The complete causal novelty controller, prompt, governor, aggregate-only gauge
and typed evidence contract now live under `src/experimental-v5/`. The original
three test files and offline proof are retained with imports directed to that
explicit experimental boundary. The novelty tests have a distinct filename;
they do not replace main's newer horizon-aware V5 tests. The shared production
policy, source-signal extractor and lesson builder are reused.

## Deliberate integration boundary

Do not replace current main's controller, governor, prompt or public types with
this older experimental stack. No production caller or frozen live benchmark
imports `experimental-v5`. There is no environment toggle, automatic rollout,
paid task, new dependency, infrastructure change or fresh grant here. Using the
experiment requires an explicit import and separately authorized evaluation.

The frozen summarize-ledger task and hidden tests, the baseline/treatment
controllers, existing verification boundaries and the unresolved $0.15 hold are
unchanged. This merge does not clear UNRECONCILED_MODEL_EXPOSURE or establish a
new coding-speed multiplier. The performance counterfactual is advisory-only,
not a second measured arm. Missing behavioral summaries remain null.

Offline proof: `node --import tsx proof/reparodynamic-learning-v5.ts`.
Regression tests are included in the ordinary `npm test` glob. Historical
277-test results remain historical; the integrated candidate requires its own
full verification and CodeQL before merge. No separate human review is claimed.

## Integration review repairs

Five new offline tests reproduced admission defects in the imported experiment:
expanded limits, removed protected paths, mutation of limits across an await,
truthy non-boolean verification, and negative token counts. The isolated
controller now snapshots and bounds limits/callbacks before asynchronous work,
retains protected paths and validates verification/accounting values. The
production controller was not changed. The mutation test uses the existing
STOPPED terminal name, not a new EXHAUSTED state.
