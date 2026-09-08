# Repository executor candidate — 2026-09-07

Status: local qualification candidate; **not benchmark-ready or merge-ready**.

Branch: `feat/swe-repository-executor`, incorporating PR #130 preparation and
main through `9c763cf36efbc548774725fa318acbe8dad2e7e6`.

Implemented a separate repository session and kernel verification entry point:
digest-pinned public-base images, isolated file/command execution, frozen patches,
fresh verification containers, task/arm namespaces, authority epoch rechecks,
durable artifacts and failure receipts. No repository mutation enters production
promotion. Existing bounded TypeScript checks remain unchanged.

The image preparation script accepts a reviewed public-base recipe, shallow
fetches the exact commit, and installs dependencies in a separate image build.
Actual ten-task dependency recipes have not yet been qualified. The Docker proof
and branch workflow contain real negative, positive and producer-workspace poison
controls. They have not run here: Docker is unavailable.

Public tests can be edited by a candidate. Their zero exit status is not an
official resolution result. Generator callbacks are trusted host code. Only the
deterministic supplied qualification producer makes the zero-model-call claim.
The new entry point refuses declared external or paid generation.

## Local evidence

- `node --import tsx --test tests/repository-executor.test.ts tests/kernel-coding-benchmark.test.ts`:
  exit 0, 13/13 passed.
- `node scripts/build-native-checker.mjs`: exit 0, native checker 7.0.2.
- `npm run verify`: exit 0, 1,016/1,016 main tests and all proof commands passed.
- `npm run typecheck`: exit 0.
- Python preparation checks: invalid mutable image/base and judge fields rejected;
  unavailable Docker preserved a failed build receipt with exit 127.
- `git diff --check`: exit 0.

An initial full run failed four source-pin regression tests. Historical live pins
were preserved; new offline-only qualification pins were added instead. Offline
receipts report those actual pins. Live historical benchmark dispatch still
rejects the changed source. No grant or historical evidence was reset.

Independent read-only review found and resolved lost receipts on cleanup failure
and a proof artifact restoration issue. It confirmed the historical live grants
remain closed. Actual Docker isolation has not yet been empirically qualified.

## Remaining gates

1. Publish this branch as a draft PR and execute the prepared Docker workflow.
2. Qualify public base/dependency images for all ten frozen tasks.
3. Connect judge-controlled official grading to frozen-patch kernel acceptance.
4. Implement and freeze matched conventional/Reparodynamic Luna execution and
   accounting, with isolated memory and no reference data available to producers.
5. Bind a fresh exact spending allowance to the qualified source/protocol.
6. Run and retain all 20 real attempts, usage, costs, times and official results.

Automatic approval review rejected the attempted GitHub push because explicit
authorization for publication of this new branch was required. No workaround was
attempted. Publication and remote Docker qualification remain blocked pending
that authorization. No benchmark attempts or paid model calls were made.
