# Owner-requested SWE-bench Multilingual pilot

The owner accepted the proposed ten-task JavaScript/TypeScript pilot on 2026-09-07.
The requested outcome is a real SARA + Luna comparison, independently graded by
the official SWE-bench harness, with every failure and cost retained.

## Current delivery boundary

First qualify the benchmark environment with untouched-base negative controls
and published-reference positive controls. These are real repository test runs,
but are **not SARA predictions, model calls, or a SARA benchmark score**.
No paid model authorization is created by this preparation branch.

Freeze dataset revision, dataset bytes, harness revision, selection algorithm,
ten instance IDs, and base commits before reading solutions or seeing outcomes.
Select by seeded SHA-256 ordering, round-robin across all seven JS/TS repositories.
Never replace an inconvenient or broken task after seeing its result.

The control workflow runs only on the preparation branch, on standard existing
GitHub-hosted runners, with contents-read permission and no model credentials.
It must record image digests, fresh run IDs, raw logs and grading reports. A
negative control must actually run and expose an expected failing test; a
positive control must resolve the instance under the official grader. Missing
reports, timeouts, image failures, and unexpected passes remain visible failures.

## Required before model execution

The current SARA kernel accepts only restricted small TypeScript programs, not
arbitrary repository patches. `validateProgramCandidateStructure` requires
3–24 files, normalized src/*.ts / tests/*.test.ts paths, and a 48 KiB aggregate
limit. Repository package managers and normal dependencies do not fit that
contract. Preserve these checks. A repository executor and its independently
verified acceptance boundary must be implemented and qualified separately.

Generation must receive only instance ID, repository, base commit and problem
statement. Never expose reference patch, hints, grading tests, grading script,
future repository history, or control logs to the agent. Use clean checkouts and
isolated memory for each task and arm. Official evaluation happens only after
each final patch is frozen, with a separate unique run ID per arm and task.

Compare conventional SARA + Luna and Reparodynamic SARA + the same Luna using
identical inputs, tools, token/attempt/time/spending limits. Freeze the precise
algorithmic difference before launch. Report cold unseen-task success separately
from any later repeat-task experiment. Ten tasks constitute a pilot subset,
never the full Multilingual leaderboard score.

All historical Luna grants are consumed and must remain unchanged. A fresh
finite grant, actual available authorization and qualified source binding are
required before the paid stage. The $300/month ceiling is not an allowance.

## Acceptance evidence

Preparation: reproducible selection, withheld evaluator data, focused contract
tests, full npm run verify, reviewable PR, and real Docker control outcomes.
Final pilot: qualified repository executor; exact deployed/source identities;
fresh provider IDs and usage; all 20 attempts including failures; immutable
patches and official grading logs; current SARA authority/acceptance receipts;
success rate, end-to-end time and cost; detailed report with a clear summary.
