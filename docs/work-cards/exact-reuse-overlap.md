# Exact learned-repair overlap experiment

Owner objective: reduce complete verified warm-job latency toward the 35x Luna target without weakening acceptance.

Base release: dd5fac4a4c39617579830ab35dd49600999116d5.

## Hypothesis

For an exact-source learned repair, SARA does not need the provisional search-loop checks used to discover a repair. The exact stored proposal remains only a candidate, never PASS authority. Apply it only when the current source/scope matches exactly, then retain a fresh authoritative legacy final verification and an independent kernel verification.

The kernel may start independent verification from an early immutable preview while the generator performs its authoritative final verification. Acceptance remains blocked until both current verifications pass, the final returned candidate exactly matches the preview, authority/stop epoch remains current, and required acceptance receipts commit.

If preview and final candidate differ, discard/drain the speculative result and verify the actual returned candidate normally. If exact reuse fails fresh final verification, quarantine it and reject the job without a provider call. Exact misses retain the cold controller.

## Non-negotiable invariants

- No cached PASS, AST, diagnostics, compiler Program, kernel attestation, or protected-test answer.
- Exact learned repair eligibility binds current source and semantic scope.
- Fresh authoritative final verification remains mandatory.
- Independent kernel verification remains mandatory.
- Emergency-stop/authority checks remain effective before acceptance.
- Failed/mismatched speculative artifacts are not accepted or leaked.
- Cold jobs retain the existing controller and verifier path.
- Dedicated preview worker is lazy and bounded; prior global-worker speed claims remain unfavorable and unchanged.
- Historical benchmark grants/results remain frozen; this branch does not authorize a paid run.
- NICO/PR69 excluded.

## Qualification

1. RED/GREEN exact-hit, stale/mismatch, quarantine/fallback, preview-ordering, generator-failure, stop/authority and artifact cleanup tests.
2. Full `npm run verify`, exact-head CI and CodeQL.
3. Credential-free matched complete HTTP/kernel benchmark on exact base versus exact candidate with scripted provider responses. Report all observations, initialization, p50/p95, memory, model calls, and fresh verification counts.
4. Only if correctness gates pass and complete warm latency materially improves may this source be considered for merge/deployment.
5. A future live Luna comparison requires a new one-use authorization. Consumed benchmark 17430b72 and all historical holds/grants remain unavailable.

## Recovered-candidate findings and repairs

The transfer patch did not compile against deployed PR126 interfaces. The rebase preserves PR126's dispatcher admission epoch, copied candidate, artifact verification, and uncertain receipt retention.
Independent review reproduced full-candidate metadata omission, use of learned proposals before a cold leader's mandatory receipt committed, final-check failure falling into a new repair attempt, and inaccurate changed-line receipts. These are repaired with full memory-key matching, leader joining, terminal final rejection/quarantine, and truthful receipt counts. Historical baseline metadata is labeled nonfresh and does not claim current accuracy gain.

The first full verification did not complete: existing HTTP test fixtures did not drain newly lazy preview workers. Production shutdown already drains the kernel. Four fixtures now use that same public shutdown API; warm workers and production verification semantics are preserved.

Three matched offline repetitions passed 72/72 complete jobs with identical final source artifacts. Pooled optimized warm throughput improved 1.1127x; pair ratios were 1.1601x, 1.0577x and 1.1213x. These are scripted-provider, same-host development-fixture measurements, not Luna results or generalization proof. Random seed 739281 happened to select base then candidate in all three pairs; this order limitation is disclosed. No RSS sampling was taken. Setup and every job are retained in docs/evidence/exact-reuse-offline-qualification.json. The default kernel pool remains disabled; exact warm previews lazily use one separate worker.

The reserved new a73c932b-9df1-4ae2-91d3-6378e4e51b82 trial is one additional allowance of at most $0.15 total / $0.05 per arm, requiring new activation and exact-runtime/launcher identity. The consumed 17430b72 trial and all historical pins, grants and receipts are retained. This registration alone makes no paid request.

Final local gate: `npm run verify`, exit 0; 960 repository tests passed, typecheck and all proof commands passed. Log SHA256 `529990bc5c41ff89794a6a181409da52779c69da8cd9fc35f9b1b3225eda120d`. Development failures and their repairs above are not counted as passing gates.
