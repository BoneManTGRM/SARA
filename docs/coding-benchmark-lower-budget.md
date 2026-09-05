# Lower-budget configuration for the existing live evidence command

## Bounded change

`benchmark:coding:evidence:live` accepts `--max-arm-spend-usd` in addition to
its existing whole-cent `--max-spend-usd` total. One common arm ceiling applies
to both conventional and active Reparodynamic paths. It must be positive, no
more than the unchanged $0.15 policy maximum, and use at most six decimal places.

For a $0.15 one-pair authorization, the budget-related arguments are:

```text
--case-count 1 --max-spend-usd 0.15 --max-arm-spend-usd 0.075
```

These arguments alone are NOT an execution authorization or a complete launch
command. The existing exact-source, authority-digest, LAB acknowledgement,
credential and permanent execution-claim requirements still apply. The authority
input now optionally accepts `maximumModelSpendUsdPerArm`. Include `0.075` when
binding this lower ceiling. Omitting the option preserves the old $0.15-per-arm
behavior and the exact old authority digest. A copied digest cannot authorize a
changed arm ceiling. This change does not renew any historical grant.

Admission checks sufficient capacity for every complete pair before execution,
using integer micro-dollars rather than rounding down to cents. Two $0.076 arms
cannot be admitted under a $0.15 total. Unused total budget does not enlarge an
arm. The live script passes the same admitted ceiling to each controller and
verifier and uses it for its pre-arm admission check.

The provider adapter continues to conservatively floor request-level budgets to
whole cents; a $0.075 remaining arm allowance therefore permits a request ceiling
of at most $0.07, not $0.08. Smaller remaining amounts may stop without another
request. No output-token limit, model, reasoning setting, pricing rate, retry
ceiling, protected path, emergency-stop setting or production default changes.

## Evidence and limitations

The new command tests recorded eight expected failures against the original
implementation, then eight passes after the change. Four added controller
coverage cases exercise the already-supported lower runtime limit, including
three-attempt success and budget-exhausted incompletion in both arms. These use
scripted model responses, NOT paid model generations. A test initially referenced
the wrong evidence field; its error is retained separately and is not counted as
a product defect or expected red test.

The permanent execution claim, crash/concurrency/replay behavior, unknown-usage
halt, fresh final verification and existing owner controls are unchanged. The
same retained private state directory remains necessary; deletion of its ledger
or copying a grant into an unrelated directory is not supported as safe replay.

This patch does NOT certify the requested fresh live comparison as ready or run.
The inspected Railway connection has no command/SSH execution capability. The
local environment has no authenticated Railway CLI, and current emergency-stop
state was not verified. No retired worker was restarted and production startup
was not repurposed as a benchmark launcher.

The existing command still selects its historical synthetic corpus. A new
nontrivial task, protected acceptance suite, protocol/order and source must be
frozen before a fresh paid generation. Per-attempt solution files and full worker
receipts also need durable capture for the requested evidence package; this
budget-only patch does not add that capture or mislabel old tasks as new trials.

No provider call or real paid-run execution claim was made while preparing this
patch. No new infrastructure, paid authorization, scheduled benchmark, compact
format, compiler cache or production rollout was enabled. PRs #70, #90 and #93
are not prerequisites for this budget configuration change.
