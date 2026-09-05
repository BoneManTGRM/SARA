# PR90 integration and launcher retirement

Original source: 23014289921e671f249ac62f598dbc831ceb6905. Original source and
historical receipts remain in Git history and the PR discussion.

## Useful changes integrated

Structured rejection evidence, safe allowlisted failure classification, the
external create-only claim helper, and their original offline regressions are
ported to current main. Rejection evidence is wired to the explicitly isolated
V5 experiment, not substituted into either frozen matched-benchmark controller.
Known rejected-request cost remains in evidence; unknown usage is not zero.
The original queue fixture and 77-assertion static test source are unchanged.

## Superseded operational stack

The old SSH broker/worker, Docker startup and live-source-manifest framework are
not installed in current main. PR99 already supplies the canonical owner route,
durable request claims and private evidence. Installing a second paid launcher
would recreate the problem this continuation is intended to fix. The historical
`proof/live-v7-comparison.ts` path is a fail-closed retirement stub, including
when supplied credential-shaped input or self-test flags. Its original code is
still retrievable at the source commit above. No historical grant is renewed.

The pure owner-side claim helper cannot call a provider or launch a worker. It
is not current-production authorization. It requires a retained private local
ledger and a separately trusted grant. The consumed V8 contract and the current
held continuation are explicitly rejected in addition to the original retired
V7 contracts. Deleting a ledger does not create authorization.

## Integration review repairs

New RED tests reproduced mutable-grant admission and truthy completion flags.
The helper now copies grant/observed identities before its first filesystem
await. The historical evaluator now requires actual booleans before computing
any successful-task speed ratio. No historical outcome is rescored by this
change. The V8-retirement test also first failed, then passed after denylisting
its already-consumed contract. The matched benchmark and its $0.15 hold remain
unchanged. These tests use mocks/local fixtures, not model generations.
